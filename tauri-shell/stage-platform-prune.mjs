'use strict';
// 平台原生 payload 裁剪（stage-resources.mjs 装配期使用）。
// 独立模块：stage-resources.mjs 无 main guard，import 即执行全量装配，
// 纯函数放这里供 node:test 直接导入。
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

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
