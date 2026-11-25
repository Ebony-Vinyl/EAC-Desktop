import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { copyPluginPackage } from '../lib/plugin-copy.js';

test('bundled Mojobox upgrades an isolated copy and mounts local routes without external dependencies', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'eac-mojobox-builtin-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = fileURLToPath(new URL('../assets/plugins/dsh-plugin-mojobox/', import.meta.url));
  const pkg = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
  const dest = join(root, 'node_modules', pkg.name);
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, 'package.json'), JSON.stringify({ name: pkg.name, version: '0.0.0' }));
  const patch = '- id: mojobox-manager\n  disabled: true\n';
  writeFileSync(join(root, 'cordis.patch.yml'), patch);

  copyPluginPackage(root, source, pkg.name);
  assert.equal(JSON.parse(readFileSync(join(dest, 'package.json'), 'utf8')).version, pkg.version);
  assert.equal(existsSync(join(dest, 'node_modules')), false);
  for (const file of ['lib/client.js', 'cordis.patch.yml', 'LICENSE', 'THIRD-PARTY-NOTICES.md']) {
    assert.ok(existsSync(join(dest, file)), `missing copied runtime file: ${file}`);
  }
  // No host package symlink or npm dependencies: this exercises the bundled CJS/ESM boundary.
  const plugin = await import(pathToFileURL(join(dest, pkg.main)).href);
  assert.equal(plugin.name, 'mojobox-manager');
  assert.deepEqual(plugin.inject, ['pluginManager', 'profileContext', 'connection']);
  assert.equal(typeof plugin.createHandler, 'function');

  type Route = { path: string; methods: string[]; fetch(request: Request): Promise<Response> };
  const routes: Route[] = [];
  const cleanups: Array<() => void> = [];
  t.after(() => { for (const cleanup of cleanups.reverse()) cleanup(); });
  const upstreamFetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected network request'); });
  const anchor = join(root, 'installation.json');
  writeFileSync(anchor, JSON.stringify({ version: '0.2.1-rc.2' }));
  await plugin.apply({
    pluginManager: {
      listBundles: async () => [],
      listPlugins: async () => [],
      installBundle: async () => assert.fail('status must not install plugins'),
    },
    profileContext: { dir: root, installAnchor: anchor },
    connection: { fetch: { register: (route: Route) => {
      routes.push(route);
      return () => { routes.splice(routes.indexOf(route), 1); };
    } } },
    effect: (effect: () => () => void) => { cleanups.push(effect()); },
    logger: { info() {} },
  });
  const status = routes.find((route) => route.path === '/api/mojobox/status');
  assert.ok(status);
  const response = await status.fetch(new Request('http://local/api/mojobox/status'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).hostVersion, '0.2.1-rc.2');
  assert.ok(routes.some((route) => route.path === '/api/mojobox/save-log'));
  assert.equal(upstreamFetch.mock.callCount(), 0);
  assert.equal(readFileSync(join(root, 'cordis.patch.yml'), 'utf8'), patch);
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  assert.equal(routes.length, 0);
});
