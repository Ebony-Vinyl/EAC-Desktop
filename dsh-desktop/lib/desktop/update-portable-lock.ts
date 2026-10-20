import cp = require('node:child_process');
import fs = require('node:fs');
import path = require('node:path');
import {AsyncLocalStorage} from 'node:async_hooks';
import {plainPath} from './update-backup';
const locks = new AsyncLocalStorage<{root: string; check(): void}>();
const command = "$ErrorActionPreference='Stop'; try { $stream = New-Object IO.FileStream($env:EAC_UPDATE_LOCK, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) } catch { exit 73 }; try { [Console]::WriteLine('locked'); [Console]::Out.Flush(); [Console]::ReadLine() | Out-Null } finally { $stream.Dispose() }";

export function linuxLockCommand(lock: string, node = process.execPath): {file:string;args:string[]} {
  if (!path.isAbsolute(lock) || !path.isAbsolute(node) || /[\x00-\x1f\x7f]/.test(lock+node)) throw new Error('update-install-lock-invalid');
  return {file:'/usr/bin/flock',args:['--exclusive','--nonblock','--conflict-exit-code','73','--no-fork',lock,node,'-e',"process.stdin.once('end',()=>process.exit(0));process.stdin.resume();process.stdout.write('locked\\n');"]};
}
export function assertPortableLock(): void {
  const current = locks.getStore();
  if (!current) throw new Error('update-install-lock-required');
  current.check();
}
export async function withPortableLock<T>(root: string, action: () => Promise<T>): Promise<T> {
  root = await plainPath(root);
  const current = locks.getStore();
  if (current) {
    if (current.root !== root) throw new Error('update-install-lock-root-conflict');
    current.check(); return action();
  }
  if (process.platform !== 'win32' && process.platform !== 'linux') throw new Error('update-portable-platform-unsupported');
  const lock = await plainPath(path.join(root, '.eac-update-lock'), true);
  // The private stdin pipe keeps the OS lock alive; a crashed owner closes it.
  let identity: fs.Stats | undefined;
  if (process.platform === 'linux') {
    const descriptor=fs.openSync(lock,'a+',0o600);
    try {identity=fs.fstatSync(descriptor);if(!identity.isFile())throw new Error('update-install-lock-invalid');}
    finally {fs.closeSync(descriptor);}
  }
  const invocation=process.platform==='linux'?linuxLockCommand(lock):{file:'powershell.exe',args:['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')]};
  const child = cp.spawn(invocation.file, invocation.args, {
    windowsHide: true, stdio: ['pipe','pipe','ignore'], env: {...process.env,EAC_UPDATE_LOCK:lock},
  });
  let exited = false;
  const exit = new Promise<void>(resolve => {child.once('close', () => {exited = true; resolve();}); child.once('error', () => {exited = true; resolve();});});
  try {
    await new Promise<void>((resolve,reject) => {
      let response = ''; const timer = setTimeout(() => reject(new Error('update-install-lock-timeout')),10000);
      const done = (error?: Error) => {clearTimeout(timer); child.stdout.removeListener('data',data); child.removeListener('exit',closed); child.removeListener('error',failed); error ? reject(error) : resolve();};
      const data = (chunk: Buffer) => {response += chunk.toString('utf8'); if (response.trim() === 'locked') done(); else if (response.length > 100) done(new Error('update-install-lock-invalid'));};
      const closed = () => done(new Error('update-install-lock-busy'));
      const failed = () => done(new Error('update-install-lock-unavailable'));
      child.stdout.on('data',data); child.once('exit',closed); child.once('error',failed);
    });
    const check = () => {if (exited || child.exitCode !== null || child.signalCode !== null) throw new Error('update-install-lock-lost');if(identity){const current=fs.lstatSync(lock);if(!current.isFile()||current.isSymbolicLink()||current.dev!==identity.dev||current.ino!==identity.ino)throw new Error('update-install-lock-lost');}};
    check();
    return await locks.run({root,check},action);
  } finally {child.stdin.on('error',() => {}); child.stdin.end(); await exit;}
}
