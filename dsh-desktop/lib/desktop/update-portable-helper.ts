import fs = require('node:fs');
import fsp = require('node:fs/promises');
import path = require('node:path');
import cp = require('node:child_process');
import crypto = require('node:crypto');
import {createInterface} from 'node:readline';
import {plainPath, pathsOverlap, writeDurableJson, captureBackup} from './update-backup';
import {hashFile, verifyReleaseTree} from './update-package';
import {readPortableJournal, exchangePortable} from './update-portable';
import {withPortableLock} from './update-portable-lock';
import {captureProcessOwners} from './update-process-owners';
import {verifyPackage} from './update-signature';
import {inspectPortableArchive} from './update-archive';
import type {PortableJournal} from './update-portable';
import type {Artifact} from './update-sources';
import type {DataBinding} from './client-update';
import {helperMac, readHelperReceipt, writeHelperReceipt, startCopiedHelper} from './update-helper-process';
import type {UpdateHandoff, UpdateHelperHandle} from './update-helper-process';
export {helperMac, readHelperReceipt, writeHelperReceipt} from './update-helper-process';
const MODULES = ['update-helper-process.js','update-portable-helper.js','update-portable.js','update-portable-lock.js','update-package.js','update-backup.js','update-sources.js','update-signature.js','update-archive.js','update-process-owners.js','update-portable-archive.ps1'];
export interface PortableHandoff extends UpdateHandoff {}
export type PortableHelperHandle = UpdateHelperHandle;
function alive(pid: number): boolean {
  try {process.kill(pid,0);return true;} catch (error) {if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;return true;}
}
const pause = () => new Promise<void>(resolve=>setTimeout(resolve,100));
async function waitUntil(check: () => Promise<boolean>, timeout: number): Promise<boolean> {
  const deadline = Date.now()+timeout;
  while (Date.now()<deadline) {if (await check()) return true;await pause();}return false;
}
export async function startPortableHelper(options: {
  journal: PortableJournal; packageFile: string; artifact: Artifact; trustedKey: string; binding: DataBinding;
  owners: number[]; signal?: AbortSignal; dataBackupDirectory?: string; launchEnv?: Record<string,string>; ownerTimeoutMs?: number; healthTimeoutMs?: number;
}): Promise<PortableHelperHandle> {
  options.signal?.throwIfAborted();
  const journal = await readPortableJournal(options.journal.transactionDir,options.journal.installRoot);
  if (journal.phase!=='prepared') throw new Error('update-journal-phase-invalid');
  const token=crypto.randomBytes(32).toString('hex');
  const request:PortableHandoff={schemaVersion:1,transactionId:journal.transactionId,transactionDir:journal.transactionDir,installRoot:journal.installRoot,
    version:journal.version,target:journal.target,packageFile:options.packageFile,artifact:options.artifact,trustedKey:options.trustedKey,
    binding:options.binding,owners:await captureProcessOwners(options.owners),token,...(options.dataBackupDirectory ? {dataBackupDirectory:options.dataBackupDirectory} : {}),launchEnv:options.launchEnv||{},ownerTimeoutMs:options.ownerTimeoutMs??30000,healthTimeoutMs:options.healthTimeoutMs??120000};
  return startCopiedHelper(request,MODULES,'update-portable-helper.js',options.signal);
}
async function validatePortableHandoff(file: string, recovery = false): Promise<{request:PortableHandoff;journal:PortableJournal}> {
  await plainPath(file);const request=JSON.parse(await fsp.readFile(file,'utf8')) as PortableHandoff;
  if(!request||request.schemaVersion!==1||typeof request.token!=='string'||!/^[a-f0-9]{64}$/.test(request.token)
    || !Array.isArray(request.owners)||!request.owners.length||request.owners.some(pid=>!Number.isSafeInteger(pid)||pid<1||(!recovery&&pid===process.pid))
    || !Number.isSafeInteger(request.ownerTimeoutMs)||request.ownerTimeoutMs<100||request.ownerTimeoutMs>120000
    || !Number.isSafeInteger(request.healthTimeoutMs)||request.healthTimeoutMs<100||request.healthTimeoutMs>300000) throw new Error('update-helper-request-invalid');
  const journal=await readPortableJournal(request.transactionDir,request.installRoot);
  if((!recovery&&journal.phase!=='prepared')||journal.transactionId!==request.transactionId||journal.version!==request.version||journal.target!==request.target
    || path.resolve(file)!==path.join(journal.transactionDir,'helper/handoff.json') || JSON.stringify(journal.dataBinding)!==JSON.stringify(request.binding)
    || request.artifact.target!==request.target||request.artifact.installKind!=='portable')throw new Error('update-helper-request-invalid');
  await verifyPackage(await plainPath(request.packageFile),request.artifact,request.trustedKey);
  const archiveManifest=await inspectPortableArchive(request.packageFile,journal.version,journal.target);
  if(JSON.stringify(archiveManifest)!==JSON.stringify(journal.nextFiles))throw new Error('update-helper-package-tree-mismatch');
  if(!recovery)await verifyReleaseTree(path.join(journal.transactionDir,'new'),journal.nextFiles,journal.preserved);
  const owned=JSON.parse(await fsp.readFile(path.join(journal.transactionDir,'helper/files.json'),'utf8')) as {schemaVersion?:number;helperProtocolVersion?:number;transactionId?:string;files?:Array<{path:string;sha256:string}>};
  // The candidate reads the helper copied by the previous version. Protocol 1
  // predates the shared transport module; both closures remain exact and hashed.
  const protocol=owned.helperProtocolVersion===undefined?1:owned.helperProtocolVersion;
  if((protocol!==1&&protocol!==2)||(!recovery&&protocol!==2))throw new Error('update-helper-files-invalid');
  const modules=protocol===1?MODULES.filter(name=>name!=='update-helper-process.js'):MODULES;
  const expected=['node.exe',...modules.map(name=>'lib/desktop/'+name)];
  if(owned.schemaVersion!==1||owned.transactionId!==request.transactionId||!Array.isArray(owned.files)||owned.files.length!==expected.length)throw new Error('update-helper-files-invalid');
  for(const [index,relative] of expected.entries()){
    const item=owned.files[index];if(item?.path!==relative||await hashFile(await plainPath(path.join(journal.transactionDir,'helper',relative)))!==item.sha256)throw new Error('update-helper-files-invalid');
  }
  for(const root of [request.binding.environmentRoot,request.binding.dshHome,request.binding.userDataDir,request.binding.registryHome,request.binding.webviewRoot,request.binding.configRoot,request.binding.guestRoot]){
    if(typeof root!=='string'||!path.isAbsolute(root)||pathsOverlap(journal.installRoot,await plainPath(root,true)))throw new Error('update-helper-binding-invalid');
  }
  if (!Number.isInteger(request.binding.webPort) || request.binding.webPort<1 || request.binding.webPort>65535 || typeof request.binding.profile!=='string' || !request.binding.profile || !['stable','beta'].includes(request.binding.channel)) throw new Error('update-helper-binding-invalid');
  if(!request.launchEnv||typeof request.launchEnv!=='object'||Object.entries(request.launchEnv).some(([key,value])=>!['DSH_EAC_DATA_ROOT','DSH_EAC_CHANNEL','DSH_EAC_WEBVIEW_DATA_DIR','DSH_EAC_SHELL_CONFIG_DIR','DSH_EAC_GUEST_DATA_DIR','DPX_HOME'].includes(key)||typeof value!=='string'||value.includes('\0')))throw new Error('update-helper-environment-invalid');
  return {request,journal};
}
async function runTakeoverLocked(file: string): Promise<void> {
  const {request,journal}=await validatePortableHandoff(file);
  await writeHelperReceipt(path.join(journal.transactionDir,'helper-owner.json'),{schemaVersion:1,transactionId:journal.transactionId,pid:process.pid},request.token);
  const lines=createInterface({input:process.stdin});
  const grant=new Promise<boolean>(resolve=>{let answered=false;lines.once('line',line=>{answered=true;try {const value=JSON.parse(line);resolve(value.action==='install'&&value.token===request.token);}catch {resolve(false);}});lines.once('close',()=>{if(!answered)resolve(false);});});
  process.stdout.write(JSON.stringify({accepted:true,transactionId:journal.transactionId,pid:process.pid,token:request.token})+'\n');
  if(!await grant){lines.close();return;}lines.close();
  const owners=await captureProcessOwners(request.owners,process.pid);
  await writeHelperReceipt(path.join(journal.transactionDir,'owner-wait.json'),{schemaVersion:1,transactionId:journal.transactionId,owners},request.token);
  let candidate:cp.ChildProcess|null=null;let spawnFailed=false;let candidateOwners:number[]=[];
  const stopCandidate=async():Promise<boolean>=>{
    if(!candidate||spawnFailed)return true;
    candidateOwners=await captureProcessOwners([candidate.pid!]);
    const gateFailure=await readHelperReceipt(path.join(journal.transactionDir,'boot-gate-failed.json'),request.token);
    if(gateFailure?.transactionId===journal.transactionId&&gateFailure.shellPid===candidate.pid&&gateFailure.sidecarStarted===false&&candidateOwners.every(pid=>!alive(pid)))return true;
    const payload={schemaVersion:1,transactionId:journal.transactionId,shellPid:candidate.pid,action:'stop-for-recovery'};
    await writeDurableJson(path.join(journal.transactionDir,'stop-request.json'),{payload,mac:helperMac(payload,request.token)});
    return waitUntil(async()=>{
      const stopped=await readHelperReceipt(path.join(journal.transactionDir,'boot-stopped.json'),request.token);
      return !!stopped && stopped.transactionId===journal.transactionId && stopped.shellPid===candidate!.pid && (stopped.rootDisposed===true||(stopped.kernelExitedBeforeAdmission===true&&stopped.admissionHeld===true))
        && typeof stopped.sidecarPid==='number' && (typeof stopped.kernelPid==='number'||(stopped.kernelPid===null&&stopped.kernelNeverStarted===true))
        && Array.isArray(stopped.owners) && stopped.owners.includes(candidate!.pid) && stopped.owners.includes(stopped.sidecarPid) && (stopped.kernelPid===null||stopped.owners.includes(stopped.kernelPid)) && stopped.owners.every(pid=>typeof pid==='number'&&Number.isSafeInteger(pid)&&pid>0&&!alive(pid)) && candidateOwners.every(pid=>!alive(pid));
    },30000);
  };
  try {
    await exchangePortable(journal,
      async()=>{
        if(!await waitUntil(async()=>owners.every(pid=>!alive(pid)),request.ownerTimeoutMs))return false;
        const roots=[{id:'webview',path:request.binding.webviewRoot,required:false},{id:'guests',path:request.binding.guestRoot,required:false}];
        try{await captureBackup(roots,path.join(journal.transactionDir,'cold-browser-backup'),new AbortController().signal);}
        catch(error){const code=(error as NodeJS.ErrnoException).code;if(code&&['ENOENT','EBUSY','EPERM','EACCES','ENOSPC','EIO'].includes(code))throw new Error('update-cold-backup-'+code.toLowerCase());throw error;}return true;
      },
      async()=>{
        const env:NodeJS.ProcessEnv={...process.env,...request.launchEnv,DSH_EAC_UPDATE_TRANSACTION_DIR:journal.transactionDir,DSH_EAC_UPDATE_HEALTH_TOKEN:request.token};
        delete env.DSH_NODE_EXE;
        try {candidate=cp.spawn(path.join(journal.installRoot,'dsh-eac-shell.exe'),[],{detached:true,windowsHide:true,stdio:'ignore',env});}
        catch {spawnFailed=true;throw new Error('update-new-shell-start-failed');}
        candidate.once('error',()=>{spawnFailed=true;});candidate.unref();
        if(!candidate.pid){spawnFailed=true;throw new Error('update-new-shell-start-failed');}
        await writeHelperReceipt(path.join(journal.transactionDir,'candidate-start.json'),{schemaVersion:1,transactionId:journal.transactionId,shellPid:candidate.pid},request.token);
        const healthy=await waitUntil(async()=>{
          if(spawnFailed)throw new Error('update-new-shell-start-failed');
          const receipt=await readHelperReceipt(path.join(journal.transactionDir,'boot-health.json'),request.token);
          return !!receipt && receipt.schemaVersion===1 && receipt.transactionId===journal.transactionId && receipt.shellPid===candidate!.pid
            && receipt.version===journal.version && receipt.target===journal.target && receipt.httpReady===true && receipt.dataReadable===true
            && typeof receipt.sidecarPid==='number' && alive(receipt.sidecarPid) && typeof receipt.kernelPid==='number' && alive(receipt.kernelPid)
            && JSON.stringify(receipt.binding)===JSON.stringify(request.binding);
        },request.healthTimeoutMs);
        return healthy;
      },undefined,stopCandidate);
  } catch(error) {
    await writeDurableJson(path.join(journal.transactionDir,'helper-result.json'),{schemaVersion:1,transactionId:journal.transactionId,ok:false,error:safeError(error)});throw error;
  }
  const payload={schemaVersion:1,transactionId:journal.transactionId,action:'accepted'};
  await writeDurableJson(path.join(journal.transactionDir,'health-accepted.json'),{payload,mac:helperMac(payload,request.token)});
  await writeDurableJson(path.join(journal.transactionDir,'helper-result.json'),{schemaVersion:1,transactionId:journal.transactionId,ok:true});
}
async function runTakeover(file: string): Promise<void> {
  await plainPath(file);
  const value=JSON.parse(await fsp.readFile(file,'utf8')) as {installRoot?:unknown};
  if(typeof value.installRoot!=='string')throw new Error('update-helper-request-invalid');
  await withPortableLock(value.installRoot,()=>runTakeoverLocked(file));
}
function safeError(error:unknown):string {return error instanceof Error&&/^update-[a-z-]+$/.test(error.message)?error.message:'update-helper-failed';}

export async function readPortableHandoff(transactionDir: string, installRoot: string): Promise<{request:PortableHandoff;journal:PortableJournal}> {
  const value=await validatePortableHandoff(path.join(transactionDir,'helper/handoff.json'),true);
  if(value.journal.installRoot!==await plainPath(installRoot))throw new Error('update-helper-request-invalid');return value;
}
export async function portableStartupGate(installRoot: string, shellPid: number, nativeVersion: string, env: NodeJS.ProcessEnv=process.env): Promise<{mode:'normal'|'health'|'recovering';recovered:boolean;helperPid?:number}> {
  installRoot=await plainPath(installRoot);const pointer=path.join(installRoot,'.eac-update-recovery.json');
  if(!fs.existsSync(pointer))return {mode:'normal',recovered:false};
  await plainPath(pointer);const value=JSON.parse(await fsp.readFile(pointer,'utf8')) as {transactionId?:string;transactionDir?:string;schemaVersion?:number};
  if(value.schemaVersion!==1||!value.transactionId||!/^[a-f0-9-]{36}$/.test(value.transactionId)||value.transactionDir!==path.join(path.dirname(installRoot),'.eac-update-'+value.transactionId))throw new Error('update-recovery-pointer-invalid');
  if(!fs.existsSync(path.join(value.transactionDir,'helper/handoff.json'))){
    const journal=await readPortableJournal(value.transactionDir,installRoot);
    if(journal.phase!=='prepared'||journal.items.some(item=>item.step!=='pending'))throw new Error('update-recovery-helper-unavailable');
    const {recoverPortable}=require('./update-portable') as typeof import('./update-portable');await recoverPortable(installRoot);return {mode:'normal',recovered:true};
  }
  const {request,journal}=await readPortableHandoff(value.transactionDir,installRoot);
  if(env.DSH_EAC_UPDATE_HEALTH_TOKEN===request.token&&env.DSH_EAC_UPDATE_TRANSACTION_DIR===journal.transactionDir&&journal.phase==='health'){
    if(!Number.isSafeInteger(shellPid)||shellPid<1)throw new Error('update-new-shell-version-mismatch');
    if(nativeVersion!==journal.version){await writeHelperReceipt(path.join(journal.transactionDir,'boot-gate-failed.json'),{schemaVersion:1,transactionId:journal.transactionId,shellPid,sidecarStarted:false},request.token);throw new Error('update-new-shell-version-mismatch');}
    const owner=await readHelperReceipt(path.join(journal.transactionDir,'helper-owner.json'),request.token);
    if(owner?.transactionId!==journal.transactionId||typeof owner.pid!=='number'||!alive(owner.pid)){await writeHelperReceipt(path.join(journal.transactionDir,'boot-gate-failed.json'),{schemaVersion:1,transactionId:journal.transactionId,shellPid,sidecarStarted:false},request.token);throw new Error('update-health-helper-unavailable');}
    let held=false;try {await withPortableLock(installRoot,async()=>{});}catch(error){if(error instanceof Error&&error.message==='update-install-lock-busy')held=true;else throw error;}
    if(!held){await writeHelperReceipt(path.join(journal.transactionDir,'boot-gate-failed.json'),{schemaVersion:1,transactionId:journal.transactionId,shellPid,sidecarStarted:false},request.token);throw new Error('update-health-helper-unavailable');}
    await writeHelperReceipt(path.join(journal.transactionDir,'boot-shell.json'),{schemaVersion:1,transactionId:journal.transactionId,shellPid},request.token);
    return {mode:'health',recovered:false};
  }
  const helperRoot=path.join(journal.transactionDir,'helper');
  const child=cp.spawn(path.join(helperRoot,'node.exe'),[path.join(helperRoot,'lib/desktop/update-portable-helper.js'),'--recover-after-exit',journal.transactionDir,installRoot,String(shellPid)],{detached:true,windowsHide:true,stdio:['ignore','pipe','ignore']});
  await new Promise<void>((resolve,reject)=>{
    let text='';const timer=setTimeout(()=>reject(new Error('update-recovery-takeover-timeout')),15000);
    const finish=(error?:Error)=>{clearTimeout(timer);child.stdout.removeListener('data',data);child.removeListener('exit',exit);child.removeListener('error',failed);error?reject(error):resolve();};
    const data=(chunk:Buffer)=>{text+=chunk.toString('utf8');if(text.length>4096)return finish(new Error('update-recovery-response-invalid'));if(!text.includes('\n'))return;try{const ack=JSON.parse(text);if(ack.accepted!==true||ack.transactionId!==journal.transactionId||ack.pid!==child.pid)throw new Error();finish();}catch{finish(new Error('update-recovery-response-invalid'));}};
    const exit=()=>finish(new Error('update-recovery-takeover-refused'));const failed=()=>finish(new Error('update-recovery-unavailable'));
    child.stdout.on('data',data);child.once('exit',exit);child.once('error',failed);
  });child.stdout.destroy();child.unref();return {mode:'recovering',recovered:false,helperPid:child.pid!};
}

async function recoverAfterExit(transactionDir:string,installRoot:string,shellPid:number):Promise<void>{
  if(!Number.isSafeInteger(shellPid)||shellPid<1||shellPid===process.pid)throw new Error('update-shell-identity-unavailable');
  const {request,journal}=await readPortableHandoff(transactionDir,installRoot);
  await withPortableLock(installRoot,async()=>{
    process.stdout.write(JSON.stringify({accepted:true,transactionId:journal.transactionId,pid:process.pid})+'\n');
    if(!await waitUntil(async()=>!alive(shellPid),30000))throw new Error('update-owner-exit-unconfirmed');
    const owners=await readHelperReceipt(path.join(journal.transactionDir,'boot-owners.json'),request.token);
    const candidate=await readHelperReceipt(path.join(journal.transactionDir,'candidate-start.json'),request.token) || await readHelperReceipt(path.join(journal.transactionDir,'boot-shell.json'),request.token);
    const known=owners&&Array.isArray(owners.owners)?owners.owners: candidate&&typeof candidate.shellPid==='number'?[candidate.shellPid]:[];
    if(known.some(pid=>typeof pid!=='number'||!Number.isSafeInteger(pid)||pid<1))throw new Error('update-recovery-owners-invalid');
    if(known.some(pid=>alive(pid as number))){
      const candidatePid=owners?.shellPid??candidate?.shellPid;
      await writeHelperReceipt(path.join(journal.transactionDir,'stop-request.json'),{schemaVersion:1,transactionId:journal.transactionId,shellPid:candidatePid,action:'stop-for-recovery'},request.token);
      const stopped=await waitUntil(async()=>{
        const gateFailure=await readHelperReceipt(path.join(journal.transactionDir,'boot-gate-failed.json'),request.token);
        if(gateFailure?.transactionId===journal.transactionId&&gateFailure.shellPid===candidatePid&&gateFailure.sidecarStarted===false&&!known.some(pid=>alive(pid as number)))return true;
        const receipt=await readHelperReceipt(path.join(journal.transactionDir,'boot-stopped.json'),request.token);
        return receipt?.transactionId===journal.transactionId&&receipt.shellPid===candidatePid&&(receipt.rootDisposed===true||(receipt.kernelExitedBeforeAdmission===true&&receipt.admissionHeld===true))&&!known.some(pid=>alive(pid as number));
      },30000);if(!stopped)throw new Error('update-health-stop-unconfirmed');
    }
    const {recoverPortable}=require('./update-portable') as typeof import('./update-portable');await recoverPortable(installRoot);
  });
  await writeDurableJson(path.join(journal.transactionDir,'recovery-result.json'),{schemaVersion:1,transactionId:journal.transactionId,recovered:true,pid:process.pid});
  const env:NodeJS.ProcessEnv={...process.env,...request.launchEnv};
  for(const key of ['DSH_EAC_UPDATE_TRANSACTION_DIR','DSH_EAC_UPDATE_HEALTH_TOKEN','DSH_EAC_UPDATE_HEALTH_BOOT','DSH_NODE_EXE'])delete env[key];
  const restarted=cp.spawn(path.join(installRoot,'dsh-eac-shell.exe'),[],{detached:true,windowsHide:true,stdio:'ignore',env});restarted.once('error',()=>{});restarted.unref();
}
if(require.main===module){
  const mode=process.argv[2];
  if(mode==='--takeover'&&process.argv[3])void runTakeover(process.argv[3]).catch(error=>{process.stderr.write(safeError(error)+'\n');process.exitCode=1;});
  else if(mode==='--recover-after-exit'&&process.argv[3]&&process.argv[4])void recoverAfterExit(process.argv[3],process.argv[4],Number(process.argv[5])).catch(error=>{process.stderr.write(safeError(error)+'\n');process.exitCode=1;});
  else if(mode==='--startup-gate'&&process.argv[3])void portableStartupGate(process.argv[3],Number(process.argv[4]),process.argv[5]||'').then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(error=>{process.stderr.write(safeError(error)+'\n');process.exitCode=1;});
  else process.exitCode=2;
}
