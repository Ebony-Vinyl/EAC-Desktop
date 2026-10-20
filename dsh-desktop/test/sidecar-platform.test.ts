import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface RpcResponse {
  id?: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

test('sidecar exposes platform identity and minimal mounted modules over shell.info', { timeout: 15000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-sidecar-platform-'));
  const child = spawn(process.execPath, ['../tauri-shell/sidecar/server.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: {
      ...process.env,
      DSH_HOME: join(root, 'dsh-home'),
      HOME: join(root, 'home'),
      USERPROFILE: join(root, 'home'),
      APPDATA: join(root, 'appdata'),
      LOCALAPPDATA: join(root, 'localappdata'),
      XDG_CONFIG_HOME: join(root, 'xdg'),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map<number, {resolve(value: RpcResponse): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>}>();
  let stderr = '';
  child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-8000); });
  lines.on('line', (line) => {
    const message = JSON.parse(line) as RpcResponse;
    if (typeof message.id === 'number') {
      const request = pending.get(message.id);
      if (request) { clearTimeout(request.timer); pending.delete(message.id); request.resolve(message); }
    }
  });
  child.on('exit', code => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('sidecar exited before reply: ' + code + '\n' + stderr)); }
    pending.clear();
  });
  let id = 0;
  // v6 Task 3.3 修复：支持带参调用（guard.action 等需要 params）。
  const call = (method: string, params: Record<string, unknown> = {}): Promise<RpcResponse> => new Promise((resolve, reject) => {
    id += 1;
    const requestId = id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('RPC timeout: ' + method + '\n' + stderr)); }, 5000);
    pending.set(id, {resolve, reject, timer});
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });

  try {
    const info = (await call('shell.info')).result || {};
    assert.equal(info.platform, process.platform);
    assert.equal(info.sidecar, 'server.ts');
    // v6 Task 3.3：接回三件套后，最小闭包扩充。改为「必需模块必须在」
    // 的双向断言，保留漏装配防呆但不再锁死快照。
    for (const mod of [
      'proc', 'platform', 'runtime-paths', 'profile',
      'guard-box', 'runtime-patches', 'companion-sync', 'plugin-ops', 'boot-server',
    ]) {
      assert.ok((info.modules as string[]).includes(mod), `modules 缺少 ${mod}`);
    }
    // 退役能力面仍不得注册（rc/rescue 属 Task 3.5）。
    for (const method of ['rc.action', 'rescue.state']) {
      const response = await call(method);
      assert.equal(response.error?.code, -32601, `${method} must be absent, not stubbed`);
      assert.match(response.error?.message || '', new RegExp(`method not found: ${method.replace('.', '\\.')}`));
    }
    // guard.* 已随 Task 3.3 接回：必须应答而非返回 method not found。
    const guardRes = await call('guard.ensure');
    assert.equal(guardRes.error, undefined, 'guard.ensure 应已注册（Task 3.3 接回 guard-box）');

    // ---- v6 Task 3.3 修复：插件保护中心 UI（dsh-plugin-shield）的动作面 ----
    // 背景：bridge.guard.action(action, value) 只传两个位置参数，服务端必须
    // 读 p.value。此前读 p.label / p.id 导致 snapshot 丢参、restore 失效；
    // 且 check / repair / incident / resolve-incident 四个动作缺失。
    // 这条断言按「UI 实际会调的动作集合」逐个验证，防止再次漏接。
    for (const action of ['status', 'snapshot', 'restore', 'check', 'repair', 'incident', 'resolve-incident']) {
      const r = await call('guard.action', { action, value: undefined });
      assert.notEqual(
        r.result?.error, 'unknown action',
        `guard.action 必须支持 UI 动作 '${action}'（插件保护中心点了没反应即此处漏接）`,
      );
    }
    // 参数名契约锁：snapshot 的入参名必须是 value（UI 传的是位置参数 value）。
    // plugin-guard 的 snapshot() 在 profile 目录不存在时返回 null，故先建目录
    // 让快照可成立，再用 reason 回显值证明读的是 value 而不是 label。
    const profileDir = join(root, 'dsh-home', 'profiles', 'web-desktop');
    mkdirSync(profileDir, { recursive: true });
    const snap = await call('guard.action', { action: 'snapshot', value: 'contract-probe' });
    assert.equal(snap.result?.ok, true, 'snapshot 应接受 value 参数并成功建快照');
    assert.equal(
      (snap.result?.snapshot as Record<string, unknown> | undefined)?.reason,
      'contract-probe',
      'snapshot 必须读 p.value 作为 reason（读 p.label 会退回默认 manual）',
    );
    // status 必须带 lastGood（UI 用它渲染「回退最后良好快照」按钮）。
    const statusRes = await call('guard.action', { action: 'status' });
    assert.ok('lastGood' in (statusRes.result || {}), 'guard.action status 必须返回 lastGood 字段');

    // ---- v6 Task 3.3 修复：boot.state 必须暴露 staticPort ----
    // dsh-client-file-changes 经 bridge.getInfo()（→ boot.state）读 staticPort
    // 拼静态预览 URL；字段缺失会让契约不完整（届时恒 0，客户端按契约回退宿主路由）。
    const bootState = await call('boot.state');
    assert.ok('staticPort' in (bootState.result || {}), 'boot.state 必须包含 staticPort 字段');

    const exited = new Promise<void>((resolve, reject) => {
      child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`sidecar exited ${String(code)}`)));
    });
    assert.deepEqual((await call('shutdown')).result, { bye: true });
    await exited;
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    lines.close();
    rmSync(root, { recursive: true, force: true });
  }
});
