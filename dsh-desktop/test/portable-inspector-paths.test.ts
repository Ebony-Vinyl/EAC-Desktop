import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const relative = 'dsh-desktop/node_modules/@deepseek-ai/dsh-experimental-inspector/lib/devtools';
const source = path.join(desktop, relative.slice('dsh-desktop/'.length));
const prefix = 'models/issues_manager/descriptions/';
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const { shortenInspectorDescriptionPaths } = await import('../../tauri-shell/portable-path-shrink.mjs');

function fixture(t: any) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eac-inspector-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const devtools = path.join(root, relative);
  fs.cpSync(source, devtools, { recursive: true });
  return { root, devtools };
}

test('portable Inspector keeps every real resource and resolves Issues Markdown in page and worker contexts', async t => {
  const { root, devtools } = fixture(t);
  const originalManifest = fs.readFileSync(path.join(source, 'resource-manifest.json'));
  const before = JSON.parse(originalManifest.toString());
  const descriptions = before.files.filter((entry: any) => entry.path.startsWith(prefix));
  assert.ok(descriptions.length > 0);
  assert.ok(Math.max(...descriptions.map((entry: any) => `${relative}/${entry.path}`.length)) > 154);
  assert.equal(shortenInspectorDescriptionPaths(root).moved, descriptions.length);
  const after = JSON.parse(fs.readFileSync(path.join(devtools, 'resource-manifest.json'), 'utf8'));
  assert.equal(after.files.length, before.files.length);
  for (let i = 0; i < after.files.length; i++) {
    const entry = after.files[i];
    const bytes = fs.readFileSync(path.join(devtools, entry.path));
    assert.equal(bytes.length, entry.bytes, entry.path);
    assert.equal(digest(bytes), entry.sha256, entry.path);
    assert.ok(`${relative}/${entry.path}`.length <= 154, entry.path);
    if (before.files[i].path.startsWith(prefix)) assert.equal(digest(bytes), before.files[i].sha256);
  }

  const chunk = after.files.find((entry: any) => /^chunks\/issues_manager-.*\.js$/.test(entry.path));
  const text = fs.readFileSync(path.join(devtools, chunk.path), 'utf8');
  const reference = text.indexOf('`../../i/');
  assert.ok(reference > 0);
  const start = text.lastIndexOf('async function ', reference);
  const loader = text.slice(start, text.indexOf('\n}', reference) + 2);
  const name = /async function (\w+)/.exec(loader)![1];
  const fetchName = /return await (\w+)\(/.exec(loader)![1];
  for (const worker of [false, true]) {
    const load = vm.runInNewContext(`${loader}; ${name}`, {
      URL,
      ...(worker ? { self: { location: { href: 'https://example.test/inspector/devtools/entrypoints/worker/worker.js' } } }
        : { document: { baseURI: 'https://example.test/inspector/devtools/devtools_app.html' } }),
      [fetchName]: async (url: URL) => {
        assert.ok(url.pathname.startsWith('/inspector/devtools/i/'), url.href);
        return fs.readFileSync(path.join(devtools, url.pathname.slice('/inspector/devtools/'.length)));
      },
    });
    for (const entry of descriptions) assert.equal(digest(await load(entry.path.slice(prefix.length))), entry.sha256);
  }
  const transformed = fs.readFileSync(path.join(devtools, 'resource-manifest.json'));
  assert.deepEqual(shortenInspectorDescriptionPaths(root), { moved: 0 });
  assert.deepEqual(fs.readFileSync(path.join(devtools, 'resource-manifest.json')), transformed);
  assert.deepEqual(fs.readFileSync(path.join(source, 'resource-manifest.json')), originalManifest);
  assert.equal(digest(fs.readFileSync(path.join(source, chunk.path))), before.files.find((entry: any) => entry.path === chunk.path).sha256);
});

for (const failure of ['destination', 'reference'] as const) {
  test(`portable Inspector rejects ${failure} drift before moving resources`, t => {
    const { root, devtools } = fixture(t);
    const manifestPath = path.join(devtools, 'resource-manifest.json');
    const manifest = fs.readFileSync(manifestPath);
    if (failure === 'destination') fs.mkdirSync(path.join(devtools, 'i'));
    else {
      const entry = JSON.parse(manifest.toString()).files.find((entry: any) => /^chunks\/issues_manager-.*\.js$/.test(entry.path));
      const file = path.join(devtools, entry.path);
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('`descriptions/', '`changed/'));
    }
    assert.throws(() => shortenInspectorDescriptionPaths(root), /inspector-shorten:/);
    assert.ok(fs.existsSync(path.join(devtools, prefix)));
    assert.deepEqual(fs.readFileSync(manifestPath), manifest);
  });
}
