import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {prepareNsis,installNsis}=require('../lib/desktop/update-nsis.js');
const makensis=process.env.EAC_TEST_MAKENSIS || path.join(os.homedir(),'AppData/Local/tauri/nsis-3.11/makensis.exe');
const hooks=path.resolve(import.meta.dirname,'../../tauri-shell/installer-hooks.nsh');
function execute(file:string,args:string[]):Promise<{code:number|null;output:string}>{
 return new Promise((resolve,reject)=>{const child=spawn(file,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],...(args.some(arg=>arg.startsWith('/D='))?{windowsVerbatimArguments:true,argv0:'"'+file+'"'}:{})});let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);child.once('error',reject);child.once('exit',code=>resolve({code,output}));});
}
async function fixture(t:any,arch='x64',payload?:string){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eac-nsis-update-'));t.after(async()=>{const resolved=path.resolve(root);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('eac-nsis-update-'));await fs.rm(resolved,{recursive:true,force:true});});
 const script=path.join(root,'fixture.nsi');const exe=path.join(root,'fixture.exe');const target=path.join(root,'应用 目录');const data=path.join(root,'个人 数据');await fs.mkdir(data);await fs.writeFile(path.join(data,'session.json'),'preserved conversation');
 await fs.writeFile(script,`Unicode true
RequestExecutionLevel user
SilentInstall silent
Name "EAC update safety fixture"
InstallDir "placeholder\\EACUpdateFixture"
VIProductVersion "6.0.1.0"
VIAddVersionKey "ProductName" "Deepseek Harness EAC"
VIAddVersionKey "ProductVersion" "6.0.1"
VIAddVersionKey "FileVersion" "6.0.1"
VIAddVersionKey "FileDescription" "EAC update safety fixture"
VIAddVersionKey "LegalCopyright" "fixture"
OutFile "${exe}"
!include MUI2.nsh
!include FileFunc.nsh
!include x64.nsh
!include WordFunc.nsh
!define ARCH "${arch}"
!define VERSION "6.0.1"
!define MAINBINARYNAME "dsh-eac-shell"
!define ESTIMATEDSIZE "1"
!define UNINSTKEY "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\EACUpdateFixture"
Var UpdateMode
!macro CheckIfAppIsRunning A B
 SetErrorLevel 99
 Quit
!macroend
!include "${hooks}"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "SimpChinese"
Function .onInit
 StrCpy $UpdateMode 1
FunctionEnd
Section
 !insertmacro DSH_InstallPreflight
 FileOpen $0 "${root}\\diagnosis.txt" w
 FileWrite $0 "$INSTDIR: $DshLocationError"
 FileClose $0
 !insertmacro NSIS_HOOK_PREINSTALL
 !insertmacro CheckIfAppIsRunning "dsh-eac-shell.exe" "fixture"
 CreateDirectory "$INSTDIR\\dsh-desktop"
 ${payload ? 'SetOutPath "$INSTDIR"\n File "/oname=dsh-eac-shell.exe" "'+payload+'"' : ''}
 FileOpen $0 "$INSTDIR\\fixture-installed.txt" w
 FileWrite $0 "success"
 FileClose $0
 !insertmacro NSIS_HOOK_POSTINSTALL
SectionEnd
`);
 const built=await execute(makensis,['/V2',script]);assert.equal(built.code,0,built.output);return {root,exe,target,data};
}
async function lockFile(file:string){
 const script="$ErrorActionPreference='Stop';$s=New-Object IO.FileStream($env:EAC_TEST_LOCK,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);try{[Console]::WriteLine('ready');[Console]::Out.Flush();[Console]::ReadLine()|Out-Null}finally{$s.Dispose()}";
 const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','ignore'],env:{...process.env,EAC_TEST_LOCK:file}});
 const exit=new Promise(resolve=>child.once('exit',resolve));await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('lock fixture timeout')),10000);child.stdout.once('data',()=>{clearTimeout(timer);resolve();});child.once('error',reject);});
 return {child,release:async()=>{child.stdin.end();await exit;}};
}
const unavailable=process.platform!=='win32'||!existsSync(makensis);
test('compiled NSIS UPDATE hook keeps user data and emits actual installation identity',{skip:unavailable},async t=>{
 for(const [arch,expected] of [['x64','x86_64'],['arm64','aarch64']]){
  const f=await fixture(t,arch);const installed=await execute(f.exe,['/S','/D='+f.target]);assert.equal(installed.code,0,installed.output+await fs.readFile(path.join(f.root,'diagnosis.txt'),'utf8'));
  const marker=JSON.parse(await fs.readFile(path.join(f.target,'eac-installation.json'),'utf8'));assert.deepEqual(marker,{schemaVersion:1,product:'eac-desktop',installKind:'nsis',scope:'currentUser',arch:expected,version:'6.0.1'});
  assert.equal(await fs.readFile(path.join(f.data,'session.json'),'utf8'),'preserved conversation');assert.equal(await fs.readFile(path.join(f.target,'fixture-installed.txt'),'utf8'),'success');
 }
});
test('compiled NSIS hook refuses a locked target before writing and keeps its owner alive',{skip:unavailable},async t=>{
 const f=await fixture(t);await fs.mkdir(f.target);const file=path.join(f.target,'dsh-eac-shell.exe');await fs.writeFile(file,'old program');const lock=await lockFile(file);
 try{const result=await execute(f.exe,['/S','/D='+f.target]);assert.equal(result.code,2);assert.equal(lock.child.exitCode,null);assert.equal(await fs.stat(path.join(f.target,'fixture-installed.txt')).then(()=>true,()=>false),false);}finally{await lock.release();}
 assert.equal(await fs.readFile(file,'utf8'),'old program');
 const retry=await execute(f.exe,['/S','/D='+f.target]);assert.equal(retry.code,0,retry.output);
});
test('a locked same-name executable in another installation is preserved and does not block UPDATE',{skip:unavailable},async t=>{
 const f=await fixture(t);const other=path.join(f.root,'other installation');await fs.mkdir(other);const file=path.join(other,'dsh-eac-shell.exe');await fs.writeFile(file,'other program');const lock=await lockFile(file);
 try{const result=await execute(f.exe,['/S','/D='+f.target]);assert.equal(result.code,0,result.output+await fs.readFile(path.join(f.root,'diagnosis.txt'),'utf8'));assert.equal(lock.child.exitCode,null);}finally{await lock.release();}assert.equal(await fs.readFile(file,'utf8'),'other program');
});
async function signedFixture(t:any,payload?:string){
 const f=await fixture(t,'x64',payload);await fs.mkdir(f.target);await fs.mkdir(path.join(f.target,'dsh-desktop'));await fs.writeFile(path.join(f.target,'dsh-desktop/profile.txt'),'lite');await fs.writeFile(path.join(f.target,'dsh-eac-shell.exe'),'old program');await fs.writeFile(path.join(f.target,'eac-installation.json'),JSON.stringify({schemaVersion:1,product:'eac-desktop',installKind:'nsis',scope:'currentUser',arch:'x86_64',version:'6.0.0'}));
 const bytes=await fs.readFile(f.exe);const key=crypto.generateKeyPairSync('ed25519');const id=crypto.randomBytes(8);const signature=crypto.sign(null,crypto.createHash('blake2b512').update(bytes).digest(),key.privateKey);const comment='timestamp:1791849600';
 const artifact={target:'windows-x86_64-nsis',installKind:'nsis',url:'installer.exe',size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),signature:'untrusted comment: signature\n'+Buffer.concat([Buffer.from('ED'),id,signature]).toString('base64')+'\ntrusted comment: '+comment+'\n'+crypto.sign(null,Buffer.concat([signature,Buffer.from(comment)]),key.privateKey).toString('base64')};
 const trustedKey=Buffer.concat([Buffer.from('Ed'),id,(key.publicKey.export({type:'spki',format:'der'}) as Buffer).subarray(-32)]).toString('base64');
 const transactionId=crypto.randomUUID();
 const plan=await prepareNsis({installRoot:f.target,transactionDir:path.join(f.root,'.eac-update-'+transactionId),transactionId,version:'6.0.1',target:artifact.target,packageFile:f.exe,artifact,trustedKey,protectedRoots:[f.data]});return {...f,plan};
}
test('NSIS adapter verifies the full installer, preserves target scope and commits only after health',{skip:unavailable},async t=>{
 const f=await signedFixture(t);let health=false;await installNsis(f.plan,async()=>true,async()=>{health=true;assert.equal(JSON.parse(await fs.readFile(path.join(f.target,'eac-installation.json'),'utf8')).version,'6.0.1');return true;});
 assert.equal(health,true);assert.equal(f.plan.phase,'committed');assert.equal(f.plan.exitCode,0);assert.equal(await fs.readFile(path.join(f.target,'dsh-desktop/profile.txt'),'utf8'),'lite');assert.equal(await fs.readFile(path.join(f.data,'session.json'),'utf8'),'preserved conversation');
});
test('unconfirmed owners and modified installer bytes block NSIS before any installation write',{skip:unavailable},async t=>{
 const f=await signedFixture(t);await assert.rejects(installNsis(f.plan,async()=>false,async()=>true),/owner-exit-unconfirmed/);assert.equal(f.plan.phase,'prepared');assert.equal(await fs.stat(path.join(f.target,'fixture-installed.txt')).then(()=>true,()=>false),false);
 await fs.appendFile(f.plan.installerFile,'modified');await assert.rejects(installNsis(f.plan,async()=>true,async()=>true),/package-size-mismatch|package-identity-mismatch/);assert.equal(await fs.stat(path.join(f.target,'fixture-installed.txt')).then(()=>true,()=>false),false);
});
test('NSIS install or health failures retain the signed installer, journal and user data',{skip:unavailable},async t=>{
 for(const locked of [true,false]){
  const f=await signedFixture(t);const lock=locked?await lockFile(path.join(f.target,'dsh-eac-shell.exe')):null;
  try{await assert.rejects(installNsis(f.plan,async()=>true,async()=>false),locked?/nsis-install-failed/:/health-unconfirmed/);}finally{if(lock)await lock.release();}
  assert.equal(f.plan.phase,'failed');assert.equal(await fs.readFile(path.join(f.data,'session.json'),'utf8'),'preserved conversation');assert.ok((await fs.stat(f.plan.installerFile)).size>0);assert.equal(JSON.parse(await fs.readFile(path.join(f.plan.transactionDir,'nsis-plan.json'),'utf8')).phase,'failed');
 }
});

async function nativeProtocolStub(t:any,healthy=true){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eac-nsis-protocol-'));
 t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('eac-nsis-protocol-'));await fs.rm(root,{recursive:true,force:true});});
 const script=path.join(root,'sidecar.cjs');const source=path.join(root,'launcher.cs');const exe=path.join(root,'launcher.exe');
 // This fixture exercises the installer worker protocol. Real Host/HTTP/UI
 // admission remains the responsibility of UpdateRestart and its runtime tests.
 await fs.writeFile(script,`
 const fs=require('node:fs/promises');const path=require('node:path');const cp=require('node:child_process');
 const p=require(${JSON.stringify(require.resolve('../lib/desktop/update-helper-process.js'))});
 const a=require(${JSON.stringify(require.resolve('../lib/desktop/update-nsis-helper.js'))});
 const delay=()=>new Promise(r=>setTimeout(r,50));
 (async()=>{const dir=process.env.DSH_EAC_UPDATE_TRANSACTION_DIR;const token=process.env.DSH_EAC_UPDATE_HEALTH_TOKEN;const shellPid=Number(process.env.EAC_FIXTURE_SHELL_PID);
 const raw=JSON.parse(await fs.readFile(path.join(dir,'helper/handoff.json'),'utf8'));const {request}=await a.readNsisHandoff(dir,raw.installRoot);
 const gate=await a.nsisStartupGate(request.installRoot,shellPid,request.version);if(gate.mode!=='health')throw Error('fixture health gate failed');
 const kernel=cp.spawn(process.execPath,['-e',"process.stdin.resume();process.stdin.on('end',()=>process.exit(0));"],{windowsHide:true,stdio:['pipe','ignore','ignore']});const kernelExit=new Promise(r=>kernel.once('exit',r));
 const payload={schemaVersion:1,transactionId:request.transactionId,shellPid,sidecarPid:process.pid,kernelPid:kernel.pid,version:request.version,target:request.target,binding:request.binding,httpReady:true,dataReadable:true,uiReadable:true};
 if(${healthy})await p.writeHelperReceipt(path.join(dir,'boot-health.json'),payload,token);
 else await p.writeHelperReceipt(path.join(dir,'boot-health-failed.json'),{schemaVersion:1,transactionId:request.transactionId,shellPid,error:'update-health-unconfirmed'},token);
 const deadline=Date.now()+20000;let accepted=false;
 while(Date.now()<deadline){const receipt=await p.readHelperReceipt(path.join(dir,'health-accepted.json'),token);if(receipt?.transactionId===request.transactionId){accepted=true;break;}
 const stop=await p.readHelperReceipt(path.join(dir,'stop-request.json'),token);if(stop?.shellPid===shellPid){kernel.stdin.end();await kernelExit;
 await p.writeHelperReceipt(path.join(dir,'boot-stopped.json'),{schemaVersion:1,transactionId:request.transactionId,shellPid,sidecarPid:process.pid,kernelPid:kernel.pid,owners:[shellPid,process.pid,kernel.pid],rootDisposed:true},token);break;}await delay();}
 if(kernel.exitCode===null){kernel.stdin.end();await kernelExit;}
 await fs.writeFile(path.join(dir,'protocol-fixture.json'),JSON.stringify({accepted,shellPid,sidecarPid:process.pid,kernelPid:kernel.pid}));
 })().catch(()=>{process.exitCode=1;});
 `);
 const cs=(value:string)=>'@"'+value.replaceAll('"','""')+'"';
 await fs.writeFile(source,`using System;using System.Diagnostics;class Fixture{static int Main(){var p=new ProcessStartInfo(${cs(process.execPath)},((char)34).ToString()+${cs(script)}+((char)34));p.UseShellExecute=false;p.CreateNoWindow=true;p.EnvironmentVariables["EAC_FIXTURE_SHELL_PID"]=Process.GetCurrentProcess().Id.ToString();using(var c=Process.Start(p)){c.WaitForExit();return c.ExitCode;}}}`);
 const compiler=path.join(process.env.SystemRoot||'C:/Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe');
 const compiled=await execute(compiler,['/nologo','/target:winexe','/out:'+exe,source]);assert.equal(compiled.code,0,compiled.output);return exe;
}
async function helperFixture(t:any,payload?:string){
 const f=await signedFixture(t,payload);const binding={environmentRoot:f.data,dshHome:f.data,userDataDir:path.join(f.root,'desktop'),registryHome:path.join(f.root,'registry'),webviewRoot:path.join(f.root,'webview'),configRoot:path.join(f.root,'config'),guestRoot:path.join(f.root,'guests'),channel:'beta',profile:'desktop',webPort:51234};
 const backup=await require('../lib/desktop/update-backup.js').captureBackup([{id:'environment',path:f.data,required:true}],path.join(f.root,'saved-data'),new AbortController().signal);
 f.plan.dataBinding=binding;await fs.writeFile(path.join(f.plan.transactionDir,'nsis-plan.json'),JSON.stringify(f.plan));
 const owner=spawn(process.execPath,['-e',"process.stdin.resume();process.stdin.on('end',()=>process.exit(0));"],{windowsHide:true,stdio:['pipe','ignore','ignore']});
 const ownerExit=new Promise<void>(resolve=>owner.once('exit',()=>resolve()));const release=async()=>{if(owner.exitCode===null){owner.stdin.end();await ownerExit;}};t.after(release);
 return {...f,binding,release,owner,options:{plan:f.plan,packageFile:f.exe,owners:[owner.pid!],dataBackupDirectory:backup.directory,launchEnv:{},ownerTimeoutMs:2000,healthTimeoutMs:10000}};
}
async function waitJson(file:string,timeout=10000):Promise<any>{const deadline=Date.now()+timeout;while(Date.now()<deadline){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}await new Promise(r=>setTimeout(r,50));}throw Error('fixture receipt timeout');}
const {startNsisHelper,nsisStartupGate,readNsisHandoff,nsisRepairInfo}=require('../lib/desktop/update-nsis-helper.js');
const {readHelperReceipt,processAlive}=require('../lib/desktop/update-helper-process.js');
const {cancelNsis}=require('../lib/desktop/update-nsis.js');
test('copied NSIS worker acknowledges before cancellation and leaves the installed tree intact',{skip:unavailable},async t=>{
 const f=await helperFixture(t);const handle=await startNsisHelper(f.options);assert.ok(handle.pid);await handle.cancel();
 assert.equal(await fs.readFile(path.join(f.target,'dsh-eac-shell.exe'),'utf8'),'old program');assert.equal(existsSync(path.join(f.target,'fixture-installed.txt')),false);
 await assert.rejects(nsisRepairInfo(f.target,'6.0.0'),/repair-unavailable/);
 const recovered=await nsisStartupGate(f.target,process.pid,'6.0.0',{});assert.equal(recovered.mode,'normal');assert.equal(recovered.recovered,true);assert.equal(existsSync(path.join(f.target,'.eac-update-recovery.json')),false);
});
test('copied NSIS worker refuses installation while an original owner remains alive',{skip:unavailable},async t=>{
 const f=await helperFixture(t);const handle=await startNsisHelper(f.options);await handle.commit();await handle.waitForExit();
 const result=await waitJson(path.join(f.plan.transactionDir,'helper-result.json'));assert.equal(result.ok,false);assert.equal(result.error,'update-owner-exit-unconfirmed');assert.equal(await fs.readFile(path.join(f.target,'dsh-eac-shell.exe'),'utf8'),'old program');assert.equal(existsSync(path.join(f.plan.transactionDir,'previous-program')),false);await cancelNsis(f.plan);
});
test('copied NSIS worker installs a signed Setup, backs up the program and commits authenticated health',{skip:unavailable,timeout:60000},async t=>{
 const f=await helperFixture(t,await nativeProtocolStub(t));const handle=await startNsisHelper(f.options);await f.release();await handle.commit();await handle.waitForExit();
 const result=await waitJson(path.join(f.plan.transactionDir,'helper-result.json'));assert.equal(result.ok,true);
 const {request,journal}=await readNsisHandoff(f.plan.transactionDir,f.target);assert.equal(journal.phase,'committed');const health=await readHelperReceipt(path.join(f.plan.transactionDir,'boot-health.json'),request.token);assert.equal(health.uiReadable,true);assert.equal(health.target,'windows-x86_64-nsis');const accepted=await readHelperReceipt(path.join(f.plan.transactionDir,'health-accepted.json'),request.token);assert.equal(accepted.action,'accepted');
 assert.equal(await fs.readFile(path.join(f.plan.transactionDir,'previous-program/program/dsh-eac-shell.exe'),'utf8'),'old program');assert.equal(await fs.readFile(path.join(f.data,'session.json'),'utf8'),'preserved conversation');assert.equal(existsSync(path.join(f.target,'.eac-update-recovery.json')),false);
 const protocol=await waitJson(path.join(f.plan.transactionDir,'protocol-fixture.json'));assert.equal(protocol.accepted,true);for(const pid of [protocol.shellPid,protocol.sidecarPid,protocol.kernelPid]){const until=Date.now()+5000;while(processAlive(pid)&&Date.now()<until)await new Promise(r=>setTimeout(r,50));assert.equal(processAlive(pid),false);}
});
test('NSIS health failure stops the new candidate through receipts and retains repair materials',{skip:unavailable,timeout:60000},async t=>{
 const f=await helperFixture(t,await nativeProtocolStub(t,false));const handle=await startNsisHelper({...f.options,healthTimeoutMs:3000});await f.release();await handle.commit();await handle.waitForExit();const result=await waitJson(path.join(f.plan.transactionDir,'helper-result.json'));assert.equal(result.ok,false);assert.equal(result.error,'update-health-unconfirmed');assert.equal(result.candidateStopped,true);
 const {journal}=await readNsisHandoff(f.plan.transactionDir,f.target);assert.equal(journal.phase,'failed');assert.ok(existsSync(journal.installerFile));assert.ok(existsSync(path.join(journal.transactionDir,'previous-program/backup-manifest.json')));assert.equal(await fs.readFile(path.join(f.data,'session.json'),'utf8'),'preserved conversation');await assert.rejects(nsisStartupGate(f.target,process.pid,'6.0.1',{}),/nsis-repair-required/);
 const info=await nsisRepairInfo(f.target,'6.0.1');assert.equal(info.version,'6.0.1');assert.equal(info.phase,'failed');assert.equal(info.transactionDir,journal.transactionDir);assert.equal(info.installerFile,journal.installerFile);assert.equal(info.programBackupManifestPresent,true);assert.equal(info.error,'update-health-unconfirmed');assert.equal('token' in info,false);assert.equal('binding' in info,false);
 await assert.rejects(nsisRepairInfo(f.target,'6.2.0'),/repair-unavailable/);
 const planBefore=await fs.readFile(path.join(journal.transactionDir,'nsis-plan.json'));const pointerBefore=await fs.readFile(path.join(f.target,'.eac-update-recovery.json'));
 const {request}=await readNsisHandoff(f.plan.transactionDir,f.target);const {writeHelperReceipt}=require('../lib/desktop/update-helper-process.js');await writeHelperReceipt(path.join(journal.transactionDir,'boot-owners.json'),{schemaVersion:1,transactionId:journal.transactionId,shellPid:process.pid,owners:[process.pid]},request.token);
 await assert.rejects(nsisRepairInfo(f.target,'6.0.1'),/installation-in-progress/);assert.deepEqual(await fs.readFile(path.join(journal.transactionDir,'nsis-plan.json')),planBefore);assert.deepEqual(await fs.readFile(path.join(f.target,'.eac-update-recovery.json')),pointerBefore);assert.equal(await fs.readFile(path.join(f.data,'session.json'),'utf8'),'preserved conversation');

});
test('NSIS handoff refuses changed worker files before startup admission',{skip:unavailable},async t=>{
 const f=await helperFixture(t);const handle=await startNsisHelper(f.options);await handle.cancel();await fs.appendFile(path.join(f.plan.transactionDir,'helper/lib/desktop/update-nsis.js'),'\n// changed');await assert.rejects(readNsisHandoff(f.plan.transactionDir,f.target),/helper-files-invalid/);await assert.rejects(nsisRepairInfo(f.target,'6.0.0'),/helper-files-invalid/);await cancelNsis(f.plan);
});

test('NSIS restart uses the shared persistent-data, HTTP, session and UI admission contract',{skip:unavailable,timeout:60000},async t=>{
 const http=require('node:http');const {UpdateRestart}=require('../lib/desktop/update-restart.js');const {writeHelperReceipt}=require('../lib/desktop/update-helper-process.js');
 for(const changedSession of [false,true]){
  const f=await helperFixture(t);const web=http.createServer((_request:any,response:any)=>{response.writeHead(200,{'Content-Type':'text/html'});response.end('<html>NSIS restart fixture</html>');});await new Promise<void>(resolve=>web.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>web.close(resolve)));
  f.binding.webPort=web.address().port;f.plan.dataBinding=f.binding;await fs.writeFile(path.join(f.plan.transactionDir,'nsis-plan.json'),JSON.stringify(f.plan));
  const handle=await startNsisHelper(f.options);await handle.cancel();f.plan.phase='health';await fs.writeFile(path.join(f.plan.transactionDir,'nsis-plan.json'),JSON.stringify(f.plan));
  const {request}=await readNsisHandoff(f.plan.transactionDir,f.target);const digest='fixture-session-digest';const origin='http://127.0.0.1:'+f.binding.webPort;
  await fs.writeFile(path.join(f.root,'data-binding.json'),JSON.stringify({receipt:{sessionDigest:digest,storedSessionCount:1}}));await fs.writeFile(path.join(f.root,'ui-preferences.json'),JSON.stringify({origin,preferences:{'dsh.locale':'zh-CN'}}));
  let released=0;const completions:any[]=[];let supervisor:any;
  supervisor=new UpdateRestart({transactionDir:f.plan.transactionDir,token:request.token,shellExe:path.join(f.target,'dsh-eac-shell.exe'),shellPid:process.pid,version:'6.0.1',nativeVersion:'6.0.1',target:f.plan.target,binding:()=>f.binding,kernel:()=>f.owner,
   hostHealth:async()=>({sessionDigest:changedSession?'changed-session-digest':digest,storedSessionCount:1,configReadable:true}),releaseHost:async()=>{released++;},recordCompletion:(id:string,version:string)=>completions.push({id,version}),stopHost:async()=>{throw Error('unexpected stop');},bootSettled:()=>true,
   notify:(method:string,value:any)=>{if(method==='update.boot-ui-checkpoint')queueMicrotask(()=>supervisor.acceptUi({nonce:value.nonce,origin:value.origin,readable:true}));}});t.after(()=>supervisor.close());
  await supervisor.beforeBoot();supervisor.bootReady(origin+'/');
  if(changedSession){const failed=await waitJson(path.join(f.plan.transactionDir,'boot-health-failed.json'));assert.equal(failed.payload.stage,'session-receipt');assert.equal(failed.payload.error,'update-session-data-changed');assert.equal(released,0);assert.deepEqual(completions,[]);}
  else{const health=await waitJson(path.join(f.plan.transactionDir,'boot-health.json'));assert.equal(health.payload.dataReadable,true);assert.equal(health.payload.uiReadable,true);assert.equal(health.payload.target,'windows-x86_64-nsis');assert.equal(released,0);
   await writeHelperReceipt(path.join(f.plan.transactionDir,'health-accepted.json'),{schemaVersion:1,transactionId:f.plan.transactionId,action:'accepted'},request.token);const deadline=Date.now()+3000;while(supervisor.pending&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));assert.equal(supervisor.pending,false);assert.equal(released,1);assert.deepEqual(completions,[{id:f.plan.transactionId,version:'6.0.1'}]);}
  supervisor.close();
 }
});

test('NSIS startup cancels an interrupted preparation before a copied helper existed',{skip:unavailable},async t=>{
 const f=await helperFixture(t);await fs.writeFile(path.join(f.target,'.eac-update-recovery.json'),JSON.stringify({schemaVersion:1,installKind:'nsis',transactionId:f.plan.transactionId,transactionDir:f.plan.transactionDir}));
 const result=await nsisStartupGate(f.target,process.pid,'6.0.0',{});assert.equal(result.mode,'normal');assert.equal(result.recovered,true);assert.equal(existsSync(path.join(f.target,'.eac-update-recovery.json')),false);assert.equal(await fs.readFile(path.join(f.target,'dsh-eac-shell.exe'),'utf8'),'old program');
});
test('NSIS startup refuses a second launch during takeover and rejects a changed binding',{skip:unavailable},async t=>{
 const f=await helperFixture(t);const handle=await startNsisHelper(f.options);
 try{await assert.rejects(nsisStartupGate(f.target,process.pid,'6.0.0',{}),/installation-in-progress/);}finally{await handle.cancel();}
 const file=path.join(f.plan.transactionDir,'helper/handoff.json');const request=JSON.parse(await fs.readFile(file,'utf8'));request.binding.webPort++;await fs.writeFile(file,JSON.stringify(request));await assert.rejects(readNsisHandoff(f.plan.transactionDir,f.target),/helper-request-invalid/);await cancelNsis(f.plan);
});
