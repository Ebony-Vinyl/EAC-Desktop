import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { explicitDisabledEntryIds, parsePatchData, registeredPatchEntryIds, resolveBundleIdentity, resolveBundleIdentities, toggleBundleInPatch } from '../lib/bundle-identity.js';
import state from '../plugin-manager-state.js';

function fixture(t: test.TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'eac-bundle-identity-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('default-disable registration honors quoted YAML IDs and ignores comments and nested user data', () => {
  const ids = registeredPatchEntryIds('# id: comment-only\n- id: "pet" # user choice\n  disabled: false\n  config: { id: nested-data }\n- insert: [{ id: pet-settings, name: settings }]\n');
  assert.deepEqual([...ids], ['pet', 'pet-settings']);
  assert.deepEqual([...registeredPatchEntryIds('# no rows\n')], []);
});

/**
 * 「id 出现过」≠「已表态禁用」——这条区分修的是一个真实 bug。
 *
 * 自带 `dsh.bundle.patch` 的社区包（如 dsh-theme-endfield）在 profile 里天然有一行
 * insert：
 *     - id: theme-endfield
 *       name: dsh-theme-endfield
 *       config: { enabled: "0" }
 * 这行没有 disabled 字段 → 插件默认**启用**。旧实现用 registeredPatchEntryIds 判
 * 「已登记就跳过补写关闭行」，于是它永远补不上 disabled，主题默认打开、覆写 73 个
 * dsw-* 变量，与皮肤管理冲突。`config.enabled` 只是插件内部开关，管不了插件加载。
 *
 * explicitDisabledEntryIds 只认「显式写了 disabled」的行，让这类包能被正确补写。
 */
test('explicitDisabledEntryIds only counts rows that actually declare disabled', () => {
  const patch = [
    '# 社区包自带 insert：没有 disabled → 未表态',
    '- id: theme-endfield',
    '  name: dsh-theme-endfield',
    '  config:',
    '    enabled: "0"',
    '# 用户已表态关闭',
    '- id: pet',
    '  disabled: true',
    '# 用户已表态开启',
    '- id: balance',
    '  disabled: false',
    '# bundle 层 insert 里显式声明',
    '- insert:',
    '    - id: ext-a',
    '      name: ext-a',
    '      disabled: true',
    '# insert 里没声明 disabled → 未表态',
    '    - id: ext-b',
    '      name: ext-b',
    '',
  ].join('\n');
  assert.deepEqual(
    [...explicitDisabledEntryIds(patch)].sort(),
    ['balance', 'ext-a', 'pet'],
    '只有显式写了 disabled 的行才算已表态',
  );
  // 对照：旧口径会把 theme-endfield / ext-b 也算成"已登记"，从而跳过补写。
  assert.deepEqual(
    [...registeredPatchEntryIds(patch)].sort(),
    ['balance', 'ext-a', 'ext-b', 'pet', 'theme-endfield'],
    '旧口径确实包含未表态的行（这是被修掉的差异）',
  );
  assert.deepEqual([...explicitDisabledEntryIds('# no rows\n')], []);
  // disabled 出现在 config 里不算表态（只看行本身的字段）
  assert.deepEqual(
    [...explicitDisabledEntryIds('- id: x\n  config:\n    disabled: true\n')],
    [],
    'config 里的 disabled 是插件内部配置，不是 loader 行开关',
  );
});

function bundle(root: string, name: string, patches: Record<string, string>, declared: unknown = Object.keys(patches)) {
  const dir = join(root, 'node_modules', ...name.split('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, dsh: { bundle: { patch: declared } } }));
  for (const [filename, text] of Object.entries(patches)) {
    mkdirSync(join(dir, filename, '..'), { recursive: true });
    writeFileSync(join(dir, filename), text);
  }
  return dir;
}

test('declared patch paths resolve commented and multiline IDs without evaluating !!js', (t) => {
  const root = fixture(t);
  bundle(root, 'dsh-pet', {
    'config/first.yml': '- insert:\n    - id: pet # actual loader ID\n      name: dsh-pet\n      config: !!js "throw new Error()"\n',
    'second.yml': '- insert:\n    -\n      id: pet-controls\n      name: dsh-pet/controls\n      disabled: true\n',
  });
  const identity = resolveBundleIdentity(root, 'dsh-pet');
  assert.equal(identity.ok, true);
  if (!identity.ok) return;
  assert.deepEqual(identity.entryIds, ['pet', 'pet-controls']);
  assert.equal(identity.entries[1].disabled, true);
});

test('missing, invalid and escaping declarations never guess IDs from package names', (t) => {
  const root = fixture(t);
  bundle(root, 'empty', { 'patch.yml': '- id: existing\n  disabled: false\n' });
  bundle(root, 'broken', { 'patch.yml': '[invalid' });
  bundle(root, 'escape', {}, '../outside.yml');
  writeFileSync(join(root, 'node_modules', 'outside.yml'), '- insert:\n    - id: escaped\n      name: escape\n');
  for (const name of ['missing', 'empty', 'broken', 'escape', '../outside', '--help', '@-scope/name', '@scope/-name']) {
    assert.equal(resolveBundleIdentity(root, name).ok, false, name);
  }
});

test('scoped packages retain distinct UI IDs and shared loader ownership is refused', (t) => {
  const root = fixture(t);
  for (const name of ['dsh-pet', '@other/dsh-pet']) {
    bundle(root, name, { 'patch.yml': `- insert:\n    - id: pet\n      name: ${JSON.stringify(name)}\n` });
  }
  const identities = resolveBundleIdentities(root, ['dsh-pet', '@other/dsh-pet']);
  assert.equal(identities['dsh-pet'].ok, false);
  assert.equal(identities['@other/dsh-pet'].ok, false);
  const rows = state.collectPluginRows([], { bundles: Object.keys(identities), bundleIdentities: identities });
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].id, rows[1].id);
  assert.ok(rows.every((row) => !row.toggleable && row.error));
});

test('same basename packages with separate declarations never toggle or merge each other', (t) => {
  const root = fixture(t);
  bundle(root, '@a/pet', { 'patch.yml': '- insert:\n    - id: a-pet\n      name: "@a/pet"\n' });
  bundle(root, '@b/pet', { 'patch.yml': '- insert:\n    - id: b-pet\n      name: "@b/pet"\n' });
  const identities = resolveBundleIdentities(root, ['@a/pet', '@b/pet']);
  const first = identities['@a/pet'];
  assert.ok(first.ok);
  const patch = toggleBundleInPatch('[]\n', first, false);
  const rows = state.collectPluginRows(parsePatchData(patch) as unknown[], {
    bundles: ['@a/pet', '@b/pet'], bundleIdentities: identities,
  });
  assert.equal(rows.find((row) => row.name === '@a/pet')?.enabled, false);
  assert.equal(rows.find((row) => row.name === '@b/pet')?.enabled, true);
  assert.equal(rows.length, 2);
});

test('toggles use every actual entry, preserve configuration and override default disabled', (t) => {
  const root = fixture(t);
  bundle(root, 'dsh-pet', { 'patch.yml': '- insert:\n    - id: pet\n      name: dsh-pet\n    - id: pet-controls\n      name: dsh-pet/controls\n      disabled: true\n' });
  const identity = resolveBundleIdentity(root, 'dsh-pet');
  assert.ok(identity.ok);
  const initial = '# keep my note\n- id: pet\n  disabled: false\n  config:\n    size: 190\n- id: unrelated\n  config: !!js "process.env.KEEP"\n';
  const off = toggleBundleInPatch(initial, identity, false);
  const on = toggleBundleInPatch(off, identity, true);
  assert.match(on, /# keep my note/);
  assert.match(on, /!!js/);
  const parsed = parsePatchData(on) as Array<Record<string, unknown>>;
  assert.equal(parsed.find((row) => row.id === 'pet')?.disabled, false);
  assert.equal(parsed.find((row) => row.id === 'pet-controls')?.disabled, false);
  assert.deepEqual(parsed.find((row) => row.id === 'pet')?.config, { size: 190 });
  assert.equal(toggleBundleInPatch(on, identity, true), on);
  const identities = { 'dsh-pet': identity };
  const before = state.collectPluginRows([], { bundles: ['dsh-pet'], bundleIdentities: identities });
  assert.equal(before[0].enabled, false);
  const after = state.collectPluginRows(parsed, { bundles: ['dsh-pet'], bundleIdentities: identities });
  assert.equal(after.find((row) => row.id === 'dsh-pet')?.enabled, true);
  assert.equal(after.filter((row) => row.name.startsWith('dsh-pet')).length, 1);
  assert.throws(() => toggleBundleInPatch('- id: pet\n  name: other-package\n', identity, false), /归属冲突/);
  assert.throws(() => toggleBundleInPatch('- id: !!js "pet"\n  disabled: false\n', identity, false), /静态解析/);
});

test('default-disable planner expands real declarations and preserves existing user choice', (t) => {
  const root = fixture(t);
  bundle(root, 'example', { 'patch.yml': '- insert:\n    - id: one\n      name: example\n    - id: two\n      name: example/client\n' });
  const bundleIdentities = resolveBundleIdentities(root, ['example', 'missing']);
  const options = { bundles: ['example', 'missing'], bundleIdentities, distributionClasses: { example: 'external', missing: 'external' } };
  assert.deepEqual(state.externalDefaultDisabledPlan(options), [{ id: 'one', name: 'example' }, { id: 'two', name: 'example/client' }]);
  assert.deepEqual(state.externalDefaultDisabledPlan({ ...options, isRegistered: (id: string) => id === 'one' }), []);
});

test('plugin operations reject unresolved identities without writes and delegate external uninstall', async (t) => {
  const home = fixture(t);
  const profileDir = join(home, 'profiles', 'web-desktop');
  mkdirSync(profileDir, { recursive: true });
  bundle(profileDir, 'dsh-pet', { 'patch.yml': '- insert:\n    - id: pet\n      name: dsh-pet\n' });
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['dsh-pet', 'missing'] } } }));
  const patchFile = join(profileDir, 'cordis.patch.yml');
  writeFileSync(patchFile, '# user patch\n[]\n');
  const profile = await import('../lib/desktop/profile.js');
  const runtime = await import('../lib/desktop/runtime-paths.js');
  const ops = await import('../lib/desktop/plugin-ops.js');
  runtime.init({ log() {}, getUserDataDir: () => home });
  profile.init({ log() {}, getDshHome: () => home });
  const removed: string[] = [];
  ops.init({ log() {}, removeBundle: async (name: string) => { removed.push(name); return { ok: true, restartRequired: true }; } });
  assert.equal(ops.pluginManagerSetEnabled('missing', false).ok, false);
  assert.equal(readFileSync(patchFile, 'utf8'), '# user patch\n[]\n');
  assert.equal(ops.pluginManagerSetEnabled('not-a-plugin', true).ok, false);
  assert.equal(readFileSync(patchFile, 'utf8'), '# user patch\n[]\n');
  assert.equal(ops.pluginManagerSetEnabled('dsh-pet', false).ok, true);
  const written = parsePatchData(readFileSync(patchFile, 'utf8')) as Array<Record<string, unknown>>;
  assert.deepEqual(written, [{ id: 'pet', disabled: true }]);
  assert.equal((await ops.pluginManagerSetRemoved('dsh-pet', true)).ok, true);
  assert.deepEqual(removed, ['dsh-pet']);
});

test('shared parent node_modules supplies core ownership without copying core into the profile', (t) => {
  const root = fixture(t);
  const profiles = join(root, 'profiles');
  const profileDir = join(profiles, 'web-desktop');
  mkdirSync(profileDir, { recursive: true });
  bundle(profiles, '@deepseek-ai/dsh-base', {
    'core.yml': '- insert:\n    - id: permission\n      name: "@deepseek-ai/dsh-sandbox-policy"\n',
  });
  bundle(profileDir, 'external', { 'patch.yml': '- insert:\n    - id: permission\n      name: external\n' });
  assert.equal(resolveBundleIdentity(profileDir, '@deepseek-ai/dsh-base').ok, true);
  const identities = resolveBundleIdentities(profileDir, ['@deepseek-ai/dsh-base', 'external']);
  assert.equal(identities.external.ok, false);
  assert.match(identities.external.error || '', /冲突/);
});

/**
 * 回归：内核骨架包在**应用树**、不在 profile 时，不得把全部外部包标红。
 *
 * 真实部署形态（lite / full / 用户日常桌面端都如此）：profile 的
 * `dsh.profile.bundles` 里列着 `@deepseek-ai/dsh-base` / `dsh-web-app`，但这两个
 * 包**不在 profile 的 node_modules**（由 app 自带，位于 <app>/node_modules）。
 *
 * 旧实现只在 profile 的祖先链里找包：找不到 → 这两个内核包解析失败 →
 * `unresolvedCore` 为真 → 把所有非内核包标成「核心插件元数据不可用」。
 * 实测后果：60 个 bundle 里 58 个是误报，设置页整片红字。
 *
 * 修法：把内核安装树作为额外的解析根（kernelRoots 参数）。传入后内核包能正常
 * 解析，连坐不再触发；而「内核真的读不到」时的保守拦截仍然保留（见下一个测试）。
 */
test('kernel bundles living in the app tree resolve without a profile copy', (t) => {
  const root = fixture(t);
  const profileDir = join(root, 'profiles', 'web-desktop');
  mkdirSync(profileDir, { recursive: true });
  // 应用树：内核包在这里，且不在 profile 的祖先链上（兄弟目录）。
  const appRoot = join(root, 'app');
  bundle(appRoot, '@deepseek-ai/dsh-base', {
    'core.yml': '- insert:\n    - id: permission\n      name: "@deepseek-ai/dsh-sandbox-policy"\n',
  });
  // 普通外部包：装在 profile 里。
  bundle(profileDir, 'external', { 'patch.yml': '- insert:\n    - id: external\n      name: external\n' });

  const names = ['@deepseek-ai/dsh-base', 'external'];

  // 不传 kernelRoots（旧调用形态）：内核包找不到 → 连坐。
  const withoutRoot = resolveBundleIdentities(profileDir, names);
  assert.equal(withoutRoot['@deepseek-ai/dsh-base'].ok, false);
  assert.match(withoutRoot.external.error || '', /核心插件元数据不可用/);

  // 传 app 树作为内核根：内核包解析成功，外部包不再被误标。
  const withRoot = resolveBundleIdentities(profileDir, names, [appRoot]);
  assert.equal(withRoot['@deepseek-ai/dsh-base'].ok, true, '内核包应能从应用树解析');
  assert.equal(withRoot.external.ok, true, '外部包不应被内核连坐误标');
});

test('dynamic identifiers stay inert and unresolved core prevents external mutations', (t) => {
  const root = fixture(t);
  bundle(root, 'dynamic-id', { 'patch.yml': '- insert:\n    - id: !!js "pet"\n      name: dynamic-id\n' });
  bundle(root, 'dynamic-name', { 'patch.yml': '- insert:\n    - id: pet\n      name: !!js "dynamicName"\n' });
  assert.equal(resolveBundleIdentity(root, 'dynamic-id').ok, false);
  assert.equal(resolveBundleIdentity(root, 'dynamic-name').ok, false);
  bundle(root, 'external', { 'patch.yml': '- insert:\n    - id: permission\n      name: external\n' });
  const identities = resolveBundleIdentities(root, ['@deepseek-ai/dsh-base', 'external']);
  assert.equal(identities.external.ok, false);
  assert.match(identities.external.error || '', /核心插件元数据不可用/);
  assert.deepEqual(state.externalDefaultDisabledPlan({
    bundles: ['external'], bundleIdentities: identities, distributionClasses: { external: 'external' },
  }), []);
  assert.deepEqual(parsePatchData('- config: !!js "doNotRun()"\n'), [{ config: { __jsExpr: 'doNotRun()' } }]);
});
