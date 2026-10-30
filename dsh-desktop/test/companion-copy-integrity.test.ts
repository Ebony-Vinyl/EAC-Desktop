import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, unlinkSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { copyPluginPackage } from '../lib/desktop/companion-sync.js';

test('Remote gateway switch preserves the authenticated local Peer and stream context', async () => {
  const source = readFileSync(new URL('../assets/plugins/ds-harness-remote/packages/plugin/dist/index.js', import.meta.url), 'utf8');
  const start = source.indexOf('var TypertGatewaySwitch = class');
  const end = source.indexOf('function usesRc1Arity', start);
  assert.ok(start >= 0 && end > start);
  const GatewaySwitch = runInNewContext(source.slice(start, end) + '; TypertGatewaySwitch', {
    isLocalOnlyEndpoint: (endpoint: string) => endpoint.startsWith('dynamicCordisRunner/'),
    usesRc1Arity: (open: Function) => open.length >= 5,
    createLocalOpen: () => undefined,
    ALL_REMOTE_COMMANDS: { execute: true, list: true },
    AbortController,
  });
  const calls: unknown[][] = [];
  const gateway = {
    invoke: async () => undefined,
    dispatchRpc: async (...args: unknown[]) => {
      calls.push(args);
      const peer = args[3] as { signal: AbortSignal };
      peer.signal.throwIfAborted();
      return { ok: true };
    },
    openWireStream: function (endpoint: unknown, payload: unknown, uplink: unknown, peer: unknown, signal: unknown, control: unknown) {
      calls.push([endpoint, payload, uplink, peer, signal, control]);
    },
  };
  const instance = new GatewaySwitch(gateway);
  instance.install();
  const connection = new AbortController();
  const peer = { signal: connection.signal, principal: { kind: 'owner' } };
  const signal = new AbortController().signal;
  const payload = { args: {} };
  await gateway.dispatchRpc('cordis/inventory', payload, signal, peer);
  assert.deepEqual(calls.pop(), ['cordis/inventory', payload, signal, peer]);
  const uplink = {};
  const control = new AbortController();
  gateway.openWireStream('cordis/events', payload, uplink, peer, signal, control);
  assert.deepEqual(calls.pop(), ['cordis/events', payload, uplink, peer, signal, control]);
  instance.selectRemote({ invoke: async () => undefined, dispatch: () => { throw new Error('must remain local'); } });
  await gateway.dispatchRpc('dynamicCordisRunner/inventory', payload, signal, peer);
  assert.deepEqual(calls.pop(), ['dynamicCordisRunner/inventory', payload, signal, peer]);
  connection.abort(new Error('peer disconnected'));
  await assert.rejects(gateway.dispatchRpc('dynamicCordisRunner/inventory', payload, signal, peer), /peer disconnected/);
});

test('copyPluginPackage repairs a missing file even when the source stamp remains', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-plugin-copy-'));
  try {
    const src = join(root, 'source');
    const profile = join(root, 'profile');
    mkdirSync(join(src, 'lib'), { recursive: true });
    writeFileSync(join(src, 'package.json'), JSON.stringify({ name: 'example-plugin', version: '1.0.0' }));
    writeFileSync(join(src, 'lib', 'index.js'), 'module.exports = {}\n');

    copyPluginPackage(profile, src, 'example-plugin');
    const copied = join(profile, 'node_modules', 'example-plugin', 'lib', 'index.js');
    assert.equal(existsSync(copied), true);
    unlinkSync(copied);

    copyPluginPackage(profile, src, 'example-plugin');
    assert.equal(existsSync(copied), true, 'missing plugin files must be restored');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const dir of ['dsh-boot-animation', 'dsh-wechat', 'ds-harness-remote', 'dsh-external-links', 'dsh-our-free-model']) {
  test(`bundled ${dir} imports after copying into an isolated profile`, async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-plugin-copy-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const src = fileURLToPath(new URL(`../assets/plugins/${dir}/`, import.meta.url));
    const pkg = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8'));
    copyPluginPackage(root, src, pkg.name);
    // 内核包由宿主提供；插件自身的运行依赖必须随拷贝闭包抵达。
    symlinkSync(fileURLToPath(new URL('../node_modules/@deepseek-ai/', import.meta.url)), join(root, 'node_modules', '@deepseek-ai'), 'junction');
    const dest = join(root, 'node_modules', pkg.name);
    const mod = await import(pathToFileURL(join(dest, pkg.main)).href);
    assert.equal(typeof mod.apply, 'function');
    const client = pkg.exports['./client'];
    assert.ok(existsSync(join(dest, typeof client === 'string' ? client : client.default)));
    if (dir === 'dsh-our-free-model') {
      const pack = await import(pathToFileURL(join(dest, 'vendor/channel-pack/pack.js')).href);
      assert.equal(typeof pack.apply, 'function');
      for (const file of ['vendor/channel-pack/qoder-auth-wasm.wasm', 'vendor/channel-pack/LICENSE', 'vendor/channel-pack/NOTICE.md', 'locale/zh.json', 'icon.svg']) {
        assert.ok(existsSync(join(dest, file)), `OFM 运行资源缺失: ${file}`);
      }
    }
  });
}
