import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRpmPackage } from '../scripts/audit-rpm-package.mjs';

const repositoryRoot = join(fileURLToPath(new URL('../..', import.meta.url)));
const linuxConfig = JSON.parse(
  readFileSync(join(repositoryRoot, 'tauri-shell', 'tauri.linux.conf.json'), 'utf8'),
) as { bundle?: { targets?: string[] } };
const installerWorkflow = readFileSync(
  join(repositoryRoot, '.github', 'workflows', 'staged-runtime-artifact.yml'),
  'utf8',
);
const rpmAudit = readFileSync(
  join(repositoryRoot, 'dsh-desktop', 'scripts', 'audit-rpm-package.mjs'),
  'utf8',
);

test('Linux Tauri bundle explicitly includes RPM alongside deb and AppImage', () => {
  assert.deepEqual(linuxConfig.bundle?.targets, ['deb', 'appimage', 'rpm']);
});

test('Linux installer workflow installs RPM tooling and uploads RPM artifacts', () => {
  const linuxDeps = installerWorkflow.match(
    /Install Linux Tauri dependencies[\s\S]*?run: ([^\n]+)/,
  )?.[1] || '';
  assert.match(linuxDeps, /\brpm\b/);
  assert.match(installerWorkflow, /rpm --version && rpmbuild --version/);
  const linuxUpload = installerWorkflow.match(
    /Upload Linux installer packages[\s\S]*?path:([\s\S]*?)if-no-files-found:/,
  )?.[1] || '';
  assert.match(linuxUpload, /bundle\/rpm\/EAC-Lite-\*\.rpm/);
});

test('RPM audit checks metadata, architecture, runtime closure, and forbidden payloads', () => {
  assert.match(rpmAudit, /'-qip'/);
  assert.match(rpmAudit, /\['-qlp'\]/);
  assert.match(rpmAudit, /aarch64/);
  assert.match(rpmAudit, /x86_64/);
  assert.match(rpmAudit, /sidecar\/server\.js/);
  assert.match(rpmAudit, /ui-skin-manager\/resolved\/system\.default\/snapshot\.json/);
  assert.match(rpmAudit, /musl/);
});

test('RPM audit validator accepts the staged runtime closure and rejects bad payloads', () => {
  const files = [
    '/usr/lib/deepseek-harness-eac/sidecar/server.js',
    '/usr/lib/deepseek-harness-eac/sidecar/bridge.js',
    '/usr/lib/deepseek-harness-eac/dsh-desktop/package.json',
    '/usr/lib/deepseek-harness-eac/dsh-desktop/vendor/node/node',
    '/usr/lib/deepseek-harness-eac/ui-skin-manager/resolved/system.default/snapshot.json',
  ];
  const version = JSON.parse(readFileSync(join(repositoryRoot, 'dsh-desktop/package.json'), 'utf8')).version;
  const info = { name: 'deepseek-harness-eac', version, release: '1', arch: 'x86_64' };
  assert.deepEqual(validateRpmPackage(info, files, { arch: 'x64' }), {
    name: info.name, version: info.version, release: info.release, arch: info.arch, files: files.length,
  });
  assert.throws(() => validateRpmPackage(info, [...files, '/usr/lib/deepseek-harness-eac/dsh-desktop/node_modules/foo/bin/musl/system.node'], { arch: 'x64' }), /不可达平台载荷/);
  assert.throws(() => validateRpmPackage({ ...info, arch: 'aarch64' }, files, { arch: 'x64' }), /架构错误/);
});

test('RPM audit reads large query output completely', { skip: process.platform === 'win32' }, (t) => {
  const root = mkdtempSync(join(tmpdir(), 'rpm-audit-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const version = JSON.parse(readFileSync(join(repositoryRoot, 'dsh-desktop/package.json'), 'utf8')).version;
  const required = [
    'sidecar/server.js',
    'sidecar/bridge.js',
    'dsh-desktop/package.json',
    'dsh-desktop/vendor/node/node',
    'ui-skin-manager/resolved/system.default/snapshot.json',
  ].map((entry) => `/usr/lib/deepseek-harness-eac/${entry}`);
  const files = Array.from({ length: 35000 }, (_, index) =>
    `/usr/lib/deepseek-harness-eac/dsh-desktop/node_modules/package-${index}/dist/index.js`);
  // Keep mandatory files and forbidden payloads at the end to catch truncated reads.
  files.push(...required);
  const listing = `${files.join('\n')}\n`;
  assert.ok(Buffer.byteLength(listing) > 1024 * 1024);
  const rpmFile = join(root, 'fixture package.rpm');
  writeFileSync(rpmFile, listing);
  writeFileSync(join(root, 'rpm'), `#!/usr/bin/env node
const fs = require('node:fs');
if (process.argv[2] === '-qip') {
  process.stdout.write(${JSON.stringify(`name=deepseek-harness-eac\nversion=${version}\nrelease=1\narch=x86_64\n`)});
} else if (process.argv[2] === '-qlp') {
  process.stdout.write(fs.readFileSync(process.argv.at(-1)));
} else {
  process.exitCode = 2;
}
`, { mode: 0o755 });
  const audit = () => execFileSync(process.execPath, [
    join(repositoryRoot, 'dsh-desktop/scripts/audit-rpm-package.mjs'), rpmFile, '--arch=x64',
  ], { encoding: 'utf8', env: { ...process.env, PATH: `${root}:${process.env.PATH}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(audit(), new RegExp(`files=${files.length}\\b`));
  writeFileSync(rpmFile, `${listing}/usr/lib/deepseek-harness-eac/unexpected.exe\n`);
  assert.throws(audit, /不可达平台载荷/);
});
