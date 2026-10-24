/**
 * catalog `defaultEnabled: false` → 补 `disabled: true` 行的守卫。
 *
 * 为什么需要这条
 * --------------
 * 自带 `dsh.bundle.patch` 的社区包（如 `dsh-theme-endfield`）在 profile 里天然
 * 有一行 `- insert:`（由 bundle 层写入），该行**没有 disabled 字段** → 插件默认
 * **启用**。而它的 `config.enabled: "0"` 只是插件内部开关，管不了插件加载。
 *
 * 实测后果（2026-10-21）：终末地主题默认打开，覆写 73 个 `dsw-*` CSS 变量，
 * 与皮肤管理器冲突；`<body>` 上同时挂着 3 个皮肤属性，管理器按
 * `body.hasAttribute(bodyAttr)` 判"当前皮肤"，永远显示错的那个。
 *
 * 为什么不用 externalDefaultDisabledPlan
 * --------------------------------------
 * 那条路依赖 `PLUGIN_SYNC_REGISTRY` 覆盖全部 bundle（实际只登记 10 个，profile
 * 有 61 个，命中 1/61），未登记包经 `canonicalBundleId` 得到 `scoped-<hex>`，
 * 与 `PLUGIN_DISTRIBUTION_CLASSES` 的裸名 key 对不上 → 全落进默认 `'external'`。
 * 实测一旦解除 `unresolvedCore` 安全网，它会一次给 **45 个插件**补 disabled，
 * 把 skin-switch / 皮肤管理器 / better-sidebar 等正常功能全关掉。
 *
 * 所以改走**事实源**：catalog 里显式写了 `defaultEnabled: false` 的包才是
 * "装着但默认关"，不做 id 推断、不做分类猜测。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** 造一个最小 catalog 目录。 */
function catalogDir(t: test.TestContext, files: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'eac-catalog-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(root, name), JSON.stringify(body));
  }
  return root;
}

/**
 * 复刻 `defaultDisabledBundlePackages()` 的筛选规则。
 * 保持与实现同步：读目录下所有 .json（跳过 retired.json）、跳过 distExclude、
 * 只收 defaultEnabled === false。
 */
function pickDefaultDisabled(dir: string): Set<string> {
  const names = new Set<string>();
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json') || file === 'retired.json') continue;
    const catalog: unknown = JSON.parse(fs.readFileSync(join(dir, file), 'utf8'));
    const rows = Array.isArray(catalog) ? catalog : ((catalog as { plugins?: unknown[] }).plugins ?? []);
    for (const row of rows as { name?: string; defaultEnabled?: boolean; distExclude?: boolean }[]) {
      if (!row || typeof row.name !== 'string' || !row.name) continue;
      if (row.distExclude === true) continue;          // 未随包分发，无需管理
      if (row.defaultEnabled === false) names.add(row.name);
    }
  }
  return names;
}

test('defaultEnabled:false 的包被识别，其余不动', (t) => {
  const dir = catalogDir(t, {
    'eac.json': [
      { name: 'dsh-keep-on', defaultEnabled: true },
      { name: 'dsh-default-off', defaultEnabled: false },
    ],
    'community.json': [
      { name: 'dsh-theme-endfield', defaultEnabled: false, tier: 'visual' },
      { name: 'dsh-no-flag' },
    ],
  });
  const names = pickDefaultDisabled(dir);
  assert.deepEqual([...names].sort(), ['dsh-default-off', 'dsh-theme-endfield']);
  assert.ok(!names.has('dsh-keep-on'), 'defaultEnabled:true 的包不能被关闭');
  assert.ok(!names.has('dsh-no-flag'), '没写 defaultEnabled 的包不能被擅自关闭（fail-open）');
});

test('distExclude:true 的包不参与（未随包分发，无需管理）', (t) => {
  const dir = catalogDir(t, {
    'eac.json': [
      { name: 'dsh-retired', defaultEnabled: false, distExclude: true },
      { name: 'dsh-real', defaultEnabled: false },
    ],
  });
  assert.deepEqual([...pickDefaultDisabled(dir)], ['dsh-real']);
});

test('retired.json 整份跳过（退役包不该被补关闭行）', (t) => {
  const dir = catalogDir(t, {
    'retired.json': [{ name: 'dsh-old', defaultEnabled: false }],
    'eac.json': [{ name: 'dsh-live', defaultEnabled: false }],
  });
  assert.deepEqual([...pickDefaultDisabled(dir)], ['dsh-live'], 'retired.json 里的条目必须被跳过');
});

test('catalog 里 plugins 包一层的形态也支持', (t) => {
  const dir = catalogDir(t, {
    'nested.json': { plugins: [{ name: 'dsh-nested', defaultEnabled: false }] },
  });
  assert.deepEqual([...pickDefaultDisabled(dir)], ['dsh-nested']);
});
