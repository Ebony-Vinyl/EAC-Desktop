import test from 'node:test';
import assert from 'node:assert/strict';

// tauri-shell 是随包分发的手写 ESM（无 .d.ts、不进 tsconfig include），
// 测试用动态 import 直读源码，与构建产物无关。
const verifyMod = await import('../../tauri-shell/verify-portable.mjs');
const distroMod = await import('../../tauri-shell/distro.mjs');

const {
  PLUGIN_ROOT,
  SKIN_ROOT,
  PROFILE_MARKER,
  REQUIRED_ROOT_FILES,
  normalizeEntryName,
  childDirsOf,
  verifyPortableEntries,
  inferDistroFromName,
} = verifyMod;

const { builtinPluginDirs, bundledSkinDirs, FULL_ONLY_SKIN_DIRS } = distroMod;

/**
 * 造一份「档位正确」的条目清单：根文件 + 该档全部随包插件与皮肤。
 * options 用于定向破坏某一项，验证门禁能抓到。
 */
function entriesFor(distro, options = {}) {
  const entries = [...REQUIRED_ROOT_FILES];
  for (const dir of builtinPluginDirs(distro)) {
    if (dir === options.omitPlugin) continue;
    entries.push(`${PLUGIN_ROOT}/${dir}/package.json`);
  }
  for (const dir of bundledSkinDirs(distro)) {
    if (dir === options.omitSkin) continue;
    entries.push(`${SKIN_ROOT}/${dir}/skin.json`, `${SKIN_ROOT}/${dir}/assets/tokens.css`);
  }
  if (options.extraSkin) entries.push(`${SKIN_ROOT}/${options.extraSkin}/skin.json`);
  if (options.extraPlugin) entries.push(`${PLUGIN_ROOT}/${options.extraPlugin}/package.json`);
  return options.omitRoot ? entries.filter((e) => e !== options.omitRoot) : entries;
}

function names(result) {
  return result.checks.map((c) => c.name);
}

test('lite 载荷面自洽时通过', () => {
  const result = verifyPortableEntries({ entries: entriesFor('lite'), distro: 'lite', profileMarker: 'lite\n' });
  assert.equal(result.ok, true, names(result).join(','));
  assert.equal(result.checks.filter((c) => !c.ok).length, 0);
});

test('full 载荷面自洽时通过', () => {
  const result = verifyPortableEntries({ entries: entriesFor('full'), distro: 'full', profileMarker: 'full' });
  assert.equal(result.ok, true, names(result).join(','));
});

test('档位标记与产物档位不符即失败（v6.0.0 发布过的 lite 包正是此症状）', () => {
  const result = verifyPortableEntries({ entries: entriesFor('lite'), distro: 'lite', profileMarker: 'full' });
  assert.equal(result.ok, false);
  const marker = result.checks.find((c) => c.name === 'profile-marker-value');
  assert.equal(marker.ok, false);
  assert.match(marker.detail, /full/);
});

test('缺少随包皮肤即失败', () => {
  const missing = bundledSkinDirs('lite')[0];
  const result = verifyPortableEntries({ entries: entriesFor('lite', { omitSkin: missing }), distro: 'lite', profileMarker: 'lite' });
  assert.equal(result.ok, false);
  const skin = result.checks.find((c) => c.name === 'bundled-skins');
  assert.equal(skin.ok, false);
  assert.ok(skin.detail.includes(missing));
});

test('缺少随包插件即失败', () => {
  const missing = builtinPluginDirs('lite')[0];
  const result = verifyPortableEntries({ entries: entriesFor('lite', { omitPlugin: missing }), distro: 'lite', profileMarker: 'lite' });
  assert.equal(result.ok, false);
  assert.equal(result.checks.find((c) => c.name === 'bundled-plugins').ok, false);
});

test('lite 混入 full 专属皮肤即失败（体积白涨的典型形态）', () => {
  const foreign = FULL_ONLY_SKIN_DIRS[0];
  assert.ok(foreign, 'full 专属皮肤清单不应为空');
  const mixed = [...entriesFor('lite'), `${SKIN_ROOT}/${foreign}/skin.json`];
  const result = verifyPortableEntries({ entries: mixed, distro: 'lite', profileMarker: 'lite' });
  assert.equal(result.ok, false);
  const rule = result.checks.find((c) => c.name === 'no-foreign-payload');
  assert.equal(rule.ok, false);
  assert.ok(rule.detail.includes(foreign));
});

test('缺少 sidecar 根文件即失败', () => {
  const result = verifyPortableEntries({
    entries: entriesFor('lite', { omitRoot: 'sidecar/server.js' }),
    distro: 'lite',
    profileMarker: 'lite',
  });
  assert.equal(result.ok, false);
  const roots = result.checks.find((c) => c.name === 'root-files');
  assert.equal(roots.ok, false);
  assert.match(roots.detail, /sidecar\/server\.js/);
});

test('未登记的多余目录只告警，不拦构建', () => {
  const result = verifyPortableEntries({
    entries: entriesFor('lite', { extraSkin: 'dsh-client-unregistered-skin' }),
    distro: 'lite',
    profileMarker: 'lite',
  });
  assert.equal(result.ok, true, '多余但非另一档专属的目录不应阻断构建');
  const warn = result.checks.find((c) => c.name === 'unregistered-skins');
  assert.ok(warn, '应给出未登记告警');
  assert.equal(warn.severity, 'warn');
  assert.equal(warn.ok, false);
});

test('条目标记解析：统一反斜杠、去 ./ 前缀与结尾斜杠', () => {
  const result = verifyPortableEntries({
    entries: entriesFor('lite').map((e) => `./${e.replace(/\//g, '\\')}`),
    distro: 'lite',
    profileMarker: 'lite',
  });
  assert.equal(result.ok, true);
});

test('childDirsOf 只取直接子目录，且忽略根下裸文件', () => {
  const dirs = childDirsOf([
    `${SKIN_ROOT}/a/one.png`,
    `${SKIN_ROOT}/a/nested/two.png`,
    `${SKIN_ROOT}/b/skin.json`,
    `${SKIN_ROOT}/loose.txt`,
  ], SKIN_ROOT);
  assert.deepEqual([...dirs].sort(), ['a', 'b']);
});

test('normalizeEntryName 对空串与纯斜杠安全', () => {
  assert.equal(normalizeEntryName('./dsh-desktop/profile.txt'), PROFILE_MARKER);
  assert.equal(normalizeEntryName('dsh-desktop/assets/skins/x/'), 'dsh-desktop/assets/skins/x');
});

test('非法档位直接抛错，而不是静默放行', () => {
  assert.throws(() => verifyPortableEntries({ entries: ['a'], distro: 'beta', profileMarker: 'beta' }), /非法档位/);
});

test('空条目列表抛错（zip 未生成/读取失败）', () => {
  assert.throws(() => verifyPortableEntries({ entries: [], distro: 'lite' }), /条目列表为空/);
});

test('从产物文件名推断档位', () => {
  assert.equal(inferDistroFromName('v6.1.0-lite-x64.zip'), 'lite');
  assert.equal(inferDistroFromName('v6.1.0beta-full-x64.zip'), 'full');
  assert.equal(inferDistroFromName('EAC-Full-6.0.0-windows-x64.zip'), 'full');
  assert.equal(inferDistroFromName('artifact.zip'), null);
  assert.equal(inferDistroFromName('xxx-lite-full.zip'), null, '两档同时出现时不做猜测');
});