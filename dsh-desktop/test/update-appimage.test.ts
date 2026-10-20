import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import cp from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {prepareAppImage,installAppImage,rollbackAppImage,readAppImagePlan,cancelAppImage,appImagePointer}=require('../lib/desktop/update-appimage.js');
const {linuxLockCommand,withPortableLock}=require('../lib/desktop/update-portable-lock.js');
const {hashFile}=require('../lib/desktop/update-package.js');
async function fixture(t:any,arch='x86_64'){
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'eac-appimage-update-'));const root=await fs.realpath(temporary);
  t.after(async()=>{assert.equal(path.dirname(root).toLowerCase(),(await fs.realpath(os.tmpdir())).toLowerCase());assert.ok(path.basename(root).startsWith('eac-appimage-update-'));await fs.rm(root,{recursive:true,force:true});});
  const directory=path.join(root,'应用 空间');await fs.mkdir(directory,{mode:0o700});
  const image=path.join(directory,'EAC-Lite.AppImage');const packageFile=path.join(root,'downloaded.AppImage');
  const header=Buffer.alloc(64);header.writeUInt32BE(0x7f454c46);header[4]=2;header[5]=1;header[8]=0x41;header[9]=0x49;header[10]=2;header.writeUInt16LE(arch==='x86_64'?62:183,18);
  const old=Buffer.concat([header,Buffer.from('old image 6.1.0')]);const next=Buffer.concat([header,Buffer.from('new image 6.1.1')]);
  await fs.writeFile(image,old,{mode:0o755});await fs.writeFile(packageFile,next);
  const key=crypto.generateKeyPairSync('ed25519');const id=crypto.randomBytes(8);const signature=crypto.sign(null,crypto.createHash('blake2b512').update(next).digest(),key.privateKey);const comment='timestamp:1792022400';
  const trustedKey=Buffer.concat([Buffer.from('Ed'),id,(key.publicKey.export({type:'spki',format:'der'}) as Buffer).subarray(-32)]).toString('base64');
  const signed='untrusted comment: fixture\n'+Buffer.concat([Buffer.from('ED'),id,signature]).toString('base64')+'\ntrusted comment: '+comment+'\n'+crypto.sign(null,Buffer.concat([signature,Buffer.from(comment)]),key.privateKey).toString('base64');
  const transactionId=crypto.randomUUID();const target='linux-'+arch+'-appimage';const transactionDir=path.join(directory,'.eac-update-'+transactionId);
  const data=path.join(root,'persistent-data');await fs.mkdir(data);const marker=path.join(data,'sessions-and-config');await fs.writeFile(marker,'original conversations and configuration');
  const binding={environmentRoot:data,dshHome:data,userDataDir:data,registryHome:data,webviewRoot:path.join(data,'webview'),configRoot:path.join(data,'config'),guestRoot:path.join(data,'guest'),profile:'desktop',channel:'beta',webPort:64584};
  const artifact={target,installKind:'appimage',url:'EAC-Lite-6.1.1-linux-'+arch+'.AppImage',size:next.length,sha256:crypto.createHash('sha256').update(next).digest('hex'),signature:signed};
  return {root,directory,image,packageFile,transactionId,transactionDir,target,artifact,trustedKey,binding,protectedRoots:[data],version:'6.1.1',currentVersion:'6.1.0',old,next,marker};
}
async function assertData(f:any){assert.equal(await fs.readFile(f.marker,'utf8'),'original conversations and configuration');}
async function present(file:string){return fs.stat(file).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});}
async function retryRecovery(plan:any){const deadline=Date.now()+10000;for(;;){try{return await rollbackAppImage(plan,async()=>true);}catch(error:any){if(error.message!=='update-install-lock-busy'||Date.now()>=deadline)throw error;await new Promise(resolve=>setTimeout(resolve,100));}}}
for(const arch of ['x86_64','aarch64'])test('AppImage file transaction commits only after owners and health, preserving old image and data: '+arch,async t=>{
  const f=await fixture(t,arch);const plan=await prepareAppImage(f);assert.deepEqual(await fs.readFile(f.image),f.old);assert.equal(await present(appImagePointer(f.image)),true);let health=false;
  const committed=await installAppImage(plan,async()=>true,async()=>{assert.deepEqual(await fs.readFile(f.image),f.next);assert.deepEqual(await fs.readFile(plan.previousFile),f.old);health=true;return true;},async()=>true);
  assert.equal(health,true);assert.equal(committed.phase,'committed');assert.deepEqual(await fs.readFile(f.image),f.next);assert.equal(await present(appImagePointer(f.image)),false);assert.equal(await hashFile(plan.previousFile),plan.previousSha256);await assertData(f);
  await assert.rejects(rollbackAppImage(committed,async()=>true),/already-committed/);
});
test('AppImage owners must exit normally before any replacement, and prepared cancellation preserves files',async t=>{
  const f=await fixture(t);const plan=await prepareAppImage(f);await assert.rejects(installAppImage(plan,async()=>false,async()=>{throw Error('unexpected health');},async()=>true),/processes-still-running/);
  assert.deepEqual(await fs.readFile(f.image),f.old);assert.equal((await readAppImagePlan(f.transactionDir,f.image)).phase,'prepared');await cancelAppImage(plan);assert.equal(await present(appImagePointer(f.image)),false);assert.deepEqual(await fs.readFile(f.packageFile),f.next);await assertData(f);
});
test('AppImage preparation rejects changed package, target architecture and data overlap before creating a transaction',async t=>{
  const f=await fixture(t);await fs.appendFile(f.packageFile,'changed');await assert.rejects(prepareAppImage(f),/package-/);assert.equal(await present(f.transactionDir),false);assert.deepEqual(await fs.readFile(f.image),f.old);
  const g=await fixture(t);await assert.rejects(prepareAppImage({...g,target:'linux-aarch64-appimage',artifact:{...g.artifact,target:'linux-aarch64-appimage'}}),/format-invalid/);assert.equal(await present(g.transactionDir),false);
  const h=await fixture(t);await assert.rejects(prepareAppImage({...h,protectedRoots:[h.directory]}),/data-overlap/);assert.equal(await present(h.transactionDir),false);await assertData(h);
});
test('AppImage changed old image, prepared candidate and journal cannot authorize replacement',async t=>{
  const f=await fixture(t);const plan=await prepareAppImage(f);await fs.appendFile(f.image,'changed old image');await assert.rejects(installAppImage(plan,async()=>true,async()=>true,async()=>true),/previous-changed/);assert.equal(await present(plan.previousFile),false);
  const g=await fixture(t);const other=await prepareAppImage(g);await fs.appendFile(other.candidateFile,'changed candidate');await assert.rejects(installAppImage(other,async()=>true,async()=>true,async()=>true),/package-/);assert.deepEqual(await fs.readFile(g.image),g.old);
  const h=await fixture(t);const owned=await prepareAppImage(h);await fs.writeFile(path.join(h.transactionDir,'appimage-plan.json'),JSON.stringify({...owned,candidateFile:h.packageFile}));await assert.rejects(readAppImagePlan(h.transactionDir,h.image),/plan-invalid/);assert.deepEqual(await fs.readFile(h.image),h.old);
});
test('AppImage failed health restores the old image only after candidate exit is confirmed',async t=>{
  const f=await fixture(t);const plan=await prepareAppImage(f);let stopped=false;
  await assert.rejects(installAppImage(plan,async()=>true,async()=>false,async()=>{stopped=true;return true;}),/health-unconfirmed/);
  assert.equal(stopped,true);assert.deepEqual(await fs.readFile(f.image),f.old);assert.deepEqual(await fs.readFile(plan.rejectedFile),f.next);assert.equal((await readAppImagePlan(f.transactionDir,f.image)).phase,'rolled-back');assert.equal(await present(appImagePointer(f.image)),false);await assertData(f);
  await rollbackAppImage(plan,async()=>{throw Error('no candidate remains');});assert.deepEqual(await fs.readFile(f.image),f.old);
});
test('AppImage candidate without a stop receipt keeps both images and recovery state',async t=>{
  const f=await fixture(t);const plan=await prepareAppImage(f);await assert.rejects(installAppImage(plan,async()=>true,async()=>false,async()=>false),/candidate-still-running/);
  assert.deepEqual(await fs.readFile(f.image),f.next);assert.deepEqual(await fs.readFile(plan.previousFile),f.old);assert.equal((await readAppImagePlan(f.transactionDir,f.image)).phase,'health');assert.equal(await present(appImagePointer(f.image)),true);
  await rollbackAppImage(plan,async()=>true);assert.deepEqual(await fs.readFile(f.image),f.old);await assertData(f);
});
test('AppImage recovery does not overwrite an unknown replacement or foreign recovery pointer',async t=>{
  const f=await fixture(t);const plan=await prepareAppImage(f);await assert.rejects(installAppImage(plan,async()=>true,async()=>{await fs.writeFile(f.image,'unrelated external replacement');return false;},async()=>true),/package-/);
  assert.equal(await fs.readFile(f.image,'utf8'),'unrelated external replacement');assert.deepEqual(await fs.readFile(plan.previousFile),f.old);assert.equal(await present(appImagePointer(f.image)),true);
  const g=await fixture(t);await fs.writeFile(appImagePointer(g.image),'foreign pointer');await assert.rejects(prepareAppImage(g),/installation-in-progress/);assert.equal(await fs.readFile(appImagePointer(g.image),'utf8'),'foreign pointer');assert.deepEqual(await fs.readFile(g.image),g.old);
});
for(const checkpoint of ['current-moved','candidate-moved','health-start'])test('AppImage crash at '+checkpoint+' is recoverable from persistent disk state',async t=>{
  const f=await fixture(t);const plan=await prepareAppImage(f);const script=path.join(f.root,'interrupted.cjs');
  await fs.writeFile(script,'const u=require('+JSON.stringify(require.resolve('../lib/desktop/update-appimage.js'))+');const plan='+JSON.stringify(plan)+';u.installAppImage(plan,async()=>true,async()=>true,async()=>true,async at=>{if(at==='+JSON.stringify(checkpoint)+')process.exit(77)}).catch(()=>process.exit(1));');
  const exited=await new Promise<number|null>((resolve,reject)=>{const child=cp.spawn(process.execPath,[script],{stdio:'ignore',windowsHide:true});child.once('error',reject);child.once('exit',code=>resolve(code));});assert.equal(exited,77);
  const recovered=await retryRecovery(await readAppImagePlan(f.transactionDir,f.image));assert.equal(recovered.phase,'rolled-back');assert.deepEqual(await fs.readFile(f.image),f.old);assert.equal(await present(appImagePointer(f.image)),false);await assertData(f);
});
test('Linux flock uses a fixed executable and literal argv without a command shell',()=>{
  const lock=path.resolve('应用 $() with spaces','.eac-update-lock');const command=linuxLockCommand(lock);assert.equal(command.file,'/usr/bin/flock');assert.ok(command.args.includes('--no-fork'));assert.equal(command.args[5],lock);assert.equal(command.args[6],process.execPath);
  const result=cp.spawnSync(process.execPath,command.args.slice(-2),{input:'',encoding:'utf8',windowsHide:true});assert.equal(result.status,0);assert.equal(result.stdout,'locked\n');
  assert.throws(()=>linuxLockCommand('relative-lock'),/lock-invalid/);assert.throws(()=>linuxLockCommand(lock+'\n'),/lock-invalid/);
});
test('AppImage installation locks exclude another process and release on normal exit',async t=>{
  const f=await fixture(t);const script=path.join(f.root,'lock-contender.cjs');await fs.writeFile(script,'const u=require('+JSON.stringify(require.resolve('../lib/desktop/update-portable-lock.js'))+');u.withPortableLock('+JSON.stringify(f.directory)+',async()=>{}).then(()=>process.exit(0),e=>process.exit(e.message==="update-install-lock-busy"?73:1));');
  await withPortableLock(f.directory,async()=>{const result=cp.spawnSync(process.execPath,[script],{windowsHide:true,timeout:15000});assert.equal(result.status,73);});
  const released=cp.spawnSync(process.execPath,[script],{windowsHide:true,timeout:15000});assert.equal(released.status,0);
});

test('AppImage a substituted transaction pointer cannot authorize a prepared replacement',async t=>{
  const f=await fixture(t);const plan=await prepareAppImage(f);const pointer=appImagePointer(f.image);await fs.writeFile(pointer,JSON.stringify({schemaVersion:1,installKind:'appimage',transactionId:crypto.randomUUID(),transactionDir:plan.transactionDir,image:f.image}));
  await assert.rejects(installAppImage(plan,async()=>true,async()=>true,async()=>true),/recovery-pointer-invalid/);assert.deepEqual(await fs.readFile(f.image),f.old);assert.equal(await present(plan.previousFile),false);await assertData(f);
});

test('AppImage preparation protects data roots that collide with a pointer or lock file',async t=>{
  for(const target of ['pointer','lock']){
    const f=await fixture(t);const protectedPath=target==='pointer'?appImagePointer(f.image):path.join(f.directory,'.eac-update-lock');
    await assert.rejects(prepareAppImage({...f,binding:{...f.binding,guestRoot:protectedPath}}),/data-overlap/);assert.equal(await present(protectedPath),false);assert.equal(await present(f.transactionDir),false);assert.deepEqual(await fs.readFile(f.image),f.old);await assertData(f);
  }
});

test('AppImage cancellation before preparation creates no pointer or transaction',async t=>{
  const f=await fixture(t);const controller=new AbortController();controller.abort();await assert.rejects(prepareAppImage({...f,signal:controller.signal}),/abort/i);assert.equal(await present(f.transactionDir),false);assert.equal(await present(appImagePointer(f.image)),false);assert.deepEqual(await fs.readFile(f.image),f.old);
});
test('native Linux AppImage preparation refuses a directory writable by other users',{skip:process.platform!=='linux'},async t=>{
  const f=await fixture(t);await fs.chmod(f.directory,0o777);try {await assert.rejects(prepareAppImage(f),/permission-denied/);assert.equal(await present(f.transactionDir),false);assert.equal(await present(appImagePointer(f.image)),false);}finally {await fs.chmod(f.directory,0o700);}
});

test('AppImage preparation can retain a read-only executable mode while syncing the candidate',async t=>{
  const f=await fixture(t);await fs.chmod(f.image,0o555);await fs.chmod(f.packageFile,0o444);const plan=await prepareAppImage(f);
  await installAppImage(plan,async()=>true,async()=>true,async()=>true);assert.deepEqual(await fs.readFile(f.image),f.next);assert.deepEqual(await fs.readFile(plan.previousFile),f.old);
  if(process.platform==='linux')assert.equal((await fs.stat(f.image)).mode&0o777,0o555);await assertData(f);
});

const {appImageRuntimePaths,inspectAppImageRuntime,appImageRestartEnvironment}=require('../lib/desktop/update-linux.js');
test('AppImage runtime binding requires the actual shell to be inside APPDIR and the image outside it',async t=>{
  const f=await fixture(t);const appDir=path.join(f.root,'mounted-runtime');const executable=path.join(appDir,'usr','bin','dsh-eac-shell');await fs.mkdir(path.dirname(executable),{recursive:true});await fs.writeFile(executable,'fixture shell entry');
  assert.deepEqual(await inspectAppImageRuntime(executable,f.target,{APPIMAGE:f.image,APPDIR:appDir}),{image:await fs.realpath(f.image),appDir:await fs.realpath(appDir)});
  for(const env of [{APPIMAGE:f.image},{APPIMAGE:'relative.AppImage',APPDIR:appDir},{APPIMAGE:f.image,APPDIR:path.join(f.root,'another-runtime')},{APPIMAGE:executable,APPDIR:appDir}])assert.throws(()=>appImageRuntimePaths(executable,env),/runtime-invalid/);
  const link=path.join(f.root,'linked-runtime');await fs.symlink(appDir,link,process.platform==='win32'?'junction':'dir');await assert.rejects(inspectAppImageRuntime(path.join(link,'usr','bin','dsh-eac-shell'),f.target,{APPIMAGE:f.image,APPDIR:link}),/path-link/);
});
test('AppImage restart removes old mount paths and transient identities while preserving data bindings and unrelated paths',()=>{
  const old='/tmp/.mount-eac';const base={APPIMAGE:'/home/user/Applications/EAC-Lite.AppImage',APPDIR:old,OWD:'/old-working-directory',ARGV0:'old image',DSH_RESOURCE_ROOT:old+'/resources',DSH_NODE_EXE:old+'/node',DSH_SHELL_PID:'123',DSH_EAC_UPDATE_HEALTH_TOKEN:'old-token',DSH_EAC_UPDATE_TRANSACTION_DIR:'/old-transaction',DSH_EAC_DATA_ROOT:'/home/user/data',DSH_EAC_CHANNEL:'beta',HOME:'/home/user',PATH:old+'/usr/bin:/usr/bin',LD_LIBRARY_PATH:old+'/usr/lib:/tmp/.mount-eac-copy/usr/lib:/usr/lib',LD_PRELOAD:old+'/lib.so:/usr/lib/custom.so',PYTHONPATH:old+'/python:/home/user/python',GSETTINGS_SCHEMA_DIR:old+'/schemas',QT_PLUGIN_PATH:old+'/plugins'};
  const env=appImageRestartEnvironment(base,{DSH_EAC_DATA_ROOT:'/home/user/data',DPX_HOME:'/home/user/registry'},old);
  for(const key of ['APPIMAGE','APPDIR','OWD','ARGV0','DSH_RESOURCE_ROOT','DSH_NODE_EXE','DSH_SHELL_PID','DSH_EAC_UPDATE_HEALTH_TOKEN','DSH_EAC_UPDATE_TRANSACTION_DIR','GSETTINGS_SCHEMA_DIR','QT_PLUGIN_PATH'])assert.equal(env[key],undefined,key);
  assert.equal(env.PATH,'/usr/bin');assert.equal(env.LD_LIBRARY_PATH,'/tmp/.mount-eac-copy/usr/lib:/usr/lib');assert.equal(env.LD_PRELOAD,'/usr/lib/custom.so');assert.equal(env.PYTHONPATH,'/home/user/python');assert.equal(env.DSH_EAC_DATA_ROOT,base.DSH_EAC_DATA_ROOT);assert.equal(env.DSH_EAC_CHANNEL,'beta');assert.equal(env.HOME,base.HOME);assert.equal(env.DPX_HOME,'/home/user/registry');assert.equal(base.APPDIR,old);
});

const {startAppImageHelper,readAppImageHandoff,appImageStartupGate}=require('../lib/desktop/update-appimage-helper.js');
test('copied AppImage helper acknowledges and cancels without changing image or data', {timeout:60000},async t=>{
  const f=await fixture(t);const plan=await prepareAppImage(f);
  const helper=await startAppImageHelper({plan,owners:[process.pid],dataBackupDirectory:path.join(f.root,'backup'),launchEnv:{}});
  t.after(()=>helper.cancel().catch(()=>{}));
  assert.ok(helper.pid>0);const read=await readAppImageHandoff(plan.transactionDir,plan.installRoot);
  assert.equal(read.journal.phase,'prepared');assert.equal(read.request.version,'6.1.1');assert.ok(read.request.owners.includes(process.pid));
  await helper.cancel();await cancelAppImage(plan);assert.deepEqual(await fs.readFile(f.image),f.old);await assertData(f);
});
test('AppImage helper waits for live owners and leaves the original installed file intact', {timeout:60000},async t=>{
  const f=await fixture(t);const plan=await prepareAppImage(f);
  const helper=await startAppImageHelper({plan,owners:[process.pid],dataBackupDirectory:path.join(f.root,'backup'),launchEnv:{},ownerTimeoutMs:100});
  await helper.commit();await helper.waitForExit();
  const result=JSON.parse(await fs.readFile(path.join(plan.transactionDir,'helper-result.json'),'utf8'));
  assert.equal(result.ok,false);assert.equal(result.error,'update-install-processes-still-running');assert.equal((await readAppImagePlan(plan.transactionDir,plan.installRoot)).phase,'prepared');
  assert.deepEqual(await fs.readFile(f.image),f.old);await assertData(f);await cancelAppImage(plan);
});
test('AppImage startup requires an owned pending transaction and verifies the copied helper', {timeout:60000},async t=>{
  const f=await fixture(t);assert.deepEqual(await appImageStartupGate(f.image,process.pid,'6.1.0',{}),{mode:'normal',recovered:false});
  await assert.rejects(appImageStartupGate(f.image,process.pid,'6.1.1',{DSH_EAC_UPDATE_HEALTH_TOKEN:'x'}),/health-pointer-unavailable/);
  const plan=await prepareAppImage(f);const helper=await startAppImageHelper({plan,owners:[process.pid],dataBackupDirectory:path.join(f.root,'backup'),launchEnv:{}});await helper.cancel();
  await assert.rejects(appImageStartupGate(f.image,process.pid,'6.1.0',{}),/startup-recovery-unconfirmed/);
  await fs.appendFile(path.join(plan.transactionDir,'helper/lib/desktop/update-appimage-helper.js'),'\n// changed');
  await assert.rejects(readAppImageHandoff(plan.transactionDir,plan.installRoot),/helper-files-invalid/);assert.deepEqual(await fs.readFile(f.image),f.old);await assertData(f);await cancelAppImage(plan);
});
