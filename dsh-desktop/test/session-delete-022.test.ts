import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// 0.2.2 内核的删除链路：Host API 面拆到 dsh-api-* 之后，客户端命令语义与
// 会话菜单的形状都与 0.2.1 不同，单独守住这两处结构耦合。
const kernelVersion: string = JSON.parse(readFileSync(new URL('../node_modules/@deepseek-ai/dsh-workspace/package.json', import.meta.url), 'utf8')).version;
const source = (file: string) => readFileSync(new URL('../node_modules/@deepseek-ai/' + file, import.meta.url), 'utf8');
const skip = kernelVersion !== '0.2.2-rc.1' ? '需要 0.2.2-rc.1 内核' : false;

test('0.2.2 client command forwards the id and preserves host rejections', { skip }, async () => {
  let definition: any;
  runInNewContext(source('dsh-api-workspace-controller/lib/client.js'), { window: { __ModuleLoader__: { load(value: any) { definition = value; } } } });
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
  await assert.rejects(command.deleteSession('s'), (error: any) => error.rpcError.code === 'workspace/session-active' && error.message === 'still running');
});

/** 从 bundle 里切出一段源码：起点到下一个给定终止符（含）。 */
function slice(sourceText: string, start: number, terminator: string): string {
  const end = sourceText.indexOf(terminator, start);
  assert.ok(end > start, '删除补丁片段缺失：' + terminator);
  return sourceText.slice(start, end + terminator.length);
}

test('0.2.2 delete action asks for confirmation and reports the host rejection', { skip }, async () => {
  const ui = source('dsh-client-ui-workspace/lib/client.js');
  const start = ui.indexOf('const deleteInjected = () => ({');
  const body = slice(ui, start, '\n\t\t\t});');
  const calls: string[] = [];
  const window: any = { confirm() { calls.push('confirm'); return false; }, alert(message: string) { calls.push(message); } };
  const ctx = { locale: { bind: () => (key: string) => key } };
  const uiWorkspace = { async deleteSession(id: string) { calls.push('delete:' + id); throw new Error('busy'); } };
  const deleteInjected = new Function('ctx', 'window', 'uiWorkspace', body + '\nreturn deleteInjected;')(ctx, window, uiWorkspace) as () => { deleteSession: (id: string) => void };
  deleteInjected().deleteSession('s');
  assert.deepEqual(calls, ['confirm']);
  calls.length = 0;
  window.confirm = () => { calls.push('confirm'); return true; };
  deleteInjected().deleteSession('s');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, ['confirm', 'delete:s', 'error.deleteSession busy']);
});

test('0.2.2 delete menu only appears when access allows it and forwards the session id', { skip }, () => {
  const ui = source('dsh-client-ui-workspace/lib/client.js');
  const start = ui.indexOf('register("delete", 700,');
  const body = slice(ui, start, '\n\t\t\t});');
  const run = (allowedValue: boolean) => {
    let resolve: ((target: unknown) => unknown) | undefined;
    const register = (_id: string, _order: number, _endpoints: string[], resolver: (target: unknown) => unknown) => { resolve = resolver; };
    const runCalls: string[] = [];
    const actions = { deleteSession: (id: string) => runCalls.push('delete:' + id) };
    new Function('register', 'allowed', 't', 'actions', body)(register, () => allowedValue, (key: string) => key, actions);
    const items = resolve!({ sessionId: 's' }) as any[];
    for (const item of items) item.run();
    return { items, runCalls };
  };
  assert.deepEqual(run(false).items, []);
  const allowed = run(true);
  assert.equal(allowed.items.length, 1);
  assert.equal(allowed.items[0].id, 'delete');
  assert.equal(allowed.items[0].label, 'menu.deleteSession');
  assert.deepEqual(allowed.runCalls, ['delete:s']);
});
