import nodeTest from 'node:test';
const test: typeof nodeTest = ((name: string, optionsOrBody: any, body?: any) => {
  if (typeof optionsOrBody === 'function') return nodeTest(name,{skip:process.platform !== 'win32' && name !== 'file manifest locks closure, paths, duplicates and exact package bytes'},optionsOrBody);
  return nodeTest(name,{...optionsOrBody,skip:process.platform !== 'win32' || optionsOrBody.skip},body);
}) as typeof nodeTest;
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {makeReleaseFiles,parseReleaseFiles,verifyReleaseTree,safeRelative}=require('../lib/desktop/update-package.js');
const {preparePortable,exchangePortable,recoverPortable,readPortableJournal}=require('../lib/desktop/update-portable.js');
const {inspectPortableArchive,extractPortableArchive}=require('../lib/desktop/update-archive.js');
const TARGET='windows-x86_64-portable';
const BASE_FILES=['dsh-eac-shell.exe','.dsh-portable','sidecar/server.js','sidecar/bridge.js','dpx/src/index.js','ui-skin-manager/resolved/system.default/snapshot.json'];
async function temporary(t:any){const root=await fs.mkdtemp(path.join(os.tmpdir(),'eac-portable-'));t.after(async()=>{const resolved=path.resolve(root);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('eac-portable-'));await fs.rm(resolved,{recursive:true,force:true});});return root;}
async function tree(root:string,version:string,dll=true){
  await fs.mkdir(root);for(const relative of BASE_FILES){const file=path.join(root,...relative.split('/'));await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,version+':'+relative);}
  await fs.mkdir(path.join(root,'dsh-desktop'));await fs.writeFile(path.join(root,'dsh-desktop/package.json'),JSON.stringify({version}));
  if(dll)await fs.writeFile(path.join(root,'WebView2Loader.dll'),version+' dll');
  return makeReleaseFiles(root,version,TARGET);
}
async function fixture(t:any,dll=true){const root=await temporary(t);const install=path.join(root,'应用 目录');const stage=path.join(root,'next');const data=path.join(root,'用户数据');await fs.mkdir(data);await fs.writeFile(path.join(data,'session.json'),'durable user session');await tree(install,'6.0.0');const next=await tree(stage,'6.0.1',dll);return {root,install,stage,data,next};}
async function prepare(f:any){return preparePortable({installRoot:f.install,stageRoot:f.stage,transactionId:crypto.randomUUID(),version:'6.0.1',target:TARGET,dataBinding:{home:f.data},protectedRoots:[f.data]});}
async function version(root:string){return JSON.parse(await fs.readFile(path.join(root,'dsh-desktop/package.json'),'utf8')).version;}
test('file manifest locks closure, paths, duplicates and exact package bytes',async t=>{
 const f=await fixture(t);await verifyReleaseTree(f.stage,f.next);
 for(const value of ['../file','/file','a/../file','a\\file','C:/file','con.txt','a./file','a /file'])assert.throws(()=>safeRelative(value));
 assert.throws(()=>parseReleaseFiles({...f.next,files:[...f.next.files,f.next.files[0]]}),/manifest-invalid/);
 assert.throws(()=>parseReleaseFiles({...f.next,files:f.next.files.filter((x:any)=>x.path!=='dpx/src/index.js')}),/closure-incomplete/);
 await fs.writeFile(path.join(f.stage,'sidecar/server.js'),'corrupted');await assert.rejects(verifyReleaseTree(f.stage,f.next),/tree-mismatch/);
});
test('exchange preserves unknown user files and retains last-good until after real health callback',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.install,'私人笔记.txt'),'unknown top-level');await fs.writeFile(path.join(f.install,'sidecar/user-note.txt'),'unknown nested');
 const journal=await prepare(f);let checked=false;
 await exchangePortable(journal,async()=>true,async()=>{checked=true;assert.equal(await version(f.install),'6.0.1');assert.equal(await version(path.join(journal.transactionDir,'old')),'6.0.0');return true;});
 assert.equal(checked,true);assert.equal(journal.phase,'committed');assert.equal(await fs.readFile(path.join(f.install,'私人笔记.txt'),'utf8'),'unknown top-level');assert.equal(await fs.readFile(path.join(f.install,'sidecar/user-note.txt'),'utf8'),'unknown nested');
 assert.equal(await fs.readFile(path.join(f.data,'session.json'),'utf8'),'durable user session');assert.equal(await version(path.join(journal.transactionDir,'old')),'6.0.0');
});
test('unconfirmed owners block all exchange, keeping the current executable and directories',async t=>{
 const f=await fixture(t);const journal=await prepare(f);let health=false;
 await assert.rejects(exchangePortable(journal,async()=>false,async()=>{health=true;return true;}),/owner-exit-unconfirmed/);
 assert.equal(await version(f.install),'6.0.0');assert.equal(health,false);assert.equal(await recoverPortable(f.install),true);assert.equal(await version(f.install),'6.0.0');
});
test('a failed new boot rolls back program files without restoring an older user-data snapshot',async t=>{
 const f=await fixture(t);const journal=await prepare(f);
 await assert.rejects(exchangePortable(journal,async()=>true,async()=>{await fs.writeFile(path.join(f.data,'session.json'),'new conversation after attempt');return false;}),/health-unconfirmed/);
 assert.equal(await version(f.install),'6.0.0');assert.equal(await fs.readFile(path.join(f.data,'session.json'),'utf8'),'new conversation after attempt');
 assert.equal(await recoverPortable(f.install),false);assert.equal((await readPortableJournal(journal.transactionDir,f.install)).phase,'rolled-back');
});
test('controlled optional files can disappear and still return on failed health',async t=>{
 const f=await fixture(t,false);const journal=await prepare(f);
 await assert.rejects(exchangePortable(journal,async()=>true,async()=>false),/health-unconfirmed/);assert.equal(await fs.readFile(path.join(f.install,'WebView2Loader.dll'),'utf8'),'6.0.0 dll');
});
test('unknown files conflicting with a new owned file block before any installation move',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.install,'sidecar/new-owned.js'),'user file');await fs.writeFile(path.join(f.stage,'sidecar/new-owned.js'),'product file');await makeReleaseFiles(f.stage,'6.0.1',TARGET);
 await assert.rejects(prepare(f),/user-file-conflict/);assert.equal(await version(f.install),'6.0.0');assert.equal(await fs.readFile(path.join(f.install,'sidecar/new-owned.js'),'utf8'),'user file');
});
test('every move intent and completed move can fail and recover the original tree',{timeout:240000},async t=>{
 const seed=await fixture(t);const first=await prepare(seed);const names=first.items.map((x:any)=>x.name);await recoverPortable(seed.install);
 const checkpoints=['exchange-start',...names.flatMap((name:string)=>['old-intent','old-saved','new-intent','new-installed'].map(stage=>name+':'+stage)),'health-start'];
 for(const fault of checkpoints){
  const f=await fixture(t);const journal=await prepare(f);
  await assert.rejects(exchangePortable(journal,async()=>true,async()=>true,async(point:string)=>{if(point===fault)throw Error('injected-fault');}),/injected-fault/);
  await recoverPortable(f.install);assert.equal(await version(f.install),'6.0.0',fault);assert.equal(await fs.readFile(path.join(f.data,'session.json'),'utf8'),'durable user session',fault);
 }
});
test('a helper exiting after a persisted checkpoint recovers through the startup entry point',async t=>{
 for(const fault of ['sidecar:old-saved','sidecar:new-installed','dsh-eac-shell.exe:new-installed']){
  const f=await fixture(t);const journal=await prepare(f);const script=path.join(f.root,'interrupted-helper.cjs');const module=require.resolve('../lib/desktop/update-portable.js');
  await fs.writeFile(script,'const fs=require("node:fs");const updater=require('+JSON.stringify(module)+');const journal=JSON.parse(fs.readFileSync('+JSON.stringify(path.join(journal.transactionDir,'journal.json'))+',"utf8"));updater.exchangePortable(journal,async()=>true,async()=>true,async point=>{if(point==='+JSON.stringify(fault)+')process.exit(77);}).catch(()=>process.exit(1));');
  const child=spawn(process.execPath,[script],{stdio:'ignore'});const code=await new Promise<number|null>(resolve=>child.once('exit',resolve));assert.equal(code,77);
  assert.equal(await recoverPortable(f.install),true);assert.equal(await version(f.install),'6.0.0');assert.equal(await recoverPortable(f.install),false);
 }
});
test('startup recovery refuses a forged pointer escaping the owned sibling directory',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.install,'.eac-update-recovery.json'),JSON.stringify({schemaVersion:1,transactionId:crypto.randomUUID(),transactionDir:f.data}));
 await assert.rejects(recoverPortable(f.install),/pointer-invalid/);assert.equal(await fs.readFile(path.join(f.data,'session.json'),'utf8'),'durable user session');
});

function zipBuffer(entries:Array<{name:string;bytes:Buffer;attributes?:number}>):Buffer{
 const local:Buffer[]=[];const central:Buffer[]=[];let offset=0;
 function crc(bytes:Buffer){let c=0xffffffff;for(const byte of bytes){c^=byte;for(let n=0;n<8;n++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
 for(const entry of entries){const name=Buffer.from(entry.name);const checksum=crc(entry.bytes);const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt32LE(checksum,14);header.writeUInt32LE(entry.bytes.length,18);header.writeUInt32LE(entry.bytes.length,22);header.writeUInt16LE(name.length,26);
 const index=Buffer.alloc(46);index.writeUInt32LE(0x02014b50);index.writeUInt16LE(0x0314,4);index.writeUInt16LE(20,6);index.writeUInt16LE(0x800,8);index.writeUInt32LE(checksum,16);index.writeUInt32LE(entry.bytes.length,20);index.writeUInt32LE(entry.bytes.length,24);index.writeUInt16LE(name.length,28);index.writeUInt32LE((entry.attributes||0)>>>0,38);index.writeUInt32LE(offset,42);
 local.push(header,name,entry.bytes);central.push(index,name);offset+=header.length+name.length+entry.bytes.length;}
 const directory=Buffer.concat(central);const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,directory,end]);
}
async function packageEntries(root:string){const {treeFiles}=require('../lib/desktop/update-package.js');const entries:Array<{name:string;bytes:Buffer;attributes?:number}>=[];for(const file of await treeFiles(root))entries.push({name:file.path,bytes:await fs.readFile(path.join(root,...file.path.split('/')))});return entries;}
test('native ZIP inspection and extraction include the marker and preserve Unicode filenames',{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.stage,'dsh-desktop/用户 文件.txt'),'完整文件');const manifest=await makeReleaseFiles(f.stage,'6.0.1',TARGET);const archive=path.join(f.root,'完整 包.zip');await fs.writeFile(archive,zipBuffer(await packageEntries(f.stage)));
 assert.equal((await inspectPortableArchive(archive,'6.0.1',TARGET)).files.length,manifest.files.length);
 const extracted=path.join(f.root,'已 解压');await extractPortableArchive(archive,extracted,'6.0.1',TARGET);assert.equal(await fs.readFile(path.join(extracted,'dsh-desktop/用户 文件.txt'),'utf8'),'完整文件');assert.equal(await fs.readFile(path.join(extracted,'.dsh-portable'),'utf8'),'6.0.1:.dsh-portable');
});
test('ZIP traversal, duplicate paths, links and unlisted files are rejected before extraction',{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t);const entries=await packageEntries(f.stage);const attacks=[
  [...entries,{name:'../escape.txt',bytes:Buffer.from('escape')}],
  [...entries,{name:'SIDECAR/SERVER.JS',bytes:Buffer.from('collision')}],
  [...entries,{name:'sidecar/link',bytes:Buffer.from('/external'),attributes:0xa1ff0000}],
  [...entries,{name:'sidecar/unlisted.js',bytes:Buffer.from('unknown')}],
 ];
 for(let i=0;i<attacks.length;i++){const archive=path.join(f.root,'attack-'+i+'.zip');const stage=path.join(f.root,'attack-stage-'+i);await fs.writeFile(archive,zipBuffer(attacks[i]!));await assert.rejects(extractPortableArchive(archive,stage,'6.0.1',TARGET));assert.equal(await fs.stat(stage).then(()=>true,()=>false),false);}
 assert.equal(await fs.stat(path.join(f.root,'escape.txt')).then(()=>true,()=>false),false);
});

test('OS lock refuses concurrent recovery and releases after helper completion',async t=>{
 const f=await fixture(t); const journal=await prepare(f);
 let release!:()=>void; const held=new Promise<void>(resolve=>release=resolve);
 let acquired!:()=>void; const ready=new Promise<void>(resolve=>acquired=resolve);
 const exchange=exchangePortable(journal,async()=>{acquired();await held;return true;},async()=>true);
 await ready; await assert.rejects(recoverPortable(f.install),/lock-busy/); release(); await exchange;
 assert.equal(await recoverPortable(f.install),false);
});
test('malformed ownership journals and missing old material cannot report successful recovery',async t=>{
 const f=await fixture(t);const journal=await prepare(f);const original=JSON.stringify(journal);
 const attacks=[{version:'6.0.0'},{target:'windows-aarch64-portable'},{preserved:[{path:'../escape',size:1,sha256:'0'.repeat(64)}]},{items:journal.items.filter((item:any)=>item.name!=='sidecar')}];
 for(const attack of attacks){await fs.writeFile(path.join(journal.transactionDir,'journal.json'),JSON.stringify({...journal,...attack}));await assert.rejects(readPortableJournal(journal.transactionDir,f.install),/journal-invalid/);}
 await fs.writeFile(path.join(journal.transactionDir,'journal.json'),original);
 await assert.rejects(exchangePortable(journal,async()=>true,async()=>false,async(name:string)=>{
  if(name==='health-start'){const old=path.resolve(journal.transactionDir,'old/sidecar');const relative=path.relative(path.resolve(f.root),old);assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));await fs.rm(old,{recursive:true});}
 }),/identity-mismatch/);
 assert.equal((await readPortableJournal(journal.transactionDir,f.install)).phase,'recovery-failed');
 await assert.rejects(recoverPortable(f.install),/identity-mismatch/);assert.equal(await version(f.install),'6.0.1');
});
test('empty user directories survive the exchange and directory-to-file conflicts refuse before preparation',async t=>{
 const f=await fixture(t);await fs.mkdir(path.join(f.install,'sidecar/用户 空目录'));
 const journal=await prepare(f);await exchangePortable(journal,async()=>true,async()=>true);
 assert.equal((await fs.stat(path.join(f.install,'sidecar/用户 空目录'))).isDirectory(),true);
 const g=await fixture(t);await fs.mkdir(path.join(g.install,'sidecar/personal-dir'));await fs.writeFile(path.join(g.stage,'sidecar/personal-dir'),'owned');await makeReleaseFiles(g.stage,'6.0.1',TARGET);
 await assert.rejects(prepare(g),/user-file-conflict/);assert.equal(await version(g.install),'6.0.0');
});

async function helperFixture(t:any,variant='',nativeShell?:Buffer){
 const f=await fixture(t);
 if(variant)await fs.writeFile(path.join(f.stage,'sidecar/server.js'),variant);
 if(nativeShell)await fs.writeFile(path.join(f.stage,'dsh-eac-shell.exe'),nativeShell);
 if(variant||nativeShell)await makeReleaseFiles(f.stage,'6.0.1',TARGET);
 const binding={environmentRoot:f.data,dshHome:path.join(f.data,'home'),profile:'web-desktop',channel:'beta',registryHome:path.join(f.data,'registry'),userDataDir:path.join(f.data,'desktop'),webPort:64574,webviewRoot:path.join(f.data,'webview'),configRoot:path.join(f.data,'config'),guestRoot:path.join(f.data,'guests')};
 await fs.mkdir(binding.dshHome);await fs.mkdir(binding.userDataDir);
 const journal=await preparePortable({installRoot:f.install,stageRoot:f.stage,transactionId:crypto.randomUUID(),version:'6.0.1',target:TARGET,dataBinding:binding,protectedRoots:[f.data]});
 const bytes=zipBuffer(await packageEntries(f.stage));const packageFile=path.join(f.root,'signed.zip');await fs.writeFile(packageFile,bytes);
 const key=crypto.generateKeyPairSync('ed25519');const id=crypto.randomBytes(8);const signature=crypto.sign(null,crypto.createHash('blake2b512').update(bytes).digest(),key.privateKey);const comment='timestamp:1791849600';
 const artifact={target:TARGET,installKind:'portable',url:'signed.zip',size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),signature:'untrusted comment: signature\n'+Buffer.concat([Buffer.from('ED'),id,signature]).toString('base64')+'\ntrusted comment: '+comment+'\n'+crypto.sign(null,Buffer.concat([signature,Buffer.from(comment)]),key.privateKey).toString('base64')};
 const trustedKey=Buffer.concat([Buffer.from('Ed'),id,(key.publicKey.export({type:'spki',format:'der'}) as Buffer).subarray(-32)]).toString('base64');
 return {...f,journal,packageFile,artifact,trustedKey,binding};
}
async function waitFile(file:string){const deadline=Date.now()+15000;while(Date.now()<deadline){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('helper result timed out');}
test('standalone copied helper acknowledges a verified ZIP and cancellation changes no installed file',async t=>{
 const {startPortableHelper}=require('../lib/desktop/update-portable-helper.js');const f=await helperFixture(t);
 const handle=await startPortableHelper({...f,owners:[process.pid]});assert.ok(handle.pid>0);assert.notEqual(handle.pid,process.pid);
 assert.equal((await fs.stat(path.join(f.journal.transactionDir,'helper/node.exe'))).isFile(),true);
 await assert.rejects(recoverPortable(f.install),/lock-busy/);
 await handle.cancel();assert.equal(await version(f.install),'6.0.0');assert.equal((await readPortableJournal(f.journal.transactionDir,f.install)).phase,'prepared');
 assert.equal(await recoverPortable(f.install),true);
});
test('standalone helper never exchanges while a designated owner is alive',async t=>{
 const {startPortableHelper}=require('../lib/desktop/update-portable-helper.js');const f=await helperFixture(t);
 const handle=await startPortableHelper({...f,owners:[process.pid],ownerTimeoutMs:200});await handle.commit();await handle.waitForExit();
 const result=await waitFile(path.join(f.journal.transactionDir,'helper-result.json'));assert.equal(result.ok,false);assert.equal(result.error,'update-owner-exit-unconfirmed');
 assert.equal(await version(f.install),'6.0.0');assert.equal((await readPortableJournal(f.journal.transactionDir,f.install)).phase,'prepared');
 await recoverPortable(f.install);
});
test('helper refuses corrupt signed bytes and a candidate tree from a different ZIP before acknowledging',async t=>{
 const {startPortableHelper}=require('../lib/desktop/update-portable-helper.js');const f=await helperFixture(t);await fs.appendFile(f.packageFile,'changed');
 await assert.rejects(startPortableHelper({...f,owners:[process.pid]}),/takeover-refused/);assert.equal(await version(f.install),'6.0.0');
 const g=await helperFixture(t);const different=await helperFixture(t,'different signed package contents');
 await assert.rejects(startPortableHelper({...g,packageFile:different.packageFile,artifact:different.artifact,trustedKey:different.trustedKey,owners:[process.pid]}),/takeover-refused/);assert.equal(await version(g.install),'6.0.0');
});
test('health failure cannot roll back files while the new process shutdown remains unconfirmed',async t=>{
 const f=await fixture(t);const journal=await prepare(f);
 await assert.rejects(exchangePortable(journal,async()=>true,async()=>false,undefined,async()=>false),/health-stop-unconfirmed/);
 assert.equal((await readPortableJournal(journal.transactionDir,f.install)).phase,'recovery-failed');assert.equal(await version(f.install),'6.0.1');
 assert.equal(await version(path.join(journal.transactionDir,'old')),'6.0.0');
 // This isolated fixture launches no app; a subsequent recovery is safe.
 assert.equal(await recoverPortable(f.install),true);assert.equal(await version(f.install),'6.0.0');
});

test('packager names both PE architectures and ships the complete file inventory and marker',{skip:process.platform!=='win32'},async t=>{
 const root=await temporary(t);const shell=path.join(root,'tauri-shell');const desktop=path.join(root,'dsh-desktop');await fs.mkdir(shell);await fs.mkdir(path.join(desktop,'lib/desktop'),{recursive:true});
 await fs.writeFile(path.join(desktop,'package.json'),JSON.stringify({version:'6.0.1'}));
 await fs.copyFile(path.resolve('../tauri-shell/make-portable.mjs'),path.join(shell,'make-portable.mjs'));
 for(const name of ['update-package.js','update-backup.js'])await fs.copyFile(require.resolve('../lib/desktop/'+name),path.join(desktop,'lib/desktop',name));
 const output=path.join(root,'输出 目录');
 async function run(args:string[]){const child=spawn(process.execPath,[path.join(shell,'make-portable.mjs'),...args],{stdio:['ignore','pipe','pipe'],windowsHide:true});let log='';child.stdout.on('data',data=>log+=data);child.stderr.on('data',data=>log+=data);const status=await new Promise<number|null>(resolve=>child.once('exit',resolve));return {status,log};}
 for(const [arch,machine] of [['x86_64',0x8664],['aarch64',0xaa64]] as const){
  const triple=arch+'-pc-windows-msvc';const release=path.join(shell,'target',triple,'release');await fs.mkdir(path.dirname(release),{recursive:true});await tree(release,'6.0.1');
  const pe=Buffer.alloc(134);pe.write('MZ');pe.writeUInt32LE(128,60);pe.writeUInt32LE(0x4550,128);pe.writeUInt16LE(machine,132);await fs.writeFile(path.join(release,'dsh-eac-shell.exe'),pe);
  const built=await run(['--target',triple,'--out',output]);assert.equal(built.status,0,built.log);
  const archive=path.join(output,'EAC-Lite-6.0.1-windows-'+arch+'-portable.zip');const manifest=await inspectPortableArchive(archive,'6.0.1','windows-'+arch+'-portable');
  assert.ok(manifest.files.some((file:any)=>file.path==='eac-installation.json'));assert.ok(manifest.files.some((file:any)=>file.path==='.dsh-portable'));
  const before=await fs.readFile(archive);const repeated=await run(['--target',triple,'--out',output]);assert.notEqual(repeated.status,0);assert.deepEqual(await fs.readFile(archive),before);
 }
 assert.equal((await fs.readFile(path.join(output,'SHA256SUMS.txt'),'utf8')).trim().split('\n').length,2);
 assert.equal((await fs.readdir(output)).filter(name=>name.startsWith('.staging-portable-')).length,0);
});

test('real helper takes a cold browser backup and restores programs when the candidate cannot start',async t=>{
 const {startPortableHelper}=require('../lib/desktop/update-portable-helper.js');const f=await helperFixture(t);await fs.mkdir(f.binding.webviewRoot);await fs.writeFile(path.join(f.binding.webviewRoot,'preferences.json'),'saved browser preferences');
 const owner=spawn(process.execPath,['-e','process.exit(0)'],{stdio:'ignore',windowsHide:true});const ownerPid=owner.pid!;await new Promise(resolve=>owner.once('exit',resolve));
 const handle=await startPortableHelper({...f,owners:[ownerPid],healthTimeoutMs:1000});await handle.commit();await handle.waitForExit();
 const result=await waitFile(path.join(f.journal.transactionDir,'helper-result.json'));assert.equal(result.ok,false);assert.equal(result.error,'update-new-shell-start-failed');
 assert.equal(await version(f.install),'6.0.0');assert.equal((await readPortableJournal(f.journal.transactionDir,f.install)).phase,'rolled-back');
 assert.equal(await fs.readFile(path.join(f.binding.webviewRoot,'preferences.json'),'utf8'),'saved browser preferences');
 const cold=JSON.parse(await fs.readFile(path.join(f.journal.transactionDir,'cold-browser-backup/backup-manifest.json'),'utf8'));assert.ok(cold.files.some((file:any)=>file.rootId==='webview'&&file.relative==='preferences.json'));
});

test('helper refuses registry overlap and an invalid saved Web origin before takeover ACK',async t=>{
 const {startPortableHelper}=require('../lib/desktop/update-portable-helper.js');
 for(const attack of ['registry','port']){
  const f=await helperFixture(t);if(attack==='registry')f.binding.registryHome=f.install;else f.binding.webPort=0;
  await fs.writeFile(path.join(f.journal.transactionDir,'journal.json'),JSON.stringify(f.journal));
  await assert.rejects(startPortableHelper({...f,owners:[process.pid]}),/takeover-refused/);assert.equal(await version(f.install),'6.0.0');
 }
});

test('startup recovery hands off outside the loaded executable, then waits for the shell to exit before restoring',async t=>{
 const f=await helperFixture(t);const {startPortableHelper}=require('../lib/desktop/update-portable-helper.js');const handle=await startPortableHelper({...f,owners:[process.pid]});await handle.cancel();
 const interrupted=path.join(f.root,'crash-at-health.cjs');await fs.writeFile(interrupted,'const fs=require("node:fs");const u=require('+JSON.stringify(require.resolve('../lib/desktop/update-portable.js'))+');const journal=JSON.parse(fs.readFileSync('+JSON.stringify(path.join(f.journal.transactionDir,'journal.json'))+',"utf8"));u.exchangePortable(journal,async()=>true,async()=>true,async checkpoint=>{if(checkpoint==="health-start")process.exit(77);}).catch(()=>process.exit(1));');
 const crash=spawn(process.execPath,[interrupted],{stdio:'ignore'});assert.equal(await new Promise(resolve=>crash.once('exit',resolve)),77);assert.equal(await version(f.install),'6.0.1');
 const shell=path.join(f.root,'recovery-shell.cjs');const gateModule=require.resolve('../lib/desktop/update-portable-helper.js');
 await fs.writeFile(shell,'const u=require('+JSON.stringify(gateModule)+');u.portableStartupGate('+JSON.stringify(f.install)+',process.pid,"6.0.1",{}).then(value=>{console.log(JSON.stringify(value));process.stdin.once("data",()=>process.exit(0));}).catch(()=>process.exit(1));');
 const child=spawn(process.execPath,[shell],{stdio:['pipe','pipe','pipe']});let text='';const result=await new Promise<any>((resolve,reject)=>{child.stdout.on('data',chunk=>{text+=chunk.toString();if(text.includes("\n"))resolve(JSON.parse(text));});child.once('exit',()=>{if(!text)reject(Error('gate exited before takeover'));});});
 assert.equal(result.mode,'recovering');assert.ok(result.helperPid>0);assert.equal(await version(f.install),'6.0.1');
 const exited=new Promise(resolve=>child.once('exit',resolve));child.stdin.end('exit\n');await exited;
 const restored=await waitFile(path.join(f.journal.transactionDir,'recovery-result.json'));assert.equal(restored.recovered,true);
 const deadline=Date.now()+10000;while(Date.now()<deadline){try{process.kill(result.helperPid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')break;throw error;}await new Promise(resolve=>setTimeout(resolve,100));}
 assert.equal(await version(f.install),'6.0.0');assert.equal(await recoverPortable(f.install),false);
});
test('startup gate refuses live helper ownership and recovers a preparation interrupted before takeover',async t=>{
 const {portableStartupGate,startPortableHelper}=require('../lib/desktop/update-portable-helper.js');
 const f=await fixture(t);await prepare(f);assert.deepEqual(await portableStartupGate(f.install,process.pid,'6.0.0',{}),{mode:'normal',recovered:true});
 const g=await helperFixture(t);const helper=await startPortableHelper({...g,owners:[process.pid]});
 await assert.rejects(portableStartupGate(g.install,process.pid,'6.0.0',{}),/takeover-refused/);assert.equal(await version(g.install),'6.0.0');await helper.cancel();await recoverPortable(g.install);
});

async function restartFixture(t:any,handler?: (request:any,response:any)=>void){
 const http=require('node:http');const {captureBackup}=require('../lib/desktop/update-backup.js');const {startPortableHelper}=require('../lib/desktop/update-portable-helper.js');
 const f=await helperFixture(t);const web=http.createServer(handler||((_request:any,response:any)=>{response.writeHead(200,{'Content-Type':'text/html'});response.end('<html>health fixture</html>');}));await new Promise(resolve=>web.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>web.close(resolve)));
 f.binding.webPort=web.address().port;f.journal.dataBinding=f.binding;await fs.writeFile(path.join(f.journal.transactionDir,'journal.json'),JSON.stringify(f.journal));
 await fs.writeFile(path.join(f.binding.userDataDir,'settings.json'),JSON.stringify({webPort:f.binding.webPort,pluginTreeAlignedVersion:'6.0.0'}));
 const bindingFile=path.join(f.root,'binding.json');await fs.writeFile(bindingFile,'preserved binding');
 const backup=await captureBackup([{id:'environment',path:f.data,required:true},{id:'environment-binding',path:bindingFile,required:true}],path.join(f.root,'saved-data-backup'),new AbortController().signal);
 const handle=await startPortableHelper({...f,owners:[process.pid],dataBackupDirectory:backup.directory});await handle.cancel();
 const request=JSON.parse(await fs.readFile(path.join(f.journal.transactionDir,'helper/handoff.json'),'utf8'));const journal=await readPortableJournal(f.journal.transactionDir,f.install);journal.phase='health';await fs.writeFile(path.join(f.journal.transactionDir,'journal.json'),JSON.stringify(journal));
 const digest='a'.repeat(64);await fs.writeFile(path.join(f.root,'data-binding.json'),JSON.stringify({receipt:{sessionDigest:digest,storedSessionCount:1}}));await fs.writeFile(path.join(f.root,'ui-preferences.json'),JSON.stringify({origin:'http://127.0.0.1:'+f.binding.webPort,preferences:{'dsh.locale':'zh-CN'}}));
 const kernel=spawn(process.execPath,['-e','process.stdin.resume()'],{stdio:['pipe','ignore','ignore']});t.after(async()=>{if(kernel.exitCode===null){const exited=new Promise(resolve=>kernel.once('exit',resolve));kernel.stdin!.end();await exited;}});
 return {...f,request,kernel,digest,webUrl:'http://127.0.0.1:'+f.binding.webPort+'/'};
}
test('restart supervision publishes health only after HTTP, session digest and WebView checkpoint agree',async t=>{
 const {UpdateRestart}=require('../lib/desktop/update-restart.js');const {writeHelperReceipt,readHelperReceipt}=require('../lib/desktop/update-portable-helper.js');const f=await restartFixture(t);let released=0;const notices:string[]=[];let supervisor:any;
 supervisor=new UpdateRestart({transactionDir:f.journal.transactionDir,token:f.request.token,shellExe:path.join(f.install,'dsh-eac-shell.exe'),shellPid:process.pid,version:'6.0.1',nativeVersion:'6.0.1',target:TARGET,binding:()=>f.binding,kernel:()=>f.kernel,
  hostHealth:async()=>({sessionDigest:f.digest,storedSessionCount:1,configReadable:true}),releaseHost:async()=>{released++;},stopHost:async()=>{throw Error('must not stop healthy fixture');},bootSettled:()=>true,
  notify:(method:string,value:any)=>{notices.push(method);if(method==='update.boot-ui-checkpoint')supervisor.acceptUi({nonce:value.nonce,origin:value.origin,readable:true});}});t.after(()=>supervisor.close());
 await fs.writeFile(path.join(f.binding.userDataDir,'settings.json'),JSON.stringify({webPort:f.binding.webPort,pluginTreeAlignedVersion:'6.0.1'}));
 await supervisor.beforeBoot();await new Promise(resolve=>setTimeout(resolve,350));assert.equal(await fs.stat(path.join(f.journal.transactionDir,'boot-health-failed.json')).then(()=>true,()=>false),false);supervisor.bootReady(f.webUrl);const health=await waitFile(path.join(f.journal.transactionDir,'boot-health.json'));assert.equal(health.payload.dataReadable,true);assert.equal(health.payload.kernelPid,f.kernel.pid);assert.equal(supervisor.pending,true);assert.equal(released,0);
 await writeHelperReceipt(path.join(f.journal.transactionDir,'health-accepted.json'),{schemaVersion:1,transactionId:f.journal.transactionId,action:'accepted'},f.request.token);
 const deadline=Date.now()+5000;while(supervisor.pending&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));assert.equal(supervisor.pending,false);assert.equal(released,1);assert.ok(notices.includes('update.boot-accepted'));
 await fs.writeFile(path.join(f.data,'session.json'),'a new conversation after acceptance');await supervisor.beforeBoot();
 const receipt=await readHelperReceipt(path.join(f.journal.transactionDir,'boot-health.json'),f.request.token);assert.equal(receipt.sessionDigest,f.digest);
});
test('changed persistent files or session content cannot produce a successful restart health receipt',async t=>{
 const {UpdateRestart}=require('../lib/desktop/update-restart.js');const f=await restartFixture(t);
 const supervisor=new UpdateRestart({transactionDir:f.journal.transactionDir,token:f.request.token,shellExe:path.join(f.install,'dsh-eac-shell.exe'),shellPid:process.pid,version:'6.0.1',nativeVersion:'6.0.1',target:TARGET,binding:()=>f.binding,kernel:()=>f.kernel,hostHealth:async()=>({sessionDigest:'b'.repeat(64),storedSessionCount:1,configReadable:true}),releaseHost:async()=>{throw Error('must not release');},stopHost:async()=>{throw Error('not requested');},bootSettled:()=>true,notify:()=>{}});t.after(()=>supervisor.close());
 await supervisor.beforeBoot();supervisor.bootReady(f.webUrl);const failure=await waitFile(path.join(f.journal.transactionDir,'boot-health-failed.json'));assert.equal(failure.payload.transactionId,f.journal.transactionId);assert.equal(supervisor.pending,true);assert.equal(await fs.stat(path.join(f.journal.transactionDir,'boot-health.json')).then(()=>true,()=>false),false);
 await fs.writeFile(path.join(f.data,'session.json'),'changed conversation');await assert.rejects(supervisor.beforeBoot(),/persistent-data-changed/);
});

test('actual native shell rejects mismatched version before sidecar startup and helper restores the old tree',
 {skip:process.platform!=='win32'||!process.env.EAC_UPDATE_NATIVE_SHELL},async t=>{
  const {startPortableHelper,readHelperReceipt}=require('../lib/desktop/update-portable-helper.js');const native=await fs.readFile(process.env.EAC_UPDATE_NATIVE_SHELL!);const f=await helperFixture(t,'',native);
  const owner=spawn(process.execPath,['-e','process.exit(0)'],{stdio:'ignore'});const pid=owner.pid!;await new Promise(resolve=>owner.once('exit',resolve));
  const helper=await startPortableHelper({...f,owners:[pid],healthTimeoutMs:10000});await helper.commit();await helper.waitForExit();
  const result=await waitFile(path.join(f.journal.transactionDir,'helper-result.json'));assert.equal(result.ok,false);assert.equal(result.error,'update-health-unconfirmed');
  const request=JSON.parse(await fs.readFile(path.join(f.journal.transactionDir,'helper/handoff.json'),'utf8'));const refusal=await readHelperReceipt(path.join(f.journal.transactionDir,'boot-gate-failed.json'),request.token);
  assert.equal(refusal.sidecarStarted,false);assert.equal(await version(f.install),'6.0.0');assert.equal((await readPortableJournal(f.journal.transactionDir,f.install)).phase,'rolled-back');
 });

test('cancelled full-package verification stops before extracting or creating a portable transaction',async t=>{
 const f=await fixture(t);const archive=path.join(f.root,'package.zip');await fs.writeFile(archive,zipBuffer(await packageEntries(f.stage)));const abort=new AbortController();abort.abort(new Error('update-cancelled'));
 const destination=path.join(f.root,'cancelled-extraction');await assert.rejects(extractPortableArchive(archive,destination,'6.0.1',TARGET,abort.signal),/cancelled/);assert.equal(await fs.stat(destination).then(()=>true,()=>false),false);
 await assert.rejects(preparePortable({installRoot:f.install,stageRoot:f.stage,transactionId:crypto.randomUUID(),version:'6.0.1',target:TARGET,dataBinding:{home:f.data},protectedRoots:[f.data],signal:abort.signal}),/cancelled/);assert.equal(await recoverPortable(f.install),false);
});

test('aborted helper takeover cannot acknowledge or create a copied runtime',async t=>{
 const {startPortableHelper}=require('../lib/desktop/update-portable-helper.js');const f=await helperFixture(t);const abort=new AbortController();abort.abort(new Error('update-cancelled'));
 await assert.rejects(startPortableHelper({...f,owners:[process.pid],signal:abort.signal}),/cancelled/);assert.equal(await fs.stat(path.join(f.journal.transactionDir,'helper')).then(()=>true,()=>false),false);await recoverPortable(f.install);
});

test('cancelling an acknowledged but uncommitted helper waits for its actual exit and releases the install lock',async t=>{
 const {startPortableHelper}=require('../lib/desktop/update-portable-helper.js');const f=await helperFixture(t);const abort=new AbortController();const helper=await startPortableHelper({...f,owners:[process.pid],signal:abort.signal});
 abort.abort(new Error('update-cancelled'));await helper.waitForExit();assert.equal(await version(f.install),'6.0.0');assert.equal(await recoverPortable(f.install),true);assert.equal(await recoverPortable(f.install),false);
});

test('missing authenticated health/control receipts remain pending while malformed receipts reject',async t=>{
 const {readHelperReceipt}=require('../lib/desktop/update-portable-helper.js');const f=await fixture(t);const file=path.join(f.root,'not-yet-written.json');const token='a'.repeat(64);
 assert.equal(await readHelperReceipt(file,token),null);await fs.writeFile(file,'{broken');await assert.rejects(readHelperReceipt(file,token),/receipt-invalid/);
});

test('only exact derived alignment metadata can vary while all user settings and plugin bytes remain protected',async t=>{
 const {permitsDerivedMetadata}=require('../lib/desktop/update-restart.js');const f=await fixture(t);const binding={userDataDir:f.data,dshHome:path.join(f.data,'home')};const backup=path.join(f.root,'backup.json');const settings=path.join(f.data,'settings.json');
 await fs.writeFile(backup,JSON.stringify({webPort:64584,pluginTreeAlignedVersion:'6.0.0',removedPlugins:['keep']}));await fs.writeFile(settings,JSON.stringify({webPort:64584,pluginTreeAlignedVersion:'6.0.1',removedPlugins:['keep']}));assert.equal(await permitsDerivedMetadata(settings,backup,binding,'6.0.1'),true);
 await fs.writeFile(settings,JSON.stringify({webPort:64585,pluginTreeAlignedVersion:'6.0.1',removedPlugins:['keep']}));assert.equal(await permitsDerivedMetadata(settings,backup,binding,'6.0.1'),false);
 const stamp=path.join(binding.dshHome,'profiles/web-desktop/node_modules/plugin/.eac-copy-stamp.json');await fs.mkdir(path.dirname(stamp),{recursive:true});await fs.writeFile(backup,JSON.stringify({v:'1.0.0',f:4,b:200,h:'1234'}));await fs.writeFile(stamp,JSON.stringify({v:'1.0.0',f:4,b:200,h:'abcd'}));assert.equal(await permitsDerivedMetadata(stamp,backup,binding,'6.0.1'),true);
 await fs.writeFile(stamp,JSON.stringify({v:'1.0.0',f:4,b:201,h:'abcd'}));assert.equal(await permitsDerivedMetadata(stamp,backup,binding,'6.0.1'),false);
 const user=path.join(f.data,'.eac-copy-stamp.json');await fs.writeFile(user,JSON.stringify({v:'1.0.0',f:4,b:200,h:'abcd'}));assert.equal(await permitsDerivedMetadata(user,backup,binding,'6.0.1'),false);
});

test('process ownership captures nested descendants and can exclude the updating helper subtree',async t=>{
 const {captureProcessOwners}=require('../lib/desktop/update-process-owners.js');
 const script='const cp=require("node:child_process");const child=cp.spawn(process.execPath,["-e","process.stdin.resume()"],{stdio:["pipe","ignore","ignore"]});console.log(JSON.stringify({pid:child.pid}));process.stdin.once("data",()=>child.stdin.end());child.once("exit",()=>process.exit(0));';
 const parent=spawn(process.execPath,['-e',script],{stdio:['pipe','pipe','ignore'],windowsHide:true});const exited=new Promise(resolve=>parent.once('exit',resolve));let childPid:number;
 try{childPid=await new Promise<number>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('child readiness timeout')),5000);parent.stdout.once('data',chunk=>{clearTimeout(timer);resolve(JSON.parse(chunk.toString()).pid);});});
  const owners=await captureProcessOwners([parent.pid]);assert.ok(owners.includes(parent.pid));assert.ok(owners.includes(childPid));
  const excluded=await captureProcessOwners([process.pid],parent.pid);assert.ok(excluded.includes(process.pid));assert.ok(!excluded.includes(parent.pid));assert.ok(!excluded.includes(childPid));
  await assert.rejects(captureProcessOwners([0]),/owners-invalid/);
 }finally{parent.stdin.end('exit');await exited;}
});

for(const scenario of ['host-health','ui-preferences','persistent-data'] as const){
 test('restart failure diagnosis identifies '+scenario+' without retaining sensitive exception details',async t=>{
  const {UpdateRestart}=require('../lib/desktop/update-restart.js');const f=await restartFixture(t);
  const privateDetail='https://example.invalid/?token=private-login-token /private/conversation';
  const cause=Object.assign(new Error(privateDetail),{code:'ECONNREFUSED'});
  const supervisor=new UpdateRestart({transactionDir:f.journal.transactionDir,token:f.request.token,shellExe:path.join(f.install,'dsh-eac-shell.exe'),shellPid:process.pid,version:'6.0.1',nativeVersion:'6.0.1',target:TARGET,binding:()=>f.binding,kernel:()=>f.kernel,
   hostHealth:async()=>{if(scenario==='host-health')throw new TypeError(privateDetail,{cause});return {sessionDigest:f.digest,storedSessionCount:1,configReadable:true};},
   releaseHost:async()=>{throw Error('must not release');},stopHost:async()=>{throw Error('not requested');},bootSettled:()=>true,notify:()=>{}});t.after(()=>supervisor.close());
  if(scenario==='persistent-data'){
   await fs.writeFile(path.join(f.data,'session.json'),'changed conversation');await assert.rejects(supervisor.beforeBoot(),/persistent-data-changed/);
  }else{
   await supervisor.beforeBoot();if(scenario==='ui-preferences')await fs.writeFile(path.join(f.root,'ui-preferences.json'),privateDetail);supervisor.bootReady(f.webUrl);
  }
  const failure=await waitFile(path.join(f.journal.transactionDir,'boot-health-failed.json'));assert.equal(failure.payload.stage,scenario);assert.ok(failure.payload.elapsedMs>=0);
  assert.equal(JSON.stringify(failure).includes(privateDetail),false);assert.equal(JSON.stringify(failure).includes('private-login-token'),false);assert.equal(supervisor.pending,true);
  if(scenario==='host-health')assert.deepEqual(failure.payload.causes,[{name:'TypeError'},{name:'Error',code:'ECONNREFUSED'}]);
  if(scenario==='ui-preferences')assert.deepEqual(failure.payload.causes,[{name:'SyntaxError'}]);
 });
}

for(const redirect of ['local','foreign','missing-cookie','repeat'] as const){
 test('restart HTTP probe handles token login and rejects unsafe redirects: '+redirect,async t=>{
  const {UpdateRestart}=require('../lib/desktop/update-restart.js');const requests:Array<{url:string;cookie?:string}>=[];
  const f=await restartFixture(t,(request,response)=>{
   requests.push({url:request.url,cookie:request.headers.cookie});
   if(request.url.includes('?token=')||redirect==='repeat'){
    response.writeHead(303,{location:redirect==='foreign'?'http://127.0.0.1:1/':'/',...(redirect==='missing-cookie'?{}:{'Set-Cookie':'dsh-auth=isolated-health-cookie; Path=/; HttpOnly; SameSite=Strict'})});response.end();return;
   }
   response.writeHead(request.headers.cookie==='dsh-auth=isolated-health-cookie'?200:401,{'Content-Type':'text/html'});response.end('<html>authenticated fixture</html>');
  });
  let hostReads=0;let supervisor:any;supervisor=new UpdateRestart({transactionDir:f.journal.transactionDir,token:f.request.token,shellExe:path.join(f.install,'dsh-eac-shell.exe'),shellPid:process.pid,version:'6.0.1',nativeVersion:'6.0.1',target:TARGET,binding:()=>f.binding,kernel:()=>f.kernel,
   hostHealth:async()=>{hostReads++;return {sessionDigest:f.digest,storedSessionCount:1,configReadable:true};},releaseHost:async()=>{},stopHost:async()=>{throw Error('not requested');},bootSettled:()=>true,
   notify:(method:string,value:any)=>{if(method==='update.boot-ui-checkpoint')supervisor.acceptUi({nonce:value.nonce,origin:value.origin,readable:true});}});t.after(()=>supervisor.close());
  await supervisor.beforeBoot();supervisor.bootReady(f.webUrl+'?token=isolated-health-login');
  const file=redirect==='local'?'boot-health.json':'boot-health-failed.json';const receipt=await waitFile(path.join(f.journal.transactionDir,file));
  if(redirect==='local'){assert.equal(receipt.payload.httpReady,true);assert.equal(hostReads,1);assert.equal(requests.length,2);assert.equal(requests[1]?.cookie,'dsh-auth=isolated-health-cookie');assert.equal(requests[1]?.url,'/');}
  else{assert.equal(receipt.payload.stage,'http-health');assert.equal(hostReads,0);assert.equal(supervisor.pending,true);assert.equal(requests.length,redirect==='repeat'?2:1);}
  assert.equal(JSON.stringify(receipt).includes('isolated-health-login'),false);assert.equal(JSON.stringify(receipt).includes('isolated-health-cookie'),false);
 });
}

test('candidate restart reads exact legacy and current helper inventories across version updates',async t=>{
 const {startPortableHelper,readPortableHandoff}=require('../lib/desktop/update-portable-helper.js');const f=await helperFixture(t);const handle=await startPortableHelper({...f,owners:[process.pid]});await handle.cancel();
 const file=path.join(f.journal.transactionDir,'helper/files.json');const current=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(current.helperProtocolVersion,2);assert.equal((await readPortableHandoff(f.journal.transactionDir,f.install)).request.version,'6.0.1');
 const legacy={...current,files:current.files.filter((entry:any)=>entry.path!=='lib/desktop/update-helper-process.js')};delete legacy.helperProtocolVersion;await fs.writeFile(file,JSON.stringify(legacy));assert.equal((await readPortableHandoff(f.journal.transactionDir,f.install)).request.version,'6.0.1');
 await fs.writeFile(file,JSON.stringify({...legacy,helperProtocolVersion:999}));await assert.rejects(readPortableHandoff(f.journal.transactionDir,f.install),/helper-files-invalid/);
 await fs.writeFile(file,JSON.stringify({...legacy,helperProtocolVersion:null}));await assert.rejects(readPortableHandoff(f.journal.transactionDir,f.install),/helper-files-invalid/);
 await fs.writeFile(file,JSON.stringify({...legacy,files:[...legacy.files,{path:'lib/desktop/unowned.js',sha256:'0'.repeat(64)}]}));await assert.rejects(readPortableHandoff(f.journal.transactionDir,f.install),/helper-files-invalid/);
 await fs.writeFile(file,JSON.stringify(legacy));await fs.appendFile(path.join(f.journal.transactionDir,'helper/lib/desktop/update-backup.js'),'\n// changed');await assert.rejects(readPortableHandoff(f.journal.transactionDir,f.install),/helper-files-invalid/);
 assert.equal(await version(f.install),'6.0.0');await recoverPortable(f.install);
});
