import fsp = require('node:fs/promises');
import path = require('node:path');
import cp = require('node:child_process');
import crypto = require('node:crypto');
import {createInterface} from 'node:readline';
import {plainPath, pathsOverlap, captureBackup, writeDurableJson} from './update-backup';
import {readLinuxPackagePlan, appImageRestartEnvironment} from './update-linux';
import type {LinuxPackagePlan, LinuxPackagePhase, LinuxCommand} from './update-linux';
import {assertRootOwned, linuxRootCommand, linuxAuthorizationEnvironment} from './update-linux-root';
import type {LinuxRootRequest} from './update-linux-root';
import {verifyPackage} from './update-signature';
import {verifyManifest} from './update-sources';
import {withPortableLock} from './update-portable-lock';
import {captureProcessOwners} from './update-process-owners';
import {startCopiedHelper, validateHelperContext, verifyHelperFiles, readHelperReceipt, writeHelperReceipt, processAlive, waitUntil} from './update-helper-process';
import type {UpdateHandoff, UpdateHelperHandle} from './update-helper-process';
const MODULES=['update-linux-helper.js','update-linux-root.js','update-linux.js','update-helper-process.js','update-portable-lock.js','update-backup.js','update-package.js','update-sources.js','update-signature.js','update-process-owners.js'];
export interface LinuxAuthorization {grant():Promise<void>;cancel():Promise<void>;}
interface RootIdentity {transactionId:string;version:string;target:string;token:string;}
function safeError(error:unknown):string{return error instanceof Error&&/^update-[a-z-]+$/.test(error.message)?error.message:'update-linux-install-failed';}
export function validLinuxRootReceipt(value:unknown,identity:RootIdentity,kind:'ready'|'installed'):boolean{
  const item=value as Record<string,unknown>|null;
  return !!item&&item.schemaVersion===1&&item.transactionId===identity.transactionId&&item.version===identity.version&&item.target===identity.target&&item.token===identity.token
    &&(kind==='ready'?item.ready===true&&item.installed===undefined:item.installed===true&&item.exitCode===0&&item.ready===undefined);
}
export async function startLinuxAuthorization(command:LinuxCommand,identity:RootIdentity,signal?:AbortSignal):Promise<LinuxAuthorization>{
  signal?.throwIfAborted();
  const child=cp.spawn(command.file,command.args,{env:linuxAuthorizationEnvironment(process.env),windowsHide:true,stdio:['pipe','pipe','pipe']});
  let text='';let stderr='';let ready=false;let installed=false;let granted=false;let cancelled=false;let settled=false;let exitCode:number|null=null;
  let terminalError:Error|undefined;let resolveReady!:()=>void;let rejectReady!:(error:Error)=>void;
  const readyPromise=new Promise<void>((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  const exit=new Promise<void>(resolve=>{child.once('close',code=>{settled=true;exitCode=code;resolve();});});
  child.stdin.on('error',()=>{});
  const refuse=(error:Error)=>{terminalError=error;rejectReady(error);if(!granted){cancelled=true;child.stdin.end();child.kill();}};
  child.once('error',()=>refuse(new Error('update-linux-authorization-unavailable')));
  child.stderr.on('data',(chunk:Buffer)=>{if(stderr.length<4096)stderr+=chunk.toString('utf8').slice(0,4096-stderr.length);});
  child.stdout.on('data',(chunk:Buffer)=>{
    text+=chunk.toString('utf8');if(text.length>16384)return refuse(new Error('update-linux-authorization-response-invalid'));
    for(let index=text.indexOf('\n');index>=0;index=text.indexOf('\n')){
      const line=text.slice(0,index);text=text.slice(index+1);
      try{const value=JSON.parse(line);if(!ready&&validLinuxRootReceipt(value,identity,'ready')){ready=true;resolveReady();}
        else if(ready&&granted&&!installed&&validLinuxRootReceipt(value,identity,'installed'))installed=true;
        else refuse(new Error('update-linux-authorization-response-invalid'));
      }catch{refuse(new Error('update-linux-authorization-response-invalid'));}
    }
  });
  void exit.then(()=>{
    if(!ready&&!terminalError){const code=stderr.trim();rejectReady(new Error(/^update-[a-z-]+$/.test(code)?code:exitCode===126?'update-linux-authorization-cancelled':'update-linux-authorization-refused'));}
  });
  const abort=()=>refuse(new Error('update-cancelled'));signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>refuse(new Error('update-linux-authorization-timeout')),120000);
  try{await readyPromise;signal?.throwIfAborted();}catch(error){cancelled=true;child.stdin.end();child.kill();await exit;throw error;}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  return {
    grant:async()=>{
      if(granted||cancelled||settled||terminalError)throw terminalError||new Error('update-linux-authorization-not-ready');
      granted=true;await new Promise<void>((resolve,reject)=>child.stdin.write(JSON.stringify({action:'install',token:identity.token})+'\n',error=>error?reject(error):resolve()));child.stdin.end();await exit;
      if(terminalError)throw terminalError;
      if(exitCode!==0||!installed){const code=stderr.trim();throw new Error(/^update-[a-z-]+$/.test(code)?code:'update-linux-package-manager-failed');}
    },
    cancel:async()=>{if(granted)throw new Error('update-linux-installation-already-started');cancelled=true;child.stdin.end();if(!ready&&!settled)child.kill();await exit;},
  };
}
export async function readLinuxHandoff(transactionDir:string,executable:string):Promise<{request:UpdateHandoff;journal:LinuxPackagePlan}>{
  const request=JSON.parse(await fsp.readFile(await plainPath(path.join(transactionDir,'helper/handoff.json')),'utf8')) as UpdateHandoff;
  await validateHelperContext(request);const journal=await readLinuxPackagePlan(transactionDir,executable);
  if(request.transactionDir!==journal.transactionDir||request.installRoot!==journal.executable||request.transactionId!==journal.transactionId
    ||request.version!==journal.version||request.target!==journal.target||request.packageFile!==journal.sourcePackageFile
    ||request.trustedKey!==journal.trustedKey||JSON.stringify(request.artifact)!==JSON.stringify(journal.artifact)||JSON.stringify(request.binding)!==JSON.stringify(journal.binding))throw new Error('update-helper-request-invalid');
  for(const root of [journal.binding.environmentRoot,journal.binding.dshHome,journal.binding.registryHome,journal.binding.userDataDir,journal.binding.webviewRoot,journal.binding.configRoot,journal.binding.guestRoot]){
    if(pathsOverlap(journal.resourceRoot,await plainPath(root,true)))throw new Error('update-install-data-overlap');
  }
  const signed=verifyManifest(journal.envelope,{schemaVersion:1,github:{repo:''},gitee:{repo:''},geoUrl:'',trustedKeys:{
    [String((journal.envelope as {keyId?:unknown}).keyId)]:journal.trustedKey,
  }});
  if(signed.manifest.version!==journal.version||!signed.manifest.artifacts.some(item=>JSON.stringify(item)===JSON.stringify(journal.artifact)))throw new Error('update-helper-request-invalid');
  await verifyHelperFiles(request,MODULES);await verifyPackage(await plainPath(journal.packageFile),journal.artifact,journal.trustedKey);return {request,journal};
}
export async function startLinuxPackageHelper(options:{plan:LinuxPackagePlan;owners:number[];dataBackupDirectory:string;launchEnv:Record<string,string>;signal?:AbortSignal}):Promise<UpdateHelperHandle>{
  options.signal?.throwIfAborted();const plan=await readLinuxPackagePlan(options.plan.transactionDir,options.plan.executable);
  if(plan.phase!=='prepared'||JSON.stringify(plan)!==JSON.stringify(options.plan))throw new Error('update-linux-not-prepared');
  const request:UpdateHandoff={schemaVersion:1,transactionId:plan.transactionId,transactionDir:plan.transactionDir,installRoot:plan.executable,
    version:plan.version,target:plan.target,packageFile:plan.sourcePackageFile,artifact:plan.artifact,trustedKey:plan.trustedKey,binding:plan.binding,
    owners:await captureProcessOwners(options.owners),token:crypto.randomBytes(32).toString('hex'),launchEnv:options.launchEnv,dataBackupDirectory:options.dataBackupDirectory,ownerTimeoutMs:30000,healthTimeoutMs:120000};
  return startCopiedHelper(request,MODULES,'update-linux-helper.js',options.signal);
}
async function save(plan:LinuxPackagePlan,phase:LinuxPackagePhase):Promise<void>{plan.phase=phase;await writeDurableJson(path.join(plan.transactionDir,'linux-plan.json'),plan);}
export async function executeLinuxPackage(plan:LinuxPackagePlan,authorization:LinuxAuthorization,ownersExited:()=>Promise<boolean>,coldBackup:()=>Promise<void>,health:()=>Promise<boolean>,stopCandidate:()=>Promise<boolean>):Promise<void>{
  if(plan.phase!=='ready'||plan.systemInstallStarted)throw new Error('update-linux-not-prepared');
  try{
    if(!await ownersExited())throw new Error('update-install-processes-still-running');
    await coldBackup();plan.systemInstallStarted=true;await save(plan,'installing');await authorization.grant();await save(plan,'installed');
    await save(plan,'health');if(!await health())throw new Error('update-health-unconfirmed');await save(plan,'committed');
  }catch(error){
    if(!plan.systemInstallStarted)await authorization.cancel();
    if((plan.phase as LinuxPackagePhase)==='health'&&!await stopCandidate()){await save(plan,'failed');throw new Error('update-linux-candidate-still-running');}
    await save(plan,'failed');throw error;
  }
}
async function takeover(file:string):Promise<void>{
  const raw=JSON.parse(await fsp.readFile(await plainPath(file),'utf8')) as UpdateHandoff;
  const {request,journal:plan}=await readLinuxHandoff(raw.transactionDir,raw.installRoot);
  if(path.resolve(file)!==path.join(plan.transactionDir,'helper/handoff.json')||plan.phase!=='prepared'||request.owners.includes(process.pid))throw new Error('update-helper-request-invalid');
  await withPortableLock(plan.transactionDir,async()=>{
    let authorization:LinuxAuthorization|null=null;
    try{
      await assertRootOwned(path.join(plan.resourceRoot,'dsh-desktop/lib/desktop/update-linux-root.js'));await assertRootOwned(path.join(plan.resourceRoot,'dsh-desktop/vendor/node/node'));
      const owners=await captureProcessOwners(request.owners,process.pid);
      const rootRequest:LinuxRootRequest={schemaVersion:1,transactionId:plan.transactionId,target:plan.target,executable:plan.executable,packageFile:plan.packageFile,envelope:plan.envelope,owners,token:request.token};
      const requestFile=path.join(plan.transactionDir,'helper/root-request.json');await writeDurableJson(requestFile,rootRequest);await save(plan,'authorizing');
      authorization=await startLinuxAuthorization(linuxRootCommand(plan.resourceRoot,requestFile),{transactionId:plan.transactionId,version:plan.version,target:plan.target,token:request.token});
      await save(plan,'ready');await writeHelperReceipt(path.join(plan.transactionDir,'helper-owner.json'),{schemaVersion:1,transactionId:plan.transactionId,pid:process.pid},request.token);
      const lines=createInterface({input:process.stdin});const grant=new Promise<boolean>(resolve=>{let answered=false;lines.once('line',line=>{answered=true;try{const value=JSON.parse(line);resolve(value.action==='install'&&value.token===request.token);}catch{resolve(false);}});lines.once('close',()=>{if(!answered)resolve(false);});});
      process.stdout.write(JSON.stringify({accepted:true,transactionId:plan.transactionId,pid:process.pid,token:request.token})+'\n');
      if(!await grant){lines.close();await authorization.cancel();await save(plan,'cancelled');return;}lines.close();
      await writeHelperReceipt(path.join(plan.transactionDir,'owner-wait.json'),{schemaVersion:1,transactionId:plan.transactionId,owners},request.token);
      let candidate:cp.ChildProcess|null=null;let failed=false;
      const stop=async():Promise<boolean>=>{
        if(!candidate?.pid)return true;const pid=candidate.pid;const descendants=await captureProcessOwners([pid]);if(descendants.every(id=>!processAlive(id)))return true;
        await writeHelperReceipt(path.join(plan.transactionDir,'stop-request.json'),{schemaVersion:1,transactionId:plan.transactionId,shellPid:pid,action:'stop-for-recovery'},request.token);
        return waitUntil(async()=>{const stopped=await readHelperReceipt(path.join(plan.transactionDir,'boot-stopped.json'),request.token);return stopped?.transactionId===plan.transactionId&&stopped.shellPid===pid
          &&(stopped.rootDisposed===true||(stopped.kernelExitedBeforeAdmission===true&&stopped.admissionHeld===true))&&Array.isArray(stopped.owners)&&stopped.owners.includes(pid)
          &&stopped.owners.every(id=>typeof id==='number'&&Number.isSafeInteger(id)&&id>0&&!processAlive(id))&&descendants.every(id=>!processAlive(id));},30000);
      };
      await executeLinuxPackage(plan,authorization,
        ()=>waitUntil(async()=>owners.every(pid=>!processAlive(pid)),request.ownerTimeoutMs),
        async()=>{await captureBackup([{id:'webview',path:request.binding.webviewRoot,required:false},{id:'guests',path:request.binding.guestRoot,required:false}],path.join(plan.transactionDir,'cold-browser-backup'),new AbortController().signal);},
        async()=>{
          const env=appImageRestartEnvironment(process.env,request.launchEnv);env.DSH_EAC_UPDATE_TRANSACTION_DIR=plan.transactionDir;env.DSH_EAC_UPDATE_HEALTH_TOKEN=request.token;
          candidate=cp.spawn(plan.executable,[],{detached:true,stdio:'ignore',env});candidate.once('error',()=>{failed=true;});candidate.unref();if(!candidate.pid)throw new Error('update-new-shell-start-failed');
          await writeHelperReceipt(path.join(plan.transactionDir,'candidate-start.json'),{schemaVersion:1,transactionId:plan.transactionId,shellPid:candidate.pid},request.token);
          return waitUntil(async()=>{if(failed)throw new Error('update-new-shell-start-failed');const receipt=await readHelperReceipt(path.join(plan.transactionDir,'boot-health.json'),request.token);
            return receipt?.schemaVersion===1&&receipt.transactionId===plan.transactionId&&receipt.shellPid===candidate!.pid&&processAlive(candidate!.pid!)&&receipt.version===plan.version&&receipt.target===plan.target
              &&receipt.httpReady===true&&receipt.dataReadable===true&&receipt.uiReadable===true&&typeof receipt.sidecarPid==='number'&&processAlive(receipt.sidecarPid)&&typeof receipt.kernelPid==='number'&&processAlive(receipt.kernelPid)
              &&JSON.stringify(receipt.binding)===JSON.stringify(request.binding);},request.healthTimeoutMs);
        },stop);
      await writeHelperReceipt(path.join(plan.transactionDir,'health-accepted.json'),{schemaVersion:1,transactionId:plan.transactionId,action:'accepted'},request.token);
      await writeDurableJson(path.join(plan.transactionDir,'helper-result.json'),{schemaVersion:1,transactionId:plan.transactionId,ok:true});
    }catch(error){
      if(!plan.systemInstallStarted){await authorization?.cancel().catch(()=>{});await save(plan,'failed');}
      await writeDurableJson(path.join(plan.transactionDir,'helper-result.json'),{schemaVersion:1,transactionId:plan.transactionId,ok:false,error:safeError(error),systemInstallStarted:plan.systemInstallStarted});throw error;
    }
  });
}
export async function linuxPackageStartupGate(transactionDir:string,executable:string,shellPid:number,version:string,env:NodeJS.ProcessEnv=process.env):Promise<{mode:'health'}>{
  const {request,journal}=await readLinuxHandoff(transactionDir,executable);
  if(journal.phase!=='health'||!journal.systemInstallStarted||request.version!==version||env.DSH_EAC_UPDATE_HEALTH_TOKEN!==request.token||env.DSH_EAC_UPDATE_TRANSACTION_DIR!==transactionDir||!Number.isSafeInteger(shellPid)||shellPid<1)throw new Error('update-restart-identity-mismatch');
  const helper=await readHelperReceipt(path.join(transactionDir,'helper-owner.json'),request.token);
  if(helper?.transactionId!==request.transactionId||typeof helper.pid!=='number'||!processAlive(helper.pid))throw new Error('update-health-helper-unavailable');
  let held=false;try{await withPortableLock(transactionDir,async()=>{});}catch(error){if(error instanceof Error&&error.message==='update-install-lock-busy')held=true;else throw error;}if(!held)throw new Error('update-health-helper-unavailable');
  const matched=await waitUntil(async()=>{const start=await readHelperReceipt(path.join(transactionDir,'candidate-start.json'),request.token);return start?.transactionId===request.transactionId&&start.shellPid===shellPid;},5000);
  if(!matched)throw new Error('update-new-shell-identity-mismatch');await writeHelperReceipt(path.join(transactionDir,'boot-shell.json'),{schemaVersion:1,transactionId:request.transactionId,shellPid},request.token);return {mode:'health'};
}
if(require.main===module){const args=process.argv.slice(2);const action=args[0]==='--takeover'?takeover(args[1]||''):args[0]==='--startup-gate'?linuxPackageStartupGate(args[1]||'',args[2]||'',Number(args[3]),args[4]||'').then(value=>{process.stdout.write(JSON.stringify(value)+'\n');}):Promise.reject(new Error('update-helper-arguments-invalid'));void action.catch(error=>{process.stderr.write(safeError(error)+'\n');process.exitCode=1;});}
