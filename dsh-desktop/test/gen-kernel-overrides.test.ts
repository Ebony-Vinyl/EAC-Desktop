// gen-kernel-overrides 契约：内核升版后上游会移除/改名包，生成器必须把
// 「已声明但缓存中没有 tarball」的直接依赖从 dependencies 和 overrides 中
// 一并剔除（仅限 KERNEL_REMOVED_PACKAGES 白名单内），其余缺失仍硬错误。
// 0.1.7-rc.2 实测移除：code-runtime / agent-presets / e2b 家族等 9 包。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyKernelSpecs, KERNEL_DEP_GAPS } from '../scripts/gen-kernel-overrides.js';

const V = 'file:vendor/kernel/0.1.7-rc.2/';
// 覆盖全部缺口包，保证测试直接命中 deps/overrides 改写与剔除逻辑本身。
const SPECS = new Map<string, string>([
  ['@deepseek-ai/dsh', V + 'deepseek-ai-dsh-0.1.7-rc.2.tgz'],
  ['@deepseek-ai/dsh-compaction', V + 'deepseek-ai-dsh-compaction-0.1.7-rc.2.tgz'],
  ...KERNEL_DEP_GAPS.map((name) => [name, V + 'deepseek-ai-' + name.slice('@deepseek-ai/'.length) + '-0.1.7-rc.2.tgz']),
]);

test('已移除包从 dependencies 与 overrides 一并剔除', () => {
  const manifest = {
    dependencies: {
      '@deepseek-ai/dsh': 'file:vendor/kernel/0.1.5-rc.2/deepseek-ai-dsh-0.1.5-rc.2.tgz',
      '@deepseek-ai/dsh-code-runtime': 'file:vendor/kernel/0.1.5-rc.2/deepseek-ai-dsh-code-runtime-0.1.5-rc.2.tgz',
      archiver: '^7.0.1',
    },
    overrides: {
      '@deepseek-ai/dsh': 'file:vendor/kernel/0.1.5-rc.2/deepseek-ai-dsh-0.1.5-rc.2.tgz',
      '@deepseek-ai/dsh-code-runtime': 'file:vendor/kernel/0.1.5-rc.2/deepseek-ai-dsh-code-runtime-0.1.5-rc.2.tgz',
      glob: '10.5.0',
    },
  };
  const result = applyKernelSpecs(manifest, SPECS);
  assert.equal(result.removed.length, 1);
  assert.equal(result.removed[0], '@deepseek-ai/dsh-code-runtime');
  assert.ok(!('@deepseek-ai/dsh-code-runtime' in manifest.dependencies));
  assert.ok(!('@deepseek-ai/dsh-code-runtime' in manifest.overrides));
  // 安全钉必须保留
  assert.equal(manifest.overrides.glob, '10.5.0');
  // 存活内核包被改写为新 spec
  assert.equal(manifest.dependencies['@deepseek-ai/dsh'], SPECS.get('@deepseek-ai/dsh'));
});

test('非白名单的缓存缺失包仍然硬错误', () => {
  const manifest = {
    dependencies: { '@deepseek-ai/dsh-not-in-kernel': 'file:vendor/kernel/0.1.5-rc.2/x.tgz' },
    overrides: {},
  };
  assert.throws(() => applyKernelSpecs(manifest, SPECS), /没有对应 tarball/);
});

const REMOVED_021 = [
  '@deepseek-ai/dsh-experimental-schedule-bundle',
  '@deepseek-ai/dsh-invariants',
  '@deepseek-ai/dsh-subagent-in-process-driver',
];

test('0.2.1-rc.2 移除包被清理，重复生成幂等且保留安全钉', () => {
  const removedSpecs = Object.fromEntries(REMOVED_021.map((name) => [name, 'file:vendor/kernel/0.2.0-rc.2/old.tgz']));
  const manifest = {
    dependencies: { ...removedSpecs, '@deepseek-ai/dsh': 'file:vendor/kernel/0.2.0-rc.2/old.tgz' },
    overrides: { ...removedSpecs, glob: '10.5.0', qs: '6.16.0' },
  };
  const result = applyKernelSpecs(manifest, SPECS);
  assert.deepEqual(result.removed, REMOVED_021);
  for (const name of REMOVED_021) {
    assert.ok(!(name in manifest.dependencies), name);
    assert.ok(!(name in manifest.overrides), name);
  }
  assert.equal(manifest.overrides.glob, '10.5.0');
  assert.equal(manifest.overrides.qs, '6.16.0');
  const once = structuredClone(manifest);
  assert.deepEqual(applyKernelSpecs(manifest, SPECS).removed, []);
  assert.deepEqual(manifest, once);
});

test('回构旧内核时保留缓存中仍存在的 0.2.1 移除包', () => {
  const specs = new Map([...SPECS, ...REMOVED_021.map((name) => [name, V + name.slice('@deepseek-ai/'.length) + '.tgz'] as [string, string])]);
  const manifest = {
    dependencies: Object.fromEntries(REMOVED_021.map((name) => [name, 'old-spec'])),
    overrides: {},
  };
  assert.deepEqual(applyKernelSpecs(manifest, specs).removed, []);
  for (const name of REMOVED_021) {
    assert.equal(manifest.dependencies[name], specs.get(name));
    assert.equal((manifest.overrides as Record<string, string>)[name], specs.get(name));
  }
});

test('KERNEL_REMOVED_PACKAGES 覆盖历次升级已确认移除的包', () => {
  const removed = [
    '@deepseek-ai/dsh-code-runtime',
    '@deepseek-ai/dsh-agent-presets',
    '@deepseek-ai/dsh-code-runtime-worker-thread',
    '@deepseek-ai/dsh-e2b',
    '@deepseek-ai/dsh-experimental-agent-team-web-profile',
    '@deepseek-ai/dsh-fs-e2b',
    '@deepseek-ai/dsh-settings-file',
    '@deepseek-ai/dsh-subprocess-e2b',
    '@deepseek-ai/dsh-workflow-worker-thread',
    ...REMOVED_021,
  ];
  assert.equal(applyKernelSpecs.REMOVED_SET.size, removed.length);
  for (const name of removed) assert.ok(applyKernelSpecs.REMOVED_SET.has(name), name);
});
