import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { seedFullProfile, adoptFullProfile, packOwnsPackage, packOwnsPatchEntry, bindFullHostClosure, repairHostClosure } = require('../lib/desktop/full-composition.js');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'full-eac-test-'));
  const assets = path.join(root, 'assets', 'full-pack');
  const seed = path.join(assets, 'profile-seed');
  fs.mkdirSync(path.join(seed, 'node_modules', 'example-pack'), { recursive: true });
  fs.writeFileSync(path.join(seed, 'node_modules', 'example-pack', 'package.json'),
    JSON.stringify({ name: 'example-pack', version: '1.0.0' }));
  fs.writeFileSync(path.join(seed, 'package.json'), JSON.stringify({ dependencies: { 'example-pack': '1.0.0' } }));
  fs.writeFileSync(path.join(assets, 'composition.json'), JSON.stringify({ schemaVersion: 1, profile: 'web-desktop', managedPackages: ['example-pack'] }));
  return { root, profile: path.join(root, 'home', 'profiles', 'web-desktop') };
}

test('full seed is atomic, idempotent, and ownership limited to managed packages', () => {
  const f = fixture();
  try {
    assert.equal(seedFullProfile(f.profile, f.root), true);
    assert.equal(packOwnsPackage(f.profile, 'example-pack', f.root), true);
    assert.equal(packOwnsPackage(f.profile, 'unmanaged', f.root), false);
    fs.writeFileSync(path.join(f.profile, 'user-config.txt'), 'keep');
    assert.equal(seedFullProfile(f.profile, f.root), false);
    assert.equal(fs.readFileSync(path.join(f.profile, 'user-config.txt'), 'utf8'), 'keep');
    fs.unlinkSync(path.join(f.profile, '.eac-full-ownership.json'));
    assert.equal(packOwnsPackage(f.profile, 'example-pack', f.root), false);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('renamed managed package protects a reused loader id without trusting an old package name', () => {
  const f = fixture();
  try {
    seedFullProfile(f.profile, f.root);
    const text = '- id: old-skin-id\n  name: example-pack\n  disabled: true\n';
    assert.equal(packOwnsPatchEntry(f.profile, 'old-skin-id', text, f.root), true);
    assert.equal(packOwnsPatchEntry(f.profile, 'other-id', text, f.root), false);
    assert.equal(packOwnsPatchEntry(f.profile, 'old-skin-id', text.replace('example-pack', 'legacy-pack'), f.root), false);
    fs.unlinkSync(path.join(f.profile, '.eac-full-ownership.json'));
    assert.equal(packOwnsPatchEntry(f.profile, 'old-skin-id', text, f.root), false);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('existing profile and uninitialized user data are never overwritten', () => {
  const f = fixture();
  try {
    fs.mkdirSync(f.profile, { recursive: true });
    fs.writeFileSync(path.join(f.profile, 'user-data'), 'keep');
    assert.throws(() => seedFullProfile(f.profile, f.root), /nonempty/);
    fs.writeFileSync(path.join(f.profile, 'package.json'), '{"private":true}');
    assert.equal(seedFullProfile(f.profile, f.root), false);
    assert.equal(fs.readFileSync(path.join(f.profile, 'user-data'), 'utf8'), 'keep');
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('host closure binding is idempotent and preserves existing packages', () => {
  const f = fixture();
  try {
    const source = path.join(f.root, 'node_modules', '@example', 'host');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'package.json'), '{"name":"@example/host"}');
    const home = path.join(f.root, 'home');
    bindFullHostClosure(home, f.root);
    const target = path.join(home, 'profiles', 'node_modules', '@example', 'host');
    assert.equal(fs.realpathSync(target), fs.realpathSync(source));
    bindFullHostClosure(home, f.root);
    assert.equal(fs.realpathSync(target), fs.realpathSync(source));
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('missing offline closure fails instead of falling back to installation', () => {
  const f = fixture();
  try {
    fs.rmSync(path.join(f.root, 'assets', 'full-pack', 'profile-seed', 'node_modules'), { recursive: true });
    assert.throws(() => seedFullProfile(f.profile, f.root), /incomplete/);
    assert.equal(fs.existsSync(f.profile), false);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

// --- issue #464：旧简配环境里的既有 profile 必须被增量补齐 ---

/** 复刻旧版最简本体（不带 full-pack）建出的隔离环境 profile。 */
function legacyProfile(profileDir: string) {
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web-desktop',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), '[]\n');
}

function readManifest(profileDir: string) {
  return JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'));
}

test('issue #464: an existing lite profile is adopted instead of silently staying empty', () => {
  const f = fixture();
  try {
    legacyProfile(f.profile);
    const before = readManifest(f.profile);
    assert.deepEqual(before.dependencies, {}, 'fixture starts with no pack packages');

    const report = adoptFullProfile(f.profile, f.root);
    assert.ok(report, 'adoption must run for an existing lite profile');
    assert.deepEqual(report.adopted, ['example-pack']);
    assert.equal(fs.existsSync(path.join(f.profile, 'node_modules', 'example-pack', 'package.json')), true);
    assert.equal(readManifest(f.profile).dependencies['example-pack'], '1.0.0');
    assert.ok(readManifest(f.profile).dsh.profile.bundles.includes('example-pack'), 'bundles gains the adopted package');
    // 官方既有 bundles 必须保留
    assert.ok(readManifest(f.profile).dsh.profile.bundles.includes('@deepseek-ai/dsh-base'));
    // 归属凭据落盘后 packOwnsPackage 才认这个包
    assert.equal(packOwnsPackage(f.profile, 'example-pack', f.root), true);
    // 幂等：第二次不再有任何变更
    assert.equal(adoptFullProfile(f.profile, f.root), null);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('issue #464: adoption preserves user files, user packages and their versions', () => {
  const f = fixture();
  try {
    legacyProfile(f.profile);
    fs.writeFileSync(path.join(f.profile, 'user-config.txt'), 'keep');
    // 用户自己装的同名包（版本与随包不同）必须原样保留
    const userPack = path.join(f.profile, 'node_modules', 'example-pack');
    fs.mkdirSync(userPack, { recursive: true });
    fs.writeFileSync(path.join(userPack, 'package.json'), JSON.stringify({ name: 'example-pack', version: '9.9.9' }));
    fs.writeFileSync(path.join(userPack, 'user-marker'), 'keep');
    // 用户自建的 patch 行必须保留
    fs.writeFileSync(path.join(f.profile, 'cordis.patch.yml'), '- id: user-row\n  name: user-plugin\n  disabled: true\n');

    const report = adoptFullProfile(f.profile, f.root);
    assert.ok(report);
    assert.deepEqual(report.adopted, [], 'an existing user package is never overwritten');
    assert.deepEqual(report.kept, ['example-pack']);
    assert.equal(fs.readFileSync(path.join(f.profile, 'user-config.txt'), 'utf8'), 'keep');
    assert.equal(fs.readFileSync(path.join(userPack, 'user-marker'), 'utf8'), 'keep');
    assert.equal(JSON.parse(fs.readFileSync(path.join(userPack, 'package.json'), 'utf8')).version, '9.9.9');
    const patch = fs.readFileSync(path.join(f.profile, 'cordis.patch.yml'), 'utf8');
    assert.match(patch, /user-row/, 'user patch rows survive');
    assert.match(patch, /disabled: true/, 'user disable state survives');
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('issue #464: adoption refreshes only pack-owned packages that drifted', () => {
  const f = fixture();
  try {
    legacyProfile(f.profile);
    // 先补齐，让 example-pack 成为「随包所有」并记录版本
    assert.ok(adoptFullProfile(f.profile, f.root));
    const dest = path.join(f.profile, 'node_modules', 'example-pack', 'package.json');
    assert.equal(JSON.parse(fs.readFileSync(dest, 'utf8')).version, '1.0.0');

    // 用户手工把版本改成 2.0.0 —— 属于用户改动，不该被降级
    fs.writeFileSync(dest, JSON.stringify({ name: 'example-pack', version: '2.0.0' }));
    assert.equal(adoptFullProfile(f.profile, f.root), null, 'a user-modified version is left alone');
    assert.equal(JSON.parse(fs.readFileSync(dest, 'utf8')).version, '2.0.0');

    // 版本回落到凭据记录的 1.0.0 后，随包升级到 1.1.0 应被刷新
    fs.writeFileSync(dest, JSON.stringify({ name: 'example-pack', version: '1.0.0' }));
    fs.writeFileSync(path.join(f.root, 'assets', 'full-pack', 'profile-seed', 'node_modules', 'example-pack', 'package.json'),
      JSON.stringify({ name: 'example-pack', version: '1.1.0' }));
    fs.writeFileSync(path.join(f.root, 'assets', 'full-pack', 'profile-seed', 'package.json'),
      JSON.stringify({ dependencies: { 'example-pack': '1.1.0' } }));
    const report = adoptFullProfile(f.profile, f.root);
    assert.ok(report);
    assert.deepEqual(report.refreshed, ['example-pack']);
    assert.equal(JSON.parse(fs.readFileSync(dest, 'utf8')).version, '1.1.0');
    assert.equal(readManifest(f.profile).dependencies['example-pack'], '1.1.0');
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('issue #464: adoption is a no-op without a profile, in safe mode, or for lite', () => {
  const f = fixture();
  try {
    // 无 profile -> 交给 seedFullProfile 的全新播种路径
    assert.equal(adoptFullProfile(f.profile, f.root), null);
    assert.equal(fs.existsSync(f.profile), false, 'adoption never creates a profile');

    // 安全模式 -> 不动
    legacyProfile(f.profile);
    const guard = path.join(f.root, 'home', 'guard');
    fs.mkdirSync(guard, { recursive: true });
    fs.writeFileSync(path.join(guard, 'safe-mode.json'), JSON.stringify({ active: true }));
    assert.equal(adoptFullProfile(f.profile, f.root), null);
    assert.equal(fs.existsSync(path.join(f.profile, 'node_modules', 'example-pack')), false);

    // lite（无 composition.json）-> 不动
    fs.rmSync(path.join(guard, 'safe-mode.json'));
    fs.rmSync(path.join(f.root, 'assets', 'full-pack', 'composition.json'));
    assert.equal(adoptFullProfile(f.profile, f.root), null);
    assert.equal(fs.existsSync(path.join(f.profile, 'node_modules', 'example-pack')), false);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('issue #464: a published full package receipt without versions migrates to a baseline first', () => {
  // 已发布的 full 包写的凭据只有 managedPackages、没有 versions。这类凭据无法
  // 区分「随包版本漂移」与「用户自己换过版本」，所以第一次只记基线、不刷新；
  // 之后随包升级才能正常刷新。
  const f = fixture();
  try {
    legacyProfile(f.profile);
    const dest = path.join(f.profile, 'node_modules', 'example-pack');
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'package.json'), JSON.stringify({ name: 'example-pack', version: '0.9.0' }));
    fs.writeFileSync(path.join(f.profile, '.eac-full-ownership.json'), JSON.stringify({
      schemaVersion: 1, profile: 'web-desktop', managedPackages: ['example-pack'],
    }));

    // 第一次：迁移为基线，不把 0.9.0 刷成随包的 1.0.0
    const first = adoptFullProfile(f.profile, f.root);
    assert.ok(first, 'migration must be reported');
    assert.deepEqual(first.refreshed, [], 'no refresh during baseline migration');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dest, 'package.json'), 'utf8')).version, '0.9.0');
    const receipt = JSON.parse(fs.readFileSync(path.join(f.profile, '.eac-full-ownership.json'), 'utf8'));
    assert.equal(receipt.versions['example-pack'], '0.9.0', 'baseline records the on-disk version');

    // 第二次：随包升级到 1.1.0 时正常刷新
    fs.writeFileSync(path.join(f.root, 'assets', 'full-pack', 'profile-seed', 'node_modules', 'example-pack', 'package.json'),
      JSON.stringify({ name: 'example-pack', version: '1.1.0' }));
    const second = adoptFullProfile(f.profile, f.root);
    assert.ok(second);
    assert.deepEqual(second.refreshed, ['example-pack']);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dest, 'package.json'), 'utf8')).version, '1.1.0');
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('repairHostClosure relinks dangling/foreign-install links, keeps real dirs and external dev links, and is idempotent', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eac-closure-'));
  const installA = path.join(tmp, 'install-a');
  const installB = path.join(tmp, 'install-b');
  const home = path.join(tmp, 'home');
  const shared = path.join(home, 'profiles', 'node_modules');
  const pkg = (installRoot: string, name: string) => {
    const dir = path.join(installRoot, 'dsh-desktop', 'node_modules', ...name.split('/'));
    fs.mkdirSync(dir, {recursive: true});
    fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  };
  try {
    pkg(installA, 'pkg-a');
    pkg(installA, '@scope/pkg-b');
    pkg(installB, 'pkg-c');
    fs.mkdirSync(shared, {recursive: true});
    // 悬空：旧安装目录已删
    fs.symlinkSync(path.join(tmp, 'deleted', 'dsh-desktop', 'node_modules', 'pkg-a'), path.join(shared, 'pkg-a'), 'junction');
    // 指向另一个安装的闭包
    fs.mkdirSync(path.join(shared, '@scope'), {recursive: true});
    fs.symlinkSync(path.join(installB, 'dsh-desktop', 'node_modules', 'pkg-c'), path.join(shared, '@scope', 'pkg-b'), 'junction');
    // 真实目录（用户包）与外部 link:：都不得动
    fs.mkdirSync(path.join(shared, 'pkg-d'), {recursive: true});
    fs.writeFileSync(path.join(shared, 'pkg-d', 'package.json'), '{"user":true}');
    const dev = path.join(tmp, 'dev-pkg');
    fs.mkdirSync(dev, {recursive: true});
    fs.writeFileSync(path.join(dev, 'package.json'), '{"dev":true}');
    fs.symlinkSync(dev, path.join(shared, 'pkg-dev'), 'junction');
    // 当前闭包不再提供、目标已消失：只有这种安装闭包内的死链可清理
    fs.symlinkSync(path.join(tmp, 'gone', 'pkg-old'), path.join(shared, 'pkg-old'), 'junction');
    const rootA = path.join(installA, 'dsh-desktop');
    fs.symlinkSync(path.join(rootA, 'node_modules', 'pkg-stale'), path.join(shared, 'pkg-stale'), 'junction');

    const linkExists = (value: string) => {try {fs.lstatSync(value); return true;} catch {return false;}};
    assert.deepEqual(repairHostClosure(home, rootA), {relinked: 2, pruned: 1});
    assert.equal(fs.existsSync(path.join(shared, 'pkg-a', 'package.json')), true, '悬空链接应指向当前闭包');
    assert.equal(fs.existsSync(path.join(shared, '@scope', 'pkg-b', 'package.json')), true, '异安装链接应改指当前闭包');
    assert.equal(fs.readFileSync(path.join(shared, 'pkg-d', 'package.json'), 'utf8'), '{"user":true}', '真实目录不得改动');
    assert.equal(fs.readFileSync(path.join(shared, 'pkg-dev', 'package.json'), 'utf8'), '{"dev":true}', '外部 link: 不得被抢改');
    assert.equal(linkExists(path.join(shared, 'pkg-old')), true, '外部不可达链接必须保留，不能当死链删除');
    assert.equal(linkExists(path.join(shared, 'pkg-stale')), false, '当前安装闭包内的陈旧链接应被清理');
    assert.deepEqual(repairHostClosure(home, rootA), {relinked: 0, pruned: 0}, '重入应无操作');
  } finally {
    fs.rmSync(tmp, {recursive: true, force: true});
  }
});

test('bindFullHostClosure tolerates a dangling existing junction instead of throwing EEXIST', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eac-closure-bind-'));
  const install = path.join(tmp, 'install');
  const home = path.join(tmp, 'home');
  const root = path.join(install, 'dsh-desktop');
  const source = path.join(root, 'node_modules', 'pkg-a');
  const shared = path.join(home, 'profiles', 'node_modules');
  try {
    fs.mkdirSync(source, {recursive: true});
    fs.writeFileSync(path.join(source, 'package.json'), '{}');
    fs.mkdirSync(shared, {recursive: true});
    const target = path.join(shared, 'pkg-a');
    fs.symlinkSync(path.join(tmp, 'deleted', 'dsh-desktop', 'node_modules', 'pkg-a'), target, 'junction');
    assert.doesNotThrow(() => bindFullHostClosure(home, root), '悬空 junction 已存在时 bind 不得抛 EEXIST');
    assert.deepEqual(repairHostClosure(home, root), {relinked: 1, pruned: 0});
    assert.equal(fs.realpathSync(target), fs.realpathSync(source), 'repair 后应指向当前安装闭包');
  } finally {
    fs.rmSync(tmp, {recursive: true, force: true});
  }
});