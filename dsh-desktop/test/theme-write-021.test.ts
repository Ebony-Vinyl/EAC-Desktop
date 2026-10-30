import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { patchThemeWriteConvergeSource } = require('../scripts/patch-deps.js');
// MIT，来自官方 dsh-client-ui-theme@0.2.1-rc.2；保留真实多 role 方法，不模拟补丁实现。
const source = readFileSync(new URL('./fixtures/theme-methods-021.txt', import.meta.url), 'utf8');
const roles = ['text', 'code', 'terminal'];
const specs = {
  text: { field: 'fontSize', min: 10, max: 22 },
  code: { field: 'codeFontSize', min: 10, max: 16 },
  terminal: { field: 'terminalFontSize', min: 10, max: 20 },
};
const families = { text: 'textFontFamily', code: 'codeFontFamily', terminal: 'terminalFontFamily' };
type Op = { op: 'set'; path: string[]; value: unknown };

function harness() {
  const patched = patchThemeWriteConvergeSource(source);
  assert.ok(patched, '0.2.1 methods must be patched');
  const make = new Function('FONT_ROLES', 'FONT_SIZE_SPECS', 'FONT_FAMILY_FIELDS', 'THEME_PREFERENCE_FIELD',
    'isThemePreference', 'isFontSize', 'normalizeFontFamily', 'sectionFontSizes', 'durableFontFamilies',
    `return class { ${patched} }`);
  const Runtime = make(roles, specs, families, 'preference',
    (id: string) => ['light', 'dark', 'system'].includes(id),
    (role: keyof typeof specs, px: number) => Number.isInteger(px) && px >= specs[role].min && px <= specs[role].max,
    (value: string) => value.trim(),
    (section: Record<string, unknown>) => Object.fromEntries(roles.map(role => [role, section[specs[role as keyof typeof specs].field]])),
    (section: Record<string, unknown>) => Object.fromEntries(roles.map(role => [role, section[families[role as keyof typeof families]]])));
  const durable: Record<string, unknown> = {
    preference: 'dark', fontSize: 14, codeFontSize: 11, terminalFontSize: 13,
    textFontFamily: '', codeFontFamily: '', terminalFontFamily: '',
  };
  const writes: Op[][] = [];
  const pending: Array<{ ops: Op[]; resolve(value: boolean): void; reject(error: Error): void }> = [];
  const runtime = new Runtime();
  Object.assign(runtime, {
    preference: 'dark', fontSizes: { text: 14, code: 11, terminal: 13 },
    fontFamilies: { text: '', code: '', terminal: '' }, themes: [{ id: 'light' }, { id: 'dark' }],
    pendingWrites: 0, publish() {},
    host: {
      getSnapshot: () => ({ value: { ...durable } }),
      mutate(ops: Op[]) {
        writes.push(structuredClone(ops));
        return new Promise<boolean>((resolve, reject) => pending.push({ ops, resolve, reject }));
      },
    },
  });
  return {
    runtime, writes, durable,
    async settle(ok = true, rejected = false) {
      const next = pending.shift();
      assert.ok(next, 'expected one wire request');
      if (ok) for (const op of next.ops) durable[op.path[0]!] = op.value;
      if (rejected) next.reject(new Error('transport disconnected'));
      else next.resolve(ok);
      await Promise.resolve();
    },
  };
}

test('0.2.1 theme patch is atomic on anchor drift and idempotent', () => {
  const once = patchThemeWriteConvergeSource(source);
  assert.ok(once);
  assert.equal(patchThemeWriteConvergeSource(once), once);
  assert.equal(patchThemeWriteConvergeSource(source.replace('write(operation)', 'upstreamChanged(operation)')), undefined);
});

test('rapid preference changes fold into the in-flight value without extra writes', async () => {
  const h = harness();
  h.runtime.setTheme('light');
  h.runtime.setTheme('dark');
  h.runtime.setTheme('light');
  assert.equal(h.writes.length, 1);
  h.runtime.adopt();
  assert.equal(h.runtime.preference, 'light');
  await h.settle();
  assert.equal(h.writes.length, 1);
  assert.equal(h.durable.preference, 'light');
  assert.equal(h.runtime.pendingWrites, 0);
});

test('role font sizes, families and keyboard batch writes converge to the latest values', async () => {
  const h = harness();
  h.runtime.setTheme('light');
  h.runtime.setFontSize('text', 18);
  h.runtime.setFontSize('code', 15);
  h.runtime.setFontFamily('terminal', 'Consolas');
  h.runtime.adjustFontSizes(1);
  await h.settle();
  assert.equal(h.writes.length, 2);
  assert.deepEqual(Object.fromEntries(h.writes[1]!.map(op => [op.path[0], op.value])), {
    fontSize: 19, codeFontSize: 16, terminalFontFamily: 'Consolas', terminalFontSize: 14,
  });
  h.runtime.adopt();
  assert.equal(h.runtime.fontSizes.text, 19);
  await h.settle();
  assert.deepEqual(h.runtime.fontSizes, { text: 19, code: 16, terminal: 14 });
  assert.equal(h.runtime.fontFamilies.terminal, 'Consolas');
});

for (const rejected of [false, true]) {
  test(`a ${rejected ? 'rejected transport' : 'refused mutation'} clears queued writes and adopts durable settings`, async () => {
    const h = harness();
    h.runtime.setFontSize('code', 15);
    h.runtime.setFontSize('code', 16);
    h.durable.preference = 'light';
    await h.settle(false, rejected);
    assert.equal(h.runtime.pendingWrites, 0);
    assert.equal(h.writes.length, 1);
    assert.equal(h.runtime.fontSizes.code, 11);
    assert.equal(h.runtime.preference, 'light');
    h.runtime.setFontSize('code', 14);
    await h.settle();
    assert.equal(h.runtime.fontSizes.code, 14);
  });
}

test('role validation and font-size boundaries remain upstream-owned', () => {
  const h = harness();
  assert.throws(() => h.runtime.setFontSize('code', 17), /outside/);
  assert.throws(() => h.runtime.setFontSize('text', 14.5), /outside/);
  assert.throws(() => h.runtime.setTheme('unknown'), /not registered/);
  assert.equal(h.writes.length, 0);
});
