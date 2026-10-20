import fs = require('node:fs');
import fsp = require('node:fs/promises');
import path = require('node:path');
import cp = require('node:child_process');
import crypto = require('node:crypto');
import {plainPath, pathsOverlap, writeDurableJson} from './update-backup';
import {hashFile} from './update-package';
import type {Artifact} from './update-sources';
import type {DataBinding} from './client-update';
export interface UpdateHandoff {
  schemaVersion: 1; transactionId: string; installRoot: string; transactionDir: string;
  version: string; target: string; packageFile: string; artifact: Artifact; trustedKey: string;
  binding: DataBinding; owners: number[]; token: string; ownerTimeoutMs: number; healthTimeoutMs: number;
  launchEnv: Record<string,string>; dataBackupDirectory?: string;
}
export interface UpdateHelperHandle {pid: number; commit(): Promise<void>; cancel(): Promise<void>; waitForExit(): Promise<void>;}
export function helperMac(value: unknown, token: string): string {return crypto.createHmac('sha256',token).update(JSON.stringify(value)).digest('hex');}
export async function readHelperReceipt(file: string, token: string): Promise<Record<string,unknown>|null> {
  try {
    await plainPath(file,true); const value=JSON.parse(await fsp.readFile(file,'utf8')) as {payload?: Record<string,unknown>;mac?:string};
    if (!value.payload || typeof value.mac!=='string' || !/^[a-f0-9]{64}$/.test(value.mac) || !crypto.timingSafeEqual(Buffer.from(value.mac,'hex'),Buffer.from(helperMac(value.payload,token),'hex'))) return null;
    return value.payload;
  } catch (error) {if ((error as NodeJS.ErrnoException).code==='ENOENT') return null;throw new Error('update-health-receipt-invalid');}
}
async function durableCopy(source: string, target: string): Promise<void> {
  await plainPath(source);await fsp.mkdir(path.dirname(target),{recursive:true,mode:0o700});
  await fsp.copyFile(source,target,fs.constants.COPYFILE_EXCL);
  const file=await fsp.open(target,'r+');try {await file.sync();} finally {await file.close();}
  if (await hashFile(source)!==await hashFile(target)) throw new Error('update-helper-copy-changed');
}
export async function writeHelperReceipt(file: string, payload: unknown, token: string): Promise<void> {
  await writeDurableJson(file,{payload,mac:helperMac(payload,token)});
}
export function helperNodeName():string{return process.platform==='win32'?'node.exe':'node';}
export async function startCopiedHelper(request: UpdateHandoff, modules: readonly string[], entry: string, signal?: AbortSignal): Promise<UpdateHelperHandle> {
  signal?.throwIfAborted();
  const helper=path.join(request.transactionDir,'helper');await plainPath(helper,true);await fsp.mkdir(helper,{mode:0o700});
  const files: Array<{path:string;sha256:string}>=[];
  const nodeName=helperNodeName();const node=path.join(helper,nodeName);await durableCopy(process.execPath,node);if(process.platform!=='win32')await fsp.chmod(node,0o700);files.push({path:nodeName,sha256:await hashFile(node)});
  for (const name of modules) {
    signal?.throwIfAborted();
    const target=path.join(helper,'lib/desktop',name);await durableCopy(path.join(__dirname,name),target);files.push({path:'lib/desktop/'+name,sha256:await hashFile(target)});
  }
  const token=request.token;
  const requestFile=path.join(helper,'handoff.json');await writeDurableJson(requestFile,request);
  await writeDurableJson(path.join(helper,'files.json'),{schemaVersion:1,helperProtocolVersion:2,transactionId:request.transactionId,files});
  signal?.throwIfAborted();
  const child=cp.spawn(node,[path.join(helper,'lib/desktop',entry),'--takeover',requestFile],{windowsHide:true,detached:true,stdio:['pipe','pipe','ignore'],...(signal ? {signal:signal} : {})});
  let terminal=false; let output='';
  const exit=new Promise<void>(resolve=>{child.once('close',()=>{terminal=true;resolve();});child.once('error',()=>{terminal=true;});});
  const ready=await new Promise<{pid:number}>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('update-helper-takeover-timeout')),900000);
    const done=(error?:Error,value?:{pid:number})=>{clearTimeout(timer);child.stdout.removeListener('data',data);child.removeListener('exit',closed);child.removeListener('error',failed);error?reject(error):resolve(value!);};
    const data=(chunk:Buffer)=>{
      output+=chunk.toString('utf8');if(output.length>4096)return done(new Error('update-helper-response-invalid'));
      if(!output.includes('\n'))return;
      try {const value=JSON.parse(output.trim());if(value.accepted!==true||value.transactionId!==request.transactionId||value.pid!==child.pid||value.token!==token)throw new Error();done(undefined,{pid:value.pid});}
      catch {done(new Error('update-helper-response-invalid'));}
    };
    const closed=()=>done(new Error('update-helper-takeover-refused'));
    const failed=()=>done(new Error('update-helper-unavailable'));
    child.stdout.on('data',data);child.once('exit',closed);child.once('error',failed);
  }).catch(async error=>{child.stdin.on('error',()=>{});child.stdin.end();await exit;throw error;});
  let committed=false;
  return {pid:ready.pid,
    commit:async()=>{
      signal?.throwIfAborted();
      if(terminal||committed)throw new Error('update-helper-not-ready');
      await new Promise<void>((resolve,reject)=>child.stdin.write(JSON.stringify({action:'install',token})+'\n',error=>error?reject(error):resolve()));
      committed=true;child.stdin.end();child.stdout.destroy();child.unref();
    },
    cancel:async()=>{if(committed)throw new Error('update-helper-already-committed');child.stdin.on('error',()=>{});child.stdin.end();await exit;},
    waitForExit:async()=>{child.ref();await exit;},
  };
}

export async function verifyHelperFiles(request: UpdateHandoff, modules: readonly string[]): Promise<void> {
  const helper=path.join(request.transactionDir,'helper');
  const owned=JSON.parse(await fsp.readFile(await plainPath(path.join(helper,'files.json')),'utf8')) as {schemaVersion?:number;helperProtocolVersion?:number;transactionId?:string;files?:Array<{path:string;sha256:string}>};
  const expected=[helperNodeName(),...modules.map(name=>'lib/desktop/'+name)];
  if(owned.schemaVersion!==1||owned.helperProtocolVersion!==2||owned.transactionId!==request.transactionId||!Array.isArray(owned.files)||owned.files.length!==expected.length)throw new Error('update-helper-files-invalid');
  for(const [index,relative] of expected.entries()){
    const item=owned.files[index];
    if(item?.path!==relative||typeof item.sha256!=='string'||await hashFile(await plainPath(path.join(helper,relative)))!==item.sha256)throw new Error('update-helper-files-invalid');
  }
}
export async function validateHelperContext(request: UpdateHandoff): Promise<void> {
  if(!request||request.schemaVersion!==1||typeof request.installRoot!=='string'||!path.isAbsolute(request.installRoot)||typeof request.transactionDir!=='string'||!path.isAbsolute(request.transactionDir)
    ||typeof request.packageFile!=='string'||!path.isAbsolute(request.packageFile)||typeof request.version!=='string'||typeof request.target!=='string'||typeof request.token!=='string'||!/^[a-f0-9]{64}$/.test(request.token)
    ||!Array.isArray(request.owners)||!request.owners.length||request.owners.some(pid=>!Number.isSafeInteger(pid)||pid<1)
    ||!Number.isSafeInteger(request.ownerTimeoutMs)||request.ownerTimeoutMs<100||request.ownerTimeoutMs>120000
    ||!Number.isSafeInteger(request.healthTimeoutMs)||request.healthTimeoutMs<100||request.healthTimeoutMs>300000)throw new Error('update-helper-request-invalid');
  const binding=request.binding;
  if(!binding||!Number.isInteger(binding.webPort)||binding.webPort<1||binding.webPort>65535||typeof binding.profile!=='string'||!binding.profile||!['stable','beta'].includes(binding.channel))throw new Error('update-helper-binding-invalid');
  for(const root of [binding.environmentRoot,binding.dshHome,binding.userDataDir,binding.registryHome,binding.webviewRoot,binding.configRoot,binding.guestRoot]){
    if(typeof root!=='string'||!path.isAbsolute(root)||pathsOverlap(request.installRoot,await plainPath(root,true)))throw new Error('update-helper-binding-invalid');
  }
  if(!request.launchEnv||typeof request.launchEnv!=='object'||Array.isArray(request.launchEnv)||Object.entries(request.launchEnv).some(([key,value])=>!['DSH_EAC_DATA_ROOT','DSH_EAC_CHANNEL','DSH_EAC_WEBVIEW_DATA_DIR','DSH_EAC_SHELL_CONFIG_DIR','DSH_EAC_GUEST_DATA_DIR','DPX_HOME'].includes(key)||typeof value!=='string'||value.includes('\0')))throw new Error('update-helper-environment-invalid');
}
export function processAlive(pid:number):boolean {
  if(!Number.isSafeInteger(pid)||pid<1)return false;
  try {process.kill(pid,0);return true;}catch(error){return (error as NodeJS.ErrnoException).code!=='ESRCH';}
}
export async function waitUntil(check:()=>Promise<boolean>,timeout:number):Promise<boolean>{
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){if(await check())return true;await new Promise<void>(resolve=>setTimeout(resolve,100));}return false;
}
