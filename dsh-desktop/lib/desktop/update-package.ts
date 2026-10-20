import fs = require('node:fs');
import fsp = require('node:fs/promises');
import path = require('node:path');
import crypto = require('node:crypto');
import {plainPath, writeDurableJson} from './update-backup';
export const PORTABLE_ITEMS = ['dsh-eac-shell.exe', 'sidecar', 'dsh-desktop', 'ui-skin-manager', 'dpx', '.dsh-portable', 'WebView2Loader.dll', 'eac-installation.json', 'eac-release-files.json'] as const;
export interface ReleaseFile {path: string; size: number; sha256: string;}
export interface ReleaseFiles {schemaVersion: 1; product: 'eac-desktop'; version: string; target: string; files: ReleaseFile[];}
export function safeRelative(value: string): string {
  if (!value || value.includes('\\') || /[<>:"|?*\x00-\x1f]/.test(value) || path.posix.isAbsolute(value)) throw new Error('update-package-path-invalid');
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('update-package-path-invalid');
  return value;
}
export function parseReleaseFiles(value: unknown, version?: string, target?: string): ReleaseFiles {
  if (!value || typeof value !== 'object') throw new Error('update-package-manifest-invalid');
  const m = value as Record<string, unknown>;
  if (m.schemaVersion !== 1 || m.product !== 'eac-desktop' || typeof m.version !== 'string' || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(m.version)
    || typeof m.target !== 'string' || !/^windows-(x86_64|aarch64)-portable$/.test(m.target) || !Array.isArray(m.files) || !m.files.length || m.files.length > 200000
    || (version !== undefined && version !== m.version) || (target !== undefined && target !== m.target)) throw new Error('update-package-manifest-invalid');
  const seen = new Set<string>();
  const files: ReleaseFile[] = m.files.map(value => {
    const f = value as Partial<ReleaseFile>;
    if (!f || typeof f.path !== 'string') throw new Error('update-package-manifest-invalid');
    const relative = safeRelative(f.path); const key = relative.toLowerCase();
    if (!(PORTABLE_ITEMS as readonly string[]).includes(relative.split('/')[0]!) || relative === 'eac-release-files.json'
      || seen.has(key) || !Number.isSafeInteger(f.size) || Number(f.size) < 0 || typeof f.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(f.sha256)) throw new Error('update-package-manifest-invalid');
    seen.add(key); return {path: relative, size: Number(f.size), sha256: f.sha256};
  });
  for (const required of ['dsh-eac-shell.exe', '.dsh-portable', 'sidecar/server.js', 'sidecar/bridge.js', 'dsh-desktop/package.json', 'dpx/src/index.js', 'ui-skin-manager/resolved/system.default/snapshot.json']) {
    if (!seen.has(required)) throw new Error('update-package-closure-incomplete');
  }
  for (const file of files) {
    const components = file.path.toLowerCase().split('/');
    for (let i = 1; i < components.length; i++) if (seen.has(components.slice(0, i).join('/'))) throw new Error('update-package-path-collision');
  }
  return {schemaVersion: 1, product: 'eac-desktop', version: m.version, target: m.target, files};
}
export async function hashFile(file: string, signal?: AbortSignal): Promise<string> {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file,signal ? {signal} : {})) hash.update(chunk);
  return hash.digest('hex');
}
export async function treeFiles(root: string, signal?: AbortSignal): Promise<Array<{path: string; size: number}>> {
  const entries: Array<{path: string; size: number}> = [];
  await plainPath(root);
  const walk = async (relative: string): Promise<void> => {
    signal?.throwIfAborted();
    const location = path.join(root, ...relative.split('/').filter(Boolean));
    const stat = await fsp.lstat(location);
    if (stat.isSymbolicLink()) throw new Error('update-package-tree-link');
    if (stat.isDirectory()) {
      for (const name of (await fsp.readdir(location)).sort()) await walk(relative ? relative + '/' + name : name);
    } else if (stat.isFile()) entries.push({path: safeRelative(relative), size: stat.size});
    else throw new Error('update-package-special-file');
  };
  await walk(''); return entries;
}
export async function makeReleaseFiles(root: string, version: string, target: string): Promise<ReleaseFiles> {
  const files: ReleaseFile[] = [];
  for (const entry of await treeFiles(root)) {
    if (entry.path === 'eac-release-files.json') continue;
    if (!(PORTABLE_ITEMS as readonly string[]).includes(entry.path.split('/')[0]!)) throw new Error('update-package-unowned-top-level');
    files.push({...entry, sha256: await hashFile(path.join(root, ...entry.path.split('/')))});
  }
  const manifest = parseReleaseFiles({schemaVersion: 1, product: 'eac-desktop', version, target, files});
  await writeDurableJson(path.join(root, 'eac-release-files.json'), manifest); return manifest;
}
export async function verifyReleaseTree(root: string, manifest: ReleaseFiles, additional: ReleaseFile[] = [], signal?: AbortSignal): Promise<void> {
  const known = new Map([...manifest.files, ...additional].map(file => [file.path.toLowerCase(), file]));
  const seen = new Set<string>();
  for (const entry of await treeFiles(root,signal)) {
    signal?.throwIfAborted();
    if (entry.path === 'eac-release-files.json') continue;
    const file = known.get(entry.path.toLowerCase());
    if (!file || seen.has(entry.path.toLowerCase()) || file.path !== entry.path || file.size !== entry.size || await hashFile(path.join(root, ...entry.path.split('/')),signal) !== file.sha256) throw new Error('update-package-tree-mismatch');
    seen.add(entry.path.toLowerCase());
  }
  if (seen.size !== known.size) throw new Error('update-package-tree-incomplete');
  const pkg = JSON.parse(await fsp.readFile(path.join(root, 'dsh-desktop', 'package.json'), 'utf8')) as {version?: string};
  if (pkg.version !== manifest.version) throw new Error('update-package-version-mismatch');
}

export async function treeEmptyDirectories(root: string): Promise<string[]> {
  const directories: string[] = [];
  const visit = async (relative: string): Promise<void> => {
    const location = path.join(root,...relative.split('/').filter(Boolean));
    await plainPath(location); const stat = await fsp.lstat(location);
    if (!stat.isDirectory()) return;
    const names = await fsp.readdir(location);
    if (relative && !names.length) directories.push(safeRelative(relative));
    for (const name of names) await visit(relative ? relative+'/'+name : name);
  };
  await visit(''); return directories;
}
