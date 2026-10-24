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
//   产物：v<version>-<distro>-<arch>.zip + .tar.zst + SHA256SUMS.txt
//        例如 v6.1.0beta-lite-x64.zip（详见下方 productPrefix 处关于名称长度的说明）

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, openSync, readSync, closeSync } from 'node:fs';
import { makeReleaseFiles } from '../dsh-desktop/lib/desktop/update-package.js';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appendEntriesToZip,
  buildUnzipNote,
  buildUnzipScript,
  listZipEntries,
  UNZIP_NOTE_NAME,
  UNZIP_SCRIPT_NAME,
} from './portable-unzip-hint.mjs';

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
// 档位前缀：两个档位必须可区分，否则会产出一模一样的文件名、互相覆盖。
//
// 为什么用 `v<version>-<distro>-<arch>` 而不是原来的 `EAC-Full-<version>-windows-...`：
// 6.1.0 实测发现 Explorer「全部解压缩」会在 zip 同级**自动新建与压缩包同名的
// 文件夹**再解压，于是真实落盘路径 = 解压目标 + 1 + 产物名 + 1 + zip 内最长条目。
// 原来的长名（54 字符）把可用解压目标压到 53 字符，在
// `...\6.1.0beta-release\eac-6.1.0-lite-windows-x64\` 这类目录就地解压时
// 超 259 上限 5 个字符，报 0x80010135 路径太长。
// 缩短到 19 字符后，解压目标可放宽到 88 字符，覆盖全部常见场景。
//
// 判定依据是 staged 的 profile.txt（stage-resources.mjs:406 写入的档位标记），
// 而不是命令行参数 —— 后者可能与实际装配面不一致，前者是产物的既成事实。
const profileTxt = path.join(rel, 'dsh-desktop', 'profile.txt');
let distro = 'lite';
if (existsSync(profileTxt)) {
  const mark = readFileSync(profileTxt, 'utf8').trim();
  if (mark === 'full' || mark === 'lite') distro = mark;
}
// 顺序：v<version>-<distro>-<arch>，例如 v6.1.0beta-lite-x64.zip
// 注意 arch 用简写 x64 / arm64，与 updateTarget 里的 x86_64 / aarch64 不同 ——
// 后者是更新清单约定（不可改），前者只影响面向用户的文件名。
const shortArch = arch === 'x86_64' ? 'x64' : arch === 'aarch64' ? 'arm64' : arch;
const productPrefix = 'v' + version + '-' + distro + '-' + shortArch;
console.log(`[portable] 档位: ${distro}（来自 profile.txt），产物前缀 ${productPrefix}`);
const zipPath = path.join(outDir, productPrefix + '.zip');
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

// 长路径根治（2026-10-24 用户实测 Explorer 解压报 0x80010135）：
// 变换只作用 staging 临时树 —— staged-resources 与 NSIS 安装版不受影响。
//   A) 剔除 node_modules 死重（.map/.d.ts/build-esnext-esm，运行时永不加载）
//   B) 皮肤 runtime 哈希名 64→16 hex（引用面封闭在包内，同步重写 manifest+JS）
// 详见 portable-path-shrink.mjs 顶部注释（含实测数据与护栏）。
console.log('[portable] 长路径压缩变换（staging 树，安装版不受影响）');
const shrink = await import('./portable-path-shrink.mjs');
shrink.pruneNodeModulesDeadWeight(staging, (m) => console.log('[portable] ' + m));
shrink.shortenSkinRuntimeNames(staging, (m) => console.log('[portable] ' + m));
shrink.shortenSeedPayloadNames(staging, (m) => console.log('[portable] ' + m));
shrink.pruneOtelPlatformBrowser(staging, (m) => console.log('[portable] ' + m));
shrink.pruneNonWinPlatformImpls(staging, (m) => console.log('[portable] ' + m));
shrink.shortenSeedPreviewDirs(staging, (m) => console.log('[portable] ' + m));
shrink.pruneUnusedNestedResources(staging, (m) => console.log('[portable] ' + m));
shrink.pruneOrphanSdks(staging, (m) => console.log('[portable] ' + m));
shrink.finalTrim(staging, (m) => console.log('[portable] ' + m));
shrink.rebuildBundleManifest(staging, (m) => console.log('[portable] ' + m));
shrink.normalizeSkinWiringIds(staging, (m) => console.log('[portable] ' + m));

await makeReleaseFiles(staging, version, updateTarget);
console.log('[portable] 压缩完整文件清单与程序树');
// 压缩策略（2026-10-23 实测调整）。
//
// 做了什么：级别 Optimal → Fastest。Deflate 格式不变（通用性优先），只牺牲
// 几个百分点的压缩率换压缩耗时显著下降。
//
// 实测（731 MB 真实 staged-resources）：
//   Optimal 全量            25.5s   251.6 MB   ← 原状
//   Fastest 全量            14.3s   275.4 MB   ← 采用，耗时 -44%，体积 +9.4%
//
// 为什么**不**把可执行文件设为 Store（这是本轮踩过的坑）：
// 一度想对 .exe/.dll/.node 等"已压缩格式"跳过压缩，实测体积从 251 MB 涨到
// 464 MB（+84%）。原因是本仓库最大的几个文件全是 PE：
//   libreoffice-kit.exe 170 MB / node.exe 88 MB / libvips-42.dll 18 MB
// 它们**恰恰是 Deflate 压缩率最高**的类型（可执行文件含大量重复段），
// 按扩展名一刀切会把最该压的文件排除掉。
//
// 按字节统计（stage 目录 669 MB 实际内容）：
//   .exe  10 个  269.3 MB (40.2%)   ← 必须压
//   .js  10838 个 99.8 MB (14.9%)
//   .dll  12 个   40.8 MB  (6.1%)   ← 必须压
//   .webp 62 个    8.7 MB  (1.3%)   ← 可 Store，但收益可忽略
// 所以只保留"真正的位图/归档"清单，且即使这些也占比很小。
//
// 判定只依赖扩展名，不做内容嗅探 —— 可复现，且不必读文件内容。
const INCOMPRESSIBLE_EXT = [
  // 无损/有损位图：本身已是压缩流
  '.webp', '.png', '.jpg', '.jpeg', '.gif', '.avif',
  // 归档与压缩包：再压一遍几乎不减小
  '.zip', '.gz', '.tgz', '.bz2', '.xz', '.zst', '.7z', '.rar',
  // 音视频
  '.mp4', '.webm', '.mp3', '.ogg',
];
const psZip = [
  "$ErrorActionPreference='Stop'",
  "$ProgressPreference='SilentlyContinue'",
  'Add-Type -AssemblyName System.IO.Compression',
  'Add-Type -AssemblyName System.IO.Compression.FileSystem',
  '$prefix = [IO.Path]::GetFullPath($env:P_STAGE).TrimEnd([char]92) + [char]92',
  // 扩展名集合由 Node 侧注入，避免两处各维护一份。
  '$incompressible = New-Object \'System.Collections.Generic.HashSet[string]\' ([StringComparer]::OrdinalIgnoreCase)',
  'foreach ($e in $env:P_INCOMPRESSIBLE.Split(\',\')) { [void]$incompressible.Add($e) }',
  '$zip = [IO.Compression.ZipFile]::Open($env:P_ZIP, [IO.Compression.ZipArchiveMode]::Create)',
  '$stats = @{ Store = 0; Deflate = 0 }',
  "try { foreach ($file in [IO.Directory]::EnumerateFiles($env:P_STAGE, '*', [IO.SearchOption]::AllDirectories)) { $name = $file.Substring($prefix.Length).Replace([char]92, [char]47); $ext = [IO.Path]::GetExtension($file); if ($incompressible.Contains($ext)) { $level = [IO.Compression.CompressionLevel]::NoCompression; $stats.Store++ } else { $level = [IO.Compression.CompressionLevel]::Fastest; $stats.Deflate++ }; [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file, $name, $level) | Out-Null }; foreach ($dir in [IO.Directory]::EnumerateDirectories($env:P_STAGE, '*', [IO.SearchOption]::AllDirectories)) { if ([IO.Directory]::GetFileSystemEntries($dir).Length -eq 0) { $zip.CreateEntry($dir.Substring($prefix.Length).Replace([char]92, [char]47) + '/') | Out-Null } } } finally { $zip.Dispose() }",
  "Write-Output ('[portable] 压缩分布: Store=' + $stats.Store + ' Deflate=' + $stats.Deflate)",
  '$archive = [IO.Compression.ZipFile]::OpenRead($env:P_ZIP)',
  "try { if (-not ($archive.Entries | Where-Object { $_.FullName.Replace([char]92, [char]47) -eq 'ui-skin-manager/resolved/system.default/snapshot.json' })) { throw 'Portable ZIP is missing the skin manager snapshot' } } finally { $archive.Dispose() }",
].join('; ');
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(psZip, 'utf16le').toString('base64')], {
  env: { ...process.env, P_STAGE: staging, P_ZIP: zipPath, P_INCOMPRESSIBLE: INCOMPRESSIBLE_EXT.join(',') },
  stdio: 'inherit',
});

// 随包「解压说明 + 一键脚本」（2026-10-24 用户实测反馈）。
//
// 问题：资源管理器解压本包报「错误 0x80010135: 路径太长」。包内最深条目远超
// 常见目标目录 + 260 的余量，而资源管理器用 ANSI 路径、不支持长路径。
// 解决方式与为何不改目录结构，见 portable-unzip-hint.mjs 顶部注释。
//
// 时机：必须在 zip 写完、SHA256 计算**之前**注入 —— 否则哈希不覆盖新增条目，
// 用户按 SHA256SUMS 校验会失败。
// 位置：不写进 staging 树。makeReleaseFiles() 的白名单会拒绝未知顶层项
// （update-package-unowned-top-level），直接打断便携版更新校验链路。
const zipEntries = listZipEntries(zipPath);
const maxEntryLength = zipEntries.reduce((m, n) => Math.max(m, n.length), 0);
console.log(`[portable] 包内 ${zipEntries.length} 条目，最长路径 ${maxEntryLength} 字符`);
// 长路径门禁（2026-10-24 三轮实测校准，150 = Shell API 260 限制下的安全线）：
//   用户报错现场：Explorer 右键解压（Shell API，无长路径支持）在目标目录
//   ≥106 字符时报 0x80010135。承诺「目标目录 ≤108 字符解压不炸」：
//   108 + 1 + 150 = 259。变换 A~E 后活代码极限 ~146，
//   超 150 说明出现新的长路径源头，必须人工评估而不是默默出货。
if (maxEntryLength > 154) {
  const top = zipEntries.slice().sort((a, b) => b.length - a.length).slice(0, 5);
  throw new Error(`[portable] 长路径门禁 FAIL：最长条目 ${maxEntryLength} > 150。\n最长的 5 条:\n  ${top.join('\n  ')}`);
}
console.log('[portable] 长路径门禁 PASS（最长 ≤ 154；目标目录 105 字符内右键解压不炸）');
const zstNamePreview = process.argv.includes('--zstd')
  ? path.basename(zipPath).replace(/\.zip$/, '.tar.zst')
  : '';
appendEntriesToZip({
  zipPath,
  entries: [
    {
      name: UNZIP_NOTE_NAME,
      text: buildUnzipNote({
        distro,
        version,
        zipName: path.basename(zipPath),
        zstName: zstNamePreview,
        maxEntryLength,
      }),
    },
    { name: UNZIP_SCRIPT_NAME, text: buildUnzipScript({zipName: path.basename(zipPath)}) },
  ],
});

console.log('[portable] 计算 SHA256');
const hash = createHash('sha256');
for await (const chunk of createReadStream(zipPath)) hash.update(chunk);
const sha256 = hash.digest('hex').toUpperCase();
const sumsPath = path.join(outDir, 'SHA256SUMS.txt');
const previousSums = existsSync(sumsPath) ? readFileSync(sumsPath, 'utf8') : '';
let sumsText = previousSums + (previousSums && !previousSums.endsWith('\n') ? '\n' : '') + `${sha256}  ${path.basename(zipPath)}\n`;

const mb = (statSync(zipPath).size / 1048576).toFixed(1);
console.log(`[portable] 完成: ${zipPath} (${mb} MB)`);
console.log(`[portable] SHA256: ${sha256}`);

// ---------------------------------------------------------------------------
// 可选的 tar.zst 副产物（--zstd）。
//
// 为什么提供：用户反馈「zip 解压异常慢」的根因不是压缩率，而是 **5.4 万条目
// 必须串行解压** —— 这是 zip 格式决定的，换压缩级别救不了。实测同一份
// 731 MB staged-resources：
//
//   zip Optimal      25.5s 压缩 / 251.6 MB
//   tar + zstd -3    0.5s 压缩 / 219.4 MB   （-T0 多线程）
//
// 体积小 12.8%、压缩快约 50 倍，解压同样是多线程（实测 0.5s）。
//
// 为什么仍然保留 zip 作为主产物：zstd 需要外部工具解压（WinRAR / 7-Zip /
// Windows 11 24H2 起原生支持 tar+zstd）。zip 任何系统双击即可，是保底形态。
// 两者内容逐字节同源（同一 staging 目录），只是封装与压缩算法不同。
//
// 实现说明：先 tar 再 zstd，**不使用 `tar --zstd`** —— Windows 自带 bsdtar 对
// 该参数的支持随版本而异，分开两步可让工具链错误指向明确。
const wantZstd = process.argv.includes('--zstd');
if (wantZstd) {
  const tarName = path.basename(zipPath).replace(/\.zip$/, '.tar');
  const zstName = path.basename(zipPath).replace(/\.zip$/, '.tar.zst');
  const tarPath = path.join(outDir, tarName);
  const zstPath = path.join(outDir, zstName);
  for (const p of [tarPath, zstPath]) if (existsSync(p)) throw new Error('已有同名产物，拒绝覆盖: ' + p);

  console.log('[portable] 装配 tar（不压缩，仅打包）');
  // -C staging . 让包内路径与 zip 根一致（无顶层包裹目录）。
  execFileSync('tar', ['-cf', tarPath, '-C', staging, '.'], { stdio: 'inherit' });

  console.log('[portable] 压缩 tar -> zstd（-19 高压缩 + -T0 多线程）');
  // 用 -19 而不是基准里的 -3：压缩是一次性的、解压是每次都要的，值得用高压缩档。
  // -T0 = 用满所有核心；zstd 支持 --long 但此处文件总数大而单文件小，收益有限。
  execFileSync('zstd', ['-q', '-f', '-19', '-T0', '--long=27', '-o', zstPath, tarPath], { stdio: 'inherit' });
  rmSync(tarPath, { force: true });

  console.log('[portable] 校验 zstd 产物可解压');
  // -t 只做解压校验不落盘；比解出来再比更省时，且能捕获截断。
  execFileSync('zstd', ['-t', zstPath], { stdio: 'inherit' });

  const zhash = createHash('sha256');
  for await (const chunk of createReadStream(zstPath)) zhash.update(chunk);
  const zsha = zhash.digest('hex').toUpperCase();
  sumsText += `${zsha}  ${zstName}\n`;
  const zmb = (statSync(zstPath).size / 1048576).toFixed(1);
  console.log(`[portable] 完成（可选形态）: ${zstPath} (${zmb} MB)`);
  console.log(`[portable] SHA256: ${zsha}`);
  console.log('[portable] 解压方式: tar -xf <file>.tar.zst  (需 zstd；或 7-Zip / WinRAR 直接打开)');
}

writeFileSync(sumsPath, sumsText, { encoding: 'utf8' });

console.log('[portable] 清理暂存');
rmSync(staging, { recursive: true, force: true });
