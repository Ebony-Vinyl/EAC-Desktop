import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, unlinkSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { copyPluginPackage } from '../lib/desktop/companion-sync.js';

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

for (const dir of ['dsh-boot-animation', 'dsh-wechat', 'ds-harness-remote', 'dsh-external-links']) {
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
  });
}
