'use strict';

// 精简版（lite）随包皮肤播种。
//
// 背景
// ----
// 用户要求精简版开箱带 5 款皮肤并默认激活「虎鲸之链」。皮肤不属于
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
// 为什么不写 bundles
// -----------------
// 皮肤包自带 cordis.patch.yml（insert 行），随包复制时**不**进 bundles ——
// bundles 是「包级 manifest 入口」，皮肤走 patch insert 另一条路。实测精简版
// 的 bundles 只应有 @deepseek-ai/dsh-base 与 @deepseek-ai/dsh-web-app；把皮肤
// 塞进 bundles 会重复注册（bundle 声明 + patch insert 同 id），触发
// "duplicate loader entry id"。因此本模块只写 dependencies（让内核的依赖解析
// 认得这些包）与 patch 行，不碰 bundles。
//
// 幂等与用户意志
// -------------
// - 包目录已存在（用户从市场装过 / 曾播种过）→ 不覆盖。
// - patch 行已存在（含用户手动改过的 disabled）→ 不覆盖，尊重用户选择。
// - 只有 installProfile === 'lite' 才播种；full 的皮肤配置完全不受影响。

import fs = require('node:fs');
import path = require('node:path');
import { PROFILE_MARKER_FILE } from './install-profile';

/** 精简版随包的 5 款皮肤。dir 是 assets/skins 下的目录名。 */
export interface LiteSkinSpec {
  /** 包名（写进 profile package.json 的 dependencies）。 */
  name: string;
  /** assets/skins 下的目录名。 */
  dir: string;
  /** patch 行 id（皮肤包 cordis.patch.yml 的 insert id）。 */
  wiringId: string;
  /** 是否默认激活（只有一款为 true）。 */
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
    active: true,
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

/**
 * 确保某个 cordis.patch.yml 里有这些皮肤的 insert 行与 disabled 行。
 *
 * 追加到文件尾部一个自管段；若已存在自管段，缺失项补进该段（保持
 * 皮肤管理器的格式约定，让它后续接管时不打架）。已有该 id 的 disabled
 * 行则一律不动 —— 那是用户/管理器的选择。
 *
 * **为什么要能指定文件（这条踩了很久）**：内核 compose 的层序是
 *
 *     bundle 层 → profile 层(cordis.patch.yml) → home 层($DSH_HOME/cordis.patch.yml) → overlay
 *
 * 见 @deepseek-ai/dsh/profile-boot 里 composeProfile 的注释：
 * 「the home-level user layer ($DSH_HOME/cordis.patch.yml — machine-local
 * preferences that apply to every profile, so it **outranks** the per-profile
 * layer)」。皮肤管理器把这套「互斥」写在 **home 层**：装过皮肤后 home 层会留下
 * `- id: ui-skin-<x> / disabled: true` 的残留。
 *
 * 实测（2026-10-23）：只在 profile 层写 `disabled: false`，home 层的旧
 * `disabled: true` 依然压过它 —— `--dump-config` 里那一行最终是
 * `disabled: true`，插件不挂载，不进客户端 roster，body 上没有 data-dsh-*。
 * 表现就是「播种全成功、日志全绿、界面无皮肤」。full 变体恰好 home 层是
 * `disabled: false`（历史操作留下的），所以它正常，误导过排查。
 *
 * 因此两处都要写：profile 层负责登记 insert，home 层负责不被旧值覆盖。
 */
function ensureSkinPatchRowsIn(patchFile: string, specs: readonly LiteSkinSpec[], log: (m: string) => void): boolean {
  let text = '';
  try {
    text = fs.existsSync(patchFile) ? fs.readFileSync(patchFile, 'utf8') : '';
  } catch {
    return false;
  }

  const hasInsert = (id: string) =>
    new RegExp(`^\\s*-\\s*id:\\s*${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').test(text);
  // 「已有 disabled 行」= 该 id 的下一行是 disabled。只认后一行，避免误判 insert 行。
  //
  // 同一 id 可能有多行（段外用户手写 + 段内本模块写）。按 patch 层语义**后写者胜**，
  // 所以这里取**最后一条**，不取第一条。取第一条会踩到这个坑：段外的
  // `disabled: true` 在文件前面时被判为「已有且为 true」，于是既不补新行、也不
  // 进纠正逻辑，默认激活款被静默关掉 —— 与本次主 bug 同源。
  const disabledValueOf = (id: string): boolean | null => {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^- id:\\s*${esc}\\s*\\n\\s+disabled:\\s*(true|false)`, 'gm');
    let last: string | null = null;
    for (const m of text.matchAll(re)) last = m[1] ?? null;
    return last === null ? null : last === 'true';
  };
  const hasDisabledRow = (id: string) => disabledValueOf(id) !== null;

  // 自管段内允许纠正值：段内是「本模块上一次写的」，若与当前配置不符（例如
  // 默认激活项从 A 改成 B，或早期版本写错），应当修正；段外是用户/皮肤管理器
  // 的显式选择，一律不动。这修掉过一个实测问题：默认激活项曾被写成
  // disabled: true（残留值），导致播种「成功」但界面无皮肤生效。
  const managedRange = (() => {
    const b = text.indexOf(MANAGED_BEGIN);
    const e = text.indexOf(MANAGED_END);
    return b >= 0 && e > b ? { begin: b, end: e } : null;
  })();
  const inManaged = (id: string): boolean => {
    if (!managedRange) return false;
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^- id:\\s*${esc}\\s*$`, 'm');
    const seg = text.slice(managedRange.begin, managedRange.end);
    return re.test(seg);
  };

  // 默认激活款若在**段外**被写成 disabled: true，段内的 false 压不住它
  // （patch 层后写者胜，段外那行在段内之前或之后都可能出现）。这种情况必须纠正，
  // 否则「默认激活」在边界下静默失效 —— 与本次主 bug 同一类。
  // 只针对 active 款：非激活款保持用户的显式禁用是正确的，不能越权打开。
  const blockedOutside = specs.filter(
    (s) => s.active && !inManaged(s.wiringId) && disabledValueOf(s.wiringId) === true,
  );

  // **每款皮肤都必须有 insert 行** —— 这是客户端半被下发的唯一入口。
  //
  // 实测（2026-10-23，这块连续判断错了三次）：
  //   · 只写 disabled 行、不写 insert → 浏览器聚合请求 /plugins/??... 里根本没有
  //     该皮肤（`/api/dsh/skins` 能列出它，因为管理器是扫目录的），body 上没有
  //     data-dsh-<skin> 属性，界面不换肤；
  //   · 包内自带 cordis.patch.yml 的那份 insert **不会**因为包进了 bundles 就自动
  //     生效 —— bundles 只控制 host 侧加载，客户端 roster 由 patch 的 insert 提供。
  //
  // 所以 insert 一律补。同 id 重复的风险由 hasInsert 拦住（已存在就不写第二条），
  // 而「重复路由」那个 bug 的实际原因是同一个包被 COMPANION_PLUGINS 和包内 patch
  // 各注册一次（见 companion-sync.ts 里皮肤管理器的说明），与本处无关。
  const missingInserts = specs.filter((s) => !hasInsert(s.wiringId));
  const missingDisabled = specs.filter((s) => !hasDisabledRow(s.wiringId));
  const wrongDisabled = specs.filter((s) => {
    const v = disabledValueOf(s.wiringId);
    return v !== null && v !== !s.active && inManaged(s.wiringId);
  });
  if (
    missingInserts.length === 0
    && missingDisabled.length === 0
    && wrongDisabled.length === 0
    && blockedOutside.length === 0
  ) return false;

  const lines: string[] = [];
  if (!text.includes(MANAGED_BEGIN)) {
    lines.push('', MANAGED_BEGIN);
  }
  for (const s of missingInserts) {
    lines.push('- insert:', `    - id: ${s.wiringId}`, `      name: '${s.name}'`);
  }
  for (const s of missingDisabled) {
    lines.push(`- id: ${s.wiringId}`, `  disabled: ${s.active ? 'false' : 'true'}`);
  }
  if (!text.includes(MANAGED_END)) lines.push(MANAGED_END);

  // 三个纠正来源任一命中有意义，就不能在这里返回：早退条件必须与第 299 行的
  // 早退条件严格对称（那边含 blockedOutside，这边原来漏了）。漏掉的表现是
  // 「只有段外阻挠行」时函数静默返回 false —— 判定命中了却不执行，没有日志、
  // 没有改动，和没命中完全无法区分。
  if (lines.length === 0 && wrongDisabled.length === 0 && blockedOutside.length === 0) return false;
  // 就地纠正自管段内写错的值（在 managedRange 内替换，不碰段外）。
  let next = text;
  for (const s of wrongDisabled) {
    const esc = s.wiringId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const seg = next.slice(managedRange!.begin, managedRange!.end);
    const fixed = seg.replace(
      new RegExp(`^(- id:\\s*${esc}\\s*\\n\\s+disabled:\\s*)(true|false)`, 'm'),
      `$1${s.active ? 'false' : 'true'}`,
    );
    next = next.slice(0, managedRange!.begin) + fixed + next.slice(managedRange!.end);
    log('已纠正随包皮肤的默认激活状态: ' + s.wiringId + ' → disabled=' + (!s.active));
  }
  // 默认激活款另有「段外阻挠行」的场景：用户（或早期版本的皮肤管理器）在自管段
  // **之外**手写过 `- id: ui-skin-orca-link / disabled: true`。上面只改段内，
  // 段外那行不动，而同 id 后出现的行会覆盖先出现的行 —— 结果默认激活款仍被关着，
  // 「播种成功但界面无皮肤」原样复现（逐行解析的 patch 层语义是后写者胜）。
  //
  // 只对 active 款做这件事：非激活款保持用户的显式禁用是正确行为，不能越权打开。
  // 改法是把段外的 true 改成 false，段内那份本来就是 false，两处一致即无歧义。
  for (const s of blockedOutside) {
    const esc = s.wiringId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const before = next;
    next = next.replace(
      new RegExp(`^(- id:\\s*${esc}\\s*\\n\\s+disabled:\\s*)true`, 'gm'),
      '$1false',
    );
    if (next !== before) {
      log('已在自管段外纠正默认激活款: ' + s.wiringId + ' → disabled=false（段外旧值会覆盖段内）');
    }
  }
  if (lines.length > 0) next = next.replace(/\s*$/, '\n') + lines.join('\n') + '\n';
  if (next === text) return false;
  try {
    fs.writeFileSync(patchFile, next);
    return true;
  } catch {
    return false;
  }
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

/**
 * 在 profile 层与 home 层两处都补齐皮肤行。
 *
 * 两层都要写的原因见 {@link ensureSkinPatchRowsIn} 的头注释：home 层优先级更高，
 * 只写 profile 层会被 home 层的旧 `disabled: true` 静默压掉。
 */
function ensureSkinPatchRows(profileDir: string, specs: readonly LiteSkinSpec[], log: (m: string) => void = () => {}): boolean {
  let changed = false;
  if (ensureSkinPatchRowsIn(path.join(profileDir, 'cordis.patch.yml'), specs, log)) changed = true;
  // home 层 = profile 目录的祖父（<home>/profiles/<name> → <home>）。不存在就跳过：
  // 不主动创建 home 层文件，避免在没有该文件的环境里凭空多出一份配置。
  const homePatch = path.join(path.dirname(path.dirname(profileDir)), 'cordis.patch.yml');
  if (fs.existsSync(homePatch) && ensureSkinPatchRowsIn(homePatch, specs, (m) => log('[home] ' + m))) {
    changed = true;
  }
  return changed;
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
  if (ensureSkinPatchRows(profileDir, LITE_BUNDLED_SKINS, log)) {
    log('已补齐随包皮肤的 patch 行（默认激活: ' + LITE_BUNDLED_SKINS.filter((s) => s.active).map((s) => s.wiringId).join(', ') + '）');
    changed = true;
  }
  return changed;
}

export { MANAGED_BEGIN, MANAGED_END };
