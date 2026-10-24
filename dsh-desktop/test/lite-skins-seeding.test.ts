import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 精简版随包皮肤播种的回归契约。
//
// 这里钉住的是 2026-10-23 踩了一整天的那个 bug：**home 层 patch 压过 profile 层**。
//
// 内核 compose 的层序（@deepseek-ai/dsh 的 profile-boot，原文）：
//   bundle layers → profile layer (cordis.patch.yml) → home layer
//   ($DSH_HOME/cordis.patch.yml — "outranks the per-profile layer") → overlays
//
// 皮肤管理器把「当前激活哪款皮肤」写成 home 层的 `- id: ui-skin-<x> / disabled:` 行。
// 装过、切过皮肤后，home 层会留下 `disabled: true` 的残留。只在 profile 层写
// `disabled: false` 完全无效：最终生效值仍是 true → 插件不挂载 → 不进客户端
// roster → body 上没有 data-dsh-* → 界面无皮肤。
//
// 当时的症状极具误导性：播种日志全绿（「随包皮肤已就绪（5 款）」）、
// profile 的 patch 看起来完全正确、测试也全过。只有 `--dump-config` 的最终值
// 才暴露真相。所以这里直接用真实文件布局测「最终值」。

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

test('播种：lite 档把默认激活的皮肤写到 profile 层', (t) => {
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
  assert.deepEqual(ACTIVE.map((s) => s.wiringId), ['ui-skin-orca-link'], '默认激活款应唯一且为 orca-link');
});

test('播种：home 层的 stale disabled:true 会被纠正（否则静默压过 profile 层）', (t) => {
  const { root, home, profileDir } = makeLayout();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const appRoot = makeAppRoot(root, 'lite');

  // 复刻「装过皮肤后 home 层留下的残留」：默认激活款被写死 disabled: true。
  const homePatch = join(home, 'cordis.patch.yml');
  writeFileSync(homePatch, [
    liteSkins.MANAGED_BEGIN,
    ...SKINS.map((s) => `- id: ${s.wiringId}\n  disabled: true`),
    liteSkins.MANAGED_END,
    '',
  ].join('\n'));
  const before = disabledMap(readFileSync(homePatch, 'utf8'));
  assert.equal(before.get(ORCA!.wiringId), true, '前置条件：home 层初始为禁用');

  liteSkins.seedLiteBundledSkins(profileDir, join(appRoot, 'assets', 'skins'), () => {}, appRoot);

  const after = disabledMap(readFileSync(homePatch, 'utf8'));
  assert.equal(
    after.get(ORCA!.wiringId), false,
    '默认激活款在 home 层必须被纠正为 enabled —— home 层优先级高于 profile 层，'
    + '不纠正则最终生效值仍为 true，皮肤静默不生效',
  );
  // 非激活款保持禁用：纠正只针对默认激活项，不能顺手把其它皮肤打开。
  for (const s of SKINS.filter((x) => !x.active)) {
    assert.equal(after.get(s.wiringId), true, `${s.wiringId} 不是默认激活款，不应被打开`);
  }
});

test('播种：home 层不存在时不凭空创建（避免在无该文件的环境多出一份配置）', (t) => {
  const { root, home, profileDir } = makeLayout();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const appRoot = makeAppRoot(root, 'lite');

  liteSkins.seedLiteBundledSkins(profileDir, join(appRoot, 'assets', 'skins'), () => {}, appRoot);
  assert.equal(existsSync(join(home, 'cordis.patch.yml')), false, 'home 层文件不应被创建');
});

test('播种：home 层段外的手写 disabled:true 也会被纠正（否则同样压死默认激活款）', (t) => {
  const { root, home, profileDir } = makeLayout();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const appRoot = makeAppRoot(root, 'lite');

  // 段外（没有 managed 标记）手写一行：模拟用户或早期管理器留下的显式禁用。
  const homePatch = join(home, 'cordis.patch.yml');
  writeFileSync(homePatch, `- id: ${ORCA!.wiringId}\n  disabled: true\n`);

  liteSkins.seedLiteBundledSkins(profileDir, join(appRoot, 'assets', 'skins'), () => {}, appRoot);

  const text = readFileSync(homePatch, 'utf8');
  // patch 层后写者胜：取最后一处该 id 的 disabled 值，必须已放开。
  const all = [...text.matchAll(new RegExp(`^- id:\\s*${ORCA!.wiringId}\\s*\\n\\s+disabled:\\s*(true|false)`, 'gm'))];
  assert.ok(all.length > 0, 'home 层应仍有该 id 的行');
  assert.equal(all[all.length - 1][1], 'false', '段外的旧 true 必须被纠正，否则默认激活款静默失效');
});

test('播种：home 层只有段外阻挠行时也必须纠正（早退条件不对称的回归）', (t) => {
  const { root, home, profileDir } = makeLayout();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const appRoot = makeAppRoot(root, 'lite');

  // 关键构造：home 层里 **managed 段已存在且完整**（其它皮肤行齐全），唯独
  // 默认激活款只在**段外**有一行 true。这样 missingInserts / missingDisabled /
  // wrongDisabled 全为空，`lines` 也为空，只有 blockedOutside 命中。
  //
  // 曾因此静默失效：两处早退条件不对称（第一处含 blockedOutside，第二处漏了），
  // 判定命中却直接 return false —— 没日志、没改动，与「没命中」完全无法区分。
  const homePatch = join(home, 'cordis.patch.yml');
  const others = SKINS.filter((s) => !s.active);
  writeFileSync(homePatch, [
    `- id: ${ORCA!.wiringId}`,
    '  disabled: true',
    liteSkins.MANAGED_BEGIN,
    ...others.flatMap((s) => [`- id: ${s.wiringId}`, '  disabled: true']),
    liteSkins.MANAGED_END,
    '',
  ].join('\n'));

  liteSkins.seedLiteBundledSkins(profileDir, join(appRoot, 'assets', 'skins'), () => {}, appRoot);

  const text = readFileSync(homePatch, 'utf8');
  const all = [...text.matchAll(new RegExp(`^- id:\\s*${ORCA!.wiringId}\\s*\\n\\s+disabled:\\s*(true|false)`, 'gm'))];
  assert.ok(all.length > 0, '该行应仍在原位');
  assert.equal(all[all.length - 1][1], 'false', '仅凭段外阻挠行也应触发纠正');
});

test('播种：非激活款在段外手写 disabled:true 时保持不动（不越权打开）', (t) => {
  const { root, home, profileDir } = makeLayout();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const appRoot = makeAppRoot(root, 'lite');

  const nonActive = SKINS.find((s) => !s.active)!;
  const homePatch = join(home, 'cordis.patch.yml');
  writeFileSync(homePatch, `- id: ${nonActive.wiringId}\n  disabled: true\n`);

  liteSkins.seedLiteBundledSkins(profileDir, join(appRoot, 'assets', 'skins'), () => {}, appRoot);

  const text = readFileSync(homePatch, 'utf8');
  const all = [...text.matchAll(new RegExp(`^- id:\\s*${nonActive.wiringId}\\s*\\n\\s+disabled:\\s*(true|false)`, 'gm'))];
  assert.equal(all[all.length - 1][1], 'true', '非默认激活款的显式禁用是用户选择，不能被播种打开');
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
