import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
function harness() {
  const source = readFileSync(new URL('../../tauri-shell/sidecar/server.ts', import.meta.url), 'utf8');
  const gateStart = source.indexOf('// ---- lifecycle/profile mutation gate');
  const gateEnd = source.indexOf('async function gracefulExit()', gateStart);
  const lineStart = source.indexOf('async function handleLine(');
  const gate = gateStart < 0 ? '' : source.slice(gateStart, gateEnd);
  const code = stripTypeScriptTypes(gate + source.slice(lineStart), {mode: 'transform'});
  const replies: any[] = []; const calls: string[] = [];
  let finish!: () => void;
  const hold = new Promise<void>(resolve => {finish = resolve;});
  const methods: any = Object.fromEntries(['boot.start','boot.stop','boot.restart','plugins.set-enabled','plugins.set-removed','environment.remove','environment.repair','files.revert','shortcuts.edit','file-drop.save','guard.action'].map(name => [name, async (p: any) => {
    calls.push(name + ':' + (p?.action || ''));
    if (name === 'boot.start') await hold;
    if (p?.fail) throw Error('injected action failure');
    return {ok: true};
  }]));
  const context: any = {updateRestart: null, methods, respond: (m: any) => replies.push(m), quitting: false, rl: {close() {}}, Date, setTimeout, clearTimeout};
  runInNewContext(code + '\nthis.run = handleLine;', context);
  let id = 0;
  return {replies,calls,finish,quit: () => {context.quitting = true;}, run: (method: string, params: any = {}) => context.run(JSON.stringify({jsonrpc:'2.0',id: ++id,method,params}))};
}

test('sidecar rejects all profile/lifecycle writes while a boot mutation is pending', async () => {
  const h = harness(); const first = h.run('boot.start'); await Promise.resolve();
  for (const method of ['boot.stop','boot.restart','plugins.set-enabled','plugins.set-removed','environment.remove','environment.repair','files.revert','shortcuts.edit','file-drop.save']) await h.run(method);
  for (const action of ['restore','snapshot','repair','resolve-incident']) await h.run('guard.action',{action});
  assert.equal(h.replies.length,13); for (const reply of h.replies) assert.equal(reply.result.error,'service-busy');
  assert.equal(h.calls.length,1); h.finish(); await first;
});

test('ping and guard read-only methods remain available while a mutation is pending', async () => {
  const h = harness(); const first = h.run('boot.start'); await Promise.resolve();
  await h.run('ping'); for (const action of ['status','check','incident']) await h.run('guard.action',{action});
  assert.equal(h.replies[0].result.pong,true); assert.equal(h.replies.filter(r=>r.result.ok).length,3);
  h.finish(); await first;
});

test('mutation gate releases after failure and allows the next write', async () => {
  const h = harness(); await h.run('guard.action',{action:'repair',fail:true}); await h.run('guard.action',{action:'snapshot'});
  assert.equal(h.replies[0].error.code,-32000); assert.equal(h.replies[1].result.ok,true);
});

test('quitting rejects new writes without invoking their implementation', async () => {
  const h = harness(); h.quit(); await h.run('boot.restart'); await h.run('guard.action',{action:'restore'});
  assert.equal(h.calls.length,0); for (const reply of h.replies) assert.equal(reply.result.error,'app-exiting');
});
