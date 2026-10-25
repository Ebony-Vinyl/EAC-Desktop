'use strict';

// profile.txt 的 full/lite 是历史插件默认启停策略，不是产品资源档位。
// 当前仓库完整产物是 EAC Lite；Full 需要实际安装 EAC-Pack 包。
// 为兼容既有安装，保留标记、缺省 full 与 companion-sync 的新行默认值契约；
// 不重写用户已有启停选择，也不能以此标记判断 EAC-Pack 已安装。

import fs = require('node:fs');
import path = require('node:path');

export type InstallProfile = 'full' | 'lite';

export const PROFILE_MARKER_FILE = 'profile.txt';

/**
 * 历史 lite 策略默认停用的随包配套插件（companion id）。
 *
 * ISO-005 收敛（当前为空数组）：停用对象只能是「随包的增强插件」，而随包面
 * 收敛后（装配面 BUILTIN_PLUGIN_DIRS 与 COMPANION_PLUGINS 1:1）这些插件
 * 全部是 ADR 0008 的 builtin（= onboarding CORE_PLUGIN_IDS），既被核心组锁定
 * 停用路径（plugin-ops 拒绝停用），本身又正是精简版要保留的项：
 *   viewport-lock 视口钳制 / settings-scroll-fix 设置滚动修复 /
 *   compact 请求压缩 / plugin-shield 保护中心 / unified-market 市场管理 /
 *   file-changes + client-file-changes 文件视图 / easy-setup 快速配置 /
 *   eac-locale-compat 界面底座 /
 *   dsh-boot-animation 开机动画 / dsh-wechat-plugin 微信渠道 /
 *   ds-harness-remote 远程访问（2026-10 集成的三项）。
 * 收敛前登记的 14 项（agent-teams / dsh-stt / dsh-phone / computer-user /
 * dsh-dafeiyu / offpeak / change-review …）自 v6 Task 3.1 起已不随包（.sync
 * 分级 recommended/external，市场按需安装），不再是本清单的合法成员 —— 它们
 * 的「装完默认禁用」由 L3 外部层规划承接（plugin-manager-state）。
 *
 * 约束（ISO-005 复核）：
 *  - 必须是 COMPANION_PLUGINS 的子集；
 *  - 不得命中 scripts/onboarding 的 CORE_PLUGIN_IDS（核心组锁定停用路径，
 *    核心插件即便在精简版也保持默认启用 —— 如 compact）。
 * 当前随包插件全部落在上述两条约束内，故清单为空；将来有「随包但默认关」
 * 的增强插件接回时在此登记。
 */
export const LITE_DEFAULT_DISABLED: readonly string[] = [];

export function isLiteDisabled(id: string, profile: InstallProfile): boolean {
  return profile === 'lite' && LITE_DEFAULT_DISABLED.includes(id);
}

/** 读取兼容启停策略标记（不判断产品档位）：缺失 / 脏值 / 读失败一律回退 full（永不阻塞启动）。 */
export function readInstallProfile(appRoot: string): InstallProfile {
  try {
    const raw = fs.readFileSync(path.join(appRoot, PROFILE_MARKER_FILE), 'utf8');
    return raw.trim() === 'lite' ? 'lite' : 'full';
  } catch {
    return 'full';
  }
}
