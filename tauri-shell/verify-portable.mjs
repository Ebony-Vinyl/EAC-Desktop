'use strict';

// 便携包（portable zip）档位一致性门禁。
//
// 为什么需要它
// ------------
// `make-portable.mjs` 决定档位的唯一依据是 staging 里的 `dsh-desktop/profile.txt`：
// 档位 → 产物文件名 → 档位标记，三者**由同一个来源派生**。所以装配
// （stage-resources.mjs）一旦写错或漏拷载荷，产物名与标记会一起说谎，而打包
// 脚本现有的 zip 内容断言只有一条（ui-skin-manager 的 system.default snapshot），
// 查不到这些：
//
//   · lite 包里混进 full 专属皮肤（体积白涨，用户以为拿到的是精简版）
//   · full 包里缺 full 专属皮肤（离线换肤少 8 款，没人发现）
//   · 随包插件少装（插件面板点开空白）
//   · profile.txt 的档位与实际内容不符（v6.0.0 发布过的 lite 便携包就是这样：
//     标记写 full、内容却是 lite，运行期按 full 策略启动）
//
// 这些都不影响「能不能开机」，只会在使用中偶发异常 —— 是最难被冒烟测试发现的
// 一类缺陷。本模块把「档位应有的载荷面」变成可断言的集合：
//
//   期望集合 ← distro.mjs（装配与描述符共用的唯一口径）
//   实际集合 ← zip 中央目录（或 staging 树）
//
// 判定分三档，刻意不对“多余目录”一刀切：
//   fail —— 该档位应有的随包载荷缺失 / 混入了另一档专属载荷 / 档位标记不符
//   warn —— 出现两边都未登记的目录（可能是新增资产，交给人判断）
// 这样门禁可以现在就接进构建，而不必等所有资产都先登记到 distro.mjs。
//
// 用法（CLI）：
//   node tauri-shell/verify-portable.mjs <zip> [--distro=lite|full]
// 不给 --distro 时按文件名里的 -lite- / -full- 推断，推断不出则报错退出。

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { listZipEntries } from './portable-unzip-hint.mjs';
import {
  DISTROS,
  FULL_ONLY_PLUGIN_DIRS,
  FULL_ONLY_SKIN_DIRS,
  builtinPluginDirs,
  bundledSkinDirs,
} from './distro.mjs';

/** 随包插件在安装树里的落点（stage-resources.mjs 的 cpSync 目标）。 */
export const PLUGIN_ROOT = 'dsh-desktop/assets/plugins';
/** 随包皮肤在安装树里的落点（stage-resources.mjs 的 cpSync 目标）。 */
export const SKIN_ROOT = 'dsh-desktop/assets/skins';
/** 档位标记文件（stage-resources.mjs 写入 `<distro>\n`）。 */
export const PROFILE_MARKER = 'dsh-desktop/profile.txt';

/**
 * 两档都必须存在的根文件 —— 只挑「缺了就必然起不来 / 更新链路会断」的。
 *
 * sidecar 是产品本体（缺 server.js 壳会一直等不到端口）；dpx 是官方桌面协议
 * 依赖；ui-skin-manager 的 snapshot 是原有唯一断言，保留以免回归；
 * `.dsh-portable` 与 `eac-installation.json` 是便携版自我识别标记。
 */
export const REQUIRED_ROOT_FILES = [
  'sidecar/server.js',
  PROFILE_MARKER,
  '.dsh-portable',
  'eac-installation.json',
  'ui-skin-manager/resolved/system.default/snapshot.json',
];

/** 归一化 zip 条目名：统一分隔符、去掉 `./` 前缀与结尾斜杠。 */
export function normalizeEntryName(name) {
  return String(name).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

/** 取某个根目录下的直接子目录名集合（根下裸文件不算目录）。 */
export function childDirsOf(entries, root) {
  const prefix = root + '/';
  const dirs = new Set();
  for (const raw of entries) {
    const name = normalizeEntryName(raw);
    if (!name.startsWith(prefix)) continue;
    const rest = name.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash <= 0) continue;
    dirs.add(rest.slice(0, slash));
  }
  return dirs;
}

function check(name, ok, detail, severity = 'fail') {
  return { name, ok: Boolean(ok), detail: detail || '', severity };
}

function diffSets(expected, actual) {
  return {
    missing: [...expected].filter((d) => !actual.has(d)).sort(),
    extra: [...actual].filter((d) => !expected.has(d)).sort(),
  };
}

/**
 * 纯函数：给定 zip 条目名列表与档位，判定载荷面是否自洽。
 *
 * @param {{entries: string[], distro: 'lite'|'full', profileMarker?: string|null}} input
 * @returns {{ok: boolean, distro: string, checks: Array<{name: string, ok: boolean, detail: string, severity: string}>}}
 */
export function verifyPortableEntries({ entries, distro, profileMarker = null }) {
  if (!DISTROS.includes(distro)) {
    throw new Error(`[verify-portable] 非法档位: ${distro}（可选 ${DISTROS.join(' / ')}）`);
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('[verify-portable] 条目列表为空：zip 未生成或读取失败');
  }

  const normalized = new Set(entries.map(normalizeEntryName));
  const checks = [];

  // 1) 「缺了就起不来」的根文件。
  const missingRoots = REQUIRED_ROOT_FILES.filter((f) => !normalized.has(f));
  checks.push(check('root-files', missingRoots.length === 0,
    missingRoots.length === 0 ? `${REQUIRED_ROOT_FILES.length} 项齐全` : '缺 ' + missingRoots.join(', ')));

  // 2) 档位标记必须与产物档位一致（v6.0.0 的 lite 包正是在这里对不上）。
  const marker = (profileMarker == null ? '' : String(profileMarker)).trim();
  checks.push(check('profile-marker-value', marker === distro,
    marker === distro ? `profile.txt = ${distro}` : `profile.txt = ${JSON.stringify(marker)}，期望 ${distro}`));

  // 3) 该档位的随包插件必须全部在场。
  const expectedPlugins = new Set(builtinPluginDirs(distro));
  const actualPlugins = childDirsOf(normalized, PLUGIN_ROOT);
  const pluginDiff = diffSets(expectedPlugins, actualPlugins);
  checks.push(check('bundled-plugins', pluginDiff.missing.length === 0,
    pluginDiff.missing.length === 0
      ? `${expectedPlugins.size} 个齐全` + (pluginDiff.extra.length ? `（额外 ${pluginDiff.extra.join(', ')}）` : '')
      : '缺 ' + pluginDiff.missing.join(', ')));
  if (pluginDiff.extra.length) {
    checks.push(check('unregistered-plugins', false,
      `未在 distro.mjs 登记的插件目录：${pluginDiff.extra.join(', ')}（若为新资产请补 BASE_PLUGIN_DIRS）`, 'warn'));
  }

  // 4) 该档位的随包皮肤必须全部在场。
  const expectedSkins = new Set(bundledSkinDirs(distro));
  const actualSkins = childDirsOf(normalized, SKIN_ROOT);
  const skinDiff = diffSets(expectedSkins, actualSkins);
  checks.push(check('bundled-skins', skinDiff.missing.length === 0,
    skinDiff.missing.length === 0
      ? `${expectedSkins.size} 款齐全` + (skinDiff.extra.length ? `（额外 ${skinDiff.extra.join(', ')}）` : '')
      : '缺 ' + skinDiff.missing.join(', ')));
  if (skinDiff.extra.length) {
    checks.push(check('unregistered-skins', false,
      `未在 distro.mjs 登记的皮肤目录：${skinDiff.extra.join(', ')}（若为新资产请补 LITE_SKIN_DIRS / FULL_ONLY_SKIN_DIRS）`, 'warn'));
  }

  // 5) 显式的「另一档专属」黑名单：即使差集算法将来改写，这条也能独立拦住
  //    「lite 混入 full 专属载荷」。这是本门禁最有价值的一条。
  const foreignSkins = FULL_ONLY_SKIN_DIRS.filter((d) => actualSkins.has(d));
  const foreignPlugins = FULL_ONLY_PLUGIN_DIRS.filter((d) => actualPlugins.has(d));
  const foreign = distro === 'lite' ? [...foreignSkins, ...foreignPlugins] : [];
  checks.push(check('no-foreign-payload', foreign.length === 0,
    foreign.length === 0 ? '无另一档专属载荷' : `lite 混入 full 专属：${foreign.join(', ')}`));

  return { ok: checks.every((c) => c.ok || c.severity === 'warn'), distro, checks };
}

/** 用 PowerShell 的 System.IO.Compression 读单个条目文本（与 listZipEntries 同源）。 */
export function readZipEntryText(zipPath, entryName) {
  const ps = [
    "$ErrorActionPreference='Stop'",
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '$OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    '$zip = [IO.Compression.ZipFile]::OpenRead($env:P_ZIP)',
    "try { $e = $zip.Entries | Where-Object { $_.FullName.Replace([char]92, [char]47) -eq $env:P_ENTRY } | Select-Object -First 1; if (-not $e) { exit 3 }; $r = New-Object IO.StreamReader($e.Open()); try { $r.ReadToEnd() } finally { $r.Close() } } finally { $zip.Dispose() }",
  ].join('; ');
  try {
    return execFileSync('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')],
      { env: { ...process.env, P_ZIP: zipPath, P_ENTRY: entryName }, encoding: 'utf8' });
  } catch (e) {
    if (e && e.status === 3) return null; // 条目不存在
    throw e;
  }
}

/** 从文件名推断档位：`v6.1.0-lite-x64.zip` → lite。推断不出返回 null。 */
export function inferDistroFromName(fileName) {
  const base = path.basename(String(fileName)).toLowerCase();
  const hasLite = /(^|[-_.])lite([-_.]|$)/.test(base);
  const hasFull = /(^|[-_.])full([-_.]|$)/.test(base);
  if (hasLite === hasFull) return null;
  return hasLite ? 'lite' : 'full';
}

/** 读 zip 并校验（zip 读不了会抛，判定结果不抛）。 */
export function verifyPortable(zipPath, distro) {
  const entries = listZipEntries(zipPath);
  const profileMarker = readZipEntryText(zipPath, PROFILE_MARKER);
  return verifyPortableEntries({ entries, distro, profileMarker });
}

/** 人类可读的结果表（CLI 与构建日志共用）。 */
export function formatChecks(result) {
  const tag = (c) => (c.ok ? 'PASS' : c.severity === 'warn' ? 'WARN' : 'FAIL');
  const lines = result.checks.map((c) => `${tag(c).padEnd(4)}  ${c.name.padEnd(22)} ${c.detail}`);
  lines.push(`${(result.ok ? 'PASS' : 'FAIL').padEnd(4)}  => 档位 ${result.distro} 载荷面${result.ok ? '自洽' : '不自洽'}`);
  return lines.join('\n');
}

const invokedDirectly = process.argv[1] && /verify-portable\.mjs$/i.test(process.argv[1].replace(/\\/g, '/'));
if (invokedDirectly) {
  const zipArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!zipArg) {
    console.error('用法: node tauri-shell/verify-portable.mjs <portable.zip> [--distro=lite|full]');
    process.exit(2);
  }
  const zipPath = path.resolve(zipArg);
  const distroArg = process.argv.find((a) => a.startsWith('--distro='));
  const distro = distroArg ? distroArg.slice('--distro='.length) : inferDistroFromName(zipPath);
  if (!distro) {
    console.error(`[verify-portable] 无法从文件名推断档位，请显式给 --distro=<${DISTROS.join('|')}>: ${zipPath}`);
    process.exit(2);
  }
  const result = verifyPortable(zipPath, distro);
  console.log(formatChecks(result));
  process.exit(result.ok ? 0 : 1);
}