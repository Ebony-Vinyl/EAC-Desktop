'use strict';
// Tauri 便携版装配（P4/R6）：把 release 构建产物打成 zip 分发包。
//
// 布局（= NSIS 安装树同构，resource_root() exe 同级解析）：
//   dsh-eac-shell.exe
//   .dsh-portable          ← 便携标记（client-updater isTauriPortable 判定）
//   sidecar/{server,bridge,rescue-integration}.js
//   dsh-desktop/<完整运行树>
//   ui-skin-manager/<皮肤管理器资源>
//   dpx/<pinned runtime isolation API>
//
// 用法：node make-portable.mjs [--out <dir>]
//   前置：tauri build 已完成（target/release/{dsh-eac-shell.exe, sidecar/, dsh-desktop/}）。
//   产物：EAC-Lite-<version>-windows-<arch>-portable.zip + SHA256SUMS.txt

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, openSync, readSync, closeSync } from 'node:fs';
import { makeReleaseFiles } from '../dsh-desktop/lib/desktop/update-package.js';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const shellDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const repo = path.resolve(shellDir, '..');
const targetArg = process.argv.indexOf('--target');
const triple = targetArg > -1 ? process.argv[targetArg + 1] : '';
if (targetArg > -1 && (!triple || triple.startsWith('--'))) throw new Error('--target requires a build triple');
if (triple && !['x86_64-pc-windows-msvc', 'aarch64-pc-windows-msvc'].includes(triple)) throw new Error('Unsupported portable build target');
const rel = path.join(shellDir, 'target', ...(triple ? [triple] : []), 'release');
const version = JSON.parse(readFileSync(path.join(repo, 'dsh-desktop', 'package.json'), 'utf8')).version || '0.0.0';

const outArg = process.argv.indexOf('--out');
if (outArg > -1 && (!process.argv[outArg + 1] || process.argv[outArg + 1].startsWith('--'))) throw new Error('--out requires a directory');
const outDir = outArg > -1 ? path.resolve(process.argv[outArg + 1]) : path.join(rel, 'portable');

const exe = path.join(rel, 'dsh-eac-shell.exe');
for (const need of [exe, path.join(rel, 'sidecar', 'server.js'), path.join(rel, 'dsh-desktop', 'package.json'), path.join(rel, 'ui-skin-manager', 'resolved', 'system.default', 'snapshot.json'), path.join(rel, 'dpx', 'src', 'index.js')]) {
  if (!existsSync(need)) {
    console.error('[portable] 缺少构建产物: ' + need);
    console.error('[portable] 请先完成 tauri build（或 node stage-resources.mjs 后 cargo tauri build）');
    process.exit(1);
  }
}

mkdirSync(outDir, { recursive: true });
const descriptor = openSync(exe, 'r');
let machine;
try {
  const dos = Buffer.alloc(64); readSync(descriptor, dos, 0, dos.length, 0);
  if (dos.toString('ascii', 0, 2) !== 'MZ') throw new Error('Portable shell is not a PE executable');
  const pe = Buffer.alloc(6); readSync(descriptor, pe, 0, pe.length, dos.readUInt32LE(60));
  if (pe.readUInt32LE(0) !== 0x4550) throw new Error('Portable shell PE header is invalid');
  machine = pe.readUInt16LE(4);
} finally {closeSync(descriptor);}
const arch = machine === 0x8664 ? 'x86_64' : machine === 0xaa64 ? 'aarch64' : '';
if (!arch || (triple && !triple.startsWith(arch + '-'))) throw new Error('Portable shell architecture differs from target');
const updateTarget = 'windows-' + arch + '-portable';
const zipPath = path.join(outDir, 'EAC-Lite-' + version + '-' + updateTarget + '.zip');
if (existsSync(zipPath)) throw new Error('Portable ZIP already exists: ' + zipPath);

console.log('[portable] 装配暂存目录（zip 根 = 安装树同构，顶层无包裹目录）');
const staging = path.resolve(outDir, '.staging-portable-' + randomUUID());
const stagingRelative = path.relative(path.resolve(outDir), staging);
if (path.isAbsolute(stagingRelative) || stagingRelative.startsWith('..') || !path.basename(staging).startsWith('.staging-portable-')) throw new Error('Portable staging escaped its output directory');
mkdirSync(staging, { recursive: true });
copyFileSync(exe, path.join(staging, 'dsh-eac-shell.exe'));
writeFileSync(path.join(staging, '.dsh-portable'), '');
writeFileSync(path.join(staging, 'eac-installation.json'), JSON.stringify({schemaVersion: 1, product: 'eac-desktop', installKind: 'portable', arch}, null, 2) + '\n');
// WebView2Loader.dll：安装版由 tauri.windows.conf.json 把 staged-resources/ 里的
// 该文件映射到 exe 同级，便携 zip 补上以保持两形态产物面一致。实测壳 exe 已
// 静态链接 webview2（导入表无该 DLL），此文件属防御性冗余 —— 故为 best-effort：
// target/release 下存在才复制，缺失跳过（stage-resources 仅在 win32 且找到
// webview2-com-sys 时装配它，跨形态/旧缓存缺失属正常，不必 fail-fast）。
const webview2Loader = path.join(rel, 'WebView2Loader.dll');
if (existsSync(webview2Loader)) {
  copyFileSync(webview2Loader, path.join(staging, 'WebView2Loader.dll'));
  console.log('[portable] WebView2Loader.dll 已随包（与安装版产物面一致）');
}

// robocopy 退出码 0-7 均为成功语义（1=有文件复制）；execFileSync 对非零会抛，需容错。
function robocopy(src, dest) {
  let code = 0;
  try {
    execFileSync('robocopy.exe', [src, dest, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'], {stdio: 'ignore', windowsHide: true});
  } catch (e) {
    code = e.status == null ? 8 : e.status;
  }
  if (code >= 8) throw new Error(`robocopy 失败 (${code}): ${src} -> ${dest}`);
}

console.log('[portable] 复制 sidecar + dsh-desktop + ui-skin-manager（数万文件，耐心等）');
robocopy(path.join(rel, 'sidecar'), path.join(staging, 'sidecar'));
robocopy(path.join(rel, 'dsh-desktop'), path.join(staging, 'dsh-desktop'));
robocopy(path.join(rel, 'ui-skin-manager'), path.join(staging, 'ui-skin-manager'));
robocopy(path.join(rel, 'dpx'), path.join(staging, 'dpx'));

await makeReleaseFiles(staging, version, updateTarget);
console.log('[portable] 压缩完整文件清单与程序树');
const psZip = [
  "$ErrorActionPreference='Stop'",
  "$ProgressPreference='SilentlyContinue'",
  'Add-Type -AssemblyName System.IO.Compression',
  'Add-Type -AssemblyName System.IO.Compression.FileSystem',
  '$prefix = [IO.Path]::GetFullPath($env:P_STAGE).TrimEnd([char]92) + [char]92',
  '$zip = [IO.Compression.ZipFile]::Open($env:P_ZIP, [IO.Compression.ZipArchiveMode]::Create)',
  "try { foreach ($file in [IO.Directory]::EnumerateFiles($env:P_STAGE, '*', [IO.SearchOption]::AllDirectories)) { $name = $file.Substring($prefix.Length).Replace([char]92, [char]47); [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file, $name, [IO.Compression.CompressionLevel]::Optimal) | Out-Null }; foreach ($dir in [IO.Directory]::EnumerateDirectories($env:P_STAGE, '*', [IO.SearchOption]::AllDirectories)) { if ([IO.Directory]::GetFileSystemEntries($dir).Length -eq 0) { $zip.CreateEntry($dir.Substring($prefix.Length).Replace([char]92, [char]47) + '/') | Out-Null } } } finally { $zip.Dispose() }",
  '$archive = [System.IO.Compression.ZipFile]::OpenRead($env:P_ZIP)',
  "try { if (-not ($archive.Entries | Where-Object { $_.FullName.Replace([char]92, [char]47) -eq 'ui-skin-manager/resolved/system.default/snapshot.json' })) { throw 'Portable ZIP is missing the skin manager snapshot' } } finally { $archive.Dispose() }",
].join('; ');
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(psZip, 'utf16le').toString('base64')], {
  env: { ...process.env, P_STAGE: staging, P_ZIP: zipPath },
  stdio: 'inherit',
});

console.log('[portable] 计算 SHA256');
const hash = createHash('sha256');
for await (const chunk of createReadStream(zipPath)) hash.update(chunk);
const sha256 = hash.digest('hex').toUpperCase();
const sumsPath = path.join(outDir, 'SHA256SUMS.txt');
const previousSums = existsSync(sumsPath) ? readFileSync(sumsPath, 'utf8') : '';
writeFileSync(sumsPath, previousSums + (previousSums && !previousSums.endsWith('\n') ? '\n' : '') + `${sha256}  ${path.basename(zipPath)}\n`);

console.log('[portable] 清理暂存');
rmSync(staging, { recursive: true, force: true });

const mb = (statSync(zipPath).size / 1048576).toFixed(1);
console.log(`[portable] 完成: ${zipPath} (${mb} MB)`);
console.log(`[portable] SHA256: ${sha256}`);
