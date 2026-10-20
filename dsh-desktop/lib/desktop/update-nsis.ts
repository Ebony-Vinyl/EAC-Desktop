import cp = require('node:child_process');
import fs = require('node:fs');
import fsp = require('node:fs/promises');
import path = require('node:path');
import type {DataBinding} from './client-update';
import type {Artifact} from './update-sources';
import {compareVersion} from './update-sources';
import {verifyPackage} from './update-signature';
import {withPortableLock} from './update-portable-lock';
import {plainPath, assertInstallBoundary, writeDurableJson, pathsOverlap} from './update-backup';
export interface NsisPlan {
  schemaVersion: 1; transactionId: string; installRoot: string; transactionDir: string;
  version: string; previousVersion: string; target: string; installerFile: string;
  artifact: Artifact; trustedKey: string;
  dataBinding?: DataBinding;
  phase: 'prepared'|'installing'|'installed'|'health'|'committed'|'failed'|'cancelled';
  exitCode: number|null;
}
const PRODUCT_NAME='Deepseek Harness EAC';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function identity(value:unknown, target:string): {version:string} {
  const record=value as Record<string,unknown>|null;
  const arch=target==='windows-x86_64-nsis'?'x86_64':target==='windows-aarch64-nsis'?'aarch64':'';
  if(!record||!arch||record.schemaVersion!==1||record.product!=='eac-desktop'||record.installKind!=='nsis'||record.scope!=='currentUser'||record.arch!==arch||typeof record.version!=='string'||!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(record.version))throw new Error('update-nsis-installation-identity-invalid');
  return {version:record.version};
}
async function checkInstaller(file:string,version:string):Promise<void> {
  const command="$ErrorActionPreference='Stop';$v=[Diagnostics.FileVersionInfo]::GetVersionInfo($env:EAC_NSIS_PACKAGE);@{product=$v.ProductName;version=$v.ProductVersion}|ConvertTo-Json -Compress";
  const result=await new Promise<{product?:string;version?:string}>((resolve,reject)=>{
    cp.execFile('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{windowsHide:true,timeout:10000,env:{...process.env,EAC_NSIS_PACKAGE:file},encoding:'utf8'},(error,stdout)=>{
      if(error)return reject(new Error('update-nsis-package-metadata-unavailable'));
      try{resolve(JSON.parse(stdout.trim()));}catch{reject(new Error('update-nsis-package-metadata-invalid'));}
    });
  });
  if(result.product!==PRODUCT_NAME||result.version!==version)throw new Error('update-nsis-package-identity-mismatch');
}
export async function prepareNsis(options:{installRoot:string;transactionDir:string;transactionId:string;version:string;target:string;packageFile:string;artifact:Artifact;trustedKey:string;protectedRoots:string[];binding?:DataBinding;signal?:AbortSignal}):Promise<NsisPlan>{
  options.signal?.throwIfAborted();
  if(process.platform!=='win32')throw new Error('update-nsis-platform-unsupported');
  if(!UUID.test(options.transactionId)||options.artifact.target!==options.target||options.artifact.installKind!=='nsis')throw new Error('update-nsis-plan-invalid');
  const installRoot=await plainPath(options.installRoot);const transactionDir=await plainPath(options.transactionDir,true);
  if(pathsOverlap(installRoot,transactionDir))throw new Error('update-install-data-overlap');
  await assertInstallBoundary(installRoot,options.protectedRoots);
  await plainPath(path.join(installRoot,'eac-installation.json'));
  const installed=identity(JSON.parse(await fsp.readFile(path.join(installRoot,'eac-installation.json'),'utf8')),options.target);
  if(compareVersion(options.version,installed.version)<=0)throw new Error('update-nsis-version-not-newer');
  await verifyPackage(await plainPath(options.packageFile),options.artifact,options.trustedKey);
  await checkInstaller(options.packageFile,options.version);
  options.signal?.throwIfAborted();
  await fsp.mkdir(transactionDir,{recursive:false,mode:0o700});
  const installerFile=path.join(transactionDir,'installer.exe');await fsp.copyFile(options.packageFile,installerFile,fs.constants.COPYFILE_EXCL);
  const fd=await fsp.open(installerFile,'r+');try{await fd.sync();}finally{await fd.close();}
  await verifyPackage(installerFile,options.artifact,options.trustedKey);await checkInstaller(installerFile,options.version);
  options.signal?.throwIfAborted();
  const plan:NsisPlan={schemaVersion:1,transactionId:options.transactionId,installRoot,transactionDir,version:options.version,previousVersion:installed.version,target:options.target,installerFile,artifact:options.artifact,trustedKey:options.trustedKey,...(options.binding?{dataBinding:options.binding}:{}),phase:'prepared',exitCode:null};
  await writeDurableJson(path.join(transactionDir,'nsis-plan.json'),plan);return plan;
}
async function persist(plan:NsisPlan):Promise<void>{await writeDurableJson(path.join(plan.transactionDir,'nsis-plan.json'),plan);}
async function installNsisLocked(plan:NsisPlan,waitForOwners:()=>Promise<boolean>,health:()=>Promise<boolean>):Promise<void>{
  if(process.platform!=='win32')throw new Error('update-nsis-platform-unsupported');
  const stored=await readNsisPlan(plan.transactionDir,plan.installRoot);
  if(JSON.stringify(stored)!==JSON.stringify(plan)||plan.phase!=='prepared')throw new Error('update-nsis-plan-invalid');
  if(!await waitForOwners())throw new Error('update-owner-exit-unconfirmed');
  await plainPath(plan.installRoot);await plainPath(plan.installerFile);
  await verifyPackage(plan.installerFile,plan.artifact,plan.trustedKey);await checkInstaller(plan.installerFile,plan.version);
  const installed=identity(JSON.parse(await fsp.readFile(await plainPath(path.join(plan.installRoot,'eac-installation.json')),'utf8')),plan.target);
  if(installed.version!==plan.previousVersion)throw new Error('update-nsis-installation-changed');
  // NSIS consumes /D= plus the command-line remainder. It rejects a quoted /D
  // argument, so quote argv0 only and pass the final install path verbatim.
  if(/["\x00\r\n]/.test(plan.installerFile+plan.installRoot))throw new Error('update-nsis-path-invalid');
  plan.phase='installing';await persist(plan);
  try{
    const code=await new Promise<number|null>((resolve,reject)=>{
      const child=cp.spawn(plan.installerFile,['/S','/UPDATE','/D='+plan.installRoot],{windowsHide:true,windowsVerbatimArguments:true,argv0:'"'+plan.installerFile+'"',stdio:'ignore'});
      child.once('error',()=>reject(new Error('update-nsis-start-failed')));child.once('exit',(exitCode,signal)=>signal?reject(new Error('update-nsis-exit-unconfirmed')):resolve(exitCode));
    });
    plan.exitCode=code;if(code!==0)throw new Error('update-nsis-install-failed');
    plan.phase='installed';await persist(plan);
    const next=identity(JSON.parse(await fsp.readFile(await plainPath(path.join(plan.installRoot,'eac-installation.json')),'utf8')),plan.target);
    if(next.version!==plan.version)throw new Error('update-nsis-result-identity-mismatch');
    plan.phase='health';await persist(plan);if(!await health())throw new Error('update-health-unconfirmed');
    plan.phase='committed';await persist(plan);
  }catch(error){plan.phase='failed';await persist(plan);throw error;}
}
export function installNsis(plan:NsisPlan,waitForOwners:()=>Promise<boolean>,health:()=>Promise<boolean>):Promise<void>{
  return withPortableLock(plan.installRoot,()=>installNsisLocked(plan,waitForOwners,health));
}

export async function readNsisPlan(transactionDir:string,installRoot:string):Promise<NsisPlan>{
  transactionDir=await plainPath(transactionDir);installRoot=await plainPath(installRoot);
  const plan=JSON.parse(await fsp.readFile(await plainPath(path.join(transactionDir,'nsis-plan.json')),'utf8')) as NsisPlan;
  if(!plan||plan.schemaVersion!==1||!UUID.test(plan.transactionId)||plan.installRoot!==installRoot||plan.transactionDir!==transactionDir
    ||pathsOverlap(installRoot,transactionDir)||plan.installerFile!==path.join(transactionDir,'installer.exe')
    ||!['prepared','installing','installed','health','committed','failed','cancelled'].includes(plan.phase)
    ||(plan.exitCode!==null&&(!Number.isSafeInteger(plan.exitCode)||plan.exitCode<0))
    ||typeof plan.trustedKey!=='string'||!plan.artifact||plan.artifact.installKind!=='nsis'||plan.artifact.target!==plan.target
    ||typeof plan.previousVersion!=='string'||typeof plan.version!=='string'||!/^windows-(x86_64|aarch64)-nsis$/.test(plan.target)
    ||!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(plan.previousVersion)
    ||!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(plan.version)
    ||compareVersion(plan.version,plan.previousVersion)<=0)throw new Error('update-nsis-plan-invalid');
  return plan;
}
export async function clearNsisPointer(plan:NsisPlan):Promise<void>{
  const file=path.join(plan.installRoot,'.eac-update-recovery.json');
  if(!fs.existsSync(file))return;
  const value=JSON.parse(await fsp.readFile(await plainPath(file),'utf8'));
  if(value.schemaVersion!==1||value.installKind!=='nsis'||value.transactionId!==plan.transactionId||value.transactionDir!==plan.transactionDir)throw new Error('update-recovery-pointer-invalid');
  await fsp.unlink(file);
}
export function cancelNsis(plan:NsisPlan):Promise<void>{
  return withPortableLock(plan.installRoot,async()=>{
    const current=await readNsisPlan(plan.transactionDir,plan.installRoot);
    if(current.phase!=='prepared')throw new Error('update-nsis-plan-invalid');
    plan.phase='cancelled';await persist(plan);await clearNsisPointer(plan);
  });
}
