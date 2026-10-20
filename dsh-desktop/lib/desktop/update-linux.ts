import cp = require('node:child_process');
import fs = require('node:fs');
import fsp = require('node:fs/promises');
import path = require('node:path');
import {plainPath, pathsOverlap, writeDurableJson, assertInstallBoundary} from './update-backup';
import {verifyPackage} from './update-signature';
import {compareVersion} from './update-sources';
import type {Artifact} from './update-sources';
import type {DataBinding} from './client-update';

export type LinuxInstallKind = 'appimage'|'deb'|'rpm';
export type LinuxManager = 'apt-get'|'dnf'|'zypper';
export interface LinuxCommand {file:string;args:string[];}
export type LinuxQuery = (command:LinuxCommand,signal?:AbortSignal)=>Promise<string>;
export interface LinuxIdentity {name:'deepseek-harness-eac';version:string;arch:string;release?:string;}
export interface LinuxPlatform {kind:LinuxInstallKind;arch:'x86_64'|'aarch64';packageArch:string;}
export type LinuxPackagePhase='prepared'|'authorizing'|'ready'|'installing'|'installed'|'health'|'committed'|'failed'|'cancelled';
export interface LinuxPackagePlan {
  schemaVersion:1;transactionId:string;installKind:'deb'|'rpm';target:string;version:string;previousVersion:string;
  executable:string;transactionDir:string;packageFile:string;artifact:Artifact;trustedKey:string;binding:DataBinding;
  manager:LinuxManager;identity:LinuxIdentity;installed:LinuxIdentity;phase:LinuxPackagePhase;
  resourceRoot:string;sourcePackageFile:string;envelope:unknown;systemInstallStarted:boolean;
}
const VERSION=/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const TOOLS={'dpkg-deb':'/usr/bin/dpkg-deb','dpkg-query':'/usr/bin/dpkg-query',rpm:'/usr/bin/rpm','apt-get':'/usr/bin/apt-get',dnf:'/usr/bin/dnf',zypper:'/usr/bin/zypper'} as const;
function text(value:string):void{if(typeof value!=='string'||value.includes('\0')||value.includes('\r')||value.length>65536)throw new Error('update-linux-metadata-invalid');}
export function linuxTarget(target:string):LinuxPlatform {
  const match=/^linux-(x86_64|aarch64)-(appimage|deb|rpm)$/.exec(target);
  if(!match)throw new Error('update-linux-target-invalid');
  const arch=match[1] as LinuxPlatform['arch'];const kind=match[2] as LinuxInstallKind;
  return {kind,arch,packageArch:kind==='deb'?(arch==='x86_64'?'amd64':'arm64'):arch};
}
export function parseLinuxIdentity(output:string,kind:'deb'|'rpm',installed=false):LinuxIdentity{
  text(output);const lines=output.trim().split('\n');
  if(lines.length!==1)throw new Error('update-linux-package-identity-invalid');
  const values=lines[0]!.split('\t');const expected=kind==='rpm'?4:installed?4:3;
  if(values.length!==expected||values[0]!=='deepseek-harness-eac'||!VERSION.test(values[1]!))throw new Error('update-linux-package-identity-invalid');
  const arch=kind==='rpm'?values[3]!:values[2]!;
  if(!(kind==='deb'?['amd64','arm64']:['x86_64','aarch64']).includes(arch)|| (kind==='deb'&&installed&&values[3]!=='installed'))throw new Error('update-linux-package-identity-invalid');
  if(kind==='rpm'&&!/^[A-Za-z0-9][A-Za-z0-9._+]{0,99}$/.test(values[2]!))throw new Error('update-linux-package-identity-invalid');
  return {name:'deepseek-harness-eac',version:values[1]!,arch,...(kind==='rpm'?{release:values[2]!}:{})};
}
export function linuxManager(osRelease:string,kind:'deb'|'rpm'):LinuxManager{
  text(osRelease);const fields=new Map<string,string>();
  for(const line of osRelease.split('\n')){
    if(!line.trim()||line.trimStart().startsWith('#'))continue;
    const match=/^([A-Z_][A-Z_0-9]*)=(.*)$/.exec(line);
    if(!match)throw new Error('update-linux-distribution-invalid');
    const key=match[1]!;let value=match[2]!;
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
    else if(/[\s'"\\]/.test(value))throw new Error('update-linux-distribution-invalid');
    if(fields.has(key))throw new Error('update-linux-distribution-invalid');fields.set(key,value);
  }
  const id=fields.get('ID');const like=fields.get('ID_LIKE')||'';
  if(!id||!/^[-a-z0-9]+$/.test(id)||!/^[-a-z0-9 ]*$/.test(like))throw new Error('update-linux-distribution-invalid');
  const families=new Set([id,...like.split(' ').filter(Boolean)]);
  if(kind==='deb'&&['debian','ubuntu'].some(f=>families.has(f)))return 'apt-get';
  if(kind==='rpm'&&['opensuse','opensuse-leap','opensuse-tumbleweed','suse','sles'].some(f=>families.has(f)))return 'zypper';
  if(kind==='rpm'&&['fedora','rhel','centos','rocky','almalinux'].some(f=>families.has(f)))return 'dnf';
  throw new Error('update-linux-distribution-unsupported');
}
function packagePath(file:string,kind:'deb'|'rpm'):void{
  if(typeof file!=='string'||!path.posix.isAbsolute(file)||file.includes('\\')||/[\x00-\x1f\x7f]/.test(file)||!file.endsWith('.'+kind))throw new Error('update-linux-package-path-invalid');
}
export function linuxInstallCommand(manager:LinuxManager,file:string,kind:'deb'|'rpm'):LinuxCommand{
  packagePath(file,kind);
  if(manager==='apt-get'&&kind==='deb')return {file:TOOLS['apt-get'],args:['--yes','--no-remove','--only-upgrade','--no-install-recommends','install','--',file]};
  if(manager==='dnf'&&kind==='rpm')return {file:TOOLS.dnf,args:['--assumeyes','--setopt=install_weak_deps=False','upgrade','--',file]};
  if(manager==='zypper'&&kind==='rpm')return {file:TOOLS.zypper,args:['--non-interactive','install','--no-recommends','--',file]};
  throw new Error('update-linux-manager-invalid');
}
const query:LinuxQuery=(command,signal)=>new Promise((resolve,reject)=>{
  cp.execFile(command.file,command.args,{encoding:'utf8',timeout:10000,maxBuffer:256*1024,env:{...process.env,LC_ALL:'C',LANG:'C'},...(signal?{signal}:{})},(error,stdout)=>{
    if(error)return reject(new Error(signal?.aborted?'update-cancelled':'update-linux-query-failed'));resolve(stdout);
  });
});
export function linuxPackageQuery(file:string,kind:'deb'|'rpm'):LinuxCommand{
  if(kind==='deb')return {file:TOOLS['dpkg-deb'],args:['--show','--showformat=${Package}\t${Version}\t${Architecture}\n',file]};
  return {file:TOOLS.rpm,args:['--query','--package','--queryformat','%{NAME}\t%{VERSION}\t%{RELEASE}\t%{ARCH}\n','--',file]};
}
export async function inspectLinuxPackage(options:{file:string;artifact:Artifact;trustedKey:string;version:string;target:string;signal?:AbortSignal},run:LinuxQuery=query):Promise<LinuxIdentity>{
  const target=linuxTarget(options.target);
  if(target.kind==='appimage'||options.artifact.target!==options.target||options.artifact.installKind!==target.kind||!VERSION.test(options.version))throw new Error('update-linux-package-identity-invalid');
  options.signal?.throwIfAborted();const file=await plainPath(options.file);if(!(await fsp.stat(file)).isFile())throw new Error('update-linux-package-path-invalid');
  await verifyPackage(file,options.artifact,options.trustedKey);options.signal?.throwIfAborted();
  const handle=await fsp.open(file,'r');const header=Buffer.alloc(8);try{if((await handle.read(header,0,8,0)).bytesRead!==8)throw new Error('update-linux-package-format-invalid');}finally{await handle.close();}
  if(target.kind==='deb'?header.toString('ascii')!=='!<arch>\n':header.readUInt32BE(0)!==0xedabeedb)throw new Error('update-linux-package-format-invalid');
  const identity=parseLinuxIdentity(await run(linuxPackageQuery(file,target.kind),options.signal),target.kind);
  if(identity.version!==options.version||identity.arch!==target.packageArch)throw new Error('update-linux-package-identity-mismatch');
  // Metadata utilities read the same file later, so verify its bytes once more.
  await verifyPackage(file,options.artifact,options.trustedKey);options.signal?.throwIfAborted();return identity;
}
export async function inspectLinuxOwner(executable:string,target:string,run:LinuxQuery=query,signal?:AbortSignal):Promise<LinuxIdentity>{
  const shape=linuxTarget(target);if(shape.kind==='appimage'||!path.posix.isAbsolute(executable)||/[\x00-\x1f\x7f]/.test(executable))throw new Error('update-linux-owner-invalid');
  let identity:LinuxIdentity;
  if(shape.kind==='deb'){
    const owner=await run({file:TOOLS['dpkg-query'],args:['--search','--',executable]},signal);text(owner);
    const rows=owner.trim().split('\n');if(rows.length!==1||!rows[0]!.endsWith(': '+executable))throw new Error('update-linux-owner-invalid');
    const name=rows[0]!.slice(0,-(': '+executable).length);
    if(name!=='deepseek-harness-eac'&&name!=='deepseek-harness-eac:'+shape.packageArch)throw new Error('update-linux-owner-invalid');
    identity=parseLinuxIdentity(await run({file:TOOLS['dpkg-query'],args:['--show','--showformat=${Package}\t${Version}\t${Architecture}\t${db:Status-Status}\n','--','deepseek-harness-eac']},signal),'deb',true);
  }else identity=parseLinuxIdentity(await run({file:TOOLS.rpm,args:['--query','--file','--queryformat','%{NAME}\t%{VERSION}\t%{RELEASE}\t%{ARCH}\n','--',executable]},signal),'rpm',true);
  if(identity.arch!==shape.packageArch)throw new Error('update-linux-owner-invalid');return identity;
}
export async function inspectAppImage(file:string,target:string):Promise<void>{
  const shape=linuxTarget(target);if(shape.kind!=='appimage')throw new Error('update-linux-target-invalid');
  const handle=await fsp.open(await plainPath(file),'r');const header=Buffer.alloc(64);
  try{if((await handle.stat()).isFile()!==true||(await handle.read(header,0,64,0)).bytesRead!==64)throw new Error('update-appimage-format-invalid');}finally{await handle.close();}
  if(header.readUInt32BE(0)!==0x7f454c46||header[4]!==2||header[5]!==1||header[8]!==0x41||header[9]!==0x49||header[10]!==2
    ||header.readUInt16LE(18)!==(shape.arch==='x86_64'?62:183))throw new Error('update-appimage-format-invalid');
}
export async function prepareLinuxPackage(options:{transactionId:string;transactionDir:string;executable:string;packageFile:string;artifact:Artifact;trustedKey:string;version:string;currentVersion:string;target:string;binding:DataBinding;resourceRoot:string;envelope:unknown;protectedRoots:string[];signal?:AbortSignal}):Promise<LinuxPackagePlan>{
  if(process.platform!=='linux')throw new Error('update-linux-platform-unsupported');
  const shape=linuxTarget(options.target);if(shape.arch!==(process.arch==='x64'?'x86_64':process.arch==='arm64'?'aarch64':'')||shape.kind==='appimage'||!UUID.test(options.transactionId))throw new Error('update-linux-plan-invalid');
  const executable=await plainPath(options.executable);const transactionDir=await plainPath(options.transactionDir,true);
  if(!options.envelope||transactionDir!==path.join(path.dirname(options.packageFile),'linux-install'))throw new Error('update-linux-plan-invalid');
  const resourceRoot=await plainPath(options.resourceRoot);
  const {assertRootOwned}=require('./update-linux-root') as typeof import('./update-linux-root');
  await assertRootOwned(resourceRoot,true);await assertRootOwned(path.join(resourceRoot,'dsh-desktop/vendor/node/node'));await assertRootOwned(path.join(resourceRoot,'dsh-desktop/lib/desktop/update-linux-root.js'));
  await assertInstallBoundary(resourceRoot,options.protectedRoots);
  if(pathsOverlap(executable,transactionDir))throw new Error('update-install-data-overlap');await assertInstallBoundary(executable,options.protectedRoots);
  const stat=await fsp.stat(executable);if(stat.uid!==0||(stat.mode&0o022)!==0)throw new Error('update-linux-owner-invalid');
  const installed=await inspectLinuxOwner(executable,options.target,query,options.signal);
  if(installed.version!==options.currentVersion||compareVersion(options.version,installed.version)<=0)throw new Error('update-linux-version-not-newer');
  const identity=await inspectLinuxPackage({file:options.packageFile,artifact:options.artifact,trustedKey:options.trustedKey,version:options.version,target:options.target,...(options.signal?{signal:options.signal}:{})});
  const manager=linuxManager(await fsp.readFile('/etc/os-release','utf8'),shape.kind);
  if(!fs.existsSync(TOOLS[manager]))throw new Error('update-linux-manager-unavailable');
  options.signal?.throwIfAborted();await fsp.mkdir(transactionDir,{recursive:false,mode:0o700});
  const space=await fsp.statfs(transactionDir);if(space.bavail*space.bsize<options.artifact.size+32*1024*1024)throw new Error('update-linux-disk-space');
  const packageFile=path.join(transactionDir,'installer.'+shape.kind);await fsp.copyFile(options.packageFile,packageFile,fs.constants.COPYFILE_EXCL);const output=await fsp.open(packageFile,'r+');try{await output.sync();}finally{await output.close();}
  await inspectLinuxPackage({file:packageFile,artifact:options.artifact,trustedKey:options.trustedKey,version:options.version,target:options.target,...(options.signal?{signal:options.signal}:{})});options.signal?.throwIfAborted();
  const plan:LinuxPackagePlan={schemaVersion:1,transactionId:options.transactionId,transactionDir,installKind:shape.kind,target:options.target,version:options.version,previousVersion:installed.version,executable,packageFile,artifact:options.artifact,trustedKey:options.trustedKey,binding:options.binding,manager,identity,installed,phase:'prepared',resourceRoot,sourcePackageFile:options.packageFile,envelope:options.envelope,systemInstallStarted:false};
  await writeDurableJson(path.join(transactionDir,'linux-plan.json'),plan);return plan;
}

export function appImageRuntimePaths(executable:string,env:NodeJS.ProcessEnv=process.env):{image:string;appDir:string}{
  const image=env.APPIMAGE;const appDir=env.APPDIR;
  if(typeof executable!=='string'||!path.isAbsolute(executable)||!image||!path.isAbsolute(image)||!appDir||!path.isAbsolute(appDir)||/[\x00-\x1f\x7f]/.test(executable+image+appDir))throw new Error('update-appimage-runtime-invalid');
  const relative=path.relative(path.resolve(appDir),path.resolve(executable));
  if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)||pathsOverlap(image,appDir))throw new Error('update-appimage-runtime-invalid');
  return {image:path.resolve(image),appDir:path.resolve(appDir)};
}
export async function inspectAppImageRuntime(executable:string,target:string,env:NodeJS.ProcessEnv=process.env):Promise<{image:string;appDir:string}>{
  const runtime=appImageRuntimePaths(executable,env);const image=await plainPath(runtime.image);const appDir=await plainPath(runtime.appDir);
  if(!appDir||!(await fsp.stat(appDir)).isDirectory()||!(await fsp.stat(await plainPath(executable))).isFile())throw new Error('update-appimage-runtime-invalid');
  await inspectAppImage(image,target);return {image,appDir};
}
export function appImageRestartEnvironment(base:NodeJS.ProcessEnv,launch:Record<string,string>,appDir?:string):NodeJS.ProcessEnv{
  const env:NodeJS.ProcessEnv={...base,...launch};
  for(const key of ['APPIMAGE','APPDIR','OWD','ARGV0','DSH_RESOURCE_ROOT','DSH_NODE_EXE','DSH_SHELL_EXE','DSH_SHELL_PID','DSH_SHELL_VERSION','DSH_SHELL_WEBVIEW_ROOT','DSH_SHELL_CONFIG_ROOT','DSH_SHELL_GUEST_ROOT','DSH_EAC_UPDATE_TRANSACTION_DIR','DSH_EAC_UPDATE_HEALTH_TOKEN','DSH_EAC_UPDATE_HEALTH_BOOT'])delete env[key];
  if(appDir){
    const inside=(entry:string)=>{if(!path.isAbsolute(entry))return false;const relative=path.relative(appDir,path.resolve(entry));return relative===''||(relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative));};
    for(const key of ['PATH','LD_LIBRARY_PATH','LD_AUDIT','XDG_DATA_DIRS','QT_PLUGIN_PATH','QT_QPA_PLATFORM_PLUGIN_PATH','PYTHONPATH'])if(env[key]!==undefined){const entries=env[key]!.split(':').filter(entry=>!inside(entry));if(entries.length)env[key]=entries.join(':');else delete env[key];}
    if(env.LD_PRELOAD!==undefined){const entries=env.LD_PRELOAD.split(/[:\s]+/).filter(entry=>!inside(entry));if(entries.length)env.LD_PRELOAD=entries.join(':');else delete env.LD_PRELOAD;}
    for(const key of ['GSETTINGS_SCHEMA_DIR','PYTHONHOME'])if(env[key]&&inside(env[key]!))delete env[key];
  }
  return env;
}

const PACKAGE_PHASES:LinuxPackagePhase[]=['prepared','authorizing','ready','installing','installed','health','committed','failed','cancelled'];
export async function readLinuxPackagePlan(transactionDir:string,executable:string):Promise<LinuxPackagePlan>{
  transactionDir=await plainPath(transactionDir);executable=await plainPath(executable);const file=await plainPath(path.join(transactionDir,'linux-plan.json'));
  if((await fsp.stat(file)).size>3*1024*1024)throw new Error('update-linux-plan-invalid');const plan=JSON.parse(await fsp.readFile(file,'utf8')) as LinuxPackagePlan;
  if(!plan||plan.schemaVersion!==1||!UUID.test(plan.transactionId)||plan.transactionDir!==transactionDir||plan.executable!==executable||!PACKAGE_PHASES.includes(plan.phase)
    ||!['deb','rpm'].includes(plan.installKind)||linuxTarget(plan.target).kind!==plan.installKind||plan.artifact?.target!==plan.target||plan.artifact?.installKind!==plan.installKind
    ||!VERSION.test(plan.version)||!VERSION.test(plan.previousVersion)||compareVersion(plan.version,plan.previousVersion)<=0||typeof plan.systemInstallStarted!=='boolean'
    ||typeof plan.sourcePackageFile!=='string'||!path.isAbsolute(plan.sourcePackageFile)||transactionDir!==path.join(path.dirname(plan.sourcePackageFile),'linux-install')
    ||path.basename(path.dirname(plan.sourcePackageFile))!==plan.transactionId||plan.packageFile!==path.join(transactionDir,'installer.'+plan.installKind)
    ||typeof plan.resourceRoot!=='string'||!path.isAbsolute(plan.resourceRoot)||!plan.envelope)throw new Error('update-linux-plan-invalid');
  for(const value of [plan.sourcePackageFile,plan.packageFile,plan.resourceRoot])await plainPath(value);return plan;
}
export async function cancelLinuxPackage(input:LinuxPackagePlan):Promise<void>{
  const plan=await readLinuxPackagePlan(input.transactionDir,input.executable);if(plan.systemInstallStarted||['installed','health','committed'].includes(plan.phase))throw new Error('update-linux-installation-already-started');
  plan.phase='cancelled';await writeDurableJson(path.join(plan.transactionDir,'linux-plan.json'),plan);
}
