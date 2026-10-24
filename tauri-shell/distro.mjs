'use strict';

// 分发档位（distro）与各档位的随包面。
//
// 为什么需要这个模块
// ------------------
// 此前只有一个 `BUILTIN_PLUGIN_DIRS` 常量，装配（stage-resources.mjs）与发行
// 描述符生成（gen-distribution-descriptor.mjs）共读它 —— 后者是**用正则从源码
// 里抓**的，属于脆弱耦合。而 lite / full 需要不同的随包面：
//
//   lite  —— 仓库默认产物。桌面壳最小核心 + 基础配套 + 视觉核心
//            （壁纸引擎、皮肤管理器）+ 5 款皮肤（见 lite-skins.ts）。
//   full  —— lite 面 + 完整皮肤集（便于离线换肤）。
//
// 档位是**构建期**概念，与 `profile.txt` 的 full/lite **不是同一回事**：
// 后者是历史插件默认启停策略标记，见 dsh-desktop/lib/desktop/install-profile.ts。
//
// 抽成纯数据模块的理由：装配脚本是顶层直接执行的 ESM，无法被 import 拿常量；
// 描述符生成器此前靠正则解析。现在两边都从这里 import，口径只有一处。

import path from 'node:path';

export const DISTROS = ['lite', 'full'];

/** 解析 --distro=<v>，缺省 lite（仓库默认产物）。非法值 fail-fast。 */
export function parseDistro(argv = process.argv) {
  const arg = argv.find((a) => a.startsWith('--distro='));
  if (!arg) return 'lite';
  const v = arg.slice('--distro='.length);
  if (v !== 'lite' && v !== 'full') {
    throw new Error(`[distro] 非法档位: ${v}（可选 ${DISTROS.join(' / ')}）`);
  }
  return v;
}

/**
 * 桌面壳最小核心 + 基础配套。两档都随包。
 *
 * ISO-005 起本清单是「随包实物」的唯一基准：每项在 assets/plugins 下有同名目录，
 * 装配时逐目录 fail-fast 拷贝；COMPANION_PLUGINS 与 onboarding 的 CORE_PLUGIN_IDS
 * 都由它派生。
 */
export const BASE_PLUGIN_DIRS = [
  // 阶段 1（PR #392）：零外设依赖的试点插件
  'dsh-viewport-lock',
  'dsh-eac-locale-compat',
  // 阶段 2：不依赖 window.dshDesktop 已删桥接面的 builtin 插件
  'dsh-compact',
  'dsh-easy-setup',
  'dsh-file-changes',
  'dsh-settings-scroll-fix',
  'dsh-unified-market',
  // 阶段 3：服务端 RPC / bridge 面已接回
  'dsh-plugin-shield',
  'dsh-client-file-changes',
];

/**
 * 视觉核心：壁纸引擎 + 皮肤管理器。两档都随包。
 *
 * 用户 2026-10-22 明确要求把它们提升为随包核心插件，精简版也要。
 * 两者都不依赖已删的 window.dshDesktop 桥接面。
 */
export const VISUAL_CORE_PLUGIN_DIRS = [
  'dsh-plugin-wallpaper-engine',
  'dsh-client-ui-skin-deep-whale-manager',
];

/**
 * full 档额外的随包插件（EAC-Pack 线）。
 *
 * 当前为空：EAC-Pack 插件由安装器写 profile，不随桌面安装包分发。
 * 保留具名常量而不是就地写 `[]`，是为了将来真需要随包时口径清晰。
 */
export const FULL_ONLY_PLUGIN_DIRS = [];

/** 某档位随包的插件目录（装配与描述符共用唯一口径）。 */
export function builtinPluginDirs(distro) {
  return distro === 'full'
    ? [...BASE_PLUGIN_DIRS, ...VISUAL_CORE_PLUGIN_DIRS, ...FULL_ONLY_PLUGIN_DIRS]
    : [...BASE_PLUGIN_DIRS, ...VISUAL_CORE_PLUGIN_DIRS];
}

/** lite 档随包的 5 款皮肤目录（与 dsh-desktop/lib/desktop/lite-skins.ts 对齐）。 */
export const LITE_SKIN_DIRS = [
  '@linxin666_dsh-client-ui-skin-whale-song',
  '@smalltailqwq_dsh-client-ui-skin-orca-link',
  'dsh-client-liang-intensity-skin',
  '@smalltailqwq_dsh-client-ui-skin-maid-atelier',
  '@dsh-external_dsh-client-ui-skin-deep-whale-day-night',
];

/** full 档额外随包的皮肤（完整皮肤集里 lite 没带的那几款）。 */
export const FULL_ONLY_SKIN_DIRS = [
  '@linxin666_dsh-client-ui-skin-blue-fantasy',
  '@linxin666_dsh-client-ui-skin-dragon-heir',
  '@linxin666_dsh-client-ui-skin-miku',
  '@linxin666_dsh-client-ui-skin-minecraft',
  '@linxin666_dsh-client-ui-skin-qq98',
  '@linxin666_dsh-client-ui-skin-ths',
  '@linxin666_dsh-client-ui-skin-trading',
  '@linxin666_dsh-client-ui-skin-xp',
];

/** 某档位随包的皮肤目录。 */
export function bundledSkinDirs(distro) {
  return distro === 'full'
    ? [...LITE_SKIN_DIRS, ...FULL_ONLY_SKIN_DIRS]
    : [...LITE_SKIN_DIRS];
}

/**
 * 装配产物的根目录名。
 *
 * 为什么两档共用同一个目录名：`tauri.conf.json` 的 `bundle.resources` 把
 * `staged-resources/sidecar/`、`staged-resources/dsh-desktop/` 等路径写死了，
 * Tauri 配置不支持参数化路径；另有 8 处测试断言守着这些字面量。改目录名会
 * 连带打断打包与测试，而档位隔离的价值在**内容**不在目录名。
 *
 * 因此：同一目录，装配开始时整体清空重建（stage-resources.mjs 已有 rmSync），
 * 所以「先装配 lite 再装配 full」不会残留上一个档位的文件。
 * 若将来确实需要两档产物并存，再引入 --out=<dir> 显式覆盖。
 */
export function stagedDirName(_distro) {
  return 'staged-resources';
}

/** 装配产物根目录的绝对路径。 */
export function stagedDir(root, distro) {
  return path.join(root, 'tauri-shell', stagedDirName(distro));
}
