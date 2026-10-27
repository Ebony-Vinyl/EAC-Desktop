'use strict';

// 精简版（lite）随包皮肤播种。
//
// 背景
// ----
// 精简版开箱带 5 款皮肤，默认使用原生界面；皮肤由用户显式启用。皮肤不属于
// COMPANION_PLUGINS（那是「插件」，走 patch insert 行 + 目录拷贝）；
// 皮肤是**公约皮肤包**，由皮肤管理器从 profile 的 node_modules 里发现，
// 加载与否由 `cordis.patch.yml` 的自管段（dsh-skin managed）决定。
//
// 为什么不能只把目录拷进 node_modules
// ----------------------------------
// 实测 2026-10-22：手工 `cp -r` 5 个皮肤目录进 profile 后，界面确实能用了，
// 但那是「悬空」状态 —— package.json 的 dependencies / dsh.profile.bundles
// 里都没有登记。一旦内核重建 profile（pnpm install / 首启重解析 node_modules），
// 目录会被清掉，而 patch 行还在 → **「行在包不在」**，这是已知会拖垮插件树
// 的故障模式（见 companion-sync 里 retireRemovedBuiltinPluginsGated 的注释）。
// 所以必须把三者一起写：包目录 + dependencies + bundles。
//
// 皮肤包自带 insert patch，由 bundles 加载；profile 只写 disabled 编辑行，
// 不重复插入同一插件。
//
// 幂等与用户意志
// -------------
// - 包目录已存在（用户从市场装过 / 曾播种过）→ 不覆盖。
// - patch 行已存在（含用户手动改过的 disabled）→ 不覆盖，尊重用户选择。
// - 只有 installProfile === 'lite' 才播种；full 的皮肤配置完全不受影响。

import fs = require('node:fs');
import path = require('node:path');
import { PROFILE_MARKER_FILE } from './install-profile';
import { registeredPatchEntryIds } from '../bundle-identity';
import { writeFileAtomic } from '../atomic-json';

/** 精简版随包的 5 款皮肤。dir 是 assets/skins 下的目录名。 */
export interface LiteSkinSpec {
  /** 包名（写进 profile package.json 的 dependencies）。 */
  name: string;
  /** assets/skins 下的目录名。 */
  dir: string;
  /** patch 行 id（皮肤包 cordis.patch.yml 的 insert id）。 */
  wiringId: string;
  /** 是否默认激活（出厂全部关闭）。 */
  active: boolean;
}

export const LITE_BUNDLED_SKINS: readonly LiteSkinSpec[] = [
  {
    name: '@linxin666/dsh-client-ui-skin-whale-song',
    dir: '@linxin666_dsh-client-ui-skin-whale-song',
    wiringId: 'ui-skin-whale-song',
    active: false,
  },
  {
    name: '@smalltailqwq/dsh-client-ui-skin-orca-link',
    dir: '@smalltailqwq_dsh-client-ui-skin-orca-link',
    wiringId: 'ui-skin-orca-link',
    active: false,
  },
  {
    name: 'dsh-client-liang-intensity-skin',
    dir: 'dsh-client-liang-intensity-skin',
    wiringId: 'liang-intensity-skin',
    active: false,
  },
  {
    name: '@smalltailqwq/dsh-client-ui-skin-maid-atelier',
    dir: '@smalltailqwq_dsh-client-ui-skin-maid-atelier',
    wiringId: 'ui-skin-maid-atelier',
    active: false,
  },
  {
    name: '@dsh-external/dsh-client-ui-skin-deep-whale-day-night',
    dir: '@dsh-external_dsh-client-ui-skin-deep-whale-day-night',
    wiringId: 'ui-skin-deep-whale-day-night',
    active: false,
  },
];

/** 自管段的起止标记，与皮肤管理器生成的一致，便于它接管后不被重复追加。 */
const MANAGED_BEGIN = '# --- dsh-skin managed (auto-generated; do not edit) ---';
const MANAGED_END = '# --- end dsh-skin managed ---';

/**
 * 落位皮肤管理器（assets/plugins → profile/node_modules）。已存在则跳过。
 *
 * 为什么不登记 COMPANION_PLUGINS 而在 bundles 里：见 companion-sync.ts 对应
 * 注释 —— 两条路径只能选一条，否则内核加载双实例报
 * `duplicate exact route "/api/dsh/skins"`。
 *
 * 选 bundles 而非配套行，是因为它**自带** `dsh.bundle.patch`：只有包名进了
 * `dsh.profile.bundles`，内核才会 apply 包内的 cordis.patch.yml 并下发客户端
 * 半。实测（2026-10-23）：只落目录、不进 bundles 时，`/plugins/<pkg>/client.js`
 * 返回 404，设置页无「皮肤管理」分节。
 */
function materializeSkinManager(profileDir: string, assetsPlugins: string, log: (m: string) => void): boolean {
  const name = '@smalltailqwq/dsh-client-ui-skin-deep-whale-manager';
  const src = path.join(assetsPlugins, 'dsh-client-ui-skin-deep-whale-manager');
  if (!fs.existsSync(path.join(src, 'package.json'))) return false;
  const dest = path.join(profileDir, 'node_modules', ...name.split('/'));
  let changed = false;
  if (!fs.existsSync(path.join(dest, 'package.json'))) {
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.cpSync(src, dest, { recursive: true });
      log('已落位皮肤管理器: ' + name);
      changed = true;
    } catch (err) {
      log('皮肤管理器落位失败: ' + String((err as Error)?.message || err));
      return false;
    }
  }
  return changed;
}

/**
 * 把一个皮肤包从 assets/skins 落位到 profile/node_modules。已存在则跳过。
 * 返回是否真的复制的。
 */
function materializeSkin(profileDir: string, spec: LiteSkinSpec, assetsSkins: string, log: (m: string) => void): boolean {
  const src = path.join(assetsSkins, spec.dir);
  if (!fs.existsSync(path.join(src, 'package.json'))) {
    log('随包皮肤源目录无效，跳过: ' + spec.name + ' → ' + src);
    return false;
  }
  const dest = path.join(profileDir, 'node_modules', ...spec.name.split('/'));
  if (fs.existsSync(path.join(dest, 'package.json'))) {
    // 已存在（用户市场安装 / 曾播种 / 覆盖层更新）→ 尊重现状，不覆盖。
    return false;
  }
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
    log('已落位随包皮肤: ' + spec.name);
    return true;
  } catch (err) {
    log('随包皮肤落位失败 ' + spec.name + ': ' + String((err as Error)?.message || err));
    return false;
  }
}

/** 皮肤管理器包名：随包但不属于「皮肤」，单独登记 bundle。 */
const SKIN_MANAGER_PACKAGE = '@smalltailqwq/dsh-client-ui-skin-deep-whale-manager';

/**
 * 精简版：把虎鲸之链的「居中设置面板」默认打开。
 *
 * 现象（用户实测，lite）：设置页左栏导航**上方空出一大片**，内容被推到底部。
 *
 * 成因（已核对皮肤源码，不是猜测）：
 *   皮肤在 docked 布局下给设置弹层的 <nav> 写了
 *     {justify-content:safe flex-end; padding-bottom:24px}
 *   `flex-end` 把导航列贴到底部；导航项少时上方自然空一块。
 *   实测 lite：nav 高 680，内容高 392，可用 634 → **上方空 242px**。
 *
 *   皮肤作者**自己提供了正常布局**：当 html 上有
 *     data-dsh-whale-orca-settings-layout=centered
 *   时覆盖为 {justify-content:flex-start}。该属性由设置项 `centerSettings`
 *   （"Center the settings panel"）驱动，`defaultValue: false`。
 *
 * 为什么改默认值而不是改 CSS：
 *   `safe flex-end` 是 docked 布局的**设计行为**，不是样式 bug。直接改基础规则
 *   等于推翻作者的设计、也破坏了 docked 模式的观感。改默认值只影响「新用户
 *   首次进来看到哪种布局」，作者两种都实现好了，用户随时能在皮肤设置里切回去。
 *
 * 为什么只对 lite 做：
 *   lite 的设置分节本来就少（7 项），贴底必然难看；full 分节多、内容基本填满，
 *   空白几乎看不出来。不对 full 改，避免无谓地改动用户既有观感。
 *
 * 生效范围：皮肤设置存在 localStorage（键 dsh.skin-manager.preferences.v2），
 * `defaultValue` 只在**没有存过值**时使用。所以本修正对新装 / 未改过该设置的用户
 * 生效；已手动选过 docked 的用户保持其选择（尊重现状，与本文件其它修正一致）。
 *
 * 实现：该文件里 `defaultValue: false` 出现 3 次，因此用
 * 「key: "centerSettings" 之后的第一处」做窗口定位，并在写入前自检
 * 「全文仅此一处按预期变化」，不自检通过就不写。
 */
function applyOrcaCenterSettingsDefault(profileDir: string, log: (m: string) => void): boolean {
  const file = path.join(
    profileDir, 'node_modules', '@smalltailqwq', 'dsh-client-ui-skin-orca-link', 'lib', 'client.js',
  );
  let text: string;
  try {
    if (!fs.existsSync(file)) return false;
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return false;
  }
  const KEY = 'key: "centerSettings"';
  const first = text.indexOf(KEY);
  if (first < 0) return false; // 上游结构变了 —— 不动。
  const nextKey = text.indexOf('key: "', first + KEY.length);
  if (nextKey < 0) return false;
  const seg = text.slice(first, nextKey);
  if (!seg.includes('defaultValue: false')) return false; // 已修过 / 上游已改。
  const fixedSeg = seg.replace('defaultValue: false', 'defaultValue: true');
  const next = text.slice(0, first) + fixedSeg + text.slice(nextKey);
  // 自检：键前、键后逐字节不变（false→true 少一个字符，不能拿长度相等当判据）。
  if (next.slice(0, first) !== text.slice(0, first)) return false;
  if (next.slice(next.length - (text.length - nextKey)) !== text.slice(nextKey)) return false;
  if (next.length !== text.length - 1) return false;
  try {
    fs.writeFileSync(file, next, 'utf8');
    log('已把虎鲸之链「居中设置面板」默认打开（修设置栏贴底留白）');
    return true;
  } catch (err) {
    log('虎鲸之链设置面板默认值修正失败: ' + String((err as Error)?.message || err));
    return false;
  }
}

/**
 * 确保 profile package.json 的 dependencies 与 dsh.profile.bundles 都登记这些皮肤。
 * （外加皮肤管理器本身，它也需要在 bundles 里才能让内核 apply 它的包内 patch。）
 *
 * 为什么 **两处都要写**（实测 2026-10-23，这块一开始判断错了）：
 *   · `dependencies` —— 让内核的依赖解析认识这些包（pnpm 重装时不至于被当野包清掉）；
 *   · `dsh.profile.bundles` —— **这才是内核真正加载插件的入口**。皮肤包自带
 *     `dsh.bundle.patch`，只有包名进了 bundles，内核才会 apply 包内的
 *     cordis.patch.yml 并把客户端半发下去。
 * 只写 dependencies 时界面完全没有皮肤（body 上没有 data-dsh-<skin> 属性），
 * 这是本模块初版的实际失败；对照 full profile 的 bundles 列表才定位到。
 */
function ensureSkinDependencies(profileDir: string, specs: readonly LiteSkinSpec[], extraBundle?: string): boolean {
  const pkgFile = path.join(profileDir, 'package.json');
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8')) as Record<string, unknown>;
  } catch {
    return false;
  }
  const deps = (pkg.dependencies && typeof pkg.dependencies === 'object')
    ? (pkg.dependencies as Record<string, string>)
    : ((pkg.dependencies = {}) as Record<string, string>);
  let changed = false;
  const names = specs.map((s) => s.name);
  if (extraBundle) names.push(extraBundle);
  for (const name of names) {
    if (typeof deps[name] === 'string') continue;
    // 语义版本用 *：实际解析走 node_modules 里已落位的目录，版本号只是占位。
    deps[name] = '*';
    changed = true;
  }
  // dsh.profile.bundles：内核加载入口，缺了皮肤不会生效。
  const dsh = (pkg.dsh && typeof pkg.dsh === 'object') ? (pkg.dsh as Record<string, unknown>) : ((pkg.dsh = {}) as Record<string, unknown>);
  const prof = (dsh.profile && typeof dsh.profile === 'object') ? (dsh.profile as Record<string, unknown>) : ((dsh.profile = {}) as Record<string, unknown>);
  const bundles = Array.isArray(prof.bundles) ? (prof.bundles as unknown[]) : [];
  for (const name of names) {
    if (bundles.includes(name)) continue;
    bundles.push(name);
    changed = true;
  }
  prof.bundles = bundles;
  if (!changed) return false;
  try {
    fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
    return true;
  } catch {
    return false;
  }
}

/** 补齐新皮肤的默认关闭行，已有启停及管理器选择原样保留。 */
function ensureSkinPatchRowsIn(patchFile: string, specs: readonly LiteSkinSpec[]): boolean {
  const text = fs.existsSync(patchFile) ? fs.readFileSync(patchFile, 'utf8') : '';
  const existing = registeredPatchEntryIds(text);
  const lines: string[] = [];
  for (const spec of specs) {
    // 包内 patch 提供 insert。这里只补默认启停行，尊重已有 YAML 选择。
    if (existing.has(spec.wiringId)) continue;
    lines.push(`- id: ${spec.wiringId}`, `  disabled: ${!spec.active}`);
  }
  if (!lines.length) return false;
  const end = text.indexOf(MANAGED_END);
  const block = lines.join('\n') + '\n';
  const next = end >= 0
    ? text.slice(0, end) + block + text.slice(end)
    : text.replace(/\s*$/, '\n') + [MANAGED_BEGIN, ...lines, MANAGED_END, ''].join('\n');
  writeFileAtomic(patchFile, next);
  return true;
}

/**
 * 判定「这个 profile 属于精简版产物」。
 *
 * 判据演进（两次迭代，都有实测依据）：
 *
 * 1. `installProfile`（profile.txt）：**修复前恒为 'full'** ——
 *    stage-resources.mjs 无条件写 'full'，两个变体实测都是 full。拿它判形态
 *    必然判错（播种代码在 lite 实例上完全没执行，踩过一次）。
 *
 * 2. profile 里有没有 `eac-plugin-suite`：能用，但语义错 ——
 *    用户可以在 lite 产物里自行装 EAC-Pack，那时播种会停摆，皮肤「装过然后
 *    消失」，属难以理解的行为。
 *
 * 3. 现在是正确做法：见 stage-resources.mjs —— 装配时按 --distro 如实写
 *    profile.txt。这里读它即得产物档位，与用户后续装什么无关。
 */
export function isLiteProfile(appRoot: string): boolean {
  try {
    const raw = fs.readFileSync(path.join(appRoot, PROFILE_MARKER_FILE), 'utf8');
    return raw.trim() === 'lite';
  } catch {
    // 标记缺失/读失败一律回退 full（不播种），与 readInstallProfile 的容错口径一致：
    // 宁可少种，不可在不确定形态时改动 profile。
    return false;
  }
}

/** 默认只播种 profile 层；home 层属于用户及皮肤管理器，绝不重写。 */
function ensureSkinPatchRows(profileDir: string, specs: readonly LiteSkinSpec[]): boolean {
  return ensureSkinPatchRowsIn(path.join(profileDir, 'cordis.patch.yml'), specs);
}

/**
 * 修虎鲸之链「设置面板贴底留白」，两档都适用。
 *
 * 导出给 companion-sync 在**两档**都调用 —— 早先只放在 lite 的播种流程里，
 * 结果 full 一直保留 docked 布局（上方空出 300+ px）。而 full 的设置分节同样
 * 填不满一屏（实测导航内容 400px / 容器 680px），所以它并不是「full 才需要
 * 的设计选择」，而是同一个布局缺陷。
 *
 * 幂等 + 只改默认值，不动用户已存的选择（localStorage 有值时 defaultValue 不生效）。
 *
 * @returns 是否发生了修改
 */
export function applyOrcaSettingsLayoutFix(profileDir: string, log: (m: string) => void = () => {}): boolean {
  return applyOrcaCenterSettingsDefault(profileDir, log);
}

/**
 * 精简版随包皮肤的完整播种：落位包目录 + 登记 dependencies + 补 patch 行。
 *
 * @returns 是否发生了任何变化（用于决定是否打日志）
 */
export function seedLiteBundledSkins(
  profileDir: string,
  assetsSkins: string,
  log: (m: string) => void = () => {},
  appRoot: string = '',
): boolean {
  if (!appRoot || !isLiteProfile(appRoot)) {
    // full：皮肤由 EAC-Pack 全量构建与用户选择决定，一行都不能碰。
    return false;
  }
  // 皮肤管理器：从 assets/plugins 落位（它不在 COMPANION_PLUGINS，见那里的注释）。
  // 目录 + bundles 登记由下面的 ensureSkinDependencies 一并处理。
  materializeSkinManager(profileDir, path.join(appRoot, 'assets', 'plugins'), log);
  if (!fs.existsSync(assetsSkins)) {
    log('随包皮肤目录不存在，跳过: ' + assetsSkins);
    return false;
  }
  let changed = false;
  for (const spec of LITE_BUNDLED_SKINS) {
    if (materializeSkin(profileDir, spec, assetsSkins, log)) changed = true;
  }
  // 注意：设置面板布局修正**不在这里**。它两档都要跑，由 companion-sync 直接
  // 调用 applyOrcaSettingsLayoutFix（本函数的 isLiteProfile 早退会把 full 挡掉）。
  if (ensureSkinDependencies(profileDir, LITE_BUNDLED_SKINS, SKIN_MANAGER_PACKAGE)) {
    log('已登记随包皮肤到 profile dependencies/bundles: ' + LITE_BUNDLED_SKINS.map((s) => s.name).join(', '));
    changed = true;
  }
  if (ensureSkinPatchRows(profileDir, LITE_BUNDLED_SKINS)) {
    log('已补齐随包皮肤的默认关闭行（原生界面，用户选择优先）');
    changed = true;
  }
  return changed;
}

export { MANAGED_BEGIN, MANAGED_END };
