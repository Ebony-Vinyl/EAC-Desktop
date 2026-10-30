import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { Context } from '@deepseek-ai/cordis';

const fileChanges = await import('../assets/plugins/dsh-file-changes/lib/index.js');
const market = await import('../assets/plugins/dsh-unified-market/lib/host.js');
const skins = await import('../assets/plugins/dsh-client-ui-skin-deep-whale-manager/lib/index.js');

for (const plugin of [fileChanges, market]) {
  test(`${plugin.name}: restart and failed activation release HTTP routes`, async (t) => {
    const home = mkdtempSync(join(tmpdir(), 'eac-route-lifecycle-'));
    const savedHome = process.env.DSH_HOME;
    process.env.DSH_HOME = home;
    t.after(() => {
      if (savedHome === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = savedHome;
      rmSync(home, { recursive: true, force: true });
    });
    const ctx = new Context();
    const routes = new Set<string>();
    let collision = false;
    ctx.reflect.provide('webServer', { register(route: { path: string }) {
      if (routes.has(route.path) || collision && routes.size === 1) throw new Error('route collision');
      routes.add(route.path);
      return () => routes.delete(route.path);
    } });
    ctx.reflect.provide('sessionProjections', { register() {} });
    try {
      for (let i = 0; i < 2; i++) {
        const fiber = ctx.plugin(plugin);
        await fiber;
        assert.ok(routes.size >= 2);
        await fiber.dispose();
        assert.equal(routes.size, 0, 'a stopped plugin must release every route');
      }
      collision = true;
      const failed = ctx.plugin(plugin);
      await assert.rejects(failed.await(), /route collision/);
      await failed.dispose();
      assert.equal(routes.size, 0, 'partially registered routes must also roll back');
      collision = false;
      const retry = ctx.plugin(plugin);
      await retry;
      assert.ok(routes.size >= 2);
    } finally { await ctx.fiber.dispose(); }
  });
}

test('skin switch waits for activation and returns activation failures to the caller', async () => {
  let complete!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const activation = new Promise<void>((resolve) => { complete = resolve; });
  let fail = false;
  const route = skins.makeSkinManagerRoute(() => [], async () => {
    entered();
    await activation;
    if (fail) throw new Error('activation failed');
  });
  const server = createServer(route.handler);
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/dsh/skins`;
  try {
    let responded = false;
    const response = fetch(url, { method: 'POST', body: JSON.stringify({ target: 'official' }) })
      .then((res) => { responded = true; return res; });
    await started;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(responded, false, 'disk writes alone must not acknowledge activation');
    complete();
    assert.equal((await response).status, 200);
    fail = true;
    const failed = await fetch(url, { method: 'POST', body: JSON.stringify({ target: 'official' }) });
    assert.equal(failed.status, 400);
    assert.equal((await failed.json() as { error: string }).error, 'activation failed');
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
