import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const WebSocket=require('ws');
function call(socket:any,id:number,method:string,params:unknown={},timeoutMs=5000):Promise<any>{
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{socket.off('message',message);reject(new Error('native-relay-response-timeout: '+method));},timeoutMs);
  const message=(bytes:Buffer)=>{const value=JSON.parse(String(bytes));if(value.id!==id)return;clearTimeout(timer);socket.off('message',message);value.error?reject(new Error(method+': '+value.error.message)):resolve(value.result);};
  socket.on('message',message);socket.send(JSON.stringify({jsonrpc:'2.0',id,method,params}));
 });
}
function connect(port:number):Promise<any>{
 return new Promise((resolve,reject)=>{const socket=new WebSocket('ws://127.0.0.1:'+port+'/ws',{origin:'http://127.0.0.1:'+port,handshakeTimeout:500});socket.once('open',()=>resolve(socket));socket.once('error',reject);});
}
test('actual native WebSocket accepts status and cancellation while a full update reply is pending',
 {skip:process.platform!=='win32'||!process.env.EAC_UPDATE_NATIVE_SHELL,timeout:60000},async t=>{
 const fixtureId=crypto.randomUUID();const base=path.resolve(import.meta.dirname,'../../.test-runtime');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'native-update-relay-'));
 await fs.mkdir(path.join(root,'sidecar'));await fs.mkdir(path.join(root,'dsh-desktop'));
 await fs.copyFile(process.env.EAC_UPDATE_NATIVE_SHELL!,path.join(root,'dsh-eac-shell.exe'));
 await fs.writeFile(path.join(root,'sidecar/server.js'),`
 const readline=require('node:readline');let pending=null;let phase='idle';let ui=null;let uiTimer=null;
 const notify=(method,params)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',method,params})+'\\n');
 const requestUi=(id,exit)=>{ui={id,exit};uiTimer=setInterval(()=>notify('update.ui-freeze',{nonce:'c'.repeat(64)}),100);};
 const reply=(id,result)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\\n');
 const lines=readline.createInterface({input:process.stdin});lines.on('line',line=>{
  const req=JSON.parse(line);const {id,method}=req;
  if(method==='shell.info')return reply(id,{fixtureId:${JSON.stringify(fixtureId)},pid:process.pid,healthEnvPresent:!!process.env.DSH_EAC_UPDATE_HEALTH_TOKEN});
  if(method==='client-update.prepare'||method==='client-update.download'){phase='installing';pending=id;process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'fixture.update-started',params:{}})+'\\n');return;}
  if(method==='client-update.settings')return reply(id,{phase,pending:pending!==null});
  if(method==='client-update.cancel'){phase='idle';if(pending!==null){reply(pending,{cancelled:true});pending=null;}return reply(id,{cancelled:true});}
  if(method==='fixture.accept-and-exit'){reply(id,{});process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'update.boot-accepted',params:{}})+'\\n',()=>process.exit(17));return;}
  if(method==='fixture.ui-ready')return requestUi(id,false);
  if(method==='client-update.ui-checkpoint'&&ui){const waiting=ui;ui=null;clearInterval(uiTimer);notify('update.ui-release',{});reply(id,{});if(waiting.exit){require('node:fs').writeFileSync(${JSON.stringify(path.join(root,'shutdown-ui-confirmed.json'))},JSON.stringify({uiProcessedDuringShutdown:true}));reply(waiting.id,{bye:true});return process.stdout.write('',()=>process.exit(0));}return reply(waiting.id,{ready:true});}
  if(method==='shutdown')return requestUi(id,true);
  reply(id,{});
 });`);
 const child=spawn(path.join(root,'dsh-eac-shell.exe'),[],{cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=28960',DSH_NODE_EXE:process.execPath,DSH_EAC_UPDATE_HEALTH_TOKEN:'isolated-native-fixture-token',DSH_EAC_UPDATE_TRANSACTION_DIR:path.join(root,'transaction'),DSH_EAC_DATA_ROOT:path.join(root,'data'),DSH_EAC_SHELL_CONFIG_DIR:path.join(root,'config'),DSH_EAC_GUEST_DATA_DIR:path.join(root,'guests'),DSH_EAC_WEBVIEW_DATA_DIR:path.join(root,'webview')}});
 let port=0;let socket:any;
 t.after(async()=>{if(socket)socket.terminate();let control:any;try{if(child.exitCode===null&&port){control=await connect(port);await call(control,90,'win.close-force').catch(()=>{});control.terminate();const deadline=Date.now()+15000;while(child.exitCode===null&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));assert.equal(child.exitCode,0,'the isolated native fixture must exit normally');const evidence=JSON.parse(await fs.readFile(path.join(root,'shutdown-ui-confirmed.json'),'utf8'));assert.equal(evidence.uiProcessedDuringShutdown,true,'the GUI must process its checkpoint while sidecar shutdown is pending');}}finally{control?.terminate();if(child.exitCode===null)child.kill();}});
 const deadline=Date.now()+20000;
 while(!socket&&Date.now()<deadline){
  for(let candidate=19873;candidate<19898;candidate++){let probe:any;try{probe=await connect(candidate);const info=await call(probe,1,'shell.info');if(info.fixtureId===fixtureId){socket=probe;port=candidate;break;}probe.close();}catch{if(probe)probe.terminate();}}
  if(!socket)await new Promise(r=>setTimeout(r,100));
 }
 assert.ok(socket,'the isolated native fixture must expose its own bridge');
 for(const [index,method] of ['client-update.prepare','client-update.download'].entries()){
  const started=new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(()=>{socket.off('message',message);reject(new Error('native-relay-start-timeout'));},5000);
   const message=(bytes:Buffer)=>{if(JSON.parse(String(bytes)).method!=='fixture.update-started')return;clearTimeout(timer);socket.off('message',message);resolve();};socket.on('message',message);
  });
  const request=call(socket,10+index*10,method);void request.catch(()=>{});await started;
  // A status round trip must complete before the long operation can finish.
  const state=await call(socket,11+index*10,'client-update.settings');assert.equal(state.pending,true);assert.equal(state.phase,'installing');
  await assert.rejects(call(socket,12+index*10,method),/update-operation-busy/);
  const cancelled=await call(socket,13+index*10,'client-update.cancel');assert.equal(cancelled.cancelled,true);assert.equal((await request).cancelled,true);
  const restored=await call(socket,14+index*10,'client-update.settings');assert.equal(restored.phase,'idle');
 }
 const first=await call(socket,40,'shell.info');assert.equal(first.healthEnvPresent,true);
 await call(socket,41,'fixture.accept-and-exit');
 // The parent must observe the old sidecar's exit before boot.start can respawn it.
 const exited=Date.now()+5000;while(Date.now()<exited){try{process.kill(first.pid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')break;}await new Promise(r=>setTimeout(r,50));}
 const restartDeadline=Date.now()+5000;while(true){try{await call(socket,42,'boot.start');break;}catch(error){if(!(error instanceof Error)||!error.message.endsWith('sidecar exited')||Date.now()>=restartDeadline)throw error;await new Promise(r=>setTimeout(r,50));}}const next=await call(socket,43,'shell.info');assert.notEqual(next.pid,first.pid);assert.equal(next.fixtureId,fixtureId);assert.equal(next.healthEnvPresent,false);assert.equal((await call(socket,44,'fixture.ui-ready',{},20000)).ready,true);
});

test('actual native NSIS recovery dialog exposes validated materials before sidecar startup',
 {skip:process.platform!=='win32'||!process.env.EAC_UPDATE_NATIVE_SHELL,timeout:60000},async t=>{
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'eac-nsis-repair-native-'));const root=await fs.realpath(temporary);let nativeChild:ReturnType<typeof spawn>|null=null;let nativeExit:Promise<number|null>|null=null;
 t.after(async()=>{if(nativeChild&&nativeChild.exitCode===null){nativeChild.kill();await nativeExit?.catch(()=>{});}assert.equal(path.dirname(root).toLowerCase(),(await fs.realpath(os.tmpdir())).toLowerCase());assert.ok(path.basename(root).startsWith('eac-nsis-repair-native-'));await fs.rm(root,{recursive:true,force:true});});
 const install=path.join(root,'应用 目录');await fs.mkdir(install);const shell=path.join(install,'dsh-eac-shell.exe');await fs.copyFile(process.env.EAC_UPDATE_NATIVE_SHELL!,shell);
 const current=JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url),'utf8')).version;const parts=current.split('.').map(Number);parts[2]++;const next=parts.join('.');
 const id=crypto.randomUUID();const directory=path.join(root,'.eac-update-'+id);const helper=path.join(directory,'helper');const script=path.join(helper,'lib/desktop/update-nsis-helper.js');await fs.mkdir(path.dirname(script),{recursive:true});await fs.copyFile(process.execPath,path.join(helper,'node.exe'));
 const installer=path.join(directory,'installer.exe');await fs.writeFile(installer,'native transport fixture; not a product installer');
 const info={schemaVersion:1,installKind:'nsis',transactionId:id,transactionDir:directory,installRoot:install,version:next,previousVersion:current,phase:'failed',installerFile:installer,programBackupManifestPresent:true,error:'update-health-unconfirmed'};
 const readMarker=path.join(root,'repair-query.json');const sidecarMarker=path.join(root,'sidecar-started.json');
 await fs.writeFile(script,'const fs=require("node:fs");if(process.argv[2]==="--startup-gate")process.exitCode=1;else if(process.argv[2]==="--repair-info"){fs.writeFileSync('+JSON.stringify(readMarker)+',"queried");process.stdout.write(JSON.stringify('+JSON.stringify(info)+'));}else process.exitCode=2;');
 await fs.writeFile(path.join(install,'.eac-update-recovery.json'),JSON.stringify({schemaVersion:1,installKind:'nsis',transactionId:id,transactionDir:directory}));await fs.mkdir(path.join(install,'sidecar'));await fs.writeFile(path.join(install,'sidecar/server.js'),'require("node:fs").writeFileSync('+JSON.stringify(sidecarMarker)+',"unexpected business sidecar start");');
 const env={...process.env,DSH_RESOURCE_ROOT:install,DSH_EAC_DATA_ROOT:path.join(root,'data'),DSH_EAC_CHANNEL:'beta',DPX_HOME:path.join(root,'registry'),DSH_EAC_WEBVIEW_DATA_DIR:path.join(root,'webview'),DSH_EAC_SHELL_CONFIG_DIR:path.join(root,'config'),DSH_EAC_GUEST_DATA_DIR:path.join(root,'guests')};
 for(const key of ['DSH_EAC_UPDATE_HEALTH_TOKEN','DSH_EAC_UPDATE_TRANSACTION_DIR','DSH_EAC_UPDATE_HEALTH_BOOT'])delete env[key];
 const child=spawn(shell.toLowerCase(),[],{cwd:install,windowsHide:true,stdio:['ignore','pipe','pipe'],env});let stderr='';child.stderr.on('data',data=>{stderr+=String(data);});const exit=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});nativeChild=child;nativeExit=exit;void exit.catch(()=>{});
 const capture=process.env.EAC_UPDATE_REPAIR_SCREENSHOT;if(capture){await fs.mkdir(path.dirname(capture),{recursive:true});assert.equal(await fs.stat(capture).then(()=>true,()=>false),false,'preserve existing screenshot evidence');}
 const probe=await new Promise<any>((resolve,reject)=>{let stdout='',error='';const args=['-NoProfile','-NonInteractive','-File',path.join(import.meta.dirname,'fixtures/nsis-repair-dialog-probe.ps1'),'-TargetProcess',String(child.pid),...(capture?['-ScreenshotPath',capture]:[])];const inspector=spawn('powershell.exe',args,{windowsHide:true,stdio:['ignore','pipe','pipe']});inspector.stdout.on('data',data=>{stdout+=String(data);});inspector.stderr.on('data',data=>{error+=String(data);});inspector.once('error',reject);inspector.once('exit',code=>code===0?resolve(JSON.parse(stdout.trim())):reject(new Error('native repair UI probe failed: '+error)));});
 assert.equal(probe.visible,true);assert.match(probe.title,/EAC-Lite/);assert.ok(probe.body.includes(next));assert.ok(probe.body.includes(directory));assert.match(probe.body,/更新尚未确认完成|not been confirmed complete/);assert.ok(probe.width>100&&probe.height>100);assert.equal(probe.declined,true);assert.equal(await exit,1);assert.equal(await fs.readFile(readMarker,'utf8'),'queried');assert.equal(await fs.stat(sidecarMarker).then(()=>true,()=>false),false);assert.match(stderr,/startup refused/);
 const evidence=process.env.EAC_UPDATE_REPAIR_EVIDENCE;if(evidence){await fs.mkdir(path.dirname(evidence),{recursive:true});await fs.writeFile(evidence,JSON.stringify({schemaVersion:1,scope:'actual native recovery dialog with protocol fixture; signed NSIS backend covered separately',mixedCaseLaunch:true,nativeVersion:current,targetVersion:next,visible:probe.visible,title:probe.title,body:probe.body,width:probe.width,height:probe.height,captureSaved:probe.captureSaved,declined:probe.declined,exitCode:1,sidecarStarted:false,queryObserved:true,realProductSetupAtoB:false,screenshot:capture||null},null,2)+'\n');}
});
