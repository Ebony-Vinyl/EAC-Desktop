'use strict';
// 平台原生 payload 裁剪（stage-resources.mjs 装配期使用）。
// 独立模块：stage-resources.mjs 无 main guard，import 即执行全量装配，
// 纯函数放这里供 node:test 直接导入。
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** 安装版与便携版共同排除调试映射及 Zod 自测；保留运行代码与运行时检查使用的类型。 */
export function pruneDevelopmentPayloads(nodeModules) {
  let removed = 0;
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        const relative = '/' + path.relative(nodeModules, file).split(path.sep).join('/') + '/';
        if (entry.name === 'tests' && relative.includes('/zod/src/')) {
          removed += readdirSync(file, { recursive: true, withFileTypes: true }).filter((item) => item.isFile()).length;
          rmSync(file, { recursive: true });
        } else walk(file);
      } else if (entry.isFile() && /\.(?:[cm]?js|css)\.map$/i.test(entry.name)) {
        rmSync(file);
        removed++;
      }
    }
  };
  walk(nodeModules);
  return removed;
}

const LINUX_ELF_MACHINES = {
  x64: 62,
  arm64: 183,
};

export function assertSupportedStageArch(arch) {
  if (arch !== 'x64' && arch !== 'arm64') {
    throw new Error(`[stage] 不支持目标架构: ${arch}（仅支持 x64/arm64）`);
  }
}

export function isLinuxElfForArch(file, arch) {
  const machine = LINUX_ELF_MACHINES[arch];
  if (machine === undefined) return false;
  try {
    const data = readFileSync(file);
    return data.length >= 20
      && data[0] === 0x7f && data.subarray(1, 4).toString('ascii') === 'ELF'
      && data[4] === 2 && data[5] === 1
      && data.readUInt16LE(18) === machine;
  } catch {
    return false;
  }
}

export function isMuslPayloadPath(relative) {
  return relative.split(/[\\/]/).some(part => /linuxmusl|^musl(?:[_-]|$)|[-_]musl(?:[-_]|$)/i.test(part));
}

export function pruneLinuxPayloads(dir, arch) {
  assertSupportedStageArch(arch);
  const prune = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        prune(file);
        if (readdirSync(file).length === 0) rmSync(file, { recursive: true, force: true });
        continue;
      }
      if (!entry.isFile()) continue;
      // musl addons are also ELF for this architecture, including copies in
      // nested node_modules. Their path identifies the incompatible libc.
      const musl = isMuslPayloadPath(path.relative(dir, file));
      if (/\.(?:exe|dll)$/i.test(entry.name)
        || (/\.node$/i.test(entry.name) && (musl || !isLinuxElfForArch(file, arch)))) {
        rmSync(file, { force: true });
      }
    }
  };
  prune(dir);
}

export function pruneNonLinuxPrebuilds(dir, arch) {
  assertSupportedStageArch(arch);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = path.join(dir, entry.name);
    if (entry.name === 'prebuilds') {
      for (const platformDir of readdirSync(child, { withFileTypes: true })) {
        if (platformDir.isDirectory() && platformDir.name !== `linux-${arch}`) {
          rmSync(path.join(child, platformDir.name), { recursive: true, force: true });
        }
      }
    } else {
      pruneNonLinuxPrebuilds(child, arch);
    }
  }
}

/** 删除 node-addon-system 的 musl 变体（glibc 发行版里不可达）。
 * 该包同时分发 `bin/glibc/system.node` 与 `bin/musl/system.node`，运行时按
 * `process.report.header.glibcVersionRuntime` 二选一（内核 native/system
 * packages/entry/src/flock.ts）。发行目标是 glibc 的 deb/AppImage，musl 那份
 * 永远不可达，却是静态链接的 .node：linuxdeploy 对它调 ldd 会直接 abort
 * （`Failed to run ldd: exited with code 1`），AppImage 打包整体失败。
 * `pruneMuslPackages` 只看包名里的 linuxmusl 字样，命中不了这个子目录。 */
export function pruneMuslNodeAddonBinaries(nodeModules) {
  const scope = path.join(nodeModules, '@deepseek-ai');
  if (!existsSync(scope)) return;
  const pruned = [];
  for (const entry of readdirSync(scope, { withFileTypes: true })) {
    if (entry.isDirectory() && /^node-addon-system-linux-/.test(entry.name)) {
      const packageDir = path.join(scope, entry.name);
      const glibc = path.join(packageDir, 'bin', 'glibc', 'system.node');
      if (!existsSync(glibc)) {
        throw new Error(`[stage] ${entry.name} 缺少 glibc/system.node，无法安全剔除 musl 变体`);
      }
      rmSync(path.join(packageDir, 'bin', 'musl'), { recursive: true, force: true });
      pruned.push(entry.name);
    }
  }
  if (pruned.length) console.log(`[stage] 已剔除 musl 变体：${pruned.join(', ')}`);
}

/** 是否为 64 位小端 Mach-O（.node 在 macOS 上为 Mach-O dylib）。
 * 假设：npm 生态的 darwin-arm64 .node 均为 thin（单架构）dylib；若未来出现 FAT/universal 二进制会被误删，届时需扩展魔数识别。 */
export function isMachO(file) {
  try {
    const data = readFileSync(file);
    return data.length >= 4
      && data[0] === 0xcf && data[1] === 0xfa && data[2] === 0xed && data[3] === 0xfe;
  } catch {
    return false;
  }
}

export function pruneDarwinPayloads(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      pruneDarwinPayloads(file);
      if (readdirSync(file).length === 0) rmSync(file, { recursive: true, force: true });
      continue;
    }
    if (!entry.isFile()) continue;
    if (/\.(?:exe|dll)$/i.test(entry.name) || (/\.node$/i.test(entry.name) && !isMachO(file))) {
      rmSync(file, { force: true });
    }
  }
}

export function pruneNonDarwinPrebuilds(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = path.join(dir, entry.name);
    if (entry.name === 'prebuilds') {
      for (const platformDir of readdirSync(child, { withFileTypes: true })) {
        if (platformDir.isDirectory() && platformDir.name !== 'darwin-arm64') {
          rmSync(path.join(child, platformDir.name), { recursive: true, force: true });
        }
      }
    } else {
      pruneNonDarwinPrebuilds(child);
    }
  }
}

// ── 装配预演（只读）─────────────────────────────────────────────────────────
// stage-resources 的裁剪是破坏性的；装配前用同一套判据做一次 dry-run，回答
// 「哪些文件会被删、删完有没有包变成无运行时载荷」。CI 与本地都可直接跑：
//   node tauri-shell/stage-platform-prune.mjs --plan [--root <node_modules>]
//        [--platform win32|linux|darwin] [--arch x64|arm64] [--json]

const RE_DEV_MAP = /\.(?:[cm]?js|css)\.map$/i;
const RE_RUNTIME_FILE = /\.(?:[cm]?js|node|wasm|dll|so|dylib)$/i;

/** 单个文件的裁剪判定；返回原因或 null（保留）。 */
function pruneReason(file, platform, arch) {
  const name = path.basename(file);
  const posix = file.split(path.sep).join('/');
  if (RE_DEV_MAP.test(name)) return 'source-map';
  if (platform !== 'linux' && platform !== 'darwin') return null;
  if (/\.(?:exe|dll)$/i.test(name)) return 'foreign-binary';
  if (/\.node$/i.test(name)) {
    if (platform === 'linux') {
      if (isMuslPayloadPath(posix)) return 'musl';
      return isLinuxElfForArch(file, arch) ? null : 'foreign-binary';
    }
    return isMachO(file) ? null : 'foreign-binary';
  }
  const prebuild = /\/prebuilds\/([^/]+)\//.exec(posix);
  if (prebuild) {
    const wanted = platform === 'linux' ? `linux-${arch}` : 'darwin-arm64';
    if (prebuild[1] !== wanted) return 'foreign-prebuilds';
  }
  return null;
}

function walkPackage(dir, onFile, onPrunedDir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'tests' && full.split(path.sep).join('/').includes('/zod/src/')) {
        onPrunedDir(full);
        continue;
      }
      walkPackage(full, onFile, onPrunedDir);
    } else if (entry.isFile()) {
      onFile(full);
    }
  }
}

function countFiles(dir) {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) n += countFiles(full);
    else if (entry.isFile()) n += 1;
  }
  return n;
}

/** 只读裁剪预演：统计将删除的文件与裁剪后无运行时载荷的包。 */
export function planPrune(nodeModules, options = {}) {
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  if ((platform === 'linux' || platform === 'darwin') && arch !== 'x64' && arch !== 'arm64') assertSupportedStageArch(arch);

  const packageEntries = [];
  for (const entry of readdirSync(nodeModules, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(nodeModules, entry.name);
    if (entry.name.startsWith('@')) {
      for (const sub of readdirSync(full, { withFileTypes: true })) {
        if (sub.isDirectory()) packageEntries.push({ name: `${entry.name}/${sub.name}`, dir: path.join(full, sub.name) });
      }
    } else {
      packageEntries.push({ name: entry.name, dir: full });
    }
  }

  const removedByReason = {};
  const samples = [];
  const noRuntimePayload = [];
  let files = 0;

  for (const pkg of packageEntries) {
    let runtime = 0;
    const pkgRemoved = [0];
    let prunedDirs = 0;
    const tally = (reason, count) => {
      removedByReason[reason] = (removedByReason[reason] || 0) + count;
      pkgRemoved[0] += count;
    };
    walkPackage(pkg.dir, (file) => {
      files += 1;
      const reason = pruneReason(file, platform, arch);
      if (reason) {
        tally(reason, 1);
        if (samples.length < 40) samples.push({ package: pkg.name, file: path.relative(nodeModules, file).split(path.sep).join('/'), reason });
      } else if (RE_RUNTIME_FILE.test(file)) {
        runtime += 1;
      }
    }, (dir) => {
      prunedDirs += 1;
      const n = countFiles(dir);
      files += n;
      tally('zod-tests', n);
    });
    if (pkgRemoved[0] > 0 && runtime === 0 && existsSync(path.join(pkg.dir, 'package.json'))) {
      noRuntimePayload.push({ package: pkg.name, removed: pkgRemoved[0], prunedDirs });
    }
  }

  const removed = Object.values(removedByReason).reduce((a, b) => a + b, 0);
  return { platform, arch, packages: packageEntries.length, files, removed, removedByReason, samples, noRuntimePayload };
}

export function formatPlan(plan) {
  const lines = [`[stage-prune:plan] 目标 ${plan.platform}-${plan.arch}（只读，不删文件）`];
  lines.push(`  包 ${plan.packages} 个 / 文件 ${plan.files} 个 / 将裁剪 ${plan.removed} 个`);
  const detail = Object.entries(plan.removedByReason).map(([k, v]) => `${k}=${v}`).join('，');
  if (detail) lines.push(`  裁剪构成：${detail}`);
  if (plan.samples.length) {
    lines.push('  样本：');
    for (const s of plan.samples.slice(0, 10)) lines.push(`    · ${s.package}  ${s.file}  (${s.reason})`);
  }
  if (plan.noRuntimePayload.length === 0) {
    lines.push('  ✓ 裁剪后没有包变成「无运行时载荷」。');
  } else {
    lines.push(`  ✗ ${plan.noRuntimePayload.length} 个包裁剪后无运行时载荷（需人工确认判据）：`);
    for (const p of plan.noRuntimePayload) lines.push(`    · ${p.package}  删除 ${p.removed} 个文件`);
  }
  return lines.join('\n');
}

function readArg(argv, name) {
  const i = argv.indexOf(name);
  const v = i >= 0 ? argv[i + 1] : undefined;
  return v && !v.startsWith('--') ? v : undefined;
}

export function main(argv = process.argv.slice(2)) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(readArg(argv, '--root') || path.join(here, '..', 'dsh-desktop', 'node_modules'));
  if (!existsSync(root)) {
    console.error('[stage-prune:plan] node_modules 不存在: ' + root);
    return 2;
  }
  const plan = planPrune(root, {
    platform: readArg(argv, '--platform') || process.platform,
    arch: readArg(argv, '--arch') || process.arch,
  });
  if (argv.includes('--json')) process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
  else console.log(formatPlan(plan));
  return plan.noRuntimePayload.length === 0 ? 0 : 1;
}

const invokedDirectly = process.argv[1] !== undefined
  && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) process.exitCode = main();
