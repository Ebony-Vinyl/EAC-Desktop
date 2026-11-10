'use strict';
// 平台原生 payload 裁剪（stage-resources.mjs 装配期使用）。
// 独立模块：stage-resources.mjs 无 main guard，import 即执行全量装配，
// 纯函数放这里供 node:test 直接导入。
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * 安装版与便携版共同裁剪生产 node_modules 的非运行载荷（v3：特征前置 + 引用扫描 + journal）。
 *
 * 三层防误删：
 * 1. 特征前置——撞名风险高的目录名（tests?/specs?/examples?/demos?/samples?/man）只在
 *    子树含 *.test.* 或 *.spec.* 特征文件时才整删，无特征整目录保留（宁可少删）。
 *    docs/coverage/.github/编辑器配置与 __tests__ 等 jest 专用名保持无条件（名字无歧义）。
 * 2. 引用扫描——裁剪前扫描全部保留 JS（.js/.mjs/.cjs，≤8MB）的字符串字面量，相对路径
 *    解析命中待删文件即豁免（require/import/readFileSync 等显式引用不受裁剪影响）。
 *    动态拼接路径扫不到，属已知边界（出错方向是"少保护"，由 V2/V4/V5 验证兜底）。
 * 3. journal——删除明细聚合（规则桶 + 逐目录计划数 + 豁免清单）返回给调用方；
 *    stage-resources.mjs 落 staged-resources/prune-journal.json（构建侧诊断产物，
 *    不随包分发），误删事故可按目录直接定位。
 *
 * 一律保留：许可文件（LICENSE/NOTICE/COPYING/third-party-notices）、非元数据命名的
 * .md（可能是运行期模板/数据）、运行期 TS 源码（.ts/.mts/.cts，L2-C 另行验证）。
 * 裁剪必须发生在 bundle-manifest 生成之前（stage-resources.mjs 的既有顺序保证），
 * manifest 口径即最终载荷，启动期 verifyBundle 才能一致。
 */
const UNCONDITIONAL_DIRECTORY = /^(?:\.github|\.vscode|\.idea|__snapshots__|__mocks__|__fixtures__)$/i;
/** 通用名（doc(s)/coverage）撞名风险实测存在（yaml/dist/doc 是运行代码）：子树无 JS 才整删。 */
const NOJS_DIRECTORY = /^(?:docs?|documentation|coverage)$/i;
const FEATURED_DIRECTORY = /^(?:tests?|__tests__|specs?|examples?|demos?|samples?|man)$/i;
const TEST_FEATURE_FILE = /\.(?:test|spec)\.[a-z0-9]+$/i;
/** 子树含任一可执行载荷即视为"非文档目录"（yaml/dist/doc 教训）。 */
const RUNTIME_PAYLOAD_FILE = /\.(?:[cm]?js|node)$/i;

const PRUNED_FILE_RULES = [
  /^readme(?:[._-].*)?$/i,
  // changes/history 只认文档扩展名：内核包有真实的运行模块叫 changes.js/history.js，
  // inspector 的 chunk 叫 changes-*.js（2026-10-31 实测引用扫描捕获）。
  /^change(?:log|s)(?:\.(?:md|txt|markdown))?$/i,
  /^history(?:\.(?:md|txt|markdown))?$/i,
  /^(?:authors|contributors|contributing|sponsors)(?:\.(?:md|txt|markdown|yml|yaml))?$/i,
  /^code_of_conduct/i,
  /^security\.md$/i,
  /^funding\.ya?ml$/i,
  /^\.(?:eslintrc|prettierrc|babelrc|nycrc|mocharc|jshintrc)(?:\..*)?$/i,
  /^\.editorconfig$/i,
  /^\.travis\.yml$/i,
  /\.d\.[cm]?ts$/i,
];

function isPrunedFileName(name) {
  if (/\.(?:[cm]?js|css)\.map$/i.test(name)) return true;
  return PRUNED_FILE_RULES.some((rule) => rule.test(name));
}

function fileBucket(name) {
  if (/\.(?:[cm]?js|css)\.map$/i.test(name)) return 'maps';
  if (/\.d\.[cm]?ts$/i.test(name)) return 'declarations';
  return 'metadata';
}

/** 目录子树里是否存在测试特征文件（决定 FEATURED 目录是否整删）。 */
function hasTestFeature(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = path.join(dir, entry.name);
    if (entry.isFile() && TEST_FEATURE_FILE.test(entry.name)) return true;
    if (entry.isDirectory() && hasTestFeature(child)) return true;
  }
  return false;
}

/** 目录子树里是否存在可执行载荷（决定 NOJS 通用名目录是否整删）。 */
function hasRuntimePayload(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = path.join(dir, entry.name);
    if (entry.isFile() && RUNTIME_PAYLOAD_FILE.test(entry.name)) return true;
    if (entry.isDirectory() && hasRuntimePayload(child)) return true;
  }
  return false;
}

/**
 * 裁剪生产 node_modules 非运行载荷。
 * @returns {{ removed: number, journal: object }} journal 供调用方落盘诊断（无时间戳，保证装配可重复）。
 */
export function pruneDevelopmentPayloads(nodeModules) {
  // ---- 阶段 1：收集待删清单（只记录，不删除）----
  /** relPosix（'/' 分隔）-> 规则桶 */
  const planned = new Map();
  /** 整删目录 relPosix -> 计划删除文件数（journal 诊断口径：计划数，豁免后实际更少） */
  const plannedDirs = new Map();

  const collectDir = (dir, rel, bucket) => {
    let files = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relChild = `${rel}/${entry.name}`;
      if (entry.isDirectory()) files += collectDir(path.join(dir, entry.name), relChild, bucket);
      else if (entry.isFile()) { planned.set(relChild, bucket); files++; }
    }
    return files;
  };

  const walk = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = path.join(dir, entry.name);
      const relChild = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (UNCONDITIONAL_DIRECTORY.test(entry.name)) {
          plannedDirs.set(relChild, collectDir(child, relChild, `dir:${entry.name.toLowerCase()}`));
        } else if (NOJS_DIRECTORY.test(entry.name)) {
          // 通用名（doc/docs/coverage）：子树无 JS/原生载荷才整删，否则整目录保留
          if (!hasRuntimePayload(child)) {
            plannedDirs.set(relChild, collectDir(child, relChild, `dir:${entry.name.toLowerCase()}`));
          }
        } else if (FEATURED_DIRECTORY.test(entry.name)) {
          if (hasTestFeature(child)) {
            plannedDirs.set(relChild, collectDir(child, relChild, `dir:${entry.name.toLowerCase()}`));
          }
          // 无特征：整目录保留，不再下钻（保守方向：目录内即使嵌套可裁名也不动）
        } else {
          walk(child, relChild);
        }
      } else if (entry.isFile() && isPrunedFileName(entry.name)) {
        planned.set(relChild, fileBucket(entry.name));
      }
    }
  };
  walk(nodeModules, '');

  // ---- 阶段 2：引用扫描（保留 JS 的字符串字面量 → 相对路径命中即豁免）----
  const referencedBy = new Map();
  const LITERAL = /'([^'\\\r\n]*(?:\\.[^'\\\r\n]*)*)'|"([^"\\\r\n]*(?:\\.[^"\\\r\n]*)*)"|`([^`\\]*(?:\\.[^`\\]*)*)`/g;
  let scannedFiles = 0;
  const plannedDirPrefixes = [...plannedDirs.keys()];
  const insidePlannedDir = (relChild) => {
    for (const prefix of plannedDirPrefixes) {
      if (relChild === prefix || relChild.startsWith(`${prefix}/`)) return true;
    }
    return false;
  };
  const scan = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = path.join(dir, entry.name);
      const relChild = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!insidePlannedDir(relChild)) scan(child, relChild);
      } else if (entry.isFile() && !planned.has(relChild) && /\.(?:[cm]?js)$/i.test(entry.name)) {
        try {
          if (statSync(child).size > 8 * 1024 * 1024) continue; // 超大包不做字面量扫描（已知边界）
        } catch { continue; }
        let content;
        try { content = readFileSync(child, 'utf8'); } catch { continue; }
        scannedFiles++;
        const relDir = rel || '.'; // rel 本身就是文件所在目录（不是文件路径，勿取 dirname）
        for (const match of content.matchAll(LITERAL)) {
          const raw = match[1] ?? match[2] ?? match[3] ?? '';
          if (!raw || raw.length > 260) continue;
          const literal = raw.replace(/\\/g, '/');
          if (!literal.includes('/')) continue;
          const target = path.posix.normalize(path.posix.join(relDir, literal));
          if (planned.has(target) && !referencedBy.has(target)) referencedBy.set(target, relChild);
        }
      }
    }
  };
  scan(nodeModules, '');

  // ---- 阶段 3：按清单删除（豁免除外），随后清理因删除而空掉的规则目录 ----
  const byRule = { maps: 0, metadata: 0, declarations: 0 };
  const directories = Object.create(null);
  let removed = 0;
  for (const [rel, bucket] of planned) {
    if (referencedBy.has(rel)) continue;
    rmSync(path.join(nodeModules, rel));
    removed++;
    if (bucket === 'maps' || bucket === 'metadata' || bucket === 'declarations') byRule[bucket]++;
    else {
      const name = bucket.slice(4);
      directories[name] = (directories[name] || 0) + 1;
    }
  }

  /** 后序清理：仅清"本就该整删"名字的空目录；普通名字即使空也保留（可能有运行期写入用途）。 */
  const removeEmptyRuleDirs = (dir) => {
    let removedDirs = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) removedDirs += removeEmptyRuleDirs(path.join(dir, entry.name));
    }
    if (dir !== nodeModules) {
      const name = path.basename(dir);
      if (UNCONDITIONAL_DIRECTORY.test(name) || NOJS_DIRECTORY.test(name) || FEATURED_DIRECTORY.test(name)) {
        try {
          if (readdirSync(dir).length === 0) { rmSync(dir, { recursive: true }); removedDirs++; }
        } catch { /* 目录被并发占用：留待下次装配 */ }
      }
    }
    return removedDirs;
  };
  const emptyDirsRemoved = removeEmptyRuleDirs(nodeModules);

  const exemptions = [];
  for (const [target, referrer] of referencedBy) {
    if (exemptions.length < 500) exemptions.push({ path: target, referencedBy: referrer });
  }
  const journal = {
    version: 1,
    totalRemoved: removed,
    byRule,
    directories,
    removedDirectories: Object.fromEntries(plannedDirs),
    referenceScan: { scannedFiles, exemptedFiles: referencedBy.size },
    exemptions,
    emptyDirsRemoved,
  };
  return { removed, journal };
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
