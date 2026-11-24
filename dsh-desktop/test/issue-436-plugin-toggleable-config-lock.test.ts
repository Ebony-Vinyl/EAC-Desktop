import test from 'node:test';
import assert from 'node:assert/strict';
import { collectPluginRows } from '../plugin-manager-state.js';
import { PLUGIN_DISTRIBUTION_CLASSES } from '../lib/desktop/plugin-sync-registry.js';

test('#436 regression: enabled non-core plugin with top-level config remains toggleable across disable/heal/re-enable lifecycle', () => {
  const classes = PLUGIN_DISTRIBUTION_CLASSES as Record<string, string>;

  // Stage A: initial insert row without top-level config -> enabled & toggleable.
  const [stageA] = collectPluginRows(
    [{ insert: [{ id: 'dsh-pet', name: 'dsh-pet' }] }],
    { distributionClasses: classes },
  ) as any[];
  assert.equal(stageA.enabled, true);
  assert.equal(stageA.toggleable, true);

  // Stage B/C: disabled top-level row after patch-row-heal populated `config: {}`.
  const [stageC] = collectPluginRows(
    [{ id: 'dsh-pet', name: 'dsh-pet', disabled: true, config: { scale: 1 } }],
    { distributionClasses: classes },
  ) as any[];
  assert.equal(stageC.enabled, false);
  assert.equal(stageC.toggleable, true);

  // Stage D: re-enabled top-level row keeps `config` without `disabled` -> must STILL be toggleable!
  const [stageD] = collectPluginRows(
    [{ id: 'dsh-pet', name: 'dsh-pet', config: { scale: 1 } }],
    { distributionClasses: classes },
  ) as any[];
  assert.equal(stageD.enabled, true);
  assert.equal(stageD.toggleable, true, 'top-level config on an enabled non-core row must not lock toggleable');
});

test('#436 boundary: recommended and external plugins with config stay toggleable while builtin/core/removed stay locked', () => {
  const classes = PLUGIN_DISTRIBUTION_CLASSES as Record<string, string>;

  const rows = collectPluginRows(
    [
      { id: 'balance', name: '@deepseek-ai/dsh-balance', config: { showCurrency: true } },
      { id: 'custom-community-plugin', name: 'custom-community-plugin', config: { foo: 'bar' } },
      { id: 'file-changes', name: '@deepseek-ai/dsh-file-changes', config: {} },
    ],
    {
      companion: [
        { id: 'file-changes', name: '@deepseek-ai/dsh-file-changes' },
        { id: 'removed-opt', name: 'removed-opt' },
      ],
      removedIds: ['removed-opt'],
      bundles: ['@deepseek-ai/dsh-web-app'],
      distributionClasses: classes,
    },
  ) as any[];

  const byId = new Map(rows.map((row) => [row.id, row]));

  // Recommended row with top-level config: unlocked.
  assert.equal(byId.get('balance')?.distributionClass, 'recommended');
  assert.equal(byId.get('balance')?.enabled, true);
  assert.equal(byId.get('balance')?.toggleable, true);

  // External community row with top-level config: unlocked.
  assert.equal(byId.get('custom-community-plugin')?.distributionClass, 'external');
  assert.equal(byId.get('custom-community-plugin')?.enabled, true);
  assert.equal(byId.get('custom-community-plugin')?.toggleable, true);

  // Builtin row with top-level config: remains locked.
  assert.equal(byId.get('file-changes')?.distributionClass, 'builtin');
  assert.equal(byId.get('file-changes')?.toggleable, false);

  // Kernel skeleton bundle: remains locked.
  assert.equal(byId.get('dsh-web-app')?.group, 'core');
  assert.equal(byId.get('dsh-web-app')?.toggleable, false);

  // Removed companion row: remains locked.
  assert.equal(byId.get('removed-opt')?.removed, true);
  assert.equal(byId.get('removed-opt')?.toggleable, false);
});
