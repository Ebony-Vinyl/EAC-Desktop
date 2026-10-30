import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 原生默认、用户配置优先与重复播种的行为回归。

const liteSkins = await import('../lib/desktop/lite-skins.js') as {
  seedLiteBundledSkins: (profileDir: string, assetsSkins: string, log?: (m: string) => void, appRoot?: string) => boolean;
  isLiteProfile: (appRoot: string) => boolean;
  LITE_BUNDLED_SKINS: { name: string; dir: string; wiringId: string; active: boolean }[];
  MANAGED_BEGIN: string;
  MANAGED_END: string;
};

const SKINS = liteSkins.LITE_BUNDLED_SKINS;
const ACTIVE = SKINS.filter((s) => s.active);
const ORCA = SKINS.find((s) => s.wiringId === 'ui-skin-orca-link');

test('随包皮肤通过当前内核的真实版本兼容检查', async () => {
  const { evaluatePluginCompatibility } = await import('@deepseek-ai/dsh-app-boot');
  for (const skin of SKINS) {
    const manifest = JSON.parse(readFileSync(new URL(`../assets/skins/${skin.dir}/package.json`, import.meta.url), 'utf8'));
    assert.equal(evaluatePluginCompatibility(manifest), undefined, `${skin.name} 不应在插件页标为版本不兼容`);
  }
});

/** 建一个最小的 <home>/profiles/<name> 布局，返回关键路径。 */
function makeLayout() {
  const root = mkdtempSync(join(tmpdir(), 'lite-skins-'));
  const home = join(root, 'dsh-home');
  const profileDir = join(home, 'profiles', 'web-desktop');
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web-desktop', private: true,
    dependencies: {}, dsh: { profile: { bundles: [] } },
  }, null, 2));
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '# profile layer\n');
  return { root, home, profileDir };
}

/**
 * 把 patch 文本解析成 id → disabled 的映射。
 *
 * 注意：`- insert:` 块内部也有 `    - id: xxx` 行（缩进 4 空格）。只认
 * **零缩进**的 `- id:` 且下一行带 disabled 的，那些才是真正的开关行。
 */
function disabledMap(text: string): Map<string, boolean> {
  const out = new Map<string, boolean>();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^- id:\s*(\S+)\s*$/.exec(lines[i]);
    if (!m) continue;
    const d = /^\s+disabled:\s*(true|false)\s*$/.exec(lines[i + 1] ?? '');
    if (d) out.set(m[1], d[1] === 'true');
  }
  return out;
}

/**
 * 造一个假 appRoot。注意 profile.txt 就在 appRoot 根下（PROFILE_MARKER_FILE），
 * 真实布局是 `<app>/dsh-desktop/profile.txt`，即 appRoot 本身就指向 dsh-desktop 目录。
 */
function makeAppRoot(root: string, distro: 'lite' | 'full'): string {
  const appRoot = join(root, 'app');
  mkdirSync(appRoot, { recursive: true });
  writeFileSync(join(appRoot, 'profile.txt'), `${distro}\n`);
  mkdirSync(join(appRoot, 'assets', 'skins'), { recursive: true });
  return appRoot;
}

test('播种：lite 档五款皮肤默认关闭，不重复插入 bundle entry', (t) => {
  const { root, profileDir } = makeLayout();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // assets/skins 为空目录：只验 patch 行逻辑，不验包落位。
  const appRoot = makeAppRoot(root, 'lite');

  liteSkins.seedLiteBundledSkins(profileDir, join(appRoot, 'assets', 'skins'), () => {}, appRoot);

  const map = disabledMap(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8'));
  for (const s of SKINS) {
    assert.equal(map.has(s.wiringId), true, `profile 层缺少 ${s.wiringId} 的 disabled 行`);
    assert.equal(map.get(s.wiringId), !s.active, `${s.wiringId} 的 disabled 基线值错误`);
  }
  assert.deepEqual(ACTIVE.map((s) => s.wiringId), [], '出厂不应激活任何皮肤');
});

for (const activeId of [null, 'ui-skin-maid-atelier', 'ui-skin-orca-link']) {
  test(`播种：保留 profile/home 的用户选择 ${activeId ?? 'official'}`, (t) => {
    const { root, home, profileDir } = makeLayout();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const appRoot = makeAppRoot(root, 'lite');
    const profilePatch = join(profileDir, 'cordis.patch.yml');
    const homePatch = join(home, 'cordis.patch.yml');
    const choice = [
      '# user comment', liteSkins.MANAGED_BEGIN,
      ...SKINS.map((s) => `- id: ${s.wiringId}\n  disabled: ${s.wiringId !== activeId}`),
      liteSkins.MANAGED_END, '',
    ].join('\n');
    writeFileSync(profilePatch, choice);
    writeFileSync(homePatch, choice + '# home user override\n');
    for (let i = 0; i < 2; i++) {
      liteSkins.seedLiteBundledSkins(profileDir, join(appRoot, 'assets', 'skins'), () => {}, appRoot);
      assert.equal(readFileSync(profilePatch, 'utf8'), choice);
      assert.equal(readFileSync(homePatch, 'utf8'), choice + '# home user override\n');
    }
  });
}

test('播种：幂等且不创建 home patch，不重复 insert', (t) => {
  const { root, home, profileDir } = makeLayout();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const appRoot = makeAppRoot(root, 'lite');
  const seed = () => liteSkins.seedLiteBundledSkins(profileDir, join(appRoot, 'assets', 'skins'), () => {}, appRoot);
  seed();
  const before = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8');
  assert.doesNotMatch(before, /insert:/);
  assert.equal(seed(), false);
  assert.equal(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8'), before);
  assert.equal(existsSync(join(home, 'cordis.patch.yml')), false);
});

test('播种：home 段外的显式启停原样保留', (t) => {
  const { root, home, profileDir } = makeLayout();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const appRoot = makeAppRoot(root, 'lite');
  const homePatch = join(home, 'cordis.patch.yml');
  const choice = `- id: ${ORCA!.wiringId}\n  disabled: false\n# user\n`;
  writeFileSync(homePatch, choice);
  liteSkins.seedLiteBundledSkins(profileDir, join(appRoot, 'assets', 'skins'), () => {}, appRoot);
  assert.equal(readFileSync(homePatch, 'utf8'), choice);
});

test('播种：保留带引号、注释与 CRLF 的用户选择', (t) => {
  const { root, profileDir } = makeLayout();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const appRoot = makeAppRoot(root, 'lite');
  const patch = join(profileDir, 'cordis.patch.yml');
  const choice = SKINS.map(s => `- id: "${s.wiringId}" # user\r\n  disabled: false\r\n`).join('');
  writeFileSync(patch, choice);
  liteSkins.seedLiteBundledSkins(profileDir, join(appRoot, 'assets', 'skins'), () => {}, appRoot);
  assert.equal(readFileSync(patch, 'utf8'), choice);
});

test('播种：畸形 YAML 保持原文件并报告错误', (t) => {
  const { root, profileDir } = makeLayout();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const appRoot = makeAppRoot(root, 'lite');
  const patch = join(profileDir, 'cordis.patch.yml');
  const invalid = '- id: [broken\n';
  writeFileSync(patch, invalid);
  assert.throws(() => liteSkins.seedLiteBundledSkins(profileDir, join(appRoot, 'assets', 'skins'), () => {}, appRoot), /YAML/);
  assert.equal(readFileSync(patch, 'utf8'), invalid);
});

test('播种：lite 把虎鲸之链「居中设置面板」默认打开（设置栏贴底留白）', (t) => {
  const { root, profileDir } = makeLayout();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const appRoot = makeAppRoot(root, 'lite');

  // 造一个最小可用的 orca 包：只含本次修正要匹配的结构。
  // 关键点：文件里**另有**两处 `defaultValue: false`（真实包有 3 处），
  // 用来证明修正是按 key 定位的，不会误伤别的选项。
  const orcaDir = join(profileDir, 'node_modules', '@smalltailqwq', 'dsh-client-ui-skin-orca-link', 'lib');
  mkdirSync(orcaDir, { recursive: true });
  const FAKE = [
    'const settings = [',
    '  {',
    '    key: "character",',
    '    type: "boolean",',
    '    defaultValue: false',
    '  },',
    '  {',
    '    key: "centerSettings",',
    '    type: "boolean",',
    '    defaultValue: false',
    '  },',
    '  {',
    '    key: "mirrorCharacter",',
    '    type: "boolean",',
    '    defaultValue: false',
    '  },',
    '];',
  ].join('\n');
  writeFileSync(join(orcaDir, 'client.js'), FAKE);

  // 布局修正已从 seedLiteBundledSkins 里拆出（它两档都要跑，而播种只跑 lite），
  // 由 companion-sync 直接调用导出的 applyOrcaSettingsLayoutFix。
  (liteSkins as { applyOrcaSettingsLayoutFix: (d: string) => boolean }).applyOrcaSettingsLayoutFix(profileDir);

  const after = readFileSync(join(orcaDir, 'client.js'), 'utf8');
  (liteSkins as { applyOrcaSettingsLayoutFix: (d: string) => boolean }).applyOrcaSettingsLayoutFix(profileDir);
  const segOf = (txt: string, key: string) => {
    const i = txt.indexOf(`key: "${key}"`);
    const j = txt.indexOf('key: "', i + 10);
    return txt.slice(i, j < 0 ? undefined : j);
  };
  assert.match(segOf(after, 'centerSettings'), /defaultValue: true/, 'centerSettings 默认值应改为 true');
  // 另外两项必须原封不动 —— 这是「按 key 定位、不盲改」的核心保证。
  assert.match(segOf(after, 'character'), /defaultValue: false/, 'character 不应被连带修改');
  assert.match(segOf(after, 'mirrorCharacter'), /defaultValue: false/, 'mirrorCharacter 不应被连带修改');
});

test('播种：full 档不动 orca 的默认值', (t) => {
  const { root, profileDir } = makeLayout();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const appRoot = makeAppRoot(root, 'full');

  const orcaDir = join(profileDir, 'node_modules', '@smalltailqwq', 'dsh-client-ui-skin-orca-link', 'lib');
  mkdirSync(orcaDir, { recursive: true });
  const fake = 'key: "centerSettings",\n  defaultValue: false,\n';
  writeFileSync(join(orcaDir, 'client.js'), fake);

  liteSkins.seedLiteBundledSkins(profileDir, join(appRoot, 'assets', 'skins'), () => {}, appRoot);

  assert.equal(readFileSync(join(orcaDir, 'client.js'), 'utf8'), fake, 'full 档不应改动');
});

test('布局修正两档都生效：full 也要修掉设置栏贴底留白', (t) => {
  const { root, profileDir } = makeLayout();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const appRoot = makeAppRoot(root, 'full');

  // orca 包装在 profile 里（full 通过市场/随包安装后就是这个形态）。
  const orcaDir = join(profileDir, 'node_modules', '@smalltailqwq', 'dsh-client-ui-skin-orca-link', 'lib');
  mkdirSync(orcaDir, { recursive: true });
  // 结构要和真实包一致：centerSettings 的 defaultValue 在本段内，后面还有别的 key。
  const FAKE = [
    '{',
    '  key: "character",',
    '  type: "boolean",',
    '  defaultValue: false,',
    '},',
    '{',
    '  key: "centerSettings",',
    '  type: "boolean",',
    '  defaultValue: false,',
    '},',
    '{',
    '  key: "mirrorCharacter",',
    '  type: "boolean",',
    '  defaultValue: false,',
    '},',
  ].join('\n');
  writeFileSync(join(orcaDir, 'client.js'), FAKE);

  // applyOrcaSettingsLayoutFix 是独立导出的，两档都应能调用。
  const changed = (liteSkins as { applyOrcaSettingsLayoutFix?: (d: string) => boolean })
    .applyOrcaSettingsLayoutFix?.(profileDir);
  assert.equal(changed, true, 'full 档也应有修改');
  assert.match(readFileSync(join(orcaDir, 'client.js'), 'utf8'), /defaultValue: true/);
});

test('播种：full 档一行都不碰', (t) => {
  const { root, home, profileDir } = makeLayout();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const appRoot = makeAppRoot(root, 'full');

  const profilePatch = join(profileDir, 'cordis.patch.yml');
  const homePatch = join(home, 'cordis.patch.yml');
  writeFileSync(homePatch, '# home\n');
  const profileBefore = readFileSync(profilePatch, 'utf8');
  const homeBefore = readFileSync(homePatch, 'utf8');

  liteSkins.seedLiteBundledSkins(profileDir, join(appRoot, 'assets', 'skins'), () => {}, appRoot);

  assert.equal(readFileSync(profilePatch, 'utf8'), profileBefore, 'full 档不该改 profile 层');
  assert.equal(readFileSync(homePatch, 'utf8'), homeBefore, 'full 档不该改 home 层');
});

for (const userOwned of [false, true]) {
  test(`skin manager upgrade: ${userOwned ? 'preserve user copy' : 'update managed copy idempotently'}`, (t) => {
    const { root, profileDir } = makeLayout();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const appRoot = makeAppRoot(root, 'lite');
    const source = join(appRoot, 'assets', 'plugins', 'dsh-client-ui-skin-deep-whale-manager');
    const target = join(profileDir, 'node_modules', '@smalltailqwq', 'dsh-client-ui-skin-deep-whale-manager');
    const makeManager = (dir: string, version: string) => {
      mkdirSync(join(dir, 'lib'), { recursive: true });
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@smalltailqwq/dsh-client-ui-skin-deep-whale-manager', version }));
      writeFileSync(join(dir, 'lib', 'index.js'), version);
      writeFileSync(join(dir, 'lib', 'client.js'), version);
    };
    makeManager(source, '1.0.0');
    if (userOwned) makeManager(target, 'user-copy');
    const seed = (app: string) => liteSkins.seedLiteBundledSkins(profileDir, join(app, 'assets', 'skins'), () => {}, app);
    seed(appRoot);
    assert.equal(readFileSync(join(target, 'lib', 'client.js'), 'utf8'), userOwned ? 'user-copy' : '1.0.0');
    const nextApp = join(root, 'next-app');
    mkdirSync(join(nextApp, 'assets', 'skins'), { recursive: true });
    writeFileSync(join(nextApp, 'profile.txt'), 'lite\n');
    makeManager(join(nextApp, 'assets', 'plugins', 'dsh-client-ui-skin-deep-whale-manager'), '2.0.0');
    assert.equal(seed(nextApp), !userOwned);
    assert.equal(readFileSync(join(target, 'lib', 'client.js'), 'utf8'), userOwned ? 'user-copy' : '2.0.0');
    assert.equal(seed(nextApp), false);
  });
}

test('播种：空数组 patch 补行后仍可解析且幂等', (t) => {
  const { root, profileDir } = makeLayout();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const appRoot = makeAppRoot(root, 'lite');
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '# empty profile\r\n[]\r\n');
  const seed = () => liteSkins.seedLiteBundledSkins(profileDir, join(appRoot, 'assets', 'skins'), () => {}, appRoot);
  assert.equal(seed(), true);
  assert.equal(disabledMap(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')).size, SKINS.length);
  assert.equal(seed(), false);
});

for (const userChange of [null, 'package.json', 'lib/client.js']) {
  test(`鲸鱼娘旧兼容声明升级：${userChange ?? '原随包副本'}，保留启停并幂等`, (t) => {
    const { root, profileDir } = makeLayout();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const appRoot = makeAppRoot(root, 'lite');
    const skin = SKINS.find(s => s.wiringId === 'ui-skin-deep-whale-day-night')!;
    const source = new URL(`../assets/skins/${skin.dir}/`, import.meta.url);
    const assets = join(appRoot, 'assets', 'skins');
    const target = join(profileDir, 'node_modules', ...skin.name.split('/'));
    cpSync(source, join(assets, skin.dir), { recursive: true });
    cpSync(source, target, { recursive: true });
    const file = join(target, 'package.json');
    const legacy = JSON.parse(readFileSync(file, 'utf8'));
    legacy.peerDependencies['@deepseek-ai/dsh-client-ui-theme'] = '>=0.1.0-rc.5 <0.2.0';
    if (userChange === 'package.json') legacy.description = 'User fork';
    const before = JSON.stringify(legacy, null, 2) + '\n';
    writeFileSync(file, before);
    if (userChange === 'lib/client.js') writeFileSync(join(target, userChange), '// user client\n');
    const patch = join(profileDir, 'cordis.patch.yml');
    const choice = SKINS.map(s => `- id: ${s.wiringId}\n  disabled: ${s.wiringId !== skin.wiringId}\n`).join('');
    writeFileSync(patch, choice);
    const seed = () => liteSkins.seedLiteBundledSkins(profileDir, assets, () => {}, appRoot);
    seed();
    assert.equal(readFileSync(file, 'utf8'), userChange ? before : readFileSync(new URL('package.json', source), 'utf8'));
    assert.equal(readFileSync(patch, 'utf8'), choice);
    if (!userChange) assert.equal(readFileSync(file + '.before-theme-021.bak', 'utf8'), before);
    assert.equal(seed(), false);
    if (userChange === 'lib/client.js') assert.equal(readFileSync(join(target, userChange), 'utf8'), '// user client\n');
  });
}
