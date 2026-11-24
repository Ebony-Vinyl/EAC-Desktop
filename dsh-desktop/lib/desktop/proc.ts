'use strict';

// 子进程回收与环境构造（ADR 0002 L2 业务服务层；Wave 1 自 proc.js 类型化迁出，
// 行为零变更）。依赖通过 init() 注入，保持本模块与 Electron/UI 零耦合。

import cp = require('node:child_process');
import type { ChildProcess } from 'node:child_process';
import fs = require('node:fs');
import path = require('node:path');
import { APP_ROOT } from './runtime-paths';

const IS_WIN = process.platform === 'win32';

/** 注入接口：由宿主（Electron main / Tauri sidecar）在启动时提供。 */
export interface ProcCtx {
  log(tag: string, msg: string): void;
  getDshHome(): string | null;
  getDesktopProfile(): string;
}

let ctx!: ProcCtx;
export function init(d: ProcCtx): void { ctx = d; }

/** DSH 子进程在 POSIX 上必须成为独立进程组组长，供负 PGID 树级回收。 */
export function childProcessSpawnOptions(
  platform: NodeJS.Platform = process.platform,
): { detached: boolean } {
  return { detached: platform !== 'win32' };
}

export function killTree(proc: ChildProcess | null | undefined): void {
  void killTreeAndWait(proc).then((confirmed) => {
    if (!confirmed) ctx.log('killTree', '未确认服务进程树退出');
  });
}

// 等待 taskkill 本身结束，不能把已派发命令当成已完成树级终止。
function taskkill(pid: number, force: boolean, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let command: ChildProcess;
    try {
      command = cp.spawn('taskkill', ['/pid', String(pid), '/T', ...(force ? ['/F'] : [])], {
        windowsHide: true, stdio: 'ignore',
      });
    } catch { resolve(false); return; }
    let done = false;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      command.removeListener('exit', onExit);
      // 保留 error 消费者：超时后终止命令仍可能异步触发 error。
      resolve(ok);
    };
    const onExit = (code: number | null): void => finish(code === 0);
    const timer = setTimeout(() => {
      try { command.kill(); } catch { /* 结果仍为未确认 */ }
      finish(false);
    }, Math.max(1, timeoutMs));
    command.once('exit', onExit);
    command.once('error', () => finish(false));
  });
}

const unconfirmedTrees = new WeakSet<ChildProcess>();

/** true 表示已确认退出；超时、权限或观测失败均不能作为无锁窗口。 */
export async function killTreeAndWait(
  proc: ChildProcess | null | undefined,
  { graceMs = 1200, hardMs = 4000 }: { graceMs?: number; hardMs?: number } = {},
): Promise<boolean> {
  if (!proc || !proc.pid) return true;
  if (IS_WIN && (proc.exitCode !== null || proc.signalCode != null)) return !unconfirmedTrees.has(proc);
  unconfirmedTrees.add(proc);
  const confirm = (): true => { unconfirmedTrees.delete(proc); return true; };
  const pid = proc.pid;
  try {
    if (IS_WIN) {
      const soft = await taskkill(pid, false, graceMs);
      const exited = await waitForProcExit(proc, graceMs);
      if (soft && exited) return confirm();
      // 根进程在失败命令期间消失，不能再靠它证明后代已被终止。
      if (exited) return false;
      const hard = await taskkill(pid, true, hardMs);
      const confirmed = await waitForProcExit(proc, hardMs);
      return hard && confirmed ? confirm() : false;
    }
    // DSH 使用 detached 独立进程组；组长 exit 不等于所有后代 exit。
    try { process.kill(-pid, 'SIGTERM'); } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ESRCH') return false;
    }
    if (await waitForGroupExit(pid, graceMs)) return confirm();
    try { process.kill(-pid, 'SIGKILL'); } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ESRCH') return false;
    }
    return await waitForGroupExit(pid, hardMs) ? confirm() : false;
  } catch (err) {
    ctx.log('killTree', String(err));
    return false;
  }
}

function waitForGroupExit(pid: number, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  return new Promise((resolve) => {
    const check = (): void => {
      try { process.kill(-pid, 0); } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ESRCH') { resolve(true); return; }
      }
      if (Date.now() - started >= timeoutMs) { resolve(false); return; }
      setTimeout(check, Math.min(100, Math.max(1, timeoutMs - (Date.now() - started))));
    };
    check();
  });
}

// Environment for the dsh child: drop harness/session leftovers so the
// desktop instance boots clean, keep everything else (proxy, API keys, ...).
// 「完全访问」用户选择 → 进程级部署默认：UI 把默认权限写进设置文档的
// permission.defaultPreset（只影响未来新会话）；若不提升为部署级
// sandbox.mode，设置了的用户在写工作区外/经旧会话时仍被 workspace-write
// 拒绝（issue #196）。DSH_PERMISSION_MODE 由内核 dsh-base/cordis.patch.yml
// 的 !!js process.env 行消费，注入后 approval 联动降为 never。
// settings.yaml 的 mtime 记忆化：childEnv 在每次 spawn 前都调，全量读 +
// yaml.parse settings.yaml 是重复热点；文件未变时复用上次解析结果。
// TTL 短（5s）：权限选择改动后最迟 5s 内生效，同时吸收同秒多次调用。
// 缓存键必须含文件路径：不同 DSH_HOME 下的 settings.yaml 可能落在同一
// mtime 刻度（Windows 文件时间粒度粗，实测两个新建临时目录逐位相同），
// 只比 mtime 会把上一个 home 的判定串到当前 home（可能把 workspace-write
// 误判为 danger-full-access）。
// 0.2.x 起 SettingsForms.importLegacyDocument() 在启动时将 settings.yaml 迁入
// 活跃 profile 的 cordis.patch.yml 并把原文件改名为 settings.yaml.imported
//（issue #479）。因此按内核真实覆盖序依次查找显式 permission.defaultPreset：
//   1. <DSH_HOME>/cordis.patch.yml（home 层覆盖，优先级最高）
//   2. <DSH_HOME>/profiles/<desktopProfile>/cordis.patch.yml（UI 设置落盘处）
//   3. <DSH_HOME>/settings.yaml（尚未完成首次迁移的旧版配置；不读已退役的
//      .imported，防止用户在 UI 改回 workspace-write 删掉 patch 行后被旧备份反向抬权）
// 记忆化键包含全部候选路径与各自 mtimeMs，避免跨 DSH_HOME 或单文件变更串缓存。
const presetCache: { at: number; signature: string | null; value: 'danger-full-access' | null } = {
  at: 0, signature: null, value: null,
};
const YAML_JS_TAG = {
  tag: 'tag:yaml.org,2002:js',
  resolve: (value: unknown): unknown => value,
};
function extractPresetFromPatchRows(rows: unknown): string | undefined {
  if (!Array.isArray(rows)) return undefined;
  let found: string | undefined;
  for (const item of rows) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    if (row.disabled === true) continue;
    if (Array.isArray(row.insert)) {
      const nested = extractPresetFromPatchRows(row.insert);
      if (nested !== undefined) found = nested;
    }
    if (row.group === true && Array.isArray(row.config)) {
      const grouped = extractPresetFromPatchRows(row.config);
      if (grouped !== undefined) found = grouped;
    }
    if (row.id === 'permission' && row.config && typeof row.config === 'object' && !Array.isArray(row.config)) {
      const preset = (row.config as Record<string, unknown>).defaultPreset;
      if (typeof preset === 'string' && preset.length > 0) {
        found = preset;
      }
    }
  }
  return found;
}
function extractPresetFromSettingsDoc(doc: unknown): string | undefined {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return undefined;
  const permission = (doc as Record<string, unknown>).permission;
  if (!permission || typeof permission !== 'object' || Array.isArray(permission)) return undefined;
  const preset = (permission as Record<string, unknown>).defaultPreset;
  return typeof preset === 'string' && preset.length > 0 ? preset : undefined;
}
function userDefaultPreset(): 'danger-full-access' | null {
  try {
    const home = ctx.getDshHome();
    if (!home) return null;
    const desktopProfile = ctx.getDesktopProfile();
    const candidates: Array<{ file: string; kind: 'patch' | 'settings' }> = [
      { file: path.join(home, 'cordis.patch.yml'), kind: 'patch' },
      ...(desktopProfile
        ? [{ file: path.join(home, 'profiles', desktopProfile, 'cordis.patch.yml'), kind: 'patch' as const }]
        : []),
      { file: path.join(home, 'settings.yaml'), kind: 'settings' },
    ];
    const stats: Array<{ file: string; kind: 'patch' | 'settings'; mtimeMs: number | null; size: number | null }> = [];
    for (const entry of candidates) {
      try {
        const st = fs.statSync(entry.file);
        stats.push({ ...entry, mtimeMs: st.mtimeMs, size: st.size });
      } catch (err) {
        // 仅明确 ENOENT 视作文件缺失；ACL 拒绝（EACCES/EPERM）、临时 I/O 错误（EIO/EBUSY）等
        // 一律按 fail-closed 保持内核默认权限，绝不跳过高优先级候选向低优先级回退抬权。
        if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
          stats.push({ ...entry, mtimeMs: null, size: null });
          continue;
        }
        presetCache.signature = null;
        const code = (err as NodeJS.ErrnoException)?.code;
        const msg = err instanceof Error ? err.message : String(err);
        ctx.log('warn', `检查权限配置状态失败（${code ?? 'UNKNOWN'}），按 fail-closed 保持默认权限（不向下回退）: ${entry.file} (${msg})`);
        return null;
      }
    }
    const signature = stats
      .map((entry) => `${entry.file}:${entry.mtimeMs === null ? 'missing' : `${entry.mtimeMs}:${entry.size}`}`)
      .join('|');
    const now = Date.now();
    if (signature === presetCache.signature && now - presetCache.at < 5000) return presetCache.value;
    // yaml 随 dsh-settings-file 进入内置依赖树；高优先级候选文件只要存在但读/解析失败
    // 或顶层结构损坏，必须失败关闭（fail-closed 返回 null，保持内核默认 workspace-write），
    // 绝不向下回退到低优先级文件（避免高优先级收紧配置损坏时意外落回旧的 danger-full-access 导致抬权）。
    const yaml = require('yaml');
    let resolvedPreset: string | undefined;
    for (const entry of stats) {
      if (entry.mtimeMs === null) continue;
      try {
        const text = fs.readFileSync(entry.file, 'utf8');
        if (typeof yaml.parse !== 'function') {
          presetCache.signature = null;
          ctx.log('warn', `权限配置解析器未就绪，按 fail-closed 关闭完全访问注入: ${entry.file}`);
          return null;
        }
        const doc = yaml.parse(text, { customTags: [YAML_JS_TAG] });
        if (doc !== null && doc !== undefined) {
          const validShape = entry.kind === 'patch'
            ? Array.isArray(doc)
            : (typeof doc === 'object' && !Array.isArray(doc));
          if (!validShape) {
            presetCache.signature = null;
            ctx.log('warn', `权限配置结构异常，按 fail-closed 保持默认权限（不向下回退）: ${entry.file}`);
            return null;
          }
        }
        const preset = entry.kind === 'patch'
          ? extractPresetFromPatchRows(doc)
          : extractPresetFromSettingsDoc(doc);
        if (preset !== undefined) {
          resolvedPreset = preset;
          break;
        }
      } catch (err) {
        presetCache.signature = null;
        const msg = err instanceof Error ? err.message : String(err);
        ctx.log('warn', `读取或解析权限配置失败，按 fail-closed 保持默认权限（不向下回退）: ${entry.file} (${msg})`);
        return null;
      }
    }
    const value = resolvedPreset === 'danger-full-access' ? 'danger-full-access' : null;
    presetCache.at = now;
    presetCache.signature = signature;
    presetCache.value = value;
    return value;
  } catch (err) {
    presetCache.signature = null;
    const msg = err instanceof Error ? err.message : String(err);
    ctx.log('warn', `解析默认权限预设异常，按 fail-closed 保持默认权限: ${msg}`);
    return null;
  }
}
export function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of ['DSH_WEB_URL', 'DSH_SESSION_ID', 'DSH_SESSION_JSONL', 'DSH_SHELL', 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS']) {
    delete env[k];
  }
  const dshHome = ctx.getDshHome();
  if (dshHome) env.DSH_HOME = dshHome;
  // 桌面端标记 + 实际 profile：配套插件的 host 半边（插件市场 / Skills 与
  // MCP 等）据此把安装/读写落到桌面专属 profile，而不是原生的 web profile。
  env.DSH_DESKTOP = '1';
  env.DSH_DESKTOP_PROFILE = ctx.getDesktopProfile();
  // 资源根（dsh-desktop 树）：L3 插件进程据此定位功能包 CLI 等随包资源。
  env.DSH_DESKTOP_RESOURCE_ROOT = APP_ROOT;
  if (dshHome && userDefaultPreset() === 'danger-full-access') {
    env.DSH_PERMISSION_MODE = 'danger-full-access';
  }
  env.NO_COLOR = '1';
  return env;
}

// exit/明确不存在才确认退出；error、超时和探活失败不等于进程消失。
export function waitForProcExit(proc: ChildProcess | null | undefined, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (!proc || !proc.pid) { resolve(true); return; }
    if (proc.exitCode !== null || proc.signalCode != null) { resolve(true); return; }
    const pid = proc.pid;
    const started = Date.now();
    let pollTimer: NodeJS.Timeout | null = null;
    let finished = false;
    const finish = (confirmed: boolean): void => {
      if (finished) return;
      finished = true;
      if (pollTimer !== null) clearTimeout(pollTimer);
      proc.removeListener('exit', onExit);
      proc.removeListener('error', onError);
      resolve(confirmed);
    };
    const onExit = (): void => finish(true);
    const onError = (): void => finish(false);
    proc.once('exit', onExit);
    proc.once('error', onError);
    const check = (): void => {
      if (finished) return;
      if (proc.exitCode !== null || proc.signalCode != null) { finish(true); return; }
      try { process.kill(pid, 0); } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ESRCH') { finish(true); return; }
      }
      if (Date.now() - started >= timeoutMs) {
        ctx.log('service', '未确认旧服务进程退出（PID ' + pid + '），停止后续操作');
        finish(false);
        return;
      }
      pollTimer = setTimeout(check, Math.min(500, Math.max(1, timeoutMs - (Date.now() - started))));
    };
    pollTimer = setTimeout(check, Math.min(500, Math.max(0, timeoutMs)));
  });
}
