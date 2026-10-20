'use strict';

// dsh web 服务进程编排（ADR 0002 L2 业务服务层；P2 自 main.js 的
// startServer / watchServerProc / waitUntilUp 提取，启动语义零变更，
// GUI 相关部分（loadURL / 「服务已停止」对话框）经 ctx 回调交给宿主）。
//
// 双轨说明：Electron main.js 在 M3 切换前保留原实现（可回退主线）；
// Tauri sidecar 挂载本模块，经 RPC 暴露：
//   boot.start   {overlays?} → {webUrl, port}
//   boot.stop    {}           → {ok}
//   boot.restart 编排由 sidecar 组合（市场排队 → 同步 → 本模块起停）
//   boot.state   {}           → {running, webUrl}
// 服务意外死亡经 ctx.onServerDied 上抛，宿主决定恢复页 / 对话框 / 静默。

import fs = require('node:fs');
import http = require('node:http');
import os = require('node:os');
import path = require('node:path');
import cp = require('node:child_process');
import { writeFileAtomic } from '../atomic-json';
import type { ChildProcess } from 'node:child_process';

// 兄弟 / 根模块窄签名消费（Wave 3 收编完成后改为具名类型化导入）。
const { killTreeAndWait, childEnv, childProcessSpawnOptions } = require('./proc') as {
  killTreeAndWait(p: ChildProcess | null | undefined, o?: { graceMs?: number; hardMs?: number }): Promise<boolean>;
  childEnv(): NodeJS.ProcessEnv;
  childProcessSpawnOptions(): { detached: boolean };
};
const { restrictedPortOf, chooseStableWebPort } = require('../../stable-port') as {
  restrictedPortOf(url: string): number;
  chooseStableWebPort(ctx: unknown, opts?: {requiredPort?: number}): Promise<number>;
};
const { createStreamWriteGuard } = require('../../stream-write-guard') as {
  createStreamWriteGuard(
    stream: fs.WriteStream,
    opts: { onError(err: unknown): void },
  ): { write(chunk: unknown): boolean; end(): void };
};

/** 注入接口：由宿主（Tauri sidecar；未来可收敛 Electron）在启动时提供。 */
export interface BootServerCtx {
  log(tag: string, msg: string): void;
  getUserDataDir(): string;
  getDesktopProfile(): string;
  desktopProfileDir(): string;
  nodeExe(): string;
  dshBin(): string;
  dshCli(): string;
  loadSettings(): { webPort?: number } & Record<string, unknown>;
  saveSettings(s: Record<string, unknown>): void;
  isQuitting(): boolean;
  requiredWebPort?(): number | undefined;
  onServerSpawn?(): void;
  updateRuntime?(): {overlays: string[]; env: NodeJS.ProcessEnv};
  /** 服务就绪后意外死亡（非主动重启、非退出中）时上抛。 */
  onServerDied?(info: { code: number | null; signal: string | null; logPath: string }): void;
}

let ctx!: BootServerCtx;
export function init(d: BootServerCtx): void { ctx = d; }

let serverProc: ChildProcess | null = null;
let restartingServer = false;
let webUrl = '';
let pendingStop: Promise<void> | null = null;
let unconfirmedProc: ChildProcess | null = null;
let starting = false;
let lifecycleRevision = 0;

function assertStartAllowed(revision: number): void {
  if (ctx.isQuitting()) throw new Error('应用正在退出');
  if (revision !== lifecycleRevision) throw new Error('service-start-cancelled');
}

export function getServerProc(): ChildProcess | null { return serverProc; }
export function getWebUrl(): string { return webUrl; }
export function setIsRestarting(v: boolean): void { restartingServer = v; }

function logsDir(): string { return path.join(ctx.getUserDataDir(), 'logs'); }
function dshWebLogPath(): string { return path.join(logsDir(), 'dsh-web.log'); }

// 0.1.2 暗雷自愈（凭据版式）：内核 credentials-local 只认 version:1 +
// refs:/records: 版式，两种历史形态会被拒启 → 每次启动必死（/died 页）：
//   a) 全新建库路径把顶层 version 写成 YAML 字符串 "1"（读取严格 ===1）；
//   b) rc.2 时代的扁平文件（顶层直接放标量凭据，"pre-release flat layout"）。
// 这里在拉起内核前做文本级自愈：a) 引号 version 规整为数字；b) 扁平文件的
// 标量顶层条目收进 refs:、records: 块原样保留在根（语义对齐内核
// renderFlatLayoutMigration，且绝不触碰任何密钥值）；形态看不懂就不动，
// 交内核报错路径展示。失败不阻塞启动。
/**
 * .credentials.yaml 版式自愈（导出供单测）：0.1.2 内核 credentials-local 只认
 * version:1 + refs:/records: 版式 —— 引号 version（"1"）与 rc.2 扁平文件都会
 * 被拒启（「升级后启动必死」级故障，5.3.0 实战事故的反向自愈半边）。
 */
export function healCredentialsVersion(): void {
  try {
    const home = childEnv().DSH_HOME || path.join(os.homedir(), '.dsh');
    const file = path.join(home, '.credentials.yaml');
    if (!fs.existsSync(file)) return;
    const text = fs.readFileSync(file, 'utf8');
    let fixed = text.replace(/^([ \t]*)version:[ \t]*["']1["'][ \t]*$/m, '$1version: 1');
    if (!/^([ \t]*)version:[ \t]*\S/m.test(fixed)) {
      const scalar: string[] = [];
      const rest: string[] = [];
      let inRecords = false;
      let recognizable = true;
      for (const line of fixed.split('\n')) {
        if (/^records:[ \t]*$/.test(line)) { inRecords = true; rest.push(line); continue; }
        if (inRecords) { rest.push(line); continue; }
        // 标量行：key: value —— value 是任意非空白串（原实现 \S 只匹配单字符，
        // 真实 API key 全是多字符 → 扁平迁移分支永不触发，5.3.0 起潜伏）。
        if (/^[A-Za-z_][A-Za-z0-9_-]*:[ \t]*\S+(?:[ \t]+\S+)*[ \t]*$/.test(line)) { scalar.push(line); continue; }
        if (line.trim() === '') continue;
        recognizable = false;
        break;
      }
      if (recognizable && scalar.length > 0) {
        fixed = 'version: 1\nrefs:\n' + scalar.map((l) => '  ' + l).join('\n') + '\n' + rest.join('\n').replace(/\n*$/, '\n');
      }
    }
    if (fixed !== text) {
      // .credentials.yaml 截断 = 凭据全丢：必须原子写。
      writeFileAtomic(file, fixed);
      ctx.log('dsh', '已自愈 .credentials.yaml 版式（0.1.2 只认 version:1 + refs:/records:；引号 version 或 rc.2 扁平文件会被拒启）');
    }
  } catch { /* 自愈失败交由内核报错路径展示 */ }
}

async function startServer(unsafePortRetries = 4, overlays: string[] = [], revision = lifecycleRevision): Promise<string> {
  assertStartAllowed(revision);
  if (serverProc) {
    ctx.log('dsh', 'startServer 重入：先确认旧进程退出再启动');
    await stopOwnedProcess();
    assertStartAllowed(revision);
  }
  healCredentialsVersion();
  // 稳定端口（stable-port）：复用 settings.webPort，避免每次 --port 0 换
  // origin 导致 localStorage 偏好丢失；同时避开 Chromium 受限端口。
  const requiredPort = ctx.requiredWebPort?.();
  const webPort = await chooseStableWebPort({
    loadSettings: () => ctx.loadSettings(),
    saveSettings: (_c: unknown, s: unknown) => ctx.saveSettings(s as Record<string, unknown>),
  }, requiredPort === undefined ? {} : {requiredPort});
  assertStartAllowed(revision);
  return new Promise<string>((resolve, reject) => {
    const nodeBin = ctx.nodeExe();
    const bin = ctx.dshBin();
    const carrier = ctx.dshCli();
    if (!fs.existsSync(nodeBin)) {
      return reject(new Error('找不到内置 Node 运行时: ' + nodeBin));
    }
    if (!fs.existsSync(carrier)) return reject(new Error('找不到桌面 CLI 启动器: ' + carrier));
    fs.mkdirSync(logsDir(), { recursive: true });
    // 启动截断：append-only 无轮转，长寿命安装会积累出数百 MB 的 dsh-web.log。
    // 超过 10MB 时保留尾部 2MB —— 诊断链路只读 tail（rescue-agent 与恢复
    // 中心的 readLog 均带 32KB tail 上限），头部是重复的启动横幅无信息量。
    try {
      const LOG_TRIM_THRESHOLD = 10 * 1024 * 1024;
      const LOG_KEEP_TAIL = 2 * 1024 * 1024;
      const st = fs.statSync(dshWebLogPath());
      if (st.size > LOG_TRIM_THRESHOLD) {
        const keep = Buffer.alloc(LOG_KEEP_TAIL);
        const fd = fs.openSync(dshWebLogPath(), 'r');
        try {
          fs.readSync(fd, keep, 0, LOG_KEEP_TAIL, st.size - LOG_KEEP_TAIL);
        } finally {
          fs.closeSync(fd);
        }
        fs.writeFileSync(dshWebLogPath(), keep);
      }
    } catch { /* 无旧日志/读取失败都不影响启动 */ }
    const out = fs.createWriteStream(dshWebLogPath(), { flags: 'a' });
    ctx.log('dsh', `启动: "${nodeBin}" "${bin}" --profile ${ctx.getDesktopProfile()} --host 127.0.0.1 --port ${webPort}`);
    // --use-system-ca：让 dsh web 进程信任系统证书库（代理/MITM 场景下内置
    // node 的默认 CA 无法验证，导致插件市场等对外 fetch 失败）。
    const updateRuntime = ctx.updateRuntime?.();
    const patchArgs = [...overlays, ...(updateRuntime?.overlays || [])]
      .filter((p) => typeof p === 'string' && p && fs.existsSync(p))
      .flatMap((p) => ['--patch', p]);
    // 0.1.5-rc.2 CLI 形态：`web` 子命令硬编码 --profile web 且拒绝根级
    // --profile；桌面专属 profile（web-desktop）必须走根命令直启
    //（`dsh --profile <name> [app args...]`，帮助示例
    // `dsh --profile tui --resume <session>`）。0.1.3 的 `web` 别名容忍
    // 后置 --profile，升级后需保持本顺序：根选项在前、app 参数在后。
    // --no-open：内核 openBrowser 默认 true 会每轮启动弹一个系统浏览器标签。
    const proc = cp.spawn(
      nodeBin,
      ['--use-system-ca', carrier, '--profile', ctx.getDesktopProfile(), ...patchArgs, '--host', '127.0.0.1', '--port', String(webPort), '--no-open'],
      {
        ...childProcessSpawnOptions(),
        cwd: ctx.getUserDataDir(),
        env: { ...childEnv(), ...updateRuntime?.env, DSH_EAC_KERNEL_BIN: bin, DSH_BIN: carrier },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    serverProc = proc;
    ctx.onServerSpawn?.();
    // profile 首次引导（node_modules 缺失）时 dsh 要先跑 pnpm 装齐依赖，
    // 就绪等待放宽（下方 bootTimeoutMs）。
    const firstBoot = !fs.existsSync(path.join(ctx.desktopProfileDir(), 'node_modules'));
    watchServerProc(proc, out, { expectedPort: webPort, unsafePortRetries, overlays, firstBoot, revision }).then(resolve, reject);
  });
}

// 等待 dsh web 子进程 stdout 出现就绪 URL 行；进程提前退出 / 启动超时则拒绝。
interface WatchOpts {
  expectedPort: number;
  unsafePortRetries: number;
  overlays: string[];
  firstBoot: boolean;
  revision: number;
}

function watchServerProc(proc: ChildProcess, out: fs.WriteStream, opts: WatchOpts): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let handedOff = false; // 受限端口重启：本实例的退出不再影响外层 Promise
    let bootTimer: NodeJS.Timeout | null = null;
    // 0.1.2：stdout 就绪行携带的一次性 token URL（HTTP 探测胜出时的兜底值）。
    let probeFallbackUrl = '';
    const output = createStreamWriteGuard(out, {
      onError: (err) => ctx.log('warn', 'dsh web 日志流异常: ' + String((err && (err as Error).message) || err)),
    });
    let onSettled: ((err: Error | null, url: string) => void) | null = (err, url) => {
      if (err) reject(err); else resolve(url);
    };
    const finish = (err: Error | null, url: string) => {
      if (!settled) {
        settled = true;
        onSettled?.(err, url);
        onSettled = null;
      }
      if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
    };
    // 跨 chunk 行缓冲：就绪行（含一次性 token URL）若被管道分块截断，按块
    // split 会两半都匹配失败 → token 永久丢失（HTTP 探测超时后 401 白屏）。
    // 只处理完整行，尾段不完整行滚入下一块。
    let lineBuf = '';
    const onData = (chunk: Buffer) => {
      output.write(chunk);
      if (settled || handedOff) return;
      try { assertStartAllowed(opts.revision); } catch (err) { finish(err as Error, ''); return; }
      lineBuf += chunk.toString();
      const lines = lineBuf.split(/\r?\n/);
      lineBuf = lines.pop()!;
      for (const line of lines) {
        const m = line.match(/dsh web:\s+(https?:\/\/\S+)/);
        if (!m) continue;
        const blocked = restrictedPortOf(m[1]!);
        if (blocked && opts.unsafePortRetries > 0) {
          // 端口命中 Chromium 受限列表：结束该实例重启换端口（有上限）。
          handedOff = true;
          ctx.log('dsh', `端口 ${blocked} 属于 Chromium 受限端口（ERR_UNSAFE_PORT），重启服务换端口（剩余重试 ${opts.unsafePortRetries} 次）`);
          void (async () => {
            try {
              await stopOwnedProcess();
              assertStartAllowed(opts.revision);
              const url = await startServer(opts.unsafePortRetries - 1, opts.overlays, opts.revision);
              finish(null, url);
            } catch (err) { finish(err as Error, ''); }
          })();
          return;
        }
        // 稳定端口：若 dsh 最终监听端口与请求的不同（极端兜底），以实际为准并保存。
        try {
          const actual = Number(new URL(m[1]!).port) || 0;
          if (actual > 0 && actual !== opts.expectedPort) {
            const settings = ctx.loadSettings();
            settings.webPort = actual;
            ctx.saveSettings(settings);
          }
        } catch { /* URL 解析失败时忽略 */ }
        // 0.1.2：就绪行带一次性 token。记录给 HTTP 探测胜出路径兜底用
        //（finish 与探测是竞争关系，谁先到都会带上有 token 的 URL）。
        probeFallbackUrl = m[1]!;
        finish(null, m[1]!);
      }
    };
    const onStderrData = (chunk: Buffer) => output.write(chunk);
    proc.stdout!.on('data', onData);
    proc.stderr!.on('data', onStderrData);
    proc.once('error', (err) => finish(err, ''));
    // close 在 exit 之后、stdio 全部关闭后触发：此时再结束文件流，既保留尾部
    // 输出，也不会让迟到的 data 写入已 end 的 Writable。
    proc.once('close', () => {
      proc.stdout!.removeListener('data', onData);
      proc.stderr!.removeListener('data', onStderrData);
      output.end();
    });
    // HTTP 就绪探测与 stdout 就绪行并行竞争 —— 就绪行被管道缓冲吞掉或格式
    // 变化时不再白白等满 bootTimer（「启动 60 秒超时」的主要假阳性来源）。
    // 内核 0.1.2 起 Web UI 首屏带一次性 token 鉴权：裸 `/` 在服务就绪后返回
    // 401，只证明端口活着、不证明可用。探测改打免鉴权的静态资源
    // favicon.svg。探测胜出时【不再立即返回】：token 只存在于 stdout 就绪行
    //（探测时行通常还没打印），再等一小窗口拿带 token 的 URL；窗口内没等到
    // 就绪行才回退裸 origin（rc.2 语义，兼容无鉴权老内核）。
    if (restrictedPortOf(`http://127.0.0.1:${opts.expectedPort}`) === 0) {
      const probeUrl = `http://127.0.0.1:${opts.expectedPort}`;
      void (async () => {
        while (!settled) {
          try { assertStartAllowed(opts.revision); } catch (err) { finish(err as Error, ''); return; }
          const ok = await new Promise<boolean>((res) => {
            const req = http.get(probeUrl + '/favicon.svg', { timeout: 2500 }, (r) => {
              r.resume();
              res(!!r.statusCode && r.statusCode < 500);
            });
            req.on('error', () => res(false));
            req.on('timeout', () => { req.destroy(); res(false); });
          }).catch(() => false);
          if (settled) return;
          try { assertStartAllowed(opts.revision); } catch (err) { finish(err as Error, ''); return; }
          if (!ok) {
            await new Promise((r) => setTimeout(r, 350));
            continue;
          }
          // 探测就绪：给 stdout 就绪行（带 token）最多 30 秒补到窗口。就绪行
          // 通常随端口就绪毫秒级到达；曾只等 5 秒，慢盘/杀毒软件拖慢 stdout
          // 管道时窗口内拿不到 token，回退裸 origin 就是 401 白屏且无从诊断。
          for (let i = 0; i < 300 && !settled && !probeFallbackUrl; i += 1) {
            try { assertStartAllowed(opts.revision); } catch (err) { finish(err as Error, ''); return; }
            await new Promise((r) => setTimeout(r, 100));
          }
          if (!settled) {
            if (!probeFallbackUrl) {
              ctx.log('dsh', 'HTTP 探测就绪但 30 秒内未收到带 token 的就绪行，回退裸 origin（0.1.2 内核下将 401，需查 dsh-web.log 的就绪行）');
            }
            finish(null, probeFallbackUrl || probeUrl);
          }
          return;
        }
      })();
    }
    proc.once('exit', (code, signal) => {
      ctx.log('dsh', `进程退出 code=${code} signal=${signal}`);
      // 原地重启（插件市场）或已替换为新进程时，不打扰用户、也不清新句柄。
      const intentional = restartingServer || serverProc !== proc || unconfirmedProc === proc;
      if (serverProc === proc && unconfirmedProc !== proc) serverProc = null;
      if (!handedOff) {
        finish(new Error(`dsh web 启动失败（退出码 ${code}）。日志: ${dshWebLogPath()}`), '');
      }
      if (!ctx.isQuitting() && !intentional && !handedOff && webUrl) {
        ctx.onServerDied?.({ code, signal, logPath: dshWebLogPath() });
      }
    });
    // 兜底：就绪行与 HTTP 探测都未按时落地时超时。首次引导（pnpm 装依赖）
    // 放宽到 180 秒，稳态 60 秒。
    const bootTimeoutMs = opts.firstBoot ? 180000 : 60000;
    bootTimer = setTimeout(
      () => finish(new Error(`等待 dsh web 启动超时（${Math.round(bootTimeoutMs / 1000)} 秒）`), ''),
      bootTimeoutMs,
    );
    bootTimer.unref();
  });
}

function waitUntilUp(url: string, timeoutMs = 120000, revision = lifecycleRevision): Promise<string> {
  const started = Date.now();
  const probeTarget = new URL('favicon.svg', url).href;
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    let request: http.ClientRequest | null = null;
    const finish = (err?: Error): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      request?.destroy();
      if (err) reject(err); else resolve(url);
    };
    const allowed = (): boolean => {
      try { assertStartAllowed(revision); return true; } catch (err) { finish(err as Error); return false; }
    };
    const tick = (): void => {
      if (settled || !allowed()) return;
      let retried = false;
      const retry = (): void => {
        if (settled || retried || !allowed()) return;
        retried = true;
        req.destroy();
        if (Date.now() - started >= timeoutMs) finish(new Error('Web UI 未在预期时间内就绪'));
        else timer = setTimeout(tick, 300);
      };
      const req = http.get(probeTarget, { timeout: 3000 }, (res) => {
        res.resume();
        if (settled || retried || !allowed()) return;
        if (res.statusCode && res.statusCode < 500) finish(); else retry();
      });
      request = req;
      req.on('error', retry);
      req.on('timeout', retry);
    };
    tick();
  });
}

/** 同一实例只允许一次启动；退出/停止使正在等待的启动失效。 */
export async function startAndWait(overlays: string[] = [], timeoutMs = 300000): Promise<{ webUrl: string; port: number }> {
  if (starting || pendingStop) throw new Error('service-busy');
  starting = true;
  const revision = lifecycleRevision;
  const timeoutError = new Error('service-start-timeout');
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { lifecycleRevision += 1; reject(timeoutError); }, timeoutMs);
  });
  try {
    const url = await Promise.race([deadline, startServer(4, overlays, revision).then((u) => waitUntilUp(u, 120000, revision))]);
    assertStartAllowed(revision);
    webUrl = url;
    let port = 0;
    try { port = Number(new URL(url).port) || 0; } catch { /* 保持 0 */ }
    return { webUrl: url, port };
  } catch (err) {
    if (err === timeoutError) {
      // 超时取消就绪等待后，仍需持有启动锁直到自有进程树退出。
      try { await stopOwnedProcess(); } catch (stopError) {
        throw new Error('service-start-timeout: service-stop-unconfirmed', { cause: stopError });
      }
    }
    throw err;
  } finally { if (timer) clearTimeout(timer); starting = false; }
}

function stopOwnedProcess(): Promise<void> {
  if (pendingStop) return pendingStop;
  const proc = serverProc;
  if (!proc) return Promise.resolve();
  unconfirmedProc = proc;
  pendingStop = (async () => {
    try {
      if (!await killTreeAndWait(proc)) throw new Error('service-stop-unconfirmed');
      if (serverProc === proc) serverProc = null;
      if (unconfirmedProc === proc) unconfirmedProc = null;
    } finally { pendingStop = null; }
  })();
  return pendingStop;
}

/** 有界回收；未确认退出时保留进程身份并拒绝后续启动。 */
export function stopServer(): Promise<void> {
  lifecycleRevision += 1;
  return stopOwnedProcess();
}

/** 重启前与退出路径共用严格停止语义，不再超时后放行。 */
export function killAndWaitForRestart(): Promise<void> { return stopServer(); }

export function state(): { running: boolean; webUrl: string } {
  // guard 等写操作以 running 作围栏；树级停止未确认时，root exit 不能放行。
  return { running: !!(serverProc && (serverProc.exitCode === null || unconfirmedProc === serverProc)), webUrl };
}
