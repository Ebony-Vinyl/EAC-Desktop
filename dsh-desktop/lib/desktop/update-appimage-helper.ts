import fs = require('node:fs');
import fsp = require('node:fs/promises');
import path = require('node:path');
import cp = require('node:child_process');
import crypto = require('node:crypto');
import {createInterface} from 'node:readline';
import {plainPath, captureBackup, writeDurableJson} from './update-backup';
import {appImagePointer, readAppImagePlan, installAppImage} from './update-appimage';
import type {AppImagePlan} from './update-appimage';
import {appImageRestartEnvironment} from './update-linux';
import {verifyPackage} from './update-signature';
import {captureProcessOwners} from './update-process-owners';
import {withPortableLock} from './update-portable-lock';
import {startCopiedHelper, validateHelperContext, verifyHelperFiles, readHelperReceipt, writeHelperReceipt, processAlive, waitUntil} from './update-helper-process';
import type {UpdateHandoff, UpdateHelperHandle} from './update-helper-process';
const MODULES=['update-appimage-helper.js','update-appimage.js','update-linux.js','update-helper-process.js','update-portable-lock.js','update-backup.js','update-package.js','update-sources.js','update-signature.js','update-process-owners.js'];
export async function readAppImageHandoff(transactionDir:string,image:string):Promise<{request:UpdateHandoff;journal:AppImagePlan}>{
  const file=await plainPath(path.join(transactionDir,'helper/handoff.json'));
  const request=JSON.parse(await fsp.readFile(file,'utf8')) as UpdateHandoff;
  await validateHelperContext(request);
  const journal=await readAppImagePlan(transactionDir,image);
  if(request.transactionDir!==journal.transactionDir||request.installRoot!==journal.installRoot||request.transactionId!==journal.transactionId
    ||request.version!==journal.version||request.target!==journal.target||request.packageFile!==journal.sourcePackageFile
    ||request.trustedKey!==journal.trustedKey||JSON.stringify(request.artifact)!==JSON.stringify(journal.artifact)
    ||JSON.stringify(request.binding)!==JSON.stringify(journal.dataBinding))throw new Error('update-helper-request-invalid');
  await verifyHelperFiles(request,MODULES);await verifyPackage(await plainPath(request.packageFile),request.artifact,request.trustedKey);
  return {request,journal};
}
export async function startAppImageHelper(options:{plan:AppImagePlan;owners:number[];dataBackupDirectory:string;launchEnv:Record<string,string>;signal?:AbortSignal;ownerTimeoutMs?:number;healthTimeoutMs?:number}):Promise<UpdateHelperHandle>{
  options.signal?.throwIfAborted();
  const plan=await readAppImagePlan(options.plan.transactionDir,options.plan.installRoot);
  if(plan.phase!=='prepared'||JSON.stringify(plan)!==JSON.stringify(options.plan))throw new Error('update-appimage-not-prepared');
  const request:UpdateHandoff={schemaVersion:1,transactionId:plan.transactionId,transactionDir:plan.transactionDir,installRoot:plan.installRoot,
    version:plan.version,target:plan.target,packageFile:plan.sourcePackageFile,artifact:plan.artifact,trustedKey:plan.trustedKey,binding:plan.dataBinding,
    owners:await captureProcessOwners(options.owners),token:crypto.randomBytes(32).toString('hex'),launchEnv:options.launchEnv,
    dataBackupDirectory:options.dataBackupDirectory,ownerTimeoutMs:options.ownerTimeoutMs??30000,healthTimeoutMs:options.healthTimeoutMs??120000};
  return startCopiedHelper(request,MODULES,'update-appimage-helper.js',options.signal);
}
export async function appImageStartupGate(image:string,shellPid:number,nativeVersion:string,env:NodeJS.ProcessEnv=process.env):Promise<{mode:'normal'|'health';recovered:boolean}>{
  image=await plainPath(image);const pointer=appImagePointer(image);
  if(!fs.existsSync(pointer)){
    if(env.DSH_EAC_UPDATE_HEALTH_TOKEN)throw new Error('update-health-pointer-unavailable');
    return {mode:'normal',recovered:false};
  }
  const value=JSON.parse(await fsp.readFile(await plainPath(pointer),'utf8'));
  if(value.schemaVersion!==1||value.installKind!=='appimage'||value.image!==image||typeof value.transactionId!=='string'
    ||value.transactionDir!==path.join(path.dirname(image),'.eac-update-'+value.transactionId))throw new Error('update-recovery-pointer-invalid');
  const {request,journal}=await readAppImageHandoff(value.transactionDir,image);
  if(!Number.isSafeInteger(shellPid)||shellPid<1||nativeVersion!==journal.version||journal.phase!=='health'
    ||env.DSH_EAC_UPDATE_HEALTH_TOKEN!==request.token||env.DSH_EAC_UPDATE_TRANSACTION_DIR!==journal.transactionDir)throw new Error('update-startup-recovery-unconfirmed');
  const helper=await readHelperReceipt(path.join(journal.transactionDir,'helper-owner.json'),request.token);
  if(helper?.transactionId!==journal.transactionId||typeof helper.pid!=='number'||!processAlive(helper.pid))throw new Error('update-health-helper-unavailable');
  let held=false;try{await withPortableLock(path.dirname(image),async()=>{});}catch(error){if(error instanceof Error&&error.message==='update-install-lock-busy')held=true;else throw error;}
  if(!held)throw new Error('update-health-helper-unavailable');
  // AppImage runtimes may retain a launcher process above the actual native shell.
  const admitted=await waitUntil(async()=>{
    const launch=await readHelperReceipt(path.join(journal.transactionDir,'candidate-start.json'),request.token);
    return launch?.transactionId===journal.transactionId&&typeof launch.shellPid==='number'&&processAlive(launch.shellPid)
      &&(await captureProcessOwners([launch.shellPid])).includes(shellPid);
  },5000);
  if(!admitted)throw new Error('update-new-shell-identity-mismatch');
  await writeHelperReceipt(path.join(journal.transactionDir,'boot-shell.json'),{schemaVersion:1,transactionId:journal.transactionId,shellPid},request.token);
  return {mode:'health',recovered:false};
}
async function takeover(file:string):Promise<void>{
  const raw=JSON.parse(await fsp.readFile(await plainPath(file),'utf8')) as UpdateHandoff;
  const {request,journal}=await readAppImageHandoff(raw.transactionDir,raw.installRoot);
  if(path.resolve(file)!==path.join(journal.transactionDir,'helper/handoff.json')||journal.phase!=='prepared'||request.owners.includes(process.pid))throw new Error('update-helper-request-invalid');
  await writeHelperReceipt(path.join(journal.transactionDir,'helper-owner.json'),{schemaVersion:1,transactionId:journal.transactionId,pid:process.pid},request.token);
  const lines=createInterface({input:process.stdin});
  const grant=new Promise<boolean>(resolve=>{let answered=false;lines.once('line',line=>{answered=true;try{const value=JSON.parse(line);resolve(value.action==='install'&&value.token===request.token);}catch{resolve(false);}});lines.once('close',()=>{if(!answered)resolve(false);});});
  process.stdout.write(JSON.stringify({accepted:true,transactionId:journal.transactionId,pid:process.pid,token:request.token})+'\n');
  if(!await grant){lines.close();return;}lines.close();
  const owners=await captureProcessOwners(request.owners,process.pid);
  await writeHelperReceipt(path.join(journal.transactionDir,'owner-wait.json'),{schemaVersion:1,transactionId:journal.transactionId,owners},request.token);
  let candidate:cp.ChildProcess|null=null;let failed=false;let shellPid:number|undefined;
  const stop=async():Promise<boolean>=>{
    if(!candidate)return true;
    const candidatePid=candidate.pid;
    if(!candidatePid)return true;
    const descendants=await captureProcessOwners([candidatePid,...(shellPid?[shellPid]:[])]);
    if(descendants.every(pid=>!processAlive(pid)))return true;
    const boot=await readHelperReceipt(path.join(journal.transactionDir,'boot-shell.json'),request.token);
    if(boot?.transactionId!==journal.transactionId||typeof boot.shellPid!=='number'||!descendants.includes(boot.shellPid))return false;
    shellPid=boot.shellPid;
    await writeHelperReceipt(path.join(journal.transactionDir,'stop-request.json'),{schemaVersion:1,transactionId:journal.transactionId,shellPid,action:'stop-for-recovery'},request.token);
    return waitUntil(async()=>{
      const stopped=await readHelperReceipt(path.join(journal.transactionDir,'boot-stopped.json'),request.token);
      return stopped?.transactionId===journal.transactionId&&stopped.shellPid===shellPid
        &&(stopped.rootDisposed===true||(stopped.kernelExitedBeforeAdmission===true&&stopped.admissionHeld===true))
        &&Array.isArray(stopped.owners)&&stopped.owners.includes(shellPid)&&stopped.owners.every(pid=>typeof pid==='number'&&Number.isSafeInteger(pid)&&pid>0&&!processAlive(pid))
        &&descendants.every(pid=>!processAlive(pid));
    },30000);
  };
  try{
    await installAppImage(journal,async()=>{
      if(!await waitUntil(async()=>owners.every(pid=>!processAlive(pid)),request.ownerTimeoutMs))return false;
      await captureBackup([{id:'webview',path:request.binding.webviewRoot,required:false},{id:'guests',path:request.binding.guestRoot,required:false}],path.join(journal.transactionDir,'cold-browser-backup'),new AbortController().signal);
      return true;
    },async()=>{
      const env=appImageRestartEnvironment(process.env,request.launchEnv,process.env.APPDIR);
      env.DSH_EAC_UPDATE_TRANSACTION_DIR=journal.transactionDir;env.DSH_EAC_UPDATE_HEALTH_TOKEN=request.token;
      candidate=cp.spawn(journal.installRoot,[],{detached:true,stdio:'ignore',env});candidate.once('error',()=>{failed=true;});candidate.unref();
      if(!candidate.pid)throw new Error('update-new-shell-start-failed');
      await writeHelperReceipt(path.join(journal.transactionDir,'candidate-start.json'),{schemaVersion:1,transactionId:journal.transactionId,shellPid:candidate.pid},request.token);
      return waitUntil(async()=>{
        if(failed)throw new Error('update-new-shell-start-failed');
        const boot=await readHelperReceipt(path.join(journal.transactionDir,'boot-shell.json'),request.token);
        if(boot?.transactionId!==journal.transactionId||typeof boot.shellPid!=='number')return false;
        shellPid=boot.shellPid;
        const receipt=await readHelperReceipt(path.join(journal.transactionDir,'boot-health.json'),request.token);
        return receipt?.schemaVersion===1&&receipt.transactionId===journal.transactionId&&receipt.shellPid===shellPid&&processAlive(shellPid)
          &&receipt.version===journal.version&&receipt.target===journal.target&&receipt.httpReady===true&&receipt.dataReadable===true
          &&typeof receipt.sidecarPid==='number'&&processAlive(receipt.sidecarPid)&&typeof receipt.kernelPid==='number'&&processAlive(receipt.kernelPid)
          &&JSON.stringify(receipt.binding)===JSON.stringify(request.binding);
      },request.healthTimeoutMs);
    },stop);
    await writeHelperReceipt(path.join(journal.transactionDir,'health-accepted.json'),{schemaVersion:1,transactionId:journal.transactionId,action:'accepted'},request.token);
    await writeDurableJson(path.join(journal.transactionDir,'helper-result.json'),{schemaVersion:1,transactionId:journal.transactionId,ok:true});
  }catch(error){
    await writeDurableJson(path.join(journal.transactionDir,'helper-result.json'),{schemaVersion:1,transactionId:journal.transactionId,ok:false,error:safeError(error)});throw error;
  }
}
function safeError(error:unknown):string{return error instanceof Error&&/^update-[a-z-]+$/.test(error.message)?error.message:'update-helper-failed';}
if(require.main===module){
  const args=process.argv.slice(2);
  const action=args[0]==='--takeover'?takeover(args[1]||''):args[0]==='--startup-gate'?appImageStartupGate(args[1]||'',Number(args[2]),args[3]||'').then(value=>{process.stdout.write(JSON.stringify(value)+'\n');}):Promise.reject(new Error('update-helper-arguments-invalid'));
  void action.catch(error=>{process.stderr.write(safeError(error)+'\n');process.exitCode=1;});
}
