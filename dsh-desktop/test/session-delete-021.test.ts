import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import * as io from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { WorkspaceRegistry, WorkspaceActiveSessionError, WorkspaceUnknownSessionError } from '@deepseek-ai/dsh-workspace';
import { AgentLoop } from '@deepseek-ai/dsh-agent-loop';
import { WorkspaceController as HostController } from '@deepseek-ai/dsh-api-workspace-controller';

const require = createRequire(import.meta.url);
const { patchSession021Sources } = require('../scripts/patch-session-manage-021.js');
const root = new URL('../node_modules/@deepseek-ai/', import.meta.url);
const files = {
  loop: 'dsh-agent-loop/lib/index.js', storage: 'dsh-session-persistence-jsonl/lib/index.js',
  workspace: 'dsh-workspace/lib/index.js', host: 'dsh-api-workspace-controller/lib/index.js',
  codecs: 'dsh-api-workspace-controller/lib/typert.host.js', client: 'dsh-api-workspace-controller/lib/client.js',
  remotes: 'dsh-api-remotes/lib/client.js', ui: 'dsh-client-ui-workspace/lib/client.js',
};
const source = (file: string) => readFileSync(new URL(file, root), 'utf8');

// 从官方缓存读取原始 MIT 产物；tar 仅用于测试夹具读取，不依赖系统 tar 或新增包。
function original(file: string): string {
  const [name, ...parts] = file.split('/');
  const archive = gunzipSync(readFileSync(new URL(`../vendor/kernel/0.2.1-rc.2/deepseek-ai-${name}-0.2.1-rc.2.tgz`, import.meta.url)));
  const target = 'package/' + parts.join('/');
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString().replace(/\0.*$/s, '');
    const size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/s, '').trim(), 8) || 0;
    if (name === target) return archive.subarray(offset + 512, offset + 512 + size).toString();
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error('missing official fixture ' + target);
}

test('0.2.1 delete transforms all real official targets atomically and is idempotent', {
  skip: !existsSync(new URL('../vendor/kernel/0.2.1-rc.2/deepseek-ai-dsh-workspace-0.2.1-rc.2.tgz', import.meta.url)),
}, () => {
  const input = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, original(file)]));
  const patched = patchSession021Sources(input);
  assert.deepEqual(patchSession021Sources(patched), patched);
  for (const [key, file] of Object.entries(files)) assert.equal(patched[key], source(file), key);
  const drift = { ...input, ui: input.ui.replace('function ArchiveSessionMenuItem(', 'function ChangedMenuItem(') };
  assert.throws(() => patchSession021Sources(drift), /anchor changed/);
  assert.equal(input.workspace, original(files.workspace), 'preflight must not change input');
});

function registryHarness(options: { live?: boolean; archived?: boolean; fault?: string; activeAt?: number; absent?: boolean } = {}) {
  const trace: string[] = [];
  let live: any = options.live === false ? undefined : { id: 's' };
  let checks = 0;
  const registry: any = Object.create(WorkspaceRegistry.prototype);
  const loop: any = Object.create(AgentLoop.prototype);
  loop.__eacSessionDisposers = new Map([['s', async () => {
    trace.push('dispose');
    await Promise.resolve();
    if (options.fault === 'close') throw new Error('drain failed');
    live = undefined;
    trace.push('closed');
    loop.__eacSessionDisposers.delete('s');
  }]]);
  Object.assign(registry, {
    operationTail: Promise.resolve(),
    state: { archivedSessionIds: options.archived ? ['s'] : [], pinnedSessionIds: ['s', 'other'] },
    headers: new Map([['s', {}]]), sessionPaths: new Map([['s', 'cwd']]),
    missingSessionPaths: new Set(), invalidSessionPaths: new Map(),
    entities: new Map([['ws', { async detachSession(id: string) { trace.push('detach:' + id); } }]]),
    async recoverPendingMutation() {},
    async setState(state: any) { trace.push('state'); this.state = state; },
    ctx: {
      get(name: string) {
        if (name === 'agentLoop') return loop;
        if (name === 'sessions') return {
          get: () => live,
          async flush() { trace.push('flush'); if (options.fault === 'flush') throw new Error('flush failed'); },
        };
      },
      sessionPersistence: {
        async stat() { if (options.fault === 'stat') throw new Error('stat failed'); return options.absent ? undefined : { header: { id: 's' } }; },
        async deleteSession() {
          trace.push('delete');
          assert.equal(live, undefined, 'no file can be deleted before live ownership is released');
          if (options.fault === 'delete') throw new Error('disk failed');
          return true;
        },
      },
      async waterfall() { trace.push('activity'); return ++checks === options.activeAt ? [{ kind: 'owned-job' }] : []; },
      emit(event: string, id: string) { trace.push(event + ':' + id); },
    },
  });
  return { registry, trace, before: structuredClone(registry.state) };
}

test('live delete waits for flush and lifecycle close, then removes pins, archive and row caches', async () => {
  const h = registryHarness();
  assert.deepEqual(await h.registry.deleteSession('s'), { deleted: true });
  assert.deepEqual(h.trace, ['activity', 'state', 'flush', 'activity', 'dispose', 'closed', 'delete', 'detach:s', 'state', 'api-session/removed:s']);
  assert.deepEqual(h.registry.state, { archivedSessionIds: [], pinnedSessionIds: ['other'] });
  assert.equal(h.registry.headers.has('s'), false);
});

test('cold archived sessions use the same delete path without a live lifecycle', async () => {
  const h = registryHarness({ live: false, archived: true });
  await h.registry.deleteSession('s');
  assert.ok(!h.trace.includes('dispose'));
  assert.ok(h.trace.includes('api-session/removed:s'));
});

test('activity is refused even for archived sessions; an admission race restores prior pin/archive state', async () => {
  for (const activeAt of [1, 2]) {
    const h = registryHarness({ activeAt, archived: true });
    await assert.rejects(h.registry.deleteSession('s'), WorkspaceActiveSessionError);
    assert.ok(!h.trace.includes('delete'));
    assert.deepEqual(h.registry.state, h.before);
  }
});

test('flush, close and storage read failures do not delete data or discard user pin/archive choices', async () => {
  for (const fault of ['flush', 'close', 'stat']) {
    const h = registryHarness({ fault });
    await assert.rejects(h.registry.deleteSession('s'), /failed/);
    assert.ok(!h.trace.includes('delete'));
    assert.deepEqual(h.registry.state, h.before);
  }
});

test('a disk deletion failure reports failure and keeps the durable archive gate for retry', async () => {
  const h = registryHarness({ fault: 'delete' });
  await assert.rejects(h.registry.deleteSession('s'), /disk failed/);
  assert.deepEqual(h.registry.state.archivedSessionIds, ['s']);
  assert.ok(!h.trace.includes('api-session/removed:s'));
  assert.equal(h.registry.headers.has('s'), true);
});

test('unknown ids fail; archived remnants can be cleaned by an explicit retry', async () => {
  const unknown = registryHarness({ live: false, absent: true });
  await assert.rejects(unknown.registry.deleteSession('s'), WorkspaceUnknownSessionError);
  assert.deepEqual(unknown.trace, []);
  const retry = registryHarness({ live: false, absent: true, archived: true });
  assert.deepEqual(await retry.registry.deleteSession('s'), { deleted: true });
});

test('host maps activity and missing-session failures to native Remote errors', async () => {
  for (const [error, code] of [[new WorkspaceUnknownSessionError('s', 'delete'), 'session/not-found'], [new WorkspaceActiveSessionError('s', []), 'workspace/session-active']] as const) {
    await assert.rejects(HostController.prototype.deleteSession.call({ ctx: { workspaceRegistry: { async deleteSession() { throw error; } } } }, { sessionId: 's' }), (failure: any) => failure.code === code);
  }
});

test('JSONL deletion stays inside the configured root and preserves the stable write lock and siblings', async t => {
  const temp = mkdtempSync(join(tmpdir(), 'eac-delete-中文-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const dir = join(temp, 'workspace', 's');
  const sibling = join(temp, 'workspace', 'other');
  mkdirSync(dir, { recursive: true }); mkdirSync(sibling);
  writeFileSync(join(dir, 'session.lock'), 'lock');
  writeFileSync(join(dir, 'v4.jsonl.zst'), 'history');
  writeFileSync(join(dir, 'v3.jsonl'), 'old generation');
  writeFileSync(join(sibling, 'v4.jsonl'), 'other history');
  const storage = source(files.storage);
  const start = storage.indexOf('  async deleteSession(id) {');
  const end = storage.indexOf('\n  }', start) + '\n  }'.length;
  const method = new Function('dirname', 'relative', 'realpath', 'lstat', 'isAbsolute', 'pathSep', 'readdir', 'rm', 'join', 'LEASE_FILENAME',
    `return ({${storage.slice(start, end)}}).deleteSession;`)(dirname, relative, io.realpath, io.lstat, isAbsolute, sep, io.readdir, io.rm, join, 'session.lock');
  let claimed = false;
  let released = false;
  const backend: any = {
    root: temp, coldLogMemo: new Map([['s', 'cached']]),
    tracker: { claimWrite() { assert.equal(claimed, false); claimed = true; }, releaseClaim() { claimed = false; } },
    async findLog() { return { currentPath: join(dir, 'v4.jsonl.zst') }; },
    async acquireLease() { assert.equal(claimed, true); return { async release() { released = true; } }; },
  };
  assert.equal(await method.call(backend, 's'), true);
  assert.deepEqual(await io.readdir(dir), ['session.lock']);
  assert.equal(readFileSync(join(sibling, 'v4.jsonl'), 'utf8'), 'other history');
  assert.equal(backend.coldLogMemo.has('s'), false);
  assert.equal(released, true); assert.equal(claimed, false);
  writeFileSync(join(dir, 'v4.jsonl.zst'), 'locked history');
  backend.acquireLease = async () => { throw new Error('already owned'); };
  await assert.rejects(method.call(backend, 's'), /already owned/);
  assert.equal(readFileSync(join(dir, 'v4.jsonl.zst'), 'utf8'), 'locked history');
  assert.equal(claimed, false);
  backend.findLog = async () => ({ currentPath: join(temp, '..', 'outside', 'v4.jsonl') });
  await assert.rejects(method.call(backend, 's'));
  assert.equal(claimed, false);
});

test('client command forwards the id and preserves host rejections', async () => {
  let definition: any;
  runInNewContext(source(files.client), { window: { __ModuleLoader__: { load(value: any) { definition = value; } } } });
  const client = definition.factory((name: string) => {
    if (name === '@deepseek-ai/cordis') return { Service: class {} };
    if (name === '@deepseek-ai/dsh-client-store') return {};
    if (name === '@deepseek-ai/dsh-api-gateway/client') return {};
    throw new Error('unexpected client dependency ' + name);
  });
  const calls: unknown[] = [];
  const model = new client.ClientWorkspaceModel({ async deleteSession(input: unknown) { calls.push(input); return { ok: true, value: { deleted: true } }; } });
  const command = new client.WorkspaceController({}, model);
  await command.deleteSession('s');
  assert.equal(JSON.stringify(calls), '[{"sessionId":"s"}]');
  model.remote.deleteSession = async () => ({ ok: false, error: { code: 'workspace/session-active', message: 'still running' } });
  await assert.rejects(command.deleteSession('s'), (error: any) => error.rpcError.code === 'workspace/session-active');
});

test('delete menu cancels without calling the host and preserves the external manager confirmation flow', async () => {
  const ui = source(files.ui);
  const start = ui.indexOf('    function DeleteSessionMenuItem(');
  const end = ui.indexOf('\n    }', start) + '\n    }'.length;
  let confirmed = false;
  const calls: string[] = [];
  const window: any = { confirm() { calls.push('confirm'); return confirmed; }, alert(message: string) { calls.push(message); } };
  const Item = runInNewContext('(' + ui.slice(start, end).trim() + ')', {
    window,
    react_jsx_runtime: { jsx: (_type: unknown, props: unknown) => props },
    _deepseek_ai_dsh_client_ui_primitives: { MenuItemButton: {} },
  });
  const button = Item({ sessionId: 's', useMenuOpenState: () => [true, () => calls.push('close')],
    workspaces: { async deleteSession(id: string) { calls.push('delete:' + id); throw new Error('busy'); } }, t: (key: string) => key });
  button.onSelect();
  assert.deepEqual(calls, ['close', 'confirm']);
  calls.length = 0;
  confirmed = true;
  button.onSelect();
  await Promise.resolve();
  assert.deepEqual(calls, ['close', 'confirm', 'delete:s', 'error.deleteSession busy']);
  calls.length = 0;
  window.__dshSessionManager = { deleteSession(id: string) { calls.push('manager:' + id); } };
  button.onSelect();
  assert.deepEqual(calls, ['close', 'manager:s']);
});
