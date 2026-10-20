import cp = require('node:child_process');
import fsp = require('node:fs/promises');
import path = require('node:path');
import {plainPath} from './update-backup';
import {PORTABLE_ITEMS, parseReleaseFiles, safeRelative, verifyReleaseTree} from './update-package';
import type {ReleaseFiles} from './update-package';
function runArchive(action: 'Inspect' | 'Extract', archive: string, destination?: string, signal?: AbortSignal): Promise<unknown> {
  if (process.platform !== 'win32') throw new Error('update-portable-platform-unsupported');
  signal?.throwIfAborted();
  const args = ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'update-portable-archive.ps1'),'-Action',action,'-Archive',archive];
  if (destination) args.push('-Destination',destination);
  return new Promise((resolve,reject) => cp.execFile('powershell.exe',args,{windowsHide:true,timeout:15*60*1000,maxBuffer:64*1024*1024,encoding:'utf8',...(signal ? {signal} : {})},(error,stdout) => {
    if (error) return reject(new Error('update-archive-operation-failed'));
    try {resolve(JSON.parse(stdout.trim()));} catch {reject(new Error('update-archive-response-invalid'));}
  }));
}
export async function inspectPortableArchive(archive: string, version: string, target: string, signal?: AbortSignal): Promise<ReleaseFiles> {
  await plainPath(archive);
  const value = await runArchive('Inspect',archive,undefined,signal) as {manifest?: unknown; entries?: Array<{path?: unknown;size?: unknown;directory?: unknown}>};
  const manifest = parseReleaseFiles(value.manifest,version,target);
  if (!Array.isArray(value.entries)) throw new Error('update-archive-invalid');
  const expected = new Map(manifest.files.map(file => [file.path,file.size]));
  const seen = new Set<string>();
  for (const entry of value.entries) {
    signal?.throwIfAborted();
    if (typeof entry.path !== 'string' || typeof entry.directory !== 'boolean' || !Number.isSafeInteger(entry.size) || Number(entry.size) < 0) throw new Error('update-archive-invalid');
    safeRelative(entry.path);
    if (entry.directory) {
      if (!(PORTABLE_ITEMS as readonly string[]).includes(entry.path.split('/')[0]!) || expected.has(entry.path)) throw new Error('update-archive-file-list-mismatch');
      const parts = entry.path.split('/');
      for (let i=1;i<parts.length;i++) if (expected.has(parts.slice(0,i).join('/'))) throw new Error('update-archive-file-list-mismatch');
      continue;
    }
    if (entry.path === 'eac-release-files.json') continue;
    if (expected.get(entry.path) !== entry.size || seen.has(entry.path)) throw new Error('update-archive-file-list-mismatch');
    seen.add(entry.path);
  }
  if (seen.size !== expected.size) throw new Error('update-archive-closure-incomplete');
  return manifest;
}
export async function extractPortableArchive(archive: string, destination: string, version: string, target: string, signal?: AbortSignal): Promise<ReleaseFiles> {
  const manifest = await inspectPortableArchive(archive,version,target,signal);
  destination = await plainPath(destination,true);
  const space = await fsp.statfs(path.dirname(destination));
  if (space.bavail*space.bsize < manifest.files.reduce((total,file)=>total+file.size,0)*1.1 + 64*1024*1024) throw new Error('update-archive-disk-space');
  await runArchive('Extract',archive,destination,signal);
  await verifyReleaseTree(destination,manifest,[],signal); return manifest;
}
