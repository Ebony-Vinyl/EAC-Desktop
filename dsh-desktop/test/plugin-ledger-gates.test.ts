import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(desktopRoot, '..');

test('plugin-ledger.mjs validates SOURCES.json without duplicate IDs or malformed baselines', () => {
  const output = execFileSync(
    process.execPath,
    [join(desktopRoot, 'scripts', 'plugin-ledger.mjs')],
    { cwd: desktopRoot, encoding: 'utf8' },
  );
  assert.match(output, /\[plugin-ledger\] 校验通过/);
});

test('plugin-sync.mjs validate passes across inventory, distribution, lock, and generated registry', () => {
  const output = execFileSync(
    process.execPath,
    [join(desktopRoot, 'scripts', 'plugin-sync.mjs'), 'validate'],
    { cwd: desktopRoot, encoding: 'utf8' },
  );
  assert.match(output, /^lock valid: entries=\d+/m);
});

test('overlay guard identity points to its own source ledger entry', () => {
  const identity = JSON.parse(readFileSync(
    join(desktopRoot, 'assets', 'plugins', 'dsh-overlay-guard', 'dsh-plugin.json'), 'utf8',
  ));
  const ledger = JSON.parse(readFileSync(join(desktopRoot, 'assets', 'SOURCES.json'), 'utf8'));
  const component = ledger.components.find(
    (entry: { id: string }) => identity['x-eac'].ledger === `assets/SOURCES.json#${entry.id}`,
  );
  assert.equal(component?.name, 'dsh-overlay-guard');
  assert.equal(component?.path, 'dsh-desktop/assets/plugins/dsh-overlay-guard');
  assert.equal(component?.version, identity.version);
});

test('ADR 0008 delegates distribution counts to .sync/plugin-distribution.json without stale hardcoded totals', () => {
  const adr = readFileSync(
    join(repoRoot, 'docs', 'adr', '0008-plugin-distribution-boundary.md'),
    'utf8',
  );
  assert.match(adr, /\.sync\/plugin-distribution\.json/);
  assert.match(adr, /plugin-sync\.mjs validate/);
  assert.doesNotMatch(
    adr,
    /\b(?:16\s*builtin|10\s*builtin|固定为\s*16\/14\/19|=\s*49\b|=\s*45\b)/,
    'ADR 0008 must not carry stale hardcoded tier totals that drift from the ledger',
  );
});

test('desktop-recommended.pack.json is explicitly marked frozen while recommended sources remain pending', () => {
  const pack = JSON.parse(
    readFileSync(join(repoRoot, '.sync', 'packs', 'desktop-recommended.pack.json'), 'utf8'),
  );
  const distribution = JSON.parse(
    readFileSync(join(repoRoot, '.sync', 'plugin-distribution.json'), 'utf8'),
  );
  const recommendedIds = distribution.plugins
    .filter((entry: { distributionClass: string }) => entry.distributionClass === 'recommended')
    .map((entry: { id: string }) => entry.id)
    .sort();

  assert.equal(pack.version, '0.0.0-frozen');
  assert.equal(pack['x-eac']?.status, 'draft');
  assert.match(String(pack.description || ''), /\[FROZEN\]/);
  assert.deepEqual([...(pack['x-eac']?.intendedPluginIds || [])].sort(), recommendedIds);
});
