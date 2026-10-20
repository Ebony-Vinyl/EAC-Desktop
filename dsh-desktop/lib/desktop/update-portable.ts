import fs = require('node:fs');
import fsp = require('node:fs/promises');
import path = require('node:path');
import {plainPath, assertInstallBoundary, writeDurableJson} from './update-backup';
import {PORTABLE_ITEMS, parseReleaseFiles, verifyReleaseTree, treeFiles, treeEmptyDirectories, hashFile, safeRelative} from './update-package';
import type {ReleaseFile, ReleaseFiles} from './update-package';
import {compareVersion} from './update-sources';
import {withPortableLock, assertPortableLock} from './update-portable-lock';
export type Checkpoint = (name: string) => Promise<void>;
interface ExchangeItem {
  name: string; kind: 'file' | 'directory'; previousExists: boolean; nextExists: boolean;
  previousDirectoryId: {dev: string; ino: string} | null;
  previousHash: string | null; nextHash: string | null;
  step: 'pending' | 'old-intent' | 'old-saved' | 'new-intent' | 'new-installed' | 'restored';
}
export interface PortableJournal {
  schemaVersion: 1; transactionId: string; installRoot: string; transactionDir: string;
  version: string; target: string; previousVersion: string;
  phase: 'prepared' | 'exchanging' | 'health' | 'committed' | 'rolling-back' | 'rolled-back' | 'recovery-failed';
  items: ExchangeItem[]; preserved: ReleaseFile[]; preservedDirectories: string[]; previousFiles: ReleaseFiles; nextFiles: ReleaseFiles; dataBinding: unknown;
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const POINTER = '.eac-update-recovery.json';
const exists = async (file: string): Promise<boolean> => {try {await fsp.lstat(file); return true;} catch (error) {if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error;}};
function location(journal: PortableJournal, tree: 'new' | 'old' | 'failed-new', name: string): string {return path.join(journal.transactionDir, tree, name);}
export async function readPortableJournal(transactionDir: string, expectedRoot: string): Promise<PortableJournal> {
  const root = await plainPath(expectedRoot); const transaction = await plainPath(transactionDir);
  await plainPath(path.join(transaction, 'journal.json'));
  const value = JSON.parse(await fsp.readFile(path.join(transaction, 'journal.json'), 'utf8')) as PortableJournal;
  if (!value || value.schemaVersion !== 1 || !UUID.test(value.transactionId) || value.installRoot !== root || value.transactionDir !== transaction
    || path.dirname(transaction) !== path.dirname(root) || path.basename(transaction) !== '.eac-update-' + value.transactionId
    || !['prepared','exchanging','health','committed','rolling-back','rolled-back','recovery-failed'].includes(value.phase) || !Array.isArray(value.items) || !value.items.length || value.items.length > PORTABLE_ITEMS.length) throw new Error('update-journal-invalid');
  let previous: ReleaseFiles; let next: ReleaseFiles;
  try { previous = parseReleaseFiles(value.previousFiles,value.previousVersion,value.target); next = parseReleaseFiles(value.nextFiles,value.version,value.target); }
  catch {throw new Error('update-journal-invalid');}
  if (compareVersion(next.version,previous.version) <= 0 || !Array.isArray(value.preserved) || value.preserved.length > 200000 || !Array.isArray(value.preservedDirectories) || value.preservedDirectories.length > 200000) throw new Error('update-journal-invalid');
  const requiredNames = new Set([...previous.files,...next.files].map(file => file.path.split('/')[0]!)); requiredNames.add('eac-release-files.json');
  const owned = new Set([...previous.files,...next.files].map(file => file.path.toLowerCase())); owned.add('eac-release-files.json');
  const kept = new Set<string>();
  for (const file of value.preserved) {
    if (!file || typeof file.path !== 'string' || !Number.isSafeInteger(file.size) || file.size < 0 || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('update-journal-invalid');
    try {safeRelative(file.path);} catch {throw new Error('update-journal-invalid');}
    const key = file.path.toLowerCase();
    if (!requiredNames.has(file.path.split('/')[0]!) || owned.has(key) || kept.has(key)) throw new Error('update-journal-invalid'); kept.add(key);
    const parts = key.split('/'); for (let i=1;i<parts.length;i++) if (owned.has(parts.slice(0,i).join('/'))) throw new Error('update-journal-invalid');
  }
  const directories = new Set<string>();
  for (const relative of value.preservedDirectories) {
    if (typeof relative !== 'string') throw new Error('update-journal-invalid');
    try {safeRelative(relative);} catch {throw new Error('update-journal-invalid');}
    if (!requiredNames.has(relative.split('/')[0]!) || owned.has(relative.toLowerCase()) || kept.has(relative.toLowerCase()) || directories.has(relative.toLowerCase())) throw new Error('update-journal-invalid');
    directories.add(relative.toLowerCase());
  }
  const names = new Set<string>();
  for (const item of value.items) {
    if (!item || !(PORTABLE_ITEMS as readonly string[]).includes(item.name) || names.has(item.name) || !['file','directory'].includes(item.kind) || typeof item.previousExists !== 'boolean' || typeof item.nextExists !== 'boolean'
      || !['pending','old-intent','old-saved','new-intent','new-installed','restored'].includes(item.step)
      || (item.kind === 'file' && item.previousExists && (typeof item.previousHash !== 'string' || !/^[a-f0-9]{64}$/.test(item.previousHash)))
      || (item.kind === 'directory' && item.previousExists && (!item.previousDirectoryId || !/^[0-9]+$/.test(item.previousDirectoryId.dev) || !/^[1-9][0-9]*$/.test(item.previousDirectoryId.ino)))
      || (item.kind === 'file' && item.nextExists && (typeof item.nextHash !== 'string' || !/^[a-f0-9]{64}$/.test(item.nextHash)))) throw new Error('update-journal-invalid');
    if (!requiredNames.has(item.name) || (!item.previousExists && !item.nextExists)) throw new Error('update-journal-invalid');
    const previousTop = previous.files.find(file => file.path === item.name);
    const nextTop = next.files.find(file => file.path === item.name);
    if (item.name !== 'eac-release-files.json' && ((item.kind === 'file') !== Boolean(previousTop || nextTop) || item.previousExists !== previous.files.some(file => file.path === item.name || file.path.startsWith(item.name+'/')) || item.nextExists !== (next.files.some(file => file.path === item.name || file.path.startsWith(item.name+'/')) || value.preserved.some(file => file.path.startsWith(item.name+'/')) || value.preservedDirectories.some(relative => relative === item.name || relative.startsWith(item.name+'/'))))) throw new Error('update-journal-invalid');
    if (item.kind === 'file' && item.name !== 'eac-release-files.json' && ((previousTop && item.previousHash !== previousTop.sha256) || (nextTop && item.nextHash !== nextTop.sha256))) throw new Error('update-journal-invalid');
    names.add(item.name);
  }
  if (names.size !== requiredNames.size || value.items[value.items.length-1]?.name !== 'dsh-eac-shell.exe') throw new Error('update-journal-invalid');
  for (const tree of ['new','old','failed-new']) await plainPath(path.join(transaction, tree), true);
  return value;
}
async function persist(journal: PortableJournal): Promise<void> {assertPortableLock(); await writeDurableJson(path.join(journal.transactionDir, 'journal.json'), journal);}
async function copyDurable(source: string, target: string): Promise<void> {
  await fsp.mkdir(path.dirname(target), {recursive: true, mode: 0o700});
  await fsp.copyFile(source, target, fs.constants.COPYFILE_EXCL);
  const handle = await fsp.open(target, 'r+'); try {await handle.sync();} finally {await handle.close();}
}
async function preparePortableLocked(options: {installRoot: string; stageRoot: string; transactionId: string; version: string; target: string; dataBinding: unknown; protectedRoots: string[]; signal?: AbortSignal}): Promise<PortableJournal> {
  options.signal?.throwIfAborted();
  if (!UUID.test(options.transactionId)) throw new Error('update-transaction-id-invalid');
  const installRoot = await plainPath(options.installRoot); const stageRoot = await plainPath(options.stageRoot);
  await assertInstallBoundary(installRoot, [...options.protectedRoots, stageRoot]);
  if (await exists(path.join(installRoot, POINTER))) throw new Error('update-recovery-required');
  const next = parseReleaseFiles(JSON.parse(await fsp.readFile(path.join(stageRoot, 'eac-release-files.json'), 'utf8')), options.version, options.target);
  await verifyReleaseTree(stageRoot, next,[],options.signal);
  let previous: ReleaseFiles;
  try {previous = parseReleaseFiles(JSON.parse(await fsp.readFile(path.join(installRoot, 'eac-release-files.json'), 'utf8')), undefined, options.target);}
  catch {throw new Error('update-installed-file-ownership-required');}
  if (compareVersion(options.version, previous.version) <= 0) throw new Error('update-portable-version-not-newer');
  for (const file of previous.files) {
    options.signal?.throwIfAborted();
    const current = await plainPath(path.join(installRoot,...file.path.split('/')));
    if ((await fsp.stat(current)).size !== file.size || await hashFile(current,options.signal) !== file.sha256) throw new Error('update-installed-owned-file-changed');
  }
  const transactionDir = path.join(path.dirname(installRoot), '.eac-update-' + options.transactionId);
  await plainPath(transactionDir, true);
  if (await exists(transactionDir)) throw new Error('update-transaction-directory-exists');
  const oldFiles = await treeFiles(installRoot,options.signal);
  const previousFiles = new Set(previous.files.map(file => file.path.toLowerCase()));
  previousFiles.add('eac-release-files.json');
  const nextFiles = new Set(next.files.map(file => file.path.toLowerCase())); nextFiles.add('eac-release-files.json');
  const nextNames = new Set(next.files.map(file => file.path.split('/')[0]!)); nextNames.add('eac-release-files.json');
  const previousNames = new Set(previous.files.map(file => file.path.split('/')[0]!)); previousNames.add('eac-release-files.json');
  const controlled = new Set([...previousNames, ...nextNames]);
  const preserved: ReleaseFile[] = [];
  for (const file of oldFiles) {
    if (!controlled.has(file.path.split('/')[0]!) || previousFiles.has(file.path.toLowerCase())) continue;
    if (nextFiles.has(file.path.toLowerCase())) throw new Error('update-user-file-conflict');
    preserved.push({...file, sha256: await hashFile(path.join(installRoot, ...file.path.split('/')),options.signal)});
  }
  const preservedDirectories = (await treeEmptyDirectories(installRoot)).filter(relative => controlled.has(relative.split('/')[0]!));
  for (const relative of [...preserved.map(file => file.path),...preservedDirectories]) {
    const parts = relative.toLowerCase().split('/');
    for (let i=1;i<=parts.length;i++) if (nextFiles.has(parts.slice(0,i).join('/'))) throw new Error('update-user-file-conflict');
    if (next.files.some(file => file.path.toLowerCase().startsWith(relative.toLowerCase()+'/')) && preserved.some(file=>file.path===relative)) throw new Error('update-user-file-conflict');
  }
  const space = await fsp.statfs(installRoot);
  const nextBytes = next.files.reduce((total, file) => total + file.size, 0) + preserved.reduce((total, file) => total + file.size, 0);
  if (space.bavail * space.bsize < nextBytes * 1.1 + 64 * 1024 * 1024) throw new Error('update-portable-disk-space');
  await fsp.mkdir(transactionDir, {recursive: false, mode: 0o700});
  await fsp.mkdir(path.join(transactionDir, 'old')); await fsp.mkdir(path.join(transactionDir, 'failed-new'));
  const newRoot = path.join(transactionDir, 'new'); await fsp.mkdir(newRoot);
  for (const file of [...next.files, {path: 'eac-release-files.json', size: 0, sha256: ''}]) {
    options.signal?.throwIfAborted();
    await copyDurable(path.join(stageRoot, ...file.path.split('/')), path.join(newRoot, ...file.path.split('/')));
  }
  for (const file of preserved) {options.signal?.throwIfAborted(); await copyDurable(path.join(installRoot, ...file.path.split('/')), path.join(newRoot, ...file.path.split('/')));}
  for (const relative of preservedDirectories) await fsp.mkdir(path.join(newRoot,...relative.split('/')), {recursive:true});
  await verifyReleaseTree(newRoot, next, preserved,options.signal);
  const items: ExchangeItem[] = [];
  // The executable is always atomically replaced last, so an interrupted exchange
  // still has a launchable entry point for startup recovery.
  const names = [...controlled].sort((a,b) => a === 'dsh-eac-shell.exe' ? 1 : b === 'dsh-eac-shell.exe' ? -1 : a.localeCompare(b));
  for (const name of names) {
    const original = path.join(installRoot, name); const candidate = path.join(newRoot, name);
    const previousExists = await exists(original); const nextExists = await exists(candidate);
    if (!nextExists && !previousExists) throw new Error('update-package-top-level-unavailable');
    const stat = await fsp.lstat(nextExists ? candidate : original);
    const directoryIdentity = previousExists && stat.isDirectory() ? await fsp.stat(original, {bigint: true}) : null;
    if (directoryIdentity && directoryIdentity.ino === 0n) throw new Error('update-directory-identity-unavailable');
    if (previousExists && (await fsp.lstat(original)).isDirectory() !== stat.isDirectory()) throw new Error('update-package-top-level-kind-conflict');
    items.push({name, kind: stat.isDirectory() ? 'directory' : 'file', previousExists, nextExists,
      previousDirectoryId: directoryIdentity ? {dev: String(directoryIdentity.dev), ino: String(directoryIdentity.ino)} : null,
      previousHash: previousExists && !stat.isDirectory() ? await hashFile(original) : null,
      nextHash: nextExists && !stat.isDirectory() ? await hashFile(candidate) : null, step: 'pending'});
  }
  options.signal?.throwIfAborted();
  const journal: PortableJournal = {schemaVersion: 1, transactionId: options.transactionId, installRoot, transactionDir,
    version: next.version, target: next.target, previousVersion: previous.version, phase: 'prepared', items, preserved, preservedDirectories, previousFiles: previous, nextFiles: next, dataBinding: options.dataBinding};
  await persist(journal);
  await writeDurableJson(path.join(installRoot, POINTER), {schemaVersion: 1, transactionId: journal.transactionId, transactionDir});
  return journal;
}
async function exchangePortableLocked(journal: PortableJournal, waitForOwners: () => Promise<boolean>, health: () => Promise<boolean>, checkpoint: Checkpoint = async () => {}, rollbackReady: () => Promise<boolean> = async () => true): Promise<void> {
  Object.assign(journal, await readPortableJournal(journal.transactionDir, journal.installRoot));
  if (journal.phase !== 'prepared') throw new Error('update-journal-phase-invalid');
  if (!await waitForOwners()) throw new Error('update-owner-exit-unconfirmed');
  const current = await readPortableJournal(journal.transactionDir, journal.installRoot);
  if (current.phase !== 'prepared') throw new Error('update-journal-phase-invalid');
  await plainPath(path.join(journal.installRoot, POINTER));
  const pointer = JSON.parse(await fsp.readFile(path.join(journal.installRoot, POINTER), 'utf8')) as {transactionId?: string};
  if (pointer.transactionId !== journal.transactionId) throw new Error('update-recovery-pointer-conflict');
  const manifest = parseReleaseFiles(JSON.parse(await fsp.readFile(path.join(journal.transactionDir, 'new', 'eac-release-files.json'), 'utf8')), journal.version, journal.target);
  await verifyReleaseTree(path.join(journal.transactionDir, 'new'), manifest, journal.preserved);
  if (JSON.stringify(manifest) !== JSON.stringify(journal.nextFiles)) throw new Error('update-journal-package-changed');
  for (const file of journal.preserved) {
    const location = await plainPath(path.join(journal.installRoot,...file.path.split('/')));
    if (await hashFile(location) !== file.sha256) throw new Error('update-user-file-changed');
  }
  journal.phase = 'exchanging'; await persist(journal); await checkpoint('exchange-start');
  try {
    for (const item of journal.items) {
      const current = path.join(journal.installRoot, item.name); const candidate = location(journal, 'new', item.name); const old = location(journal, 'old', item.name);
      await plainPath(current, true); await plainPath(candidate, !item.nextExists); await plainPath(old, true);
      item.step = 'old-intent'; await persist(journal); await checkpoint(item.name + ':old-intent');
      if (item.previousExists) {
        if (item.kind === 'directory') (assertPortableLock(), await fsp.rename(current, old));
        else {await copyDurable(current, old); if (await hashFile(old) !== item.previousHash) throw new Error('update-old-file-changed');}
      }
      item.step = 'old-saved'; await persist(journal); await checkpoint(item.name + ':old-saved');
      item.step = 'new-intent'; await persist(journal); await checkpoint(item.name + ':new-intent');
      if (item.nextExists) {assertPortableLock(); await fsp.rename(candidate, current);}
      else if (item.kind === 'file' && item.previousExists) await fsp.unlink(current);
      item.step = 'new-installed'; await persist(journal); await checkpoint(item.name + ':new-installed');
    }
    journal.phase = 'health'; await persist(journal); await checkpoint('health-start');
    if (!await health()) throw new Error('update-health-unconfirmed');
    journal.phase = 'committed'; await persist(journal); await checkpoint('committed');
    await clearPointer(journal);
  } catch (error) {
    if (!await rollbackReady()) {journal.phase = 'recovery-failed'; await persist(journal); throw new Error('update-health-stop-unconfirmed');}
    await rollbackPortable(journal, checkpoint); throw error;
  }
}
async function rollbackPortableLocked(journal: PortableJournal, checkpoint: Checkpoint = async () => {}): Promise<void> {
  journal = await readPortableJournal(journal.transactionDir, journal.installRoot);
  if (journal.phase === 'committed' || journal.phase === 'rolled-back') return;
  journal.phase = 'rolling-back'; await persist(journal);
  try {
    for (const item of [...journal.items].reverse()) {
      if (item.step === 'pending' || item.step === 'restored') continue;
      const current = path.join(journal.installRoot, item.name); const old = location(journal, 'old', item.name); const failed = location(journal, 'failed-new', item.name);
      await plainPath(current, true); await plainPath(old, true); await plainPath(failed, true);
      if (item.kind === 'directory') {
        if (await exists(old)) {
          await verifyPreviousDirectory(old,journal,item);
          if (await exists(current)) {
            if (await exists(failed)) throw new Error('update-recovery-path-conflict');
            await fsp.rename(current, failed);
          }
          await fsp.rename(old, current);
        } else if (item.previousExists) {
          if (!await exists(current)) throw new Error('update-recovery-old-directory-unavailable');
          const identity = await fsp.stat(current, {bigint: true});
          if (!item.previousDirectoryId || String(identity.dev) !== item.previousDirectoryId.dev || String(identity.ino) !== item.previousDirectoryId.ino) throw new Error('update-recovery-directory-identity-mismatch');
        } else if (!item.previousExists && !await exists(location(journal, 'new', item.name)) && await exists(current)) {
          if (await exists(failed)) throw new Error('update-recovery-path-conflict');
          await fsp.rename(current, failed);
        }
      } else if (item.previousExists) {
        if (await exists(old) && await hashFile(old) === item.previousHash) {
          if (await exists(current) && await hashFile(current) !== item.previousHash && !await exists(failed)) await copyDurable(current, failed);
          const temporary = current + '.restore-' + journal.transactionId;
          if (!await exists(temporary)) await copyDurable(old, temporary);
          if (await hashFile(temporary) !== item.previousHash) throw new Error('update-recovery-file-invalid');
          await fsp.rename(temporary, current);
        } else if (!await exists(current) || await hashFile(current) !== item.previousHash) throw new Error('update-recovery-old-file-unavailable');
      } else if (await exists(current) && !await exists(location(journal, 'new', item.name))) {
        if (await hashFile(current) !== item.nextHash || await exists(failed)) throw new Error('update-recovery-file-conflict');
        await fsp.rename(current, failed);
      }
      if (item.kind === 'directory' && item.previousExists) await verifyPreviousDirectory(current,journal,item);
      item.step = 'restored'; await persist(journal); await checkpoint(item.name + ':restored');
    }
    journal.phase = 'rolled-back'; await persist(journal); await clearPointer(journal);
  } catch (error) {journal.phase = 'recovery-failed'; await persist(journal); throw error;}
}
async function clearPointer(journal: PortableJournal): Promise<void> {
  const pointer = path.join(journal.installRoot, POINTER);
  if (!await exists(pointer)) return;
  await plainPath(pointer);
  const value = JSON.parse(await fsp.readFile(pointer, 'utf8')) as {transactionId?: string};
  if (value.transactionId !== journal.transactionId) throw new Error('update-recovery-pointer-conflict');
  await fsp.unlink(pointer);
}
async function recoverPortableLocked(installRoot: string): Promise<boolean> {
  installRoot = await plainPath(installRoot);
  const pointer = path.join(installRoot, POINTER);
  if (!await exists(pointer)) return false;
  await plainPath(pointer);
  const value = JSON.parse(await fsp.readFile(pointer, 'utf8')) as {schemaVersion?: number; transactionId?: string; transactionDir?: string};
  if (value.schemaVersion !== 1 || !value.transactionId || !UUID.test(value.transactionId)
    || value.transactionDir !== path.join(path.dirname(installRoot), '.eac-update-' + value.transactionId)) throw new Error('update-recovery-pointer-invalid');
  const journal = await readPortableJournal(value.transactionDir, installRoot);
  if (journal.phase === 'committed') await clearPointer(journal);
  else await rollbackPortable(journal);
  return true;
}

export function preparePortable(options: Parameters<typeof preparePortableLocked>[0]): Promise<PortableJournal> {
  return withPortableLock(options.installRoot, () => preparePortableLocked(options));
}
export function exchangePortable(journal: PortableJournal, waitForOwners: () => Promise<boolean>, health: () => Promise<boolean>, checkpoint?: Checkpoint, rollbackReady?: () => Promise<boolean>): Promise<void> {
  return withPortableLock(journal.installRoot, () => exchangePortableLocked(journal,waitForOwners,health,checkpoint,rollbackReady));
}
export function rollbackPortable(journal: PortableJournal, checkpoint?: Checkpoint): Promise<void> {
  return withPortableLock(journal.installRoot, () => rollbackPortableLocked(journal,checkpoint));
}
export function recoverPortable(installRoot: string): Promise<boolean> {
  return withPortableLock(installRoot, () => recoverPortableLocked(installRoot));
}

async function verifyPreviousDirectory(root: string, journal: PortableJournal, item: ExchangeItem): Promise<void> {
  const identity = await fsp.stat(root, {bigint:true});
  if (!identity.isDirectory() || !item.previousDirectoryId || String(identity.dev) !== item.previousDirectoryId.dev || String(identity.ino) !== item.previousDirectoryId.ino) throw new Error('update-recovery-directory-identity-mismatch');
  for (const file of [...journal.previousFiles.files,...journal.preserved].filter(file=>file.path.startsWith(item.name+'/'))) {
    const location = await plainPath(path.join(root,...file.path.split('/').slice(1)));
    if ((await fsp.stat(location)).size !== file.size || await hashFile(location) !== file.sha256) throw new Error('update-recovery-old-file-invalid');
  }
}
