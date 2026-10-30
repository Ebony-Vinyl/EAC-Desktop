import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { hasTransactionalProfileRecompose, patchAppBootReconcileGateSource, patchConfigEditorEditShortCircuitSource } = require('../scripts/patch-deps.js');
const file = new URL('../node_modules/@deepseek-ai/dsh-app-boot/lib/index.js', import.meta.url);
const source = existsSync(file) ? readFileSync(file, 'utf8') : '';
const native = hasTransactionalProfileRecompose(source);

// 执行安装树中的真实事务函数；只替换 Loader/IO 边界，不重写失败判定算法。
function harness() {
  const start = source.indexOf('async function reconcileProfilePatches(');
  const end = source.indexOf('/** The ids of the rows', start);
  assert.ok(start >= 0 && end > start);
  const row = { options: { id: 'settings' }, fiber: { uid: 'settings', state: 2, async await() {} } };
  let failures: any[] = [];
  let updateError: Error | undefined;
  let disposalError: Error | undefined;
  let updated = 0;
  let resumed = 0;
  let prepared = 0;
  let onUpdate = () => {};
  const ctx = { loader: { entries: () => [row], async await() {} }, get: () => undefined, emit() {} };
  row.fiber.await = async () => { if (disposalError) throw disposalError; };
  const include = {
    options: { config: { path: './cordis.yml', patches: [] } },
    parent: { tree: { ctx: { baseUrl: 'file:///profile/' } } },
    async update() { updated++; if (updateError) throw updateError; onUpdate(); },
  };
  const make = new Function('bootstrapIncludes', 'inactiveEntries', 'prepareProfilePatches', 'resume',
    'FIBER_FAILED', 'FIBER_DISPOSED', 'ProfileRuntimeResolution', 'activationDiagnostic', 'reloadDiagnostic',
    source.slice(start, end) + '\nreturn reconcileProfilePatches;');
  const reconcile = make(new Map([[ctx, include]]), async () => failures,
    (_ctx: unknown, patches: unknown) => { prepared++; return patches; },
    async () => { resumed++; }, 3, 4, class {},
    () => 'required plugin failed', (failure: any) => failure.outcome.message);
  return {
    row, ctx, reconcile,
    fail() { failures = [{ entry: row, outcome: { kind: 'failed', message: 'broken settings' } }]; },
    afterUpdate(fn: () => void) { onUpdate = fn; },
    updateFails(error: Error) { updateError = error; },
    disposalFails(error: Error) { disposalError = error; },
    counts: () => ({ updated, resumed, prepared }),
  };
}

test('0.2.1 native recompose retires the old gate without modifying upstream', { skip: !native }, () => {
  assert.equal(patchAppBootReconcileGateSource(source), source);
  const original = '\t\t\t\tconst beforePatches = readProfilePatches("dsh", this.ownerContext.profileContext);\n'
    + '\t\t\t\tawait reconcileProfilePatches(this.ownerContext.root, beforePatches, "dsh");\n'
    + '\t\t\t\tif (!this.entries().includes(entry)) throw new Error("Configuration entry changed during reload");';
  const legacy = patchConfigEditorEditShortCircuitSource(original);
  assert.notEqual(legacy, original);
  assert.equal(patchConfigEditorEditShortCircuitSource(legacy, source), original);
  assert.equal(patchConfigEditorEditShortCircuitSource(original, source), original);
});

test('unchanged patches still preflight and reconcile the current Loader tree', { skip: !native }, async () => {
  const h = harness();
  assert.deepEqual(await h.reconcile(h.ctx, [], 'dsh'), []);
  assert.deepEqual(h.counts(), { updated: 1, resumed: 1, prepared: 1 });
});

test('required plugin failure rejects even if it existed before an unchanged reload', { skip: !native }, async () => {
  const h = harness();
  h.fail();
  await assert.rejects(h.reconcile(h.ctx, [], 'dsh', ['settings']), /required plugin failed/);
});

test('unrelated existing failures remain diagnostic while newly introduced failures reject', { skip: !native }, async () => {
  const existing = harness();
  existing.fail();
  assert.deepEqual(await existing.reconcile(existing.ctx, [], 'dsh'), ['broken settings']);
  const introduced = harness();
  introduced.afterUpdate(() => introduced.fail());
  await assert.rejects(introduced.reconcile(introduced.ctx, [], 'dsh'), /required plugin failed/);
});

test('Loader update failure still resumes entries and propagates the original error', { skip: !native }, async () => {
  const h = harness();
  h.updateFails(new Error('update failed'));
  await assert.rejects(h.reconcile(h.ctx, [], 'dsh'), /update failed/);
  assert.equal(h.counts().resumed, 1);
});

test('a healthy fiber disposal failure cannot be reported as a successful reload', { skip: !native }, async () => {
  const h = harness();
  h.disposalFails(new Error('dispose failed'));
  await assert.rejects(h.reconcile(h.ctx, [], 'dsh'), /dispose failed/);
});
