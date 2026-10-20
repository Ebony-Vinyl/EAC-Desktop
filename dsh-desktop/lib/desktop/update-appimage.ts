import fs = require('node:fs');
import fsp = require('node:fs/promises');
import path = require('node:path');
import {plainPath, pathsOverlap, writeDurableJson} from './update-backup';
import {withPortableLock, assertPortableLock} from './update-portable-lock';
import {hashFile} from './update-package';
import {verifyPackage} from './update-signature';
import {compareVersion} from './update-sources';
import {linuxTarget, inspectAppImage} from './update-linux';
import type {Artifact} from './update-sources';
import type {DataBinding} from './client-update';
export type AppImagePhase='prepared'|'moving-current'|'current-moved'|'moving-candidate'|'health'|'committed'|'rolling-back'|'rolled-back'|'cancelled';
export interface AppImagePlan {
  schemaVersion:1;installKind:'appimage';transactionId:string;transactionDir:string;installRoot:string;
  sourcePackageFile:string;candidateFile:string;previousFile:string;rejectedFile:string;version:string;previousVersion:string;target:string;
  previousSha256:string;previousSize:number;executableMode:number;artifact:Artifact;trustedKey:string;
  dataBinding:DataBinding;phase:AppImagePhase;
}
export interface PrepareAppImage {
  transactionId:string;transactionDir:string;image:string;packageFile:string;version:string;currentVersion:string;
  target:string;artifact:Artifact;trustedKey:string;binding:DataBinding;protectedRoots:string[];signal?:AbortSignal;
}
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const VERSION=/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const PHASES:AppImagePhase[]=['prepared','moving-current','current-moved','moving-candidate','health','committed','rolling-back','rolled-back','cancelled'];
export function appImagePointer(image:string):string{return path.join(path.dirname(image),'.'+path.basename(image)+'.eac-update.json');}
async function assertDataBoundary(image:string,transactionDir:string,roots:string[]):Promise<void>{
  const targets=[image,transactionDir,appImagePointer(image),path.join(path.dirname(image),'.eac-update-lock')];
  for(const root of roots){
    if(!root)continue;const protectedPath=await plainPath(root,true);
    if(targets.some(target=>pathsOverlap(target,protectedPath)))throw new Error('update-install-data-overlap');
  }
}

async function exists(file:string):Promise<boolean>{try {await fsp.lstat(file);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}}
async function syncDirectory(directory:string):Promise<void>{
  if(process.platform==='win32')return;
  const handle=await fsp.open(directory,'r');try {await handle.sync();}finally {await handle.close();}
}
async function move(source:string,destination:string):Promise<void>{
  assertPortableLock();await plainPath(source);await plainPath(destination,true);
  if(await exists(destination))throw new Error('update-appimage-destination-exists');
  await fsp.rename(source,destination);await syncDirectory(path.dirname(source));
  if(path.dirname(source)!==path.dirname(destination))await syncDirectory(path.dirname(destination));
}
async function save(plan:AppImagePlan,phase:AppImagePhase):Promise<void>{
  assertPortableLock();plan.phase=phase;await writeDurableJson(path.join(plan.transactionDir,'appimage-plan.json'),plan);
}
async function validate(plan:AppImagePlan,transactionDir:string,image:string):Promise<void>{
  if(!plan||plan.schemaVersion!==1||plan.installKind!=='appimage'||!UUID.test(plan.transactionId)||!PHASES.includes(plan.phase)
    ||plan.transactionDir!==transactionDir||plan.installRoot!==image||transactionDir!==path.join(path.dirname(image),'.eac-update-'+plan.transactionId)
    ||typeof plan.sourcePackageFile!=='string'||!path.isAbsolute(plan.sourcePackageFile)||plan.candidateFile!==path.join(transactionDir,'candidate.AppImage')||plan.previousFile!==path.join(transactionDir,'previous.AppImage')||plan.rejectedFile!==path.join(transactionDir,'rejected.AppImage')
    ||!VERSION.test(plan.version)||!VERSION.test(plan.previousVersion)||compareVersion(plan.version,plan.previousVersion)<=0
    ||!Number.isSafeInteger(plan.previousSize)||plan.previousSize<64||!Number.isInteger(plan.executableMode)||plan.executableMode<0||plan.executableMode>0o777
    ||!/^[a-f0-9]{64}$/.test(plan.previousSha256)||!plan.artifact||plan.previousSha256===plan.artifact.sha256||plan.artifact.target!==plan.target||plan.artifact.installKind!=='appimage'
    ||typeof plan.trustedKey!=='string'||linuxTarget(plan.target).kind!=='appimage')throw new Error('update-appimage-plan-invalid');
  for(const file of [image,transactionDir,plan.sourcePackageFile,plan.candidateFile,plan.previousFile,plan.rejectedFile,appImagePointer(image)])await plainPath(file,true);
  const binding=plan.dataBinding;
  if(!binding||!['stable','beta'].includes(binding.channel)||typeof binding.profile!=='string'||!binding.profile||!Number.isInteger(binding.webPort)||binding.webPort<1||binding.webPort>65535)throw new Error('update-appimage-binding-invalid');
  for(const root of [binding.environmentRoot,binding.dshHome,binding.userDataDir,binding.registryHome,binding.webviewRoot,binding.configRoot,binding.guestRoot]){
    if(typeof root!=='string'||!path.isAbsolute(root))throw new Error('update-appimage-binding-invalid');
    await assertDataBoundary(image,transactionDir,[root]);
  }
}
export async function readAppImagePlan(transactionDir:string,image:string):Promise<AppImagePlan>{
  transactionDir=await plainPath(transactionDir);image=await plainPath(image,true);
  const file=await plainPath(path.join(transactionDir,'appimage-plan.json'));
  if((await fsp.stat(file)).size>262144)throw new Error('update-appimage-plan-invalid');
  const plan=JSON.parse(await fsp.readFile(file,'utf8')) as AppImagePlan;await validate(plan,transactionDir,image);return plan;
}
async function currentPlan(input:AppImagePlan):Promise<AppImagePlan>{
  const plan=await readAppImagePlan(input.transactionDir,input.installRoot);
  if(JSON.stringify(plan)!==JSON.stringify(input))throw new Error('update-appimage-plan-changed');await ownedPointer(plan);return plan;
}
async function verifyPrevious(file:string,plan:AppImagePlan):Promise<void>{
  file=await plainPath(file);const stat=await fsp.stat(file);
  if(!stat.isFile()||stat.size!==plan.previousSize||await hashFile(file)!==plan.previousSha256)throw new Error('update-appimage-previous-changed');
}
async function verifyCandidate(file:string,plan:AppImagePlan):Promise<void>{await verifyPackage(await plainPath(file),plan.artifact,plan.trustedKey);await inspectAppImage(file,plan.target);}
export async function prepareAppImage(options:PrepareAppImage):Promise<AppImagePlan>{
  options.signal?.throwIfAborted();
  if(!UUID.test(options.transactionId)||!VERSION.test(options.version)||!VERSION.test(options.currentVersion)||compareVersion(options.version,options.currentVersion)<=0
    ||linuxTarget(options.target).kind!=='appimage'||options.artifact.target!==options.target||options.artifact.installKind!=='appimage')throw new Error('update-appimage-plan-invalid');
  const image=await plainPath(options.image);const directory=path.dirname(image);const transactionDir=await plainPath(options.transactionDir,true);
  if(transactionDir!==path.join(directory,'.eac-update-'+options.transactionId))throw new Error('update-appimage-plan-invalid');
  await assertDataBoundary(image,transactionDir,options.protectedRoots);
  await inspectAppImage(image,options.target);const previous=await fsp.stat(image);const owner=await fsp.stat(directory);
  if(!previous.isFile()||previous.size<64||previous.mode&0o6000)throw new Error('update-appimage-file-invalid');
  // Native ownership and writability are checked before preparing an in-place update.
  if(process.platform==='linux'&&(!process.getuid||previous.uid!==process.getuid()||owner.uid!==process.getuid()||owner.mode&0o022))throw new Error('update-appimage-permission-denied');
  try {await fsp.access(directory,fs.constants.W_OK|fs.constants.X_OK);await fsp.access(image,fs.constants.R_OK|fs.constants.X_OK);}
  catch {throw new Error('update-appimage-permission-denied');}
  const packageFile=await plainPath(options.packageFile);await verifyPackage(packageFile,options.artifact,options.trustedKey);await inspectAppImage(packageFile,options.target);
  const previousSha256=await hashFile(image);if(previousSha256===options.artifact.sha256)throw new Error('update-appimage-version-not-newer');
  const plan:AppImagePlan={schemaVersion:1,installKind:'appimage',transactionId:options.transactionId,transactionDir,installRoot:image,
    sourcePackageFile:packageFile,candidateFile:path.join(transactionDir,'candidate.AppImage'),previousFile:path.join(transactionDir,'previous.AppImage'),rejectedFile:path.join(transactionDir,'rejected.AppImage'),
    version:options.version,previousVersion:options.currentVersion,target:options.target,previousSha256,previousSize:previous.size,
    executableMode:(previous.mode&0o755)|0o100,artifact:options.artifact,trustedKey:options.trustedKey,dataBinding:options.binding,phase:'prepared'};
  await validate(plan,transactionDir,image);
  return withPortableLock(directory,async()=>{
    if(await exists(appImagePointer(image)))throw new Error('update-installation-in-progress');
    if(await exists(transactionDir))throw new Error('update-appimage-transaction-exists');
    await verifyPrevious(image,plan);options.signal?.throwIfAborted();
    const space=await fsp.statfs(directory);if(space.bavail*space.bsize<options.artifact.size+32*1024*1024)throw new Error('update-appimage-disk-space');
    await fsp.mkdir(transactionDir,{mode:0o700});
    if((await fsp.stat(transactionDir)).dev!==owner.dev)throw new Error('update-appimage-cross-device');
    await fsp.copyFile(packageFile,plan.candidateFile,fs.constants.COPYFILE_EXCL);await fsp.chmod(plan.candidateFile,0o600);
    const handle=await fsp.open(plan.candidateFile,'r+');try {await handle.chmod(plan.executableMode);await handle.sync();}finally {await handle.close();}
    await verifyCandidate(plan.candidateFile,plan);await verifyPrevious(image,plan);options.signal?.throwIfAborted();
    await save(plan,'prepared');
    await writeDurableJson(appImagePointer(image),{schemaVersion:1,installKind:'appimage',transactionId:plan.transactionId,transactionDir,image});return plan;
  });
}
async function ownedPointer(plan:AppImagePlan,allowMissing=false):Promise<void>{
  const file=appImagePointer(plan.installRoot);if(allowMissing&&!await exists(file))return;
  const pointer=JSON.parse(await fsp.readFile(await plainPath(file),'utf8'));
  if(pointer.schemaVersion!==1||pointer.installKind!=='appimage'||pointer.transactionId!==plan.transactionId||pointer.transactionDir!==plan.transactionDir||pointer.image!==plan.installRoot)throw new Error('update-recovery-pointer-invalid');
}
export async function clearAppImagePointer(plan:AppImagePlan):Promise<void>{
  assertPortableLock();const file=appImagePointer(plan.installRoot);await ownedPointer(plan,true);
  if(!await exists(file))return;await fsp.unlink(file);await syncDirectory(path.dirname(file));
}
export async function rollbackAppImage(input:AppImagePlan,stopCandidate:()=>Promise<boolean>):Promise<AppImagePlan>{
  return withPortableLock(path.dirname(input.installRoot),async()=>{
    const plan=await readAppImagePlan(input.transactionDir,input.installRoot);
    if(plan.phase==='committed')throw new Error('update-appimage-already-committed');
    await ownedPointer(plan,['rolled-back','cancelled'].includes(plan.phase));
    const previous=await exists(plan.previousFile);const current=await exists(plan.installRoot);
    if(!previous){
      if(!current)throw new Error('update-appimage-recovery-unconfirmed');await verifyPrevious(plan.installRoot,plan);
      if(['health','moving-candidate','current-moved'].includes(plan.phase))throw new Error('update-appimage-recovery-unconfirmed');
    }else{
      await verifyPrevious(plan.previousFile,plan);
      if(current){await verifyCandidate(plan.installRoot,plan);if(!await stopCandidate())throw new Error('update-appimage-candidate-still-running');}
      await save(plan,'rolling-back');
      if(current)await move(plan.installRoot,plan.rejectedFile);
      await move(plan.previousFile,plan.installRoot);await verifyPrevious(plan.installRoot,plan);
    }
    await save(plan,'rolled-back');await clearAppImagePointer(plan);return plan;
  });
}
export async function installAppImage(input:AppImagePlan,awaitOwners:()=>Promise<boolean>,health:()=>Promise<boolean>,stopCandidate:()=>Promise<boolean>,checkpoint?:(name:string)=>Promise<void>):Promise<AppImagePlan>{
  return withPortableLock(path.dirname(input.installRoot),async()=>{
    const plan=await currentPlan(input);if(plan.phase!=='prepared')throw new Error('update-appimage-not-prepared');
    await verifyCandidate(plan.candidateFile,plan);await verifyPrevious(plan.installRoot,plan);
    if(!await awaitOwners())throw new Error('update-install-processes-still-running');
    await verifyCandidate(plan.candidateFile,plan);await verifyPrevious(plan.installRoot,plan);
    try {
      await save(plan,'moving-current');await move(plan.installRoot,plan.previousFile);await checkpoint?.('current-moved');await save(plan,'current-moved');
      await save(plan,'moving-candidate');await move(plan.candidateFile,plan.installRoot);await checkpoint?.('candidate-moved');await save(plan,'health');await checkpoint?.('health-start');
      if(!await health())throw new Error('update-health-unconfirmed');
      await verifyCandidate(plan.installRoot,plan);await verifyPrevious(plan.previousFile,plan);await save(plan,'committed');await clearAppImagePointer(plan);return plan;
    }catch(error){const persisted=await readAppImagePlan(plan.transactionDir,plan.installRoot);if(persisted.phase!=='committed')await rollbackAppImage(persisted,stopCandidate);throw error;}
  });
}
export async function cancelAppImage(input:AppImagePlan):Promise<void>{
  await withPortableLock(path.dirname(input.installRoot),async()=>{
    const plan=await currentPlan(input);if(plan.phase!=='prepared')throw new Error('update-appimage-not-prepared');
    await verifyPrevious(plan.installRoot,plan);await save(plan,'cancelled');await clearAppImagePointer(plan);
  });
}
