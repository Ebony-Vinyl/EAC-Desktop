import fs = require('node:fs');
import fsp = require('node:fs/promises');
import path = require('node:path');
import crypto = require('node:crypto');
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
export interface BackupRoot {id: string; path: string; required: boolean; exclude?: string[];}
export interface BackupManifest {
  schemaVersion: 1;
  roots: Array<{id: string; path: string; present: boolean}>;
  files: Array<{rootId: string; relative: string; size: number; sha256: string}>;
  links: Array<{rootId: string; relative: string; target: string}>;
  exclusions: Array<{rootId: string; path: string}>;
  totalBytes: number;
}
export function pathsOverlap(a: string, b: string): boolean {
  const normalize = (p: string) => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
  const contains = (parent: string, child: string) => {
    const relative = path.relative(parent, child);
    return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
  };
  return contains(normalize(a), normalize(b)) || contains(normalize(b), normalize(a));
}
export async function plainPath(file: string, allowMissing = false): Promise<string> {
  if (!path.isAbsolute(file)) throw new Error('update-absolute-path-required');
  const absolute = path.resolve(file); let current = path.parse(absolute).root;
  for (const component of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    try { if ((await fsp.lstat(current)).isSymbolicLink()) throw new Error('update-path-link'); }
    catch (error) { if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') break; throw error; }
  }
  let existing = absolute;
  const suffix: string[] = [];
  while (!fs.existsSync(existing)) {
    if (!allowMissing) throw new Error('update-path-unavailable');
    suffix.unshift(path.basename(existing)); const parent = path.dirname(existing);
    if (parent === existing) throw new Error('update-path-unavailable'); existing = parent;
  }
  return path.join(await fsp.realpath(existing), ...suffix);
}
export async function assertInstallBoundary(installPath: string, protectedRoots: string[]): Promise<void> {
  const install = await plainPath(installPath);
  for (const root of protectedRoots) {
    if (!root) continue;
    const protectedPath = await plainPath(root, true);
    if (pathsOverlap(install, protectedPath)) throw new Error('update-install-data-overlap');
  }
}
export async function writeDurableJson(file: string, value: unknown): Promise<void> {
  await plainPath(path.dirname(file), true);
  await fsp.mkdir(path.dirname(file), {recursive: true, mode: 0o700});
  const temp = file + '.tmp-' + crypto.randomUUID();
  const handle = await fsp.open(temp, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  // A failed rename leaves the previous file intact; never delete it to force success.
  await fsp.rename(temp, file);
  if (process.platform !== 'win32') {
    const directory = await fsp.open(path.dirname(file), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  }
}
function below(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
export async function captureBackup(roots: BackupRoot[], destination: string, signal: AbortSignal): Promise<{directory: string; manifest: BackupManifest}> {
  destination = await plainPath(destination, true);
  const ids = new Set<string>();
  const manifest: BackupManifest = {schemaVersion: 1, roots: [], files: [], links: [], exclusions: [], totalBytes: 0};
  const inputs: Array<{rootId: string; source: string; relative: string; size: number; mtimeMs: number; ino: number}> = [];
  for (const root of roots) {
    signal.throwIfAborted();
    if (!/^[a-z][a-z0-9-]{0,50}$/.test(root.id) || ids.has(root.id)) throw new Error('update-backup-root-id');
    ids.add(root.id);
    const absolute = await plainPath(root.path, true);
    let stat: fs.Stats;
    try { stat = await fsp.lstat(absolute); }
    catch (error) {
      if (!root.required && (error as NodeJS.ErrnoException).code === 'ENOENT') { manifest.roots.push({id: root.id, path: absolute, present: false}); continue; }
      throw new Error('update-backup-root-unavailable');
    }
    if (absolute === path.resolve(destination)) throw new Error('update-backup-self-copy');
    const excludes = await Promise.all((root.exclude || []).map(exclusion => plainPath(exclusion, true)));
    for (const exclusion of excludes) {
      if (!below(absolute, exclusion)) throw new Error('update-backup-exclusion-escape');
      manifest.exclusions.push({rootId: root.id, path: exclusion});
    }
    manifest.roots.push({id: root.id, path: absolute, present: true});
    const walk = async (source: string, relative: string, knownStat?: fs.Stats): Promise<void> => {
      signal.throwIfAborted();
      if (below(destination, source)) return;
      if (excludes.some(exclusion => below(exclusion, source))) return;
      const item = knownStat || await fsp.lstat(source);
      if (item.isSymbolicLink()) { manifest.links.push({rootId: root.id, relative, target: await fsp.readlink(source)}); return; }
      if (item.isDirectory()) {
        const names = (await fsp.readdir(source)).sort();
        for (const name of names) await walk(path.join(source, name), relative ? relative + '/' + name : name);
      } else if (item.isFile()) {
        const location = relative || 'file';
        inputs.push({rootId: root.id, source, relative: location, size: item.size, mtimeMs: item.mtimeMs, ino: item.ino});
        manifest.totalBytes += item.size;
      } else throw new Error('update-backup-special-file');
    };
    await walk(absolute, '', stat);
  }
  await fsp.mkdir(destination, {recursive: false, mode: 0o700});
  const space = await fsp.statfs(destination);
  if (space.bavail * space.bsize < manifest.totalBytes * 1.05 + 32 * 1024 * 1024) throw new Error('update-backup-disk-space');
  for (const input of inputs) {
    signal.throwIfAborted();
    await plainPath(input.source);
    const reader = await fsp.open(input.source, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const before = await reader.stat();
    if (!before.isFile() || before.size !== input.size || before.mtimeMs !== input.mtimeMs || before.ino !== input.ino) {
      await reader.close(); throw new Error('update-backup-source-changed');
    }
    const output = path.join(destination, input.rootId, ...input.relative.split('/'));
    await fsp.mkdir(path.dirname(output), {recursive: true, mode: 0o700});
    const hash = crypto.createHash('sha256'); let size = 0;
    const count = new Transform({transform: (chunk: Buffer, _encoding, done) => {size += chunk.length; hash.update(chunk); done(null, chunk);}});
    try {
      await pipeline(reader.createReadStream({autoClose: false}), count, fs.createWriteStream(output, {flags: 'wx', mode: 0o600}), {signal});
      const after = await reader.stat();
      if (size !== input.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) throw new Error('update-backup-source-changed');
    } finally { await reader.close(); }
    const sha256 = hash.digest('hex'); const copied = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(output)) copied.update(chunk);
    if (copied.digest('hex') !== sha256) throw new Error('update-backup-verification-failed');
    const copy = await fsp.open(output, 'r+'); try { await copy.sync(); } finally { await copy.close(); }
    manifest.files.push({rootId: input.rootId, relative: input.relative, size, sha256});
  }
  await writeDurableJson(path.join(destination, 'backup-manifest.json'), manifest);
  return {directory: destination, manifest};
}

export function protectedLinkTargets(manifest:BackupManifest,dshHome:string,desktopRoot:string):string[]{
  const key=(file:string)=>process.platform==='win32'?path.resolve(file).toLowerCase():path.resolve(file);
  const shared=key(path.join(dshHome,'profiles/node_modules/schemastery'));
  const runtime=key(path.join(desktopRoot,'node_modules/schemastery'));
  const targets:string[]=[];
  for(const link of manifest.links){
    const root=manifest.roots.find(root=>root.id===link.rootId);
    if(!root)throw new Error('update-backup-link-root-invalid');
    const source=path.join(root.path,...link.relative.split('/'));
    const target=path.resolve(path.dirname(source),link.target);
    if(/(^|\/)profiles\/[^/]+\/node_modules(?:\/|$)/.test(link.relative))continue;
    // This one shared junction is created by ensureDesktopProfileInit. Its exact
    // location and target bind it to the owned runtime, rather than user data.
    if(key(source)===shared&&key(target)===runtime)continue;
    targets.push(target);
  }
  return targets;
}
