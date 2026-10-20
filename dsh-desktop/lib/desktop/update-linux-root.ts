import fs = require('node:fs');
import fsp = require('node:fs/promises');
import path = require('node:path');
import cp = require('node:child_process');
import {createInterface} from 'node:readline';
import type {UpdateDefaults, Artifact, Manifest} from './update-sources';
import type {LinuxQuery, LinuxCommand} from './update-linux';
export interface LinuxRootRequest {schemaVersion:1;transactionId:string;target:string;executable:string;packageFile:string;envelope:unknown;owners:number[];token:string;}
export interface LinuxRootSpec {request:LinuxRootRequest;manifest:Manifest;artifact:Artifact;trustedKey:string;}
const MODULES=['update-linux-root.js','update-linux.js','update-sources.js','update-signature.js','update-backup.js','update-package.js','update-portable-lock.js'];
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ROOT_CACHE='/var/cache/deepseek-harness-eac-updater';
const SAFE_ENV={PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C.UTF-8',LC_ALL:'C.UTF-8',HOME:'/root',USER:'root',LOGNAME:'root',DEBIAN_FRONTEND:'noninteractive'};
function absolute(value:unknown):value is string{return typeof value==='string'&&path.posix.isAbsolute(value)&&!value.includes('\\')&&!/[\x00-\x1f\x7f]/.test(value)&&!value.split('/').includes('..');}
export function linuxRootSpec(value:unknown,defaults:UpdateDefaults,currentVersion:string,arch:string):LinuxRootSpec{
  const request=value as LinuxRootRequest;
  const keys=['schemaVersion','transactionId','target','executable','packageFile','envelope','owners','token'];
  if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).some(key=>!keys.includes(key))||request.schemaVersion!==1
    ||typeof request.transactionId!=='string'||!UUID.test(request.transactionId)||typeof request.token!=='string'||!/^[a-f0-9]{64}$/.test(request.token)
    ||!absolute(request.executable)||path.posix.basename(request.executable)!=='dsh-eac-shell'||!absolute(request.packageFile)
    ||!Array.isArray(request.owners)||!request.owners.length||request.owners.length>2048||request.owners.some(pid=>!Number.isSafeInteger(pid)||pid<1))throw new Error('update-linux-root-request-invalid');
  const {linuxTarget}=require('./update-linux') as typeof import('./update-linux');
  const {verifyManifest,compareVersion}=require('./update-sources') as typeof import('./update-sources');
  const shape=linuxTarget(request.target);if(shape.kind==='appimage'||shape.arch!==(arch==='x64'?'x86_64':arch==='arm64'?'aarch64':''))throw new Error('update-linux-root-target-invalid');
  // Only installed, root-owned defaults supply the trust anchor. No request key or artifact is accepted.
  const verified=verifyManifest(request.envelope,defaults);const artifact=verified.manifest.artifacts.find(item=>item.target===request.target);
  if(!artifact||artifact.installKind!==shape.kind||compareVersion(verified.manifest.version,currentVersion)<=0)throw new Error('update-linux-root-version-invalid');
  const trustedKey=defaults.trustedKeys[verified.keyId];if(!trustedKey)throw new Error('update-linux-root-key-unavailable');
  return {request,manifest:verified.manifest,artifact,trustedKey};
}
export function rootOwnedStat(stat:{uid:number;mode:number;isSymbolicLink():boolean;isFile():boolean;isDirectory():boolean},directory=false):void{
  if(stat.uid!==0||(stat.mode&0o022)!==0||stat.isSymbolicLink()||!(directory?stat.isDirectory():stat.isFile()))throw new Error('update-linux-root-code-untrusted');
}
export async function assertRootOwned(file:string,directory=false):Promise<void>{
  if(!absolute(file))throw new Error('update-linux-root-code-untrusted');
  rootOwnedStat(await fsp.lstat(file),directory);
  for(let parent=path.dirname(file);;parent=path.dirname(parent)){rootOwnedStat(await fsp.lstat(parent),true);if(parent===path.dirname(parent))break;}
}
export async function resolveLinuxRootCommand(command:LinuxCommand):Promise<LinuxCommand>{
  // System package managers may use a root-controlled symlink as their entry point.
  await assertRootOwned(path.dirname(command.file),true);
  const file=await fsp.realpath(command.file);await assertRootOwned(file);
  return {file,args:command.args};
}
export function linuxRootCommand(resourceRoot:string,requestFile:string):{file:string;args:string[]}{
  if(!absolute(resourceRoot)||!absolute(requestFile))throw new Error('update-linux-root-request-invalid');
  const desktop=path.posix.join(resourceRoot,'dsh-desktop');return {file:'/usr/bin/pkexec',args:['--disable-internal-agent',path.posix.join(desktop,'vendor/node/node'),'--no-addons','--no-global-search-paths',path.posix.join(desktop,'lib/desktop/update-linux-root.js'),'--install',requestFile]};
}
export function linuxAuthorizationEnvironment(env:NodeJS.ProcessEnv):NodeJS.ProcessEnv{
  const safe:NodeJS.ProcessEnv={PATH:SAFE_ENV.PATH,LANG:SAFE_ENV.LANG,LC_ALL:SAFE_ENV.LC_ALL};
  for(const key of ['DISPLAY','WAYLAND_DISPLAY','XAUTHORITY','DBUS_SESSION_BUS_ADDRESS','XDG_RUNTIME_DIR'])if(env[key]&&!env[key]!.includes('\0'))safe[key]=env[key];return safe;
}
async function readRequest(file:string,uid:number):Promise<unknown>{
  const handle=await fsp.open(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{const stat=await handle.stat();if(!stat.isFile()||stat.uid!==uid||(stat.mode&0o077)!==0||stat.size<1||stat.size>3*1024*1024)throw new Error('update-linux-root-request-invalid');return JSON.parse(await handle.readFile('utf8'));}finally{await handle.close();}
}
const query:LinuxQuery=command=>new Promise((resolve,reject)=>cp.execFile(command.file,command.args,{cwd:'/',env:SAFE_ENV,encoding:'utf8',timeout:10000,maxBuffer:256*1024,windowsHide:true},(error,stdout)=>error?reject(new Error('update-linux-query-failed')):resolve(stdout)));
export async function copyLinuxRootPackage(source:string,target:string,uid:number,size:number):Promise<void>{
  const input=await fsp.open(source,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let output:Awaited<ReturnType<typeof fsp.open>>|undefined;
  try{const stat=await input.stat();if(!stat.isFile()||stat.uid!==uid||stat.size!==size)throw new Error('update-linux-root-package-invalid');
    output=await fsp.open(target,'wx',0o600);const buffer=Buffer.allocUnsafe(1024*1024);let bytes=0;
    for(;;){const count=(await input.read(buffer,0,Math.min(buffer.length,size+1-bytes),bytes)).bytesRead;if(!count)break;bytes+=count;
      if(bytes>size)throw new Error('update-linux-root-package-invalid');let written=0;
      while(written<count){const result=await output.write(buffer,written,count-written,null);if(!result.bytesWritten)throw new Error('update-linux-root-package-invalid');written+=result.bytesWritten;}
    }
    if(bytes!==size)throw new Error('update-linux-root-package-invalid');await output.sync();
  }finally{await output?.close();await input.close();}
}
function alive(pid:number):boolean{try{process.kill(pid,0);return true;}catch(error){return (error as NodeJS.ErrnoException).code!=='ESRCH';}}
async function runRoot(file:string):Promise<void>{
  if(process.platform!=='linux'||!process.getuid||process.getuid()!==0||!/^([1-9][0-9]*)$/.test(process.env.PKEXEC_UID||''))throw new Error('update-linux-root-authorization-required');
  const uid=Number(process.env.PKEXEC_UID);if(!Number.isSafeInteger(uid)||uid<1)throw new Error('update-linux-root-authorization-required');
  process.umask(0o077);const desktop=path.resolve(__dirname,'../..');
  // Validate every local code dependency before requiring any application module as root.
  for(const name of MODULES)await assertRootOwned(path.join(__dirname,name));
  for(const name of ['package.json','client-update-defaults.json','vendor/node/node'])await assertRootOwned(path.join(desktop,name));
  if(path.resolve(process.execPath)!==path.join(desktop,'vendor/node/node'))throw new Error('update-linux-root-code-untrusted');
  const {inspectLinuxOwner,inspectLinuxPackage,linuxTarget,linuxManager,linuxInstallCommand}=require('./update-linux') as typeof import('./update-linux');
  const {withPortableLock}=require('./update-portable-lock') as typeof import('./update-portable-lock');
  const defaults=JSON.parse(await fsp.readFile(path.join(desktop,'client-update-defaults.json'),'utf8')) as UpdateDefaults;
  const raw=await readRequest(file,uid) as LinuxRootRequest;
  // Verify the signature before interpreting any package path or invoking package utilities.
  const first=linuxRootSpec(raw,defaults,'0.0.0',process.arch);const shape=linuxTarget(first.request.target);if(shape.kind==='appimage')throw new Error('update-linux-root-target-invalid');
  await assertRootOwned(raw.executable);const owner=await inspectLinuxOwner(raw.executable,raw.target,query);
  for(const owned of [__filename,process.execPath]){const item=await inspectLinuxOwner(owned,raw.target,query);if(item.version!==owner.version)throw new Error('update-linux-root-owner-invalid');}
  const kind=shape.kind;const spec=linuxRootSpec(raw,defaults,owner.version,process.arch);const manager=linuxManager(await fsp.readFile('/etc/os-release','utf8'),kind);
  await fsp.mkdir(ROOT_CACHE,{mode:0o700,recursive:true});await assertRootOwned(ROOT_CACHE,true);
  await withPortableLock(ROOT_CACHE,async()=>{
    const installed=await inspectLinuxOwner(raw.executable,raw.target,query);if(installed.version!==owner.version)throw new Error('update-linux-root-installed-version-changed');
    const directory=await fsp.mkdtemp(path.join(ROOT_CACHE,raw.transactionId+'-'));await assertRootOwned(directory,true);
    const space=await fsp.statfs(directory);if(space.bavail*space.bsize<spec.artifact.size+32*1024*1024)throw new Error('update-linux-disk-space');
    const packageFile=path.join(directory,'installer.'+shape.kind);await copyLinuxRootPackage(raw.packageFile,packageFile,uid,spec.artifact.size);
    await inspectLinuxPackage({file:packageFile,artifact:spec.artifact,trustedKey:spec.trustedKey,version:spec.manifest.version,target:raw.target},query);
    const lines=createInterface({input:process.stdin});const grant=new Promise<boolean>(resolve=>{let answered=false;lines.once('line',line=>{answered=true;try{const value=JSON.parse(line);resolve(value.action==='install'&&value.token===raw.token);}catch{resolve(false);}});lines.once('close',()=>{if(!answered)resolve(false);});});
    process.stdout.write(JSON.stringify({schemaVersion:1,ready:true,transactionId:raw.transactionId,version:spec.manifest.version,target:raw.target,token:raw.token})+'\n');
    if(!await grant){lines.close();return;}lines.close();
    if(raw.owners.some(alive))throw new Error('update-install-processes-still-running');
    const before=await inspectLinuxOwner(raw.executable,raw.target,query);if(before.version!==owner.version)throw new Error('update-linux-root-installed-version-changed');
    await inspectLinuxPackage({file:packageFile,artifact:spec.artifact,trustedKey:spec.trustedKey,version:spec.manifest.version,target:raw.target},query);
    const command=await resolveLinuxRootCommand(linuxInstallCommand(manager,packageFile,kind));
    const exitCode=await new Promise<number|null>((resolve,reject)=>{const child=cp.spawn(command.file,command.args,{cwd:'/',env:SAFE_ENV,stdio:'ignore'});child.once('error',()=>reject(new Error('update-linux-manager-unavailable')));child.once('exit',resolve);});
    if(exitCode!==0)throw new Error('update-linux-package-manager-failed');await assertRootOwned(raw.executable);
    const after=await inspectLinuxOwner(raw.executable,raw.target,query);if(after.version!==spec.manifest.version)throw new Error('update-linux-installed-version-mismatch');
    process.stdout.write(JSON.stringify({schemaVersion:1,installed:true,transactionId:raw.transactionId,version:after.version,target:raw.target,exitCode:0,token:raw.token})+'\n');
  });
}
if(require.main===module){const args=process.argv.slice(2);void (args.length===2&&args[0]==='--install'?runRoot(args[1]!):Promise.reject(new Error('update-linux-root-arguments-invalid'))).catch(error=>{const code=error instanceof Error&&/^update-[a-z-]+$/.test(error.message)?error.message:'update-linux-root-verification-failed';process.stderr.write(code+'\n');process.exitCode=1;});}
