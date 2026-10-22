import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// M2/#415 结构退役契约：旧版用户可见皮肤切换（dsh-skin-switch 插件 +
// assets/skins 目录播种 + applyLegacySkinChoice 迁移落位）整体移除，
// 换肤职责移交 ui-skin-loader 公约皮肤包（M1 产物另行接入）。
// 边界（ADR 0010）：壳层 ui-skin manager 的 boot/recovery 回退资源不在
// 本退役范围内，必须保持随包。

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts: string[]): string => readFileSync(join(root, ...parts), 'utf8');
const json = <T>(...parts: string[]): T => JSON.parse(read(...parts)) as T;

const companionSyncSource = read('dsh-desktop', 'lib', 'desktop', 'companion-sync.ts');
const sidecarServer = read('tauri-shell', 'sidecar', 'server.ts');
const stageScript = read('tauri-shell', 'stage-resources.mjs');
const registrySource = read('dsh-desktop', 'lib', 'desktop', 'plugin-sync-registry.ts');

const companion = await import('../lib/desktop/companion-sync.js');
const registry = await import('../lib/desktop/plugin-sync-registry.js');

test('dsh-skin-switch asset package is no longer shipped (#415 A5)', () => {
  assert.equal(existsSync(join(root, 'dsh-desktop', 'assets', 'plugins', 'dsh-skin-switch')), false);
});

test('skin-switch moved from the companion registry to the retired builtin list', () => {
  const offered = companion.COMPANION_PLUGINS.map((p: { id: string }) => p.id);
  assert.equal(offered.includes('skin-switch'), false, 'skin-switch 必须退出配套插件注册表');
  assert.equal(
    offered.some((id: string) => id.startsWith('ui-skin-')),
    false,
    '旧版皮肤行（ui-skin-*）不得经 COMPANION_PLUGINS 注册',
  );
  const retired = companion.RETIRED_BUILTIN_PLUGINS as { id: string; name: string }[];
  assert.deepEqual(
    retired.find((p) => p.id === 'skin-switch'),
    { id: 'skin-switch', name: '@deepseek-ai/dsh-skin-switch' },
    'skin-switch 必须列入退役清单（启动时清理老 profile 残留行/包副本）',
  );
});

test('skin-directory synchronization (SKINS_DIR seeding) is removed', () => {
  assert.doesNotMatch(companionSyncSource, /SKINS_DIR/);
  assert.doesNotMatch(companionSyncSource, /DISABLED_SKINS/);
  assert.doesNotMatch(companionSyncSource, /skin\.json/);
  assert.equal((companion as Record<string, unknown>).SKINS_DIR, undefined);
  const syncBody = companionSyncSource.slice(companionSyncSource.indexOf('export function syncCompanionPlugins'));
  // 旧版皮肤行由 skin.json 的 wiring.id（ui-skin-*）派生 —— 派生链必须整体消失。
  assert.doesNotMatch(syncBody, /wiring/);
});

test('legacy skin choice hook is removed from the sync contract and the sidecar host', () => {
  // 只匹配真实代码用法（接口成员 / 调用点 / 注入属性）；历史注释允许提及（#415 A7）。
  assert.doesNotMatch(companionSyncSource, /applyLegacySkinChoice\s*[(:]/);
  assert.doesNotMatch(sidecarServer, /applyLegacySkinChoice\s*[(:]/);
});

test('offline ledgers no longer carry skin-switch (history keeps a retired baseline row)', () => {
  for (const file of [
    '.sync/plugins.json',
    '.sync/plugins.lock.json',
    '.sync/plugin-distribution.json',
  ]) {
    assert.doesNotMatch(read(...file.split('/') as [string, string]), /skin-switch/, `${file} 不得再有 skin-switch`);
  }
  // ISO-004 / ADR 0008 §5：资产移出当前 inventory 后「不得删除对应历史行」——
  // skin-switch 只以 state=retired 的基线行留在历史账本（id/path/patched 取自
  // 删除它的提交，不新造细节），分发集合与随包清单里都不得再出现。
  const history = json<{ plugins: { id: string; path: string; patched: boolean; state?: string }[] }>(
    '.sync', 'plugin-inventory-history.json',
  );
  assert.deepEqual(
    history.plugins.find((p) => p.id === 'skin-switch'),
    {
      id: 'skin-switch',
      path: 'dsh-desktop/assets/plugins/dsh-skin-switch',
      patched: false,
      state: 'retired',
    },
    'skin-switch 必须以退役基线行留在历史账本（而不是从账本里消失）',
  );
  const policies = json<{ pluginDistribution: { expectedCounts: Record<string, number> } }>('.sync', 'policies.json');
  const distribution = json<{ plugins: { id: string; distributionClass: string }[] }>(
    '.sync', 'plugin-distribution.json',
  );
  const builtinCount = distribution.plugins.filter((p) => p.distributionClass === 'builtin').length;
  assert.equal(policies.pluginDistribution.expectedCounts.builtin, builtinCount,
    'policies.expectedCounts.builtin 必须与 plugin-distribution 的 builtin 数一致');
  assert.equal(builtinCount, 11,
    '11 个内置插件 = dsh-desktop/assets/plugins 实物 + our-free-model（皮肤平台 14 包已外迁、plugin-manager/terminal/file-drop-eac 已退役；balance/plugin-wizard 实物不存在，ISO-004 改判 recommended/external）');
  // lock 的 manifestRevision 与被编辑后的 .sync/plugins.json 逐字节对应
  //（与 scripts/plugin-sync.mjs buildLock 的 sha256File 口径一致）。
  const lock = json<{ manifestRevision: string }>('.sync', 'plugins.lock.json');
  const digest = createHash('sha256').update(readFileSync(join(root, '.sync', 'plugins.json'))).digest('hex');
  assert.equal(lock.manifestRevision, digest);
});

test('generated runtime registry matches the retired set', () => {
  assert.doesNotMatch(registrySource, /skin-switch/);
  assert.equal((registry.DISTRIBUTION_BUILTIN_PLUGIN_IDS as string[]).includes('skin-switch'), false);
  assert.equal(Object.keys(registry.PLUGIN_SYNC_REGISTRY.entries ?? {}).includes('skin-switch'), false);
  // 更新源漏斗不受退役影响：skin-switch 本就没有 runtime update 源。
  assert.equal(Object.keys(registry.PLUGIN_UPDATE_SOURCES).includes('skin-switch'), false);
});

test('SOURCES.json drops the main-line skin-switch component, keeps aio-v1 history', () => {
  const sources = json<{ components: { id: string; line: string; name: string; path?: string }[] }>(
    'dsh-desktop', 'assets', 'SOURCES.json',
  );
  assert.equal(
    sources.components.some((c) => c.line === 'main' && (c.id === 'C038' || c.name === '@deepseek-ai/dsh-skin-switch')),
    false,
    'main 线不得再有 dsh-skin-switch 台账条目（目录已删，plugin-ledger 路径存在性要求）',
  );
  const historical = sources.components.find((c) => c.id === 'C079');
  assert.equal(historical?.line, 'aio-v1', 'aio-v1 历史线（C079）是 AIO v1 来源记录，不属于本次退役');
  assert.equal(historical?.name, '@deepseek-ai/dsh-skin-switch');
  assert.equal(historical?.path, 'assets/plugins/dsh-skin-switch');
});

test('staging drops the retired plugin but preserves the ADR 0010 manager fallback', () => {
  // 只看 BUILTIN_PLUGIN_DIRS 数组本体：历史注释允许提及退役插件（#415 A7）。
  const arrayMatch = /const BUILTIN_PLUGIN_DIRS = \[([\s\S]*?)\];/.exec(stageScript);
  assert.ok(arrayMatch, 'BUILTIN_PLUGIN_DIRS 清单必须存在');
  const stagedDirs = (arrayMatch![1].match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1));
  assert.equal(stagedDirs.includes('dsh-skin-switch'), false, '退役插件不得再随包装配');
  // EAC-CORE-SHELL-01：皮肤平台（loader + 13 款皮肤）已外迁，装配清单收敛为
  // 阶段 1-3 的内置插件（不含任何皮肤/加载器）。
  assert.equal(stagedDirs.includes('dsh-ui-skin-loader'), false, '皮肤加载器不得再随包装配（已外迁）');
  assert.equal(stagedDirs.includes('dsh-terminal'), false, '与内核同名的 terminal 不得再随包装配');
  assert.equal(stagedDirs.includes('dsh-plugin-manager'), false, '与内核同名的 plugin-manager 不得再随包装配');
  // ISO-003：eac-core-bridge 的端点生产者缺失（DSH_EAC_BRIDGE_URL/TOKEN 零写入方）
  // → 退役出装配清单（资产目录保留，等进程隔离接回）。
  assert.equal(stagedDirs.includes('dsh-eac-core-bridge'), false, 'ISO-003：Core Bridge 不得再随包装配');
  assert.equal(stagedDirs.length, 10, '装配清单应为 10 个内置插件（皮肤平台已外迁 + 3 个同名/内置重叠插件已退役 + ISO-003 core-bridge 退役 + our-free-model 接入）');
  // ADR 0010：壳层 ui-skin manager 钉版产物与 boot/recovery 回退资源必须随包。
  assert.match(stageScript, /ui-skin-manager/);
  assert.match(stageScript, /pinned UI skin manager artifacts staged/);
  assert.equal(existsSync(join(root, 'tauri-shell', 'skin-manager-artifact.lock.json')), true);
  assert.equal(existsSync(join(root, 'tauri-shell', 'host-profile.json')), true);
});
