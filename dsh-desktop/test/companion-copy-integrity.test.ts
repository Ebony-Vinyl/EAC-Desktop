import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyPluginPackage } from '../lib/desktop/companion-sync.js';

const root = join(import.meta.dirname, '..', '..');

test('copyPluginPackage repairs a missing file even when the source stamp remains', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-plugin-copy-'));
  try {
    const src = join(dir, 'source');
    const profile = join(dir, 'profile');
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
    rmSync(dir, { recursive: true, force: true });
  }
});

// 拷贝清单（TOP_FILES/TOP_DIRS）是白名单：源包里没被列进去的顶层成员不会进
// profile。插件能装上却 ERR_MODULE_NOT_FOUND，就是漏列的直接后果 ——
// dsh-our-free-model 的 index.js 静态 import './adapter/kernel.js'，而 adapter/
// 与 locale/ 曾不在清单里，随包插件在用户机器上直接加载失败。
// 这里对每个随包内置插件，把随包 JS 里的相对 import 全解析一遍，要求拷进
// profile 的那份包能解析出同样的目标。开发用文件（AUDIT.md / scripts/ /
// tests/）不在断言面内 —— 它们不参与运行期模块解析。
test('every bundled builtin plugin copies the modules its shipped code imports', async () => {
  const staged = readFileSync(join(root, 'tauri-shell', 'stage-resources.mjs'), 'utf8');
  const match = /const BUILTIN_PLUGIN_DIRS = \[([\s\S]*?)\];/.exec(staged);
  assert.ok(match, 'BUILTIN_PLUGIN_DIRS 清单必须存在');
  const dirs = [...match![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(dirs.length > 0, '装配面必须至少随包一个内置插件');

  // 插件对外入口：host 半 index.js、浏览器半 client.js，以及 package.json 声明的 main。
  const ENTRY_NAMES = ['index.js', 'client.js'];

  const resolveIn = (base: string, spec: string): boolean => {
    const target = join(base, spec);
    return existsSync(target)
      || existsSync(`${target}.js`)
      || existsSync(`${target}.mjs`)
      || existsSync(join(target, 'index.js'));
  };

  const work = mkdtempSync(join(tmpdir(), 'dsh-plugin-copy-all-'));
  try {
    for (const dir of dirs) {
      const src = join(root, 'dsh-desktop', 'assets', 'plugins', dir);
      assert.equal(existsSync(join(src, 'package.json')), true, `随包插件实物缺失: ${dir}`);
      const profile = join(work, dir);
      mkdirSync(profile, { recursive: true });
      copyPluginPackage(profile, src, dir);
      const dest = join(profile, 'node_modules', dir);

      const broken: string[] = [];
      for (const entry of ENTRY_NAMES) {
        const file = join(src, entry);
        if (!existsSync(file)) continue;
        const code = readFileSync(file, 'utf8');
        for (const m of code.matchAll(/(?:from|import)\s*'(\.[^']+)'/g)) {
          const spec = m[1]!;
          if (!resolveIn(src, spec)) continue; // 源包本身就解析不到：不是拷贝的问题
          if (!resolveIn(dest, spec)) broken.push(`${entry} -> ${spec}`);
        }
      }
      assert.deepEqual(broken, [],
        `${dir}：入口 import 的相对模块未被 copyPluginPackage 拷贝（TOP_FILES/TOP_DIRS 漏列）：${broken.join(', ')}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
