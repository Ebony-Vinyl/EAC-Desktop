import fs = require('node:fs');
import fsp = require('node:fs/promises');
import path = require('node:path');
import crypto = require('node:crypto');
import type {ChildProcess} from 'node:child_process';
import type {DataBinding} from './client-update';
import type {UpdateHandoff} from './update-helper-process';
import {readNsisHandoff} from './update-nsis-helper';
import {readAppImageHandoff} from './update-appimage-helper';
import {readLinuxHandoff} from './update-linux-helper';
import {appImageRuntimePaths} from './update-linux';
import {readPortableHandoff, readHelperReceipt, writeHelperReceipt, helperMac} from './update-portable-helper';
import {plainPath} from './update-backup';
import type {BackupManifest} from './update-backup';
import {hashFile} from './update-package';
import type {HostPrepared} from './update-host-control';
export interface RestartContext {
  transactionDir: string; token: string; shellExe: string; shellPid: number; version: string; nativeVersion: string; target: string;
  binding(): DataBinding; kernel(): ChildProcess|null;
  hostHealth(): Promise<{sessionDigest:string;storedSessionCount:number;configReadable:true}>;
  releaseHost(): Promise<void>;
  recordCompletion?(transactionId:string,version:string):void;
  stopHost(transactionId: string): Promise<HostPrepared>;
  bootSettled(): boolean;
  notify(method: string, params: unknown): void;
}
export class UpdateRestart {
  pending=true;
  private request!:UpdateHandoff;
  private stage='handoff-validation';
  private readonly startedAt=Date.now();
  private readonly initialized:Promise<void>;
  private timer:NodeJS.Timeout|null=null;
  private polling=false;
  private stopped=false;
  private healthStarted=false;
  private failedReported=false;
  private observedKernel:ChildProcess|null=null;
  private ui:{nonce:string;origin:string;resolve(value:boolean):void}|null=null;
  constructor(private readonly ctx:RestartContext){this.initialized=this.initialize();void this.initialized.catch(error=>this.failed(error)).catch(()=>{});}
  private async initialize():Promise<void>{
    const {request,journal}=await (['-deb','-rpm'].some(kind=>this.ctx.target.endsWith(kind)) ? readLinuxHandoff(this.ctx.transactionDir,this.ctx.shellExe) : this.ctx.target.endsWith('-appimage') ? readAppImageHandoff(this.ctx.transactionDir,appImageRuntimePaths(this.ctx.shellExe).image) : this.ctx.target.endsWith('-nsis') ? readNsisHandoff(this.ctx.transactionDir,path.dirname(this.ctx.shellExe)) : readPortableHandoff(this.ctx.transactionDir,path.dirname(this.ctx.shellExe)));
    this.request=request;
    this.timer=setInterval(()=>{if(this.polling||this.stopped)return;this.polling=true;void this.poll().catch(error=>this.failed(error,'control-receipt')).catch(()=>{}).finally(()=>{this.polling=false;});},200);
    if(journal.phase!=='health'||request.token!==this.ctx.token||request.version!==this.ctx.version||request.version!==this.ctx.nativeVersion||request.target!==this.ctx.target
      || JSON.stringify(request.binding)!==JSON.stringify(this.ctx.binding()))throw new Error('update-restart-identity-mismatch');
    this.stage='boot-admission';this.recordOwners();
  }
  canBoot():boolean{return !this.stopped;}
  recordOwners():void{
    if(!this.request)return;
    const kernel=this.ctx.kernel();if(kernel)this.observedKernel=kernel;const payload={schemaVersion:1,transactionId:this.request.transactionId,shellPid:this.ctx.shellPid,sidecarPid:process.pid,kernelPid:kernel?.pid||null,owners:[this.ctx.shellPid,process.pid,...(kernel?.pid?[kernel.pid]:[])]};
    const file=path.join(this.ctx.transactionDir,'boot-owners.json');const temporary=file+'.tmp-'+crypto.randomUUID();
    const fd=fs.openSync(temporary,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify({payload,mac:helperMac(payload,this.ctx.token)})+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temporary,file);
  }
  async beforeBoot():Promise<void>{
    if(!this.pending)return;
    if(this.stopped)throw new Error('update-restart-stopping');
    await this.initialized;this.stage='persistent-data';this.recordOwners();
    try{
    if(!this.request.dataBackupDirectory)throw new Error('update-backup-identity-unavailable');
    const directory=await plainPath(this.request.dataBackupDirectory);
    const manifest=JSON.parse(await fsp.readFile(path.join(directory,'backup-manifest.json'),'utf8')) as BackupManifest;
    if(manifest.schemaVersion!==1||!Array.isArray(manifest.files)||!Array.isArray(manifest.roots))throw new Error('update-backup-manifest-invalid');
    for(const file of manifest.files){
      const root=manifest.roots.find(root=>root.id===file.rootId);
      if(!root?.present||typeof file.relative!=='string'||file.relative.split('/').some(part=>part==='..'||part==='.'||part.includes('\\')))throw new Error('update-backup-manifest-invalid');
      // These owned records are rewritten by environment ensure/window shutdown;
      // durable conversation content is separately opened through the real backend.
      if(file.rootId==='shell-settings'||(file.rootId==='environment'&&file.relative==='.dpx-environment.json'))continue;
      const rootStat=await fsp.lstat(await plainPath(root.path));
      if(rootStat.isFile()&&file.relative!=='file')throw new Error('update-backup-manifest-invalid');
      const current=await plainPath(rootStat.isFile()?root.path:path.join(root.path,...file.relative.split('/')));
      if(await hashFile(current)!==file.sha256){
        const backupFile=path.join(directory,file.rootId,...file.relative.split('/'));
        const allowed=await permitsDerivedMetadata(current,backupFile,this.request.binding,this.request.version);
        if(!allowed)throw new Error('update-persistent-data-changed');
      }
    }
    for(const link of manifest.links||[]){
      const root=manifest.roots.find(root=>root.id===link.rootId);
      if(!root?.present||typeof link.relative!=='string'||link.relative.split('/').some(part=>part==='..'||part==='.'||part.includes('\\')))throw new Error('update-backup-manifest-invalid');
      const file=path.join(root.path,...link.relative.split('/'));await plainPath(path.dirname(file));
      if(!(await fsp.lstat(file)).isSymbolicLink()||await fsp.readlink(file)!==link.target)throw new Error('update-persistent-link-changed');
    }
    }catch(error){await this.failed(error,'persistent-data');throw error;}
  }
  bootFailed(error:unknown):Promise<void>{return this.failed(error,'kernel-start');}
  bootReady(webUrl:string):void{
    if(!this.pending||this.healthStarted||this.stopped)return;this.healthStarted=true;this.recordOwners();
    void this.checkHealth(webUrl).catch(error=>this.failed(error)).catch(()=>{});
  }
  acceptUi(value:Record<string,unknown>):void{
    if(!this.ui||value.nonce!==this.ui.nonce||value.origin!==this.ui.origin||typeof value.readable!=='boolean')throw new Error('update-ui-restore-invalid');
    this.ui.resolve(value.readable);
  }
  private async checkHealth(webUrl:string):Promise<void>{
    this.stage='web-origin';
    await this.initialized;
    const url=new URL(webUrl);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||Number(url.port)!==this.request.binding.webPort)throw new Error('update-web-origin-changed');
    this.stage='http-health';
    await probeHttpHealth(url,AbortSignal.timeout(10000));
    this.stage='host-health';
    const health=await this.ctx.hostHealth();
    this.stage='session-receipt';
    const oldReceipt=JSON.parse(await fsp.readFile(path.join(path.dirname(this.request.packageFile),'data-binding.json'),'utf8')) as {receipt?:HostPrepared};
    if(typeof oldReceipt.receipt?.sessionDigest!=='string'||oldReceipt.receipt.sessionDigest!==health.sessionDigest||oldReceipt.receipt.storedSessionCount!==health.storedSessionCount||!health.configReadable)throw new Error('update-session-data-changed');
    this.stage='ui-preferences';
    const saved=JSON.parse(await fsp.readFile(path.join(path.dirname(this.request.packageFile),'ui-preferences.json'),'utf8')) as {origin:string;preferences:Record<string,string>};
    if(saved.origin!==url.origin||!saved.preferences||typeof saved.preferences!=='object'||Array.isArray(saved.preferences))throw new Error('update-ui-origin-changed');
    this.stage='ui-checkpoint';
    const nonce=crypto.randomBytes(32).toString('hex');let timer:NodeJS.Timeout|undefined;
    const readable=await new Promise<boolean>((resolve,reject)=>{
      this.ui={nonce,origin:url.origin,resolve};timer=setTimeout(()=>reject(new Error('update-ui-restore-timeout')),30000);
      this.ctx.notify('update.boot-ui-checkpoint',{nonce,origin:url.origin,preferences:saved.preferences});
    }).finally(()=>{if(timer)clearTimeout(timer);this.ui=null;});
    if(!readable)throw new Error('update-ui-data-changed');
    this.stage='health-receipt';
    const kernel=this.ctx.kernel();if(!kernel?.pid||kernel.exitCode!==null||this.stopped)throw new Error('update-kernel-health-unconfirmed');
    await writeHelperReceipt(path.join(this.ctx.transactionDir,'boot-health.json'),{schemaVersion:1,transactionId:this.request.transactionId,shellPid:this.ctx.shellPid,sidecarPid:process.pid,kernelPid:kernel.pid,version:this.ctx.version,target:this.ctx.target,binding:this.ctx.binding(),httpReady:true,dataReadable:true,uiReadable:true,sessionDigest:health.sessionDigest},this.ctx.token);
  }
  private async failed(error?:unknown,stage=this.stage):Promise<void>{
    if(!this.request||this.failedReported)return;this.failedReported=true;
    const code=error instanceof Error&&/^update-[a-z-]+$/.test(error.message)?error.message:'update-health-unconfirmed';
    await writeHelperReceipt(path.join(this.ctx.transactionDir,'boot-health-failed.json'),{schemaVersion:1,transactionId:this.request.transactionId,shellPid:this.ctx.shellPid,error:code,stage,elapsedMs:Math.max(0,Date.now()-this.startedAt),causes:safeFailureCauses(error)},this.ctx.token);
    this.ctx.notify('update.restart-failed',{message:'update-health-unconfirmed'});
  }
  private async poll():Promise<void>{
    if(!this.request)return;
    const stop=await readHelperReceipt(path.join(this.ctx.transactionDir,'stop-request.json'),this.ctx.token);
    if(stop?.transactionId===this.request.transactionId&&stop.shellPid===this.ctx.shellPid&&stop.action==='stop-for-recovery'){
      if(!this.ctx.bootSettled())return;
      const kernel=this.ctx.kernel()||this.observedKernel;let receipt:HostPrepared|null=null;
      if(kernel?.pid&&kernel.exitCode===null){receipt=await this.ctx.stopHost(crypto.randomUUID());if(!receipt.rootDisposed||kernel.exitCode!==0)throw new Error('update-shutdown-unconfirmed');}
      const payload={schemaVersion:1,transactionId:this.request.transactionId,shellPid:this.ctx.shellPid,sidecarPid:process.pid,kernelPid:kernel?.pid||null,kernelNeverStarted:!kernel?.pid,owners:[this.ctx.shellPid,process.pid,...(kernel?.pid?[kernel.pid]:[])],rootDisposed:receipt?.rootDisposed||!kernel?.pid,kernelExitedBeforeAdmission:!!kernel?.pid&&kernel.exitCode!==null&&!receipt,admissionHeld:this.pending};
      this.stopped=true;if(this.timer)clearInterval(this.timer);
      await writeHelperReceipt(path.join(this.ctx.transactionDir,'boot-stopped.json'),payload,this.ctx.token);this.ctx.notify('update.safe-exit',{transactionId:this.request.transactionId});return;
    }
    const accepted=await readHelperReceipt(path.join(this.ctx.transactionDir,'health-accepted.json'),this.ctx.token);
    if(accepted?.transactionId===this.request.transactionId&&accepted.action==='accepted'){
      await this.initialized;
      if(!fs.existsSync(path.join(this.ctx.transactionDir,'boot-health.json')))throw new Error('update-health-acceptance-invalid');
      this.ctx.recordCompletion?.(this.request.transactionId,this.request.version);
      await this.ctx.releaseHost();this.pending=false;
      for(const key of ['DSH_EAC_UPDATE_HEALTH_TOKEN','DSH_EAC_UPDATE_TRANSACTION_DIR','DSH_EAC_UPDATE_HEALTH_BOOT'])delete process.env[key];if(this.timer)clearInterval(this.timer);this.ctx.notify('update.boot-accepted',{});
    }
  }
  close():void{if(this.timer)clearInterval(this.timer);this.timer=null;this.stopped=true;}
}

function canonical(value:unknown):string{
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}';return JSON.stringify(value)??'null';
}
export async function permitsDerivedMetadata(current:string,backupFile:string,binding:DataBinding,version:string):Promise<boolean>{
 const normal=(file:string)=>process.platform==='win32'?path.resolve(file).toLowerCase():path.resolve(file);
 const settings=normal(path.join(binding.userDataDir,'settings.json'));
 const profiles=path.join(binding.dshHome,'profiles');const relative=path.relative(profiles,current).split(path.sep).join('/');
 const stamp=/^[^/]+\/node_modules\/(?:@[^/]+\/)?[^/]+\/\.eac-copy-stamp\.json$/.test(relative);
 if(normal(current)!==settings&&!stamp)return false;
 try{
  await plainPath(backupFile);const expected=JSON.parse(await fsp.readFile(backupFile,'utf8'));const actual=JSON.parse(await fsp.readFile(current,'utf8'));
  if(!expected||!actual||typeof expected!=='object'||typeof actual!=='object'||Array.isArray(expected)||Array.isArray(actual))return false;
  if(normal(current)===settings){
    if(actual.pluginTreeAlignedVersion!==version)return false;
    const before={...expected};const after={...actual};delete before.pluginTreeAlignedVersion;delete after.pluginTreeAlignedVersion;
    return canonical(before)===canonical(after);
  }
  if(Object.keys(actual).sort().join(',')!=='b,f,h,v'||Object.keys(expected).sort().join(',')!=='b,f,h,v'||!Number.isSafeInteger(actual.f)||actual.f<1||!Number.isSafeInteger(actual.b)||actual.b<1||typeof actual.v!=='string'||typeof actual.h!=='string'||!/^[a-f0-9]{1,8}$/.test(actual.h))return false;
  const before={...expected};const after={...actual};delete before.h;delete after.h;return canonical(before)===canonical(after);
 }catch{return false;}
}

// Only fixed technical identifiers are retained. Error messages, paths, URLs and
// stacks can contain credentials or session data and never enter the receipt.
function safeFailureCauses(error:unknown):Array<{name:string;code?:string}>{
 const names=new Set(['Error','TypeError','SyntaxError','RangeError','AbortError','TimeoutError','AggregateError']);
 const codes=new Set(['ENOENT','EACCES','EPERM','EBUSY','EIO','ENOSPC','ENOTDIR','EISDIR','EINVAL','ECONNREFUSED','ECONNRESET','ETIMEDOUT','EPIPE','ENOTFOUND','ABORT_ERR','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_SOCKET']);
 const result:Array<{name:string;code?:string}>=[];const seen=new Set<unknown>();
 while(error&&typeof error==='object'&&result.length<3&&!seen.has(error)){
  seen.add(error);const value=error as {name?:unknown;code?:unknown;cause?:unknown};
  const entry:{name:string;code?:string}={name:typeof value.name==='string'&&names.has(value.name)?value.name:'Error'};
  if(typeof value.code==='string'&&codes.has(value.code))entry.code=value.code;
  result.push(entry);error=value.cause;
 }
 return result;
}

async function probeHttpHealth(url:URL,signal:AbortSignal):Promise<void>{
 const first=await fetch(url,{redirect:'manual',signal});
 let target:URL|null=null;let cookie='';
 try{
  if(first.status===200){
   if(!first.headers.get('content-type')?.includes('text/html'))throw new Error('update-http-health-unconfirmed');return;
  }
  if(first.status!==303)throw new Error('update-http-health-unconfirmed');
  const location=first.headers.get('location');if(!location)throw new Error('update-http-login-redirect-invalid');
  target=new URL(location,url);
  if(target.origin!==url.origin||target.username||target.password||target.pathname!=='/'||target.search||target.hash)throw new Error('update-http-login-redirect-invalid');
  const cookies=first.headers.getSetCookie().map(value=>value.split(';',1)[0]||'');
  if(!cookies.length||cookies.some(value=>!value||/[\x00-\x20\x7f,;]/.test(value)||!value.includes('=')))throw new Error('update-http-login-cookie-invalid');
  cookie=cookies.join('; ');if(cookie.length>4096)throw new Error('update-http-login-cookie-invalid');
 }finally{await first.body?.cancel();}
 // The one-time token establishes a local HttpOnly cookie via 303. Keep that
 // cookie only in this probe and never follow a redirect beyond the same origin.
 const second=await fetch(target!,{redirect:'manual',signal,headers:{cookie}});
 try{if(second.status!==200||!second.headers.get('content-type')?.includes('text/html'))throw new Error('update-http-health-unconfirmed');}
 finally{await second.body?.cancel();}
}
