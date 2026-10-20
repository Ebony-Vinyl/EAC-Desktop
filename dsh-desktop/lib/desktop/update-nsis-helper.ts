import fs = require('node:fs');
import fsp = require('node:fs/promises');
import path = require('node:path');
import cp = require('node:child_process');
import crypto = require('node:crypto');
import {createInterface} from 'node:readline';
import {plainPath, writeDurableJson, captureBackup} from './update-backup';
import {readNsisPlan, installNsis, clearNsisPointer, cancelNsis} from './update-nsis';
import type {NsisPlan} from './update-nsis';
import {withPortableLock} from './update-portable-lock';
import {captureProcessOwners} from './update-process-owners';
import {verifyPackage} from './update-signature';
import {startCopiedHelper, verifyHelperFiles, validateHelperContext, processAlive, waitUntil, readHelperReceipt, writeHelperReceipt} from './update-helper-process';
import type {UpdateHandoff, UpdateHelperHandle} from './update-helper-process';
export interface NsisHandoff extends UpdateHandoff {installKind:'nsis';}
const MODULES=['update-nsis-helper.js','update-nsis.js','update-helper-process.js','update-portable-lock.js','update-backup.js','update-package.js','update-sources.js','update-signature.js','update-process-owners.js'];
const POINTER='.eac-update-recovery.json';
export async function startNsisHelper(options:{plan:NsisPlan;packageFile:string;owners:number[];dataBackupDirectory:string;launchEnv:Record<string,string>;signal?:AbortSignal;ownerTimeoutMs?:number;healthTimeoutMs?:number}):Promise<UpdateHelperHandle>{
  options.signal?.throwIfAborted();
  const plan=await readNsisPlan(options.plan.transactionDir,options.plan.installRoot);
  if(plan.phase!=='prepared'||JSON.stringify(plan)!==JSON.stringify(options.plan)||!plan.dataBinding||plan.transactionDir!==path.join(path.dirname(plan.installRoot),'.eac-update-'+plan.transactionId))throw new Error('update-nsis-plan-invalid');
  const request:NsisHandoff={schemaVersion:1,installKind:'nsis',transactionId:plan.transactionId,transactionDir:plan.transactionDir,installRoot:plan.installRoot,
    version:plan.version,target:plan.target,packageFile:options.packageFile,artifact:plan.artifact,trustedKey:plan.trustedKey,binding:plan.dataBinding,
    owners:await captureProcessOwners(options.owners),token:crypto.randomBytes(32).toString('hex'),launchEnv:options.launchEnv,dataBackupDirectory:options.dataBackupDirectory,
    ownerTimeoutMs:options.ownerTimeoutMs??30000,healthTimeoutMs:options.healthTimeoutMs??120000};
  await validateHelperContext(request);
  return withPortableLock(plan.installRoot,async()=>{
    const pointer=path.join(plan.installRoot,POINTER);
    if(fs.existsSync(pointer))throw new Error('update-installation-in-progress');
    await writeDurableJson(pointer,{schemaVersion:1,installKind:'nsis',transactionId:plan.transactionId,transactionDir:plan.transactionDir});
    try{return await startCopiedHelper(request,MODULES,'update-nsis-helper.js',options.signal);}
    catch(error){await clearNsisPointer(plan);throw error;}
  });
}
export async function readNsisHandoff(transactionDir:string,installRoot:string):Promise<{request:NsisHandoff;journal:NsisPlan}>{
  const journal=await readNsisPlan(transactionDir,installRoot);
  const request=JSON.parse(await fsp.readFile(await plainPath(path.join(journal.transactionDir,'helper/handoff.json')),'utf8')) as NsisHandoff;
  await validateHelperContext(request);
  if(request.installKind!=='nsis'||request.transactionId!==journal.transactionId||request.transactionDir!==journal.transactionDir||request.installRoot!==journal.installRoot
    ||request.version!==journal.version||request.target!==journal.target||request.trustedKey!==journal.trustedKey||JSON.stringify(request.artifact)!==JSON.stringify(journal.artifact)
    ||request.artifact.installKind!=='nsis'||JSON.stringify(request.binding)!==JSON.stringify(journal.dataBinding)
    ||journal.transactionDir!==path.join(path.dirname(journal.installRoot),'.eac-update-'+journal.transactionId))throw new Error('update-helper-request-invalid');
  await verifyPackage(await plainPath(request.packageFile),request.artifact,request.trustedKey);
  await verifyPackage(await plainPath(journal.installerFile),journal.artifact,journal.trustedKey);
  await verifyHelperFiles(request,MODULES);
  return {request,journal};
}
async function runTakeover(file:string):Promise<void>{
  const input=JSON.parse(await fsp.readFile(await plainPath(file),'utf8')) as NsisHandoff;
  if(typeof input.transactionDir!=='string'||typeof input.installRoot!=='string'||path.resolve(file)!==path.join(input.transactionDir,'helper/handoff.json'))throw new Error('update-helper-request-invalid');
  const {request,journal}=await readNsisHandoff(input.transactionDir,input.installRoot);
  if(journal.phase!=='prepared'||request.owners.includes(process.pid))throw new Error('update-nsis-plan-invalid');
  await writeHelperReceipt(path.join(journal.transactionDir,'helper-owner.json'),{schemaVersion:1,transactionId:journal.transactionId,pid:process.pid},request.token);
  const lines=createInterface({input:process.stdin});
  const grant=new Promise<boolean>(resolve=>{let answered=false;lines.once('line',line=>{answered=true;try{const value=JSON.parse(line);resolve(value.action==='install'&&value.token===request.token);}catch{resolve(false);}});lines.once('close',()=>{if(!answered)resolve(false);});});
  process.stdout.write(JSON.stringify({accepted:true,transactionId:journal.transactionId,pid:process.pid,token:request.token})+'\n');
  if(!await grant){lines.close();return;}lines.close();
  await withPortableLock(journal.installRoot,async()=>{
    const owners=await captureProcessOwners(request.owners,process.pid);
    await writeHelperReceipt(path.join(journal.transactionDir,'owner-wait.json'),{schemaVersion:1,transactionId:journal.transactionId,owners},request.token);
    let candidate:cp.ChildProcess|null=null;let spawnFailed=false;
    const stopCandidate=async():Promise<boolean>=>{
      if(!candidate||spawnFailed)return true;
      const child=candidate;const candidateOwners=await captureProcessOwners([child.pid!]);
      const gate=await readHelperReceipt(path.join(journal.transactionDir,'boot-gate-failed.json'),request.token);
      if(gate?.transactionId===journal.transactionId&&gate.shellPid===child.pid&&gate.sidecarStarted===false&&candidateOwners.every(pid=>!processAlive(pid)))return true;
      await writeHelperReceipt(path.join(journal.transactionDir,'stop-request.json'),{schemaVersion:1,transactionId:journal.transactionId,shellPid:child.pid,action:'stop-for-recovery'},request.token);
      return waitUntil(async()=>{
        const stopped=await readHelperReceipt(path.join(journal.transactionDir,'boot-stopped.json'),request.token);
        return !!stopped&&stopped.transactionId===journal.transactionId&&stopped.shellPid===child.pid&&(stopped.rootDisposed===true||(stopped.kernelExitedBeforeAdmission===true&&stopped.admissionHeld===true))
          &&typeof stopped.sidecarPid==='number'&&(typeof stopped.kernelPid==='number'||(stopped.kernelPid===null&&stopped.kernelNeverStarted===true))
          &&Array.isArray(stopped.owners)&&stopped.owners.includes(child.pid)&&stopped.owners.includes(stopped.sidecarPid)&&(stopped.kernelPid===null||stopped.owners.includes(stopped.kernelPid))
          &&stopped.owners.every(pid=>typeof pid==='number'&&Number.isSafeInteger(pid)&&pid>0&&!processAlive(pid))&&candidateOwners.every(pid=>!processAlive(pid));
      },30000);
    };
    try{
      await installNsis(journal,async()=>{
        if(!await waitUntil(async()=>owners.every(pid=>!processAlive(pid)),request.ownerTimeoutMs))return false;
        await captureBackup([{id:'program',path:journal.installRoot,required:true,exclude:[path.join(journal.installRoot,POINTER),path.join(journal.installRoot,'.eac-update-lock')]}],path.join(journal.transactionDir,'previous-program'),new AbortController().signal);
        await captureBackup([{id:'webview',path:request.binding.webviewRoot,required:false},{id:'guests',path:request.binding.guestRoot,required:false}],path.join(journal.transactionDir,'cold-browser-backup'),new AbortController().signal);
        return true;
      },async()=>{
        const env:NodeJS.ProcessEnv={...process.env,...request.launchEnv,DSH_EAC_UPDATE_TRANSACTION_DIR:journal.transactionDir,DSH_EAC_UPDATE_HEALTH_TOKEN:request.token};
        delete env.DSH_NODE_EXE;
        try{candidate=cp.spawn(path.join(journal.installRoot,'dsh-eac-shell.exe'),[],{cwd:journal.installRoot,detached:true,windowsHide:true,stdio:'ignore',env});}catch{spawnFailed=true;throw new Error('update-new-shell-start-failed');}
        candidate.once('error',()=>{spawnFailed=true;});candidate.unref();
        if(!candidate.pid){spawnFailed=true;throw new Error('update-new-shell-start-failed');}
        await writeHelperReceipt(path.join(journal.transactionDir,'candidate-start.json'),{schemaVersion:1,transactionId:journal.transactionId,shellPid:candidate.pid},request.token);
        return waitUntil(async()=>{
          if(spawnFailed)throw new Error('update-new-shell-start-failed');
          const receipt=await readHelperReceipt(path.join(journal.transactionDir,'boot-health.json'),request.token);
          return !!receipt&&receipt.schemaVersion===1&&receipt.transactionId===journal.transactionId&&receipt.shellPid===candidate!.pid&&processAlive(candidate!.pid!)
            &&receipt.version===journal.version&&receipt.target===journal.target&&receipt.httpReady===true&&receipt.dataReadable===true&&receipt.uiReadable===true
            &&typeof receipt.sidecarPid==='number'&&processAlive(receipt.sidecarPid)&&typeof receipt.kernelPid==='number'&&processAlive(receipt.kernelPid)
            &&JSON.stringify(receipt.binding)===JSON.stringify(request.binding);
        },request.healthTimeoutMs);
      });
      await clearNsisPointer(journal);
      await writeHelperReceipt(path.join(journal.transactionDir,'health-accepted.json'),{schemaVersion:1,transactionId:journal.transactionId,action:'accepted'},request.token);
      await writeDurableJson(path.join(journal.transactionDir,'helper-result.json'),{schemaVersion:1,transactionId:journal.transactionId,ok:true});
    }catch(error){
      const stopped=await stopCandidate();
      await writeDurableJson(path.join(journal.transactionDir,'helper-result.json'),{schemaVersion:1,transactionId:journal.transactionId,ok:false,error:safeError(error),candidateStopped:stopped});throw error;
    }
  });
}
export async function nsisStartupGate(installRoot:string,shellPid:number,nativeVersion:string,env:NodeJS.ProcessEnv=process.env):Promise<{mode:'normal'|'health';recovered:boolean}>{
  installRoot=await plainPath(installRoot);const pointer=path.join(installRoot,POINTER);
  if(!fs.existsSync(pointer))return {mode:'normal',recovered:false};
  const value=JSON.parse(await fsp.readFile(await plainPath(pointer),'utf8'));
  if(value.schemaVersion!==1||value.installKind!=='nsis'||typeof value.transactionId!=='string'||value.transactionDir!==path.join(path.dirname(installRoot),'.eac-update-'+value.transactionId))throw new Error('update-recovery-pointer-invalid');
  const prepared=await readNsisPlan(value.transactionDir,installRoot);
  if(prepared.transactionId!==value.transactionId)throw new Error('update-recovery-pointer-invalid');
  if(!fs.existsSync(path.join(prepared.transactionDir,'helper/handoff.json'))){
    if(prepared.phase!=='prepared'||nativeVersion!==prepared.previousVersion)throw new Error('update-nsis-repair-required');
    await cancelNsis(prepared);return {mode:'normal',recovered:true};
  }
  const {request,journal}=await readNsisHandoff(value.transactionDir,installRoot);
  if(value.transactionId!==journal.transactionId)throw new Error('update-recovery-pointer-invalid');
  const owner=await readHelperReceipt(path.join(journal.transactionDir,'helper-owner.json'),request.token);
  const running=owner?.transactionId===journal.transactionId&&typeof owner.pid==='number'&&processAlive(owner.pid);
  if(journal.phase==='health'&&env.DSH_EAC_UPDATE_HEALTH_TOKEN===request.token&&env.DSH_EAC_UPDATE_TRANSACTION_DIR===journal.transactionDir){
    try{
      if(!Number.isSafeInteger(shellPid)||shellPid<1||nativeVersion!==journal.version)throw new Error('update-new-shell-version-mismatch');
      if(!running)throw new Error('update-health-helper-unavailable');
      let held=false;try{await withPortableLock(installRoot,async()=>{});}catch(error){if(error instanceof Error&&error.message==='update-install-lock-busy')held=true;else throw error;}
      if(!held)throw new Error('update-health-helper-unavailable');
      await writeHelperReceipt(path.join(journal.transactionDir,'boot-shell.json'),{schemaVersion:1,transactionId:journal.transactionId,shellPid},request.token);
      return {mode:'health',recovered:false};
    }catch(error){await writeHelperReceipt(path.join(journal.transactionDir,'boot-gate-failed.json'),{schemaVersion:1,transactionId:journal.transactionId,shellPid,sidecarStarted:false},request.token);throw error;}
  }
  if(running)throw new Error('update-installation-in-progress');
  if(journal.phase==='prepared'){if(nativeVersion!==journal.previousVersion)throw new Error('update-new-shell-version-mismatch');await cancelNsis(journal);return {mode:'normal',recovered:true};}
  if(journal.phase==='committed'||journal.phase==='cancelled'){if(nativeVersion!==(journal.phase==='committed'?journal.version:journal.previousVersion))throw new Error('update-new-shell-version-mismatch');await clearNsisPointer(journal);return {mode:'normal',recovered:true};}
  throw new Error('update-nsis-repair-required');
}

export interface NsisRepairInfo {
  schemaVersion:1;installKind:'nsis';transactionId:string;transactionDir:string;installRoot:string;
  version:string;previousVersion:string;phase:'installing'|'installed'|'health'|'failed';installerFile:string;
  programBackupManifestPresent:boolean;error:string;
}
export async function nsisRepairInfo(installRoot:string,nativeVersion:string):Promise<NsisRepairInfo>{
  installRoot=await plainPath(installRoot);
  return withPortableLock(installRoot,async()=>{
    const pointer=JSON.parse(await fsp.readFile(await plainPath(path.join(installRoot,POINTER)),'utf8'));
    if(pointer.schemaVersion!==1||pointer.installKind!=='nsis'||typeof pointer.transactionId!=='string'||pointer.transactionDir!==path.join(path.dirname(installRoot),'.eac-update-'+pointer.transactionId))throw new Error('update-recovery-pointer-invalid');
    const {request,journal}=await readNsisHandoff(pointer.transactionDir,installRoot);
    if(pointer.transactionId!==journal.transactionId||!['installing','installed','health','failed'].includes(journal.phase)||![journal.previousVersion,journal.version].includes(nativeVersion))throw new Error('update-nsis-repair-unavailable');
    const helper=await readHelperReceipt(path.join(journal.transactionDir,'helper-owner.json'),request.token);
    if(helper?.transactionId===journal.transactionId&&typeof helper.pid==='number'&&processAlive(helper.pid))throw new Error('update-installation-in-progress');
    for(const name of ['candidate-start.json','boot-shell.json','boot-owners.json']){
      const receipt=await readHelperReceipt(path.join(journal.transactionDir,name),request.token);if(!receipt)continue;
      if(receipt.transactionId!==journal.transactionId)throw new Error('update-recovery-owners-invalid');
      const owners=name==='boot-owners.json'?receipt.owners:[receipt.shellPid];
      if(!Array.isArray(owners)||owners.some(pid=>typeof pid!=='number'||!Number.isSafeInteger(pid)||pid<1))throw new Error('update-recovery-owners-invalid');
      if(owners.some(pid=>processAlive(pid as number)))throw new Error('update-installation-in-progress');
    }
    const backupManifest=path.join(journal.transactionDir,'previous-program/backup-manifest.json');let programBackupManifestPresent=false;
    if(fs.existsSync(backupManifest)){await plainPath(backupManifest);programBackupManifestPresent=(await fsp.stat(backupManifest)).isFile();}
    let error='update-nsis-repair-required';const resultFile=path.join(journal.transactionDir,'helper-result.json');
    if(fs.existsSync(resultFile)){
      const result=JSON.parse(await fsp.readFile(await plainPath(resultFile),'utf8'));
      if(result.transactionId===journal.transactionId&&result.ok===false&&typeof result.error==='string'&&/^update-[a-z-]+$/.test(result.error))error=result.error;
    }
    return {schemaVersion:1,installKind:'nsis',transactionId:journal.transactionId,transactionDir:journal.transactionDir,installRoot:journal.installRoot,
      version:journal.version,previousVersion:journal.previousVersion,phase:journal.phase as NsisRepairInfo['phase'],installerFile:journal.installerFile,programBackupManifestPresent,error};
  });
}
function safeError(error:unknown):string{return error instanceof Error&&/^update-[a-z-]+$/.test(error.message)?error.message:'update-helper-failed';}
if(require.main===module){
  const args=process.argv.slice(2);
  const operation=args[0]==='--takeover'&&args.length===2?runTakeover(args[1]!):args[0]==='--startup-gate'&&args.length===4?nsisStartupGate(args[1]!,Number(args[2]),args[3]!).then(value=>{process.stdout.write(JSON.stringify(value));}):args[0]==='--repair-info'&&args.length===3?nsisRepairInfo(args[1]!,args[2]!).then(value=>{process.stdout.write(JSON.stringify(value));}):Promise.reject(new Error('update-helper-arguments-invalid'));
  void operation.catch(()=>{process.exitCode=1;});
}
