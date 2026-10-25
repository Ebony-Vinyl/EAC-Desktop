'use strict';

// 桌面专属 profile（与原生 CLI 彻底共存）（ADR 0002 L2 业务服务层；
// Wave 1 自 profile.js 类型化迁出，行为零变更）。
//
// 历史冲突根因有二 ——
//   1. 桌面端把配套插件行/包直接写进原生 `web` profile，pnpm 安装、patch
//      行互踩，原生 CLI 跟着崩；
//   2. dsh-app-boot 会把 <home>/profiles/node_modules 的共享 junction 指向
//      「当前运行的 dsh 实例」自己的闭包 —— 原生 npx dsh 一跑，桌面端模块
//      解析被换血（版本错位 / npx 缓存清理后悬空）。
// 桌面端从此默认运行在独立 profile `web-desktop`（DSH_HOME 不变：会话、
// API Key、settings.yaml 依旧共享）；junction 归属由 plugin-guard 周期守卫。
// 旧共享模式仍可用（settings.shareWebProfile = true），仅供特殊需要。

import path = require('node:path');
import fs = require('node:fs');
import os = require('node:os');
import { updCtx, APP_ROOT } from './runtime-paths';
import { seedFullProfile, adoptFullProfile, bindFullHostClosure } from './full-composition';
// updater.js 尚未类型化（Wave 3 收编），先以窄签名消费。
const updater = require('../../updater') as {
  loadSettings(c: ReturnType<typeof updCtx>): { shareWebProfile?: boolean };
};

export const DESKTOP_PROFILE = 'web-desktop';
// 内置 bundle 插件（经 profile bundles 播种）：bundle 机制驱动 host + client
// 注入，overlay 配套行会被 removeBundledRowDuplicates 去重（见
// companion-sync.ts），故这类插件必须走 bundles 而非 patch 行。
// 当前为空数组（ISO-005 复核）：v6 Task 3.1（ADR 0006）把内置插件资产剥出
// assets/plugins，Task 3.3 起接回的随包插件走 COMPANION_PLUGINS 的配套行 /
// 包拷贝路径，不经 bundles 播种 —— 最简 profile 只含官方
// @deepseek-ai/dsh-base + dsh-web-app（纯净 boot 实测 200 可达）。这条链当前
// 无成员，仅保留播种机制：将来确有声明 `dsh.bundle.patch` 的随包插件再登记。
//
// M2/#415（皮肤加载器接入）：皮肤平台曾在此清单（`@dsh-eac/ui-skin-loader`
// 与 13 款公约皮肤包，逐包 SHA-256 本地校验）。
//
// EAC-CORE-SHELL-01：皮肤平台已彻底外迁 —— 宿主最小壳不再随包任何皮肤/
// 加载器。皮肤改为市场可选包（Market Core 按需安装，安装即写 profile
// bundles，语义与既往一致）。未选择任何皮肤时观感为宿主原生主题。
export const UI_SKIN_PLATFORM_PACKAGES: string[] = [];
export const BUNDLED_BUILTIN_PLUGINS: string[] = [...UI_SKIN_PLATFORM_PACKAGES];
// 与官方 web profile 出厂模板一致（@deepseek-ai/dsh-base + dsh-web-app），
// 外加内置 bundle 插件（当前为空）；仅用于全新 profile 播种。
export const DESKTOP_PROFILE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...BUNDLED_BUILTIN_PLUGINS];

/** 注入接口：由宿主（Electron main / Tauri sidecar）在启动时提供。 */
export interface ProfileCtx {
  log(tag: string, msg: string): void;
  getDshHome(): string | null;
}

let ctx!: ProfileCtx;
export function init(d: ProfileCtx): void { ctx = d; }

// shareWebProfile 的 mtime 记忆化：desktopProfile 在 boot/market/companion-sync
// 等多条路径频繁调用，每次 loadSettings 都同步读 settings.json；设置文件未变
// 时复用结果，5s TTL 兜底外部改动。
const profileCache: { at: number; mtimeMs: number | null; value: string } = {
  at: 0, mtimeMs: null, value: DESKTOP_PROFILE,
};
export function desktopProfile(): string {
  try {
    const file = path.join(updCtx().userDataDir, 'settings.json');
    let mtimeMs: number | null = null;
    try { mtimeMs = fs.statSync(file).mtimeMs; } catch { /* 不存在 */ }
    const now = Date.now();
    if (mtimeMs === profileCache.mtimeMs && now - profileCache.at < 5000) return profileCache.value;
    const s = updater.loadSettings(updCtx());
    const value = s.shareWebProfile === true ? 'web' : DESKTOP_PROFILE;
    profileCache.at = now;
    profileCache.mtimeMs = mtimeMs;
    profileCache.value = value;
    return value;
  } catch {
    return DESKTOP_PROFILE;
  }
}

export function desktopProfileDir(): string {
  const home = ctx.getDshHome() || path.join(os.homedir(), '.dsh');
  return path.join(home, 'profiles', desktopProfile());
}

// 未知 profile 不会自动初始化（dsh 直接报错退出），桌面端自己按官方模板
// 创建：package.json（bundles）+ pnpm-workspace.yaml + 空 patch 层。
export function ensureDesktopProfileInit() {
  try {
    const home = ctx.getDshHome() || path.join(os.homedir(), '.dsh');
    const dir = desktopProfileDir();
    if (desktopProfile() === 'web') return; // 共享模式走官方模板
    if (seedFullProfile(dir)) {
      bindFullHostClosure(home);
      ctx.log('boot', '已从随包完整离线种子初始化 profile: ' + dir);
    } else {
      // issue #464：旧版最简本体（不带 full-pack）建出的隔离环境里，profile 只有
      // 官方 base/web-app。full 包装进这种环境时 seedFullProfile 因「profile 已
      // 存在」直接跳过，随包插件永远补不上，UI 里看不到任何插件且全程无提示。
      // 这里只做增量补齐（绝不覆盖用户数据），补齐后 bindFullHostClosure 兜住
      // 新增包所需的宿主闭包。
      const adopted = adoptFullProfile(dir);
      if (adopted) {
        bindFullHostClosure(home);
        ctx.log('boot', '已将既有 profile 补齐到随包完整清单: '
          + `新增 ${adopted.adopted.length}、刷新 ${adopted.refreshed.length}、保留用户包 ${adopted.kept.length}`);
      }
    }
    fs.mkdirSync(dir, { recursive: true });
    const manifest = path.join(dir, 'package.json');
    if (!fs.existsSync(manifest)) {
      fs.writeFileSync(manifest, JSON.stringify({
        name: 'dsh-profile-' + desktopProfile(),
        private: true,
        dependencies: {},
        dsh: { profile: { bundles: [...DESKTOP_PROFILE_BUNDLES] } },
      }, null, 2) + '\n');
      ctx.log('boot', '已初始化桌面专属 profile: ' + dir);
    }
    if (!fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n');
    }
    if (!fs.existsSync(path.join(dir, 'cordis.patch.yml'))) {
      fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), '[]\n');
    }
    // 从源码运行时，插件会从 DSH_HOME/profile 的共享 node_modules 解析
    // 宿主依赖；全新隔离 DSH_HOME 没有安装闭包，先补齐桌面依赖中的
    // schemastery junction，避免 better-sidebar / side-session 触发整树失败。
    const shared = path.join(home, 'profiles', 'node_modules');
    const source = path.join(APP_ROOT, 'node_modules', 'schemastery');
    const link = path.join(shared, 'schemastery');
    if (fs.existsSync(source) && !fs.existsSync(link)) {
      fs.mkdirSync(shared, { recursive: true });
      try { fs.symlinkSync(source, link, 'junction'); } catch (err) {
        ctx.log('boot', '创建 schemastery 共享链接失败: ' + (err as Error).message);
      }
    }
  } catch (err) {
    ctx.log('boot', '初始化桌面 profile 失败: ' + (err as Error).message);
  }
}
