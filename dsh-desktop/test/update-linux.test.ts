import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
const require=createRequire(import.meta.url);
const {linuxTarget,linuxManager,linuxInstallCommand,parseLinuxIdentity,inspectLinuxPackage,inspectLinuxOwner,inspectAppImage,prepareLinuxPackage}=require('../lib/desktop/update-linux.js');
async function fixture(t:any,kind:'deb'|'rpm'='deb',arch='x86_64'){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eac-linux-update-'));t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('eac-linux-update-'));await fs.rm(root,{recursive:true,force:true});});
 const file=path.join(root,'signed package.'+kind);const bytes=Buffer.concat([kind==='deb'?Buffer.from('!<arch>\n'):Buffer.from([0xed,0xab,0xee,0xdb,0x03,0x00,0x00,0x00]),Buffer.from('signed test fixture; metadata provided by bounded query fixture')]);await fs.writeFile(file,bytes);
 const key=crypto.generateKeyPairSync('ed25519');const id=crypto.randomBytes(8);const sig=crypto.sign(null,crypto.createHash('blake2b512').update(bytes).digest(),key.privateKey);const comment='timestamp:1792022400';
 const publicKey=Buffer.concat([Buffer.from('Ed'),id,(key.publicKey.export({type:'spki',format:'der'}) as Buffer).subarray(-32)]).toString('base64');const signature='untrusted comment: test signature\n'+Buffer.concat([Buffer.from('ED'),id,sig]).toString('base64')+'\ntrusted comment: '+comment+'\n'+crypto.sign(null,Buffer.concat([sig,Buffer.from(comment)]),key.privateKey).toString('base64');
 const target='linux-'+arch+'-'+kind;const artifact={target,installKind:kind,url:path.basename(file),size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),signature};return {root,file,artifact,trustedKey:publicKey,version:'6.1.1',target};
}
test('Linux target, package architecture and distribution select only the owned installer family',()=>{
 assert.deepEqual(linuxTarget('linux-aarch64-deb'),{kind:'deb',arch:'aarch64',packageArch:'arm64'});assert.equal(linuxTarget('linux-x86_64-rpm').packageArch,'x86_64');
 for(const target of ['linux-x64-deb','linux-x86_64-portable','windows-x86_64-deb','linux-aarch64-msi'])assert.throws(()=>linuxTarget(target),/target-invalid/);
 for(const osRelease of ['ID=debian\n','ID=ubuntu\n','NAME="Linux Mint"\nID=linuxmint\nID_LIKE="ubuntu debian"\n'])assert.equal(linuxManager(osRelease,'deb'),'apt-get');
 for(const id of ['fedora','rhel','centos','rocky','almalinux'])assert.equal(linuxManager('ID='+id+'\n','rpm'),'dnf');
 for(const id of ['opensuse','opensuse-leap','opensuse-tumbleweed','sles'])assert.equal(linuxManager('ID='+id+'\n','rpm'),'zypper');
 for(const [text,kind] of [['ID=arch\n','deb'],['ID=ubuntu\n','rpm'],['ID=fedora\n','deb'],['ID=debian\nID=fedora\n','rpm'],['ID="$(untrusted)"\n','deb']])assert.throws(()=>linuxManager(text,kind),/distribution-/);
});
test('Linux package metadata refuses foreign products, incomplete installs and duplicate records',()=>{
 assert.deepEqual(parseLinuxIdentity('deepseek-harness-eac\t6.1.1\tamd64\n','deb'),{name:'deepseek-harness-eac',version:'6.1.1',arch:'amd64'});
 assert.equal(parseLinuxIdentity('deepseek-harness-eac\t6.1.1\t1\taarch64\n','rpm').release,'1');
 for(const output of ['other-product\t6.1.1\tamd64\n','deepseek-harness-eac\t6.1.1-beta\tamd64\n','deepseek-harness-eac\t6.1.1\tall\n','deepseek-harness-eac\t6.1.1\tamd64\nextra\n'])assert.throws(()=>parseLinuxIdentity(output,'deb'),/identity-invalid/);
 assert.throws(()=>parseLinuxIdentity('deepseek-harness-eac\t6.1.0\tamd64\tconfig-files\n','deb',true),/identity-invalid/);
 assert.throws(()=>parseLinuxIdentity('deepseek-harness-eac\t6.1.1\t../unowned\tx86_64\n','rpm'),/identity-invalid/);
});
test('Linux installer arguments are fixed, keep package-manager identity and preserve literal Unicode paths',()=>{
 const file='/home/test/包 & $(untrusted) 目录/installer.deb';const apt=linuxInstallCommand('apt-get',file,'deb');assert.equal(apt.file,'/usr/bin/apt-get');assert.deepEqual(apt.args,['--yes','--no-remove','--only-upgrade','--no-install-recommends','install','--',file]);
 for(const manager of ['dnf','zypper']){const command=linuxInstallCommand(manager,'/home/test/installer.rpm','rpm');assert.equal(command.args.at(-1),'/home/test/installer.rpm');assert.ok(!command.args.some((arg:string)=>['remove','purge','--allowerasing','--allow-downgrades'].includes(arg)));}
 for(const file of ['../installer.deb','-bad.deb','/tmp/installer\n.deb','/tmp/installer.rpm'])assert.throws(()=>linuxInstallCommand('apt-get',file,'deb'),/path-invalid/);
 assert.throws(()=>linuxInstallCommand('apt-get','/tmp/installer.rpm','rpm'),/manager-invalid/);assert.throws(()=>linuxInstallCommand('unknown','/tmp/installer.deb','deb'),/manager-invalid/);
});
for(const kind of ['deb','rpm'] as const)for(const arch of ['x86_64','aarch64'])test('signed Linux package metadata is checked before preparation: '+kind+'/'+arch,async t=>{
 const f=await fixture(t,kind,arch);const packageArch=kind==='deb'?(arch==='x86_64'?'amd64':'arm64'):arch;const calls:any[]=[];
 const value=await inspectLinuxPackage(f,async(command:any)=>{calls.push(command);return 'deepseek-harness-eac\t6.1.1\t'+(kind==='rpm'?'1\t':'')+packageArch+'\n';});assert.equal(value.arch,packageArch);assert.equal(calls.length,1);assert.equal(calls[0].file,'/usr/bin/'+(kind==='deb'?'dpkg-deb':'rpm'));assert.equal(calls[0].args.at(-1),await fs.realpath(f.file));
 await assert.rejects(inspectLinuxPackage(f,async()=> 'deepseek-harness-eac\t6.1.0\t'+(kind==='rpm'?'1\t':'')+packageArch+'\n'),/identity-mismatch/);
});
test('changed signature/package bytes never reach a metadata query and query-time substitution is detected',async t=>{
 const f=await fixture(t);let queried=false;await fs.appendFile(f.file,'changed');await assert.rejects(inspectLinuxPackage(f,async()=>{queried=true;return '';}),/package-/);assert.equal(queried,false);
 const g=await fixture(t);await assert.rejects(inspectLinuxPackage(g,async()=>{await fs.appendFile(g.file,'changed during query');return 'deepseek-harness-eac\t6.1.1\tamd64\n';}),/package-/);
 const h=await fixture(t);const controller=new AbortController();controller.abort();await assert.rejects(inspectLinuxPackage({...h,signal:controller.signal},async()=>{throw Error('query after cancellation');}),/abort/i);
});
test('Debian ownership is exact and requires the EAC package to be fully installed',async()=>{
 const calls:any[]=[];const run=async(command:any)=>{calls.push(command);return calls.length===1?'deepseek-harness-eac:amd64: /usr/bin/dsh-eac-shell\n':'deepseek-harness-eac\t6.1.0\tamd64\tinstalled\n';};
 const value=await inspectLinuxOwner('/usr/bin/dsh-eac-shell','linux-x86_64-deb',run);assert.equal(value.version,'6.1.0');assert.equal(calls.length,2);assert.equal(calls[0].args.at(-1),'/usr/bin/dsh-eac-shell');
 for(const owner of ['other: /usr/bin/dsh-eac-shell\n','deepseek-harness-eac: /another/exe\n','deepseek-harness-eac: /usr/bin/dsh-eac-shell\nextra: /usr/bin/dsh-eac-shell\n'])await assert.rejects(inspectLinuxOwner('/usr/bin/dsh-eac-shell','linux-x86_64-deb',async()=>owner),/owner-invalid/);
 await assert.rejects(inspectLinuxOwner('/usr/bin/dsh-eac-shell','linux-aarch64-rpm',async()=> 'deepseek-harness-eac\t6.1.0\t1\tx86_64\n'),/owner-invalid/);
});
test('AppImage inspection checks ELF class, byte order, type and actual machine without executing the image',async t=>{
 const f=await fixture(t);for(const [arch,machine] of [['x86_64',62],['aarch64',183]] as const){const bytes=Buffer.alloc(64);bytes.writeUInt32BE(0x7f454c46);bytes[4]=2;bytes[5]=1;bytes[8]=0x41;bytes[9]=0x49;bytes[10]=2;bytes.writeUInt16LE(machine,18);const file=path.join(f.root,arch+'.AppImage');await fs.writeFile(file,bytes);await inspectAppImage(file,'linux-'+arch+'-appimage');await assert.rejects(inspectAppImage(file,'linux-'+(arch==='x86_64'?'aarch64':'x86_64')+'-appimage'),/format-invalid/);bytes[10]=1;await fs.writeFile(file,bytes);await assert.rejects(inspectAppImage(file,'linux-'+arch+'-appimage'),/format-invalid/);}
});
test('Linux shape detection never interprets an arbitrary system package as this product',async()=>{
 const source=await fs.readFile(new URL('../lib/desktop/update-platform.js',import.meta.url),'utf8');
 const run=(owner:string,metadata:string,rpm='')=>{let calls=0;const context:any={require:(name:string)=>name==='node:fs'?{existsSync:()=>false}:name==='node:path'?path.posix:name==='node:child_process'?{spawnSync:(_file:string,args:string[])=>{calls++;return {status:0,stdout:args.includes('--search')?owner:args[0]==='--show'?metadata:rpm};}}:{parseLinuxIdentity},process:{platform:'linux',arch:'x64',env:{}},exports:{}};runInNewContext(source,context);return {target:context.exports.updateTarget('/usr/bin/dsh-eac-shell','linux','x64',{}),calls};};
 assert.equal(run('other: /usr/bin/dsh-eac-shell\n','').target,'unsupported');assert.equal(run('deepseek-harness-eac: /usr/bin/dsh-eac-shell\n','deepseek-harness-eac\t6.1.0\tamd64\tinstalled\n').target,'linux-x86_64-deb');assert.equal(run('','', 'deepseek-harness-eac\t6.1.0\t1\tx86_64\n').target,'linux-x86_64-rpm');
});
test('Linux-only preparation cannot create transaction files on a different host',{skip:process.platform==='linux'},async t=>{
 const f=await fixture(t);const transactionDir=path.join(f.root,'not-created');await assert.rejects(prepareLinuxPackage({...f,transactionDir}),/platform-unsupported/);assert.equal(await fs.stat(transactionDir).then(()=>true,()=>false),false);
});

const {parseLinuxProcessStat,captureLinuxProcessOwners,captureProcessOwners}=require('../lib/desktop/update-process-owners.js');
function procStat(pid:number,parentPid:number,comm='appimage helper',state='S'){
 const fields=Array(20).fill('0');fields[0]=state;fields[1]=String(parentPid);fields[19]='987654321123456789';return pid+' ('+comm+') '+fields.join(' ')+'\n';
}
test('Linux process stat parsing preserves large start times and handles parentheses and newlines in process names',()=>{
 assert.deepEqual(parseLinuxProcessStat(procStat(123,45,'a ) ( worker\nname')), {pid:123,parentPid:45,state:'S',startTime:'987654321123456789'});
 for(const value of ['not stat',procStat(123,-1),procStat(123,45,'name','unknown'),procStat(0,45)])assert.throws(()=>parseLinuxProcessStat(value),/owners-invalid/);
});
test('Linux process owner capture follows exact ancestry and excludes the helper subtree without invoking a shell',async t=>{
 const f=await fixture(t);const procRoot=path.join(f.root,'proc');await fs.mkdir(procRoot);
 for(const [pid,parent] of [[10,1],[11,10],[12,11],[13,12],[14,10],[20,1]]){await fs.mkdir(path.join(procRoot,String(pid)));await fs.writeFile(path.join(procRoot,String(pid),'stat'),procStat(pid!,parent!));}
 await fs.mkdir(path.join(procRoot,'15'));await fs.mkdir(path.join(procRoot,'self'));
 assert.deepEqual(await captureLinuxProcessOwners([10],12,procRoot),[10,11,14]);assert.deepEqual(await captureLinuxProcessOwners([10],undefined,procRoot),[10,11,12,13,14]);
 await fs.writeFile(path.join(procRoot,'14','stat'),procStat(99,10));await assert.rejects(captureLinuxProcessOwners([10],undefined,procRoot),/owners-unavailable/);
 await assert.rejects(captureLinuxProcessOwners([],undefined,procRoot),/owners-invalid/);
});
test('native Linux process ownership includes the current process',{skip:process.platform!=='linux'},async()=>{
 assert.ok((await captureProcessOwners([process.pid])).includes(process.pid));const current=parseLinuxProcessStat(await fs.readFile('/proc/'+process.pid+'/stat','utf8'));assert.equal(current.pid,process.pid);
});

const {linuxRootSpec,rootOwnedStat,linuxRootCommand,linuxAuthorizationEnvironment,copyLinuxRootPackage}=require('../lib/desktop/update-linux-root.js');
function rootCase(kind='deb',arch='x86_64'){
 const signing=crypto.generateKeyPairSync('ed25519');const id=crypto.randomBytes(8);const bytes=Buffer.from('signed Linux native package fixture');
 const publicKey=Buffer.concat([Buffer.from('Ed'),id,(signing.publicKey.export({format:'der',type:'spki'}) as Buffer).subarray(-32)]).toString('base64');
 const sign=(message:Buffer,prehashed=false)=>{const input=prehashed?crypto.createHash('blake2b512').update(message).digest():message;const signature=crypto.sign(null,input,signing.privateKey);const comment='timestamp:1792022400';return 'untrusted comment: test\n'+Buffer.concat([Buffer.from(prehashed?'ED':'Ed'),id,signature]).toString('base64')+'\ntrusted comment: '+comment+'\n'+crypto.sign(null,Buffer.concat([signature,Buffer.from(comment)]),signing.privateKey).toString('base64');};
 const artifact={target:'linux-'+arch+'-'+kind,installKind:kind,url:'installer.'+kind,size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),signature:sign(bytes,true)};
 const manifest={schemaVersion:1,product:'eac-desktop',releaseChannel:'stable',version:'6.1.1',publishedAt:'2026-10-15T00:00:00Z',artifacts:[artifact]};const payload=Buffer.from(JSON.stringify(manifest));const envelope={schemaVersion:1,keyId:'root-test',payload:payload.toString('base64'),signature:sign(payload)};
 const defaults={schemaVersion:1,github:{repo:''},gitee:{repo:''},geoUrl:'',trustedKeys:{'root-test':publicKey}};
 const request={schemaVersion:1,transactionId:crypto.randomUUID(),target:artifact.target,executable:'/usr/bin/dsh-eac-shell',packageFile:'/home/test/client-updates/installer.'+kind,envelope,owners:[123],token:'b'.repeat(64)};
 return {request,defaults,manifest,artifact};
}
test('privileged package selection derives the exact newer artifact from the independently signed envelope',()=>{
 for(const [kind,arch,nodeArch]of [['deb','x86_64','x64'],['rpm','aarch64','arm64']]){const f=rootCase(kind,arch);const spec=linuxRootSpec(f.request,f.defaults,'6.1.0',nodeArch);assert.deepEqual(spec.artifact,f.artifact);assert.equal(spec.manifest.version,'6.1.1');assert.equal(spec.trustedKey,f.defaults.trustedKeys['root-test']);}
 const f=rootCase();assert.throws(()=>linuxRootSpec(f.request,f.defaults,'6.1.1','x64'),/version-invalid/);assert.throws(()=>linuxRootSpec(f.request,f.defaults,'6.1.2','x64'),/version-invalid/);assert.throws(()=>linuxRootSpec(f.request,f.defaults,'6.1.0','arm64'),/target-invalid/);
});
test('the privileged boundary refuses user keys, altered manifests and arbitrary scripts before installation',()=>{
 const f=rootCase();assert.throws(()=>linuxRootSpec({...f.request,trustedKey:f.defaults.trustedKeys['root-test']},f.defaults,'6.1.0','x64'),/request-invalid/);
 assert.throws(()=>linuxRootSpec({...f.request,artifact:f.artifact},f.defaults,'6.1.0','x64'),/request-invalid/);
 assert.throws(()=>linuxRootSpec(f.request,{...f.defaults,trustedKeys:{}},'6.1.0','x64'),/untrusted-update-key/);
 const forged=Buffer.from(JSON.stringify({...f.manifest,version:'9.0.0'})).toString('base64');assert.throws(()=>linuxRootSpec({...f.request,envelope:{...f.request.envelope,payload:forged}},f.defaults,'6.1.0','x64'),/signature/);
 for(const executable of ['/usr/bin/sh','/home/test/node','relative/dsh-eac-shell','/usr/bin/../bin/dsh-eac-shell'])assert.throws(()=>linuxRootSpec({...f.request,executable},f.defaults,'6.1.0','x64'),/request-invalid/);
});
test('privileged code requires root-owned immutable files and parent directories',()=>{
 const stat=(uid:number,mode:number,kind='file')=>({uid,mode,isSymbolicLink:()=>kind==='link',isFile:()=>kind==='file',isDirectory:()=>kind==='directory'});
 rootOwnedStat(stat(0,0o755));rootOwnedStat(stat(0,0o755,'directory'),true);
 for(const candidate of [stat(1000,0o755),stat(0,0o775),stat(0,0o757),stat(0,0o755,'link'),stat(0,0o755,'directory')])assert.throws(()=>rootOwnedStat(candidate),/code-untrusted/);
});
test('system authorization uses installed Node and helper with fixed arguments and a minimal environment',()=>{
 const command=linuxRootCommand('/usr/lib/Deepseek Harness EAC','/home/test/应用 空间/root-request.json');assert.equal(command.file,'/usr/bin/pkexec');assert.deepEqual(command.args,['--disable-internal-agent','/usr/lib/Deepseek Harness EAC/dsh-desktop/vendor/node/node','--no-addons','--no-global-search-paths','/usr/lib/Deepseek Harness EAC/dsh-desktop/lib/desktop/update-linux-root.js','--install','/home/test/应用 空间/root-request.json']);
 const safe=linuxAuthorizationEnvironment({PATH:'/untrusted/bin',NODE_OPTIONS:'--require /tmp/user.js',NODE_PATH:'/tmp/modules',LD_PRELOAD:'/tmp/user.so',DISPLAY:':1',DBUS_SESSION_BUS_ADDRESS:'unix:path=/run/user/1000/bus',HOME:'/home/test'});
 assert.equal(safe.DISPLAY,':1');assert.equal(safe.NODE_OPTIONS,undefined);assert.equal(safe.NODE_PATH,undefined);assert.equal(safe.LD_PRELOAD,undefined);assert.equal(safe.HOME,undefined);assert.equal(safe.PATH,'/usr/sbin:/usr/bin:/sbin:/bin');
});
test('root staging copies descriptor-owned bytes completely and refuses wrong owner or size', {timeout:15000},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eac-root-stage-'));t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('eac-root-stage-'));await fs.rm(root,{recursive:true,force:true});});
 const source=path.join(root,'downloaded');const target=path.join(root,'installer.deb');const bytes=crypto.randomBytes(2*1024*1024+13);await fs.writeFile(source,bytes);const uid=(await fs.stat(source)).uid;
 await copyLinuxRootPackage(source,target,uid,bytes.length);assert.deepEqual(await fs.readFile(target),bytes);
 await assert.rejects(copyLinuxRootPackage(source,path.join(root,'wrong-owner.deb'),uid+1,bytes.length),/root-package-invalid/);await assert.rejects(copyLinuxRootPackage(source,path.join(root,'wrong-size.deb'),uid,bytes.length+1),/root-package-invalid/);
});
test('signed source resolution retains the original envelope for privileged verification',async t=>{
 const f=await fixture(t);const r=rootCase();await fs.writeFile(path.join(f.root,'installer.deb'),'placeholder');await fs.writeFile(path.join(f.root,'stable.json'),JSON.stringify(r.request.envelope));
 const {resolveUpdate,initialSelection}=require('../lib/desktop/update-sources.js');const selection={...initialSelection(),selectionMode:'manual',preferredSourceId:'local',localPath:f.root};const resolved=await resolveUpdate(selection,r.defaults,'6.1.0',r.request.target,new AbortController().signal);assert.deepEqual(resolved.envelope,r.request.envelope);
 assert.equal(linuxRootSpec({...r.request,envelope:resolved.envelope},r.defaults,'6.1.0','x64').manifest.version,'6.1.1');
});
const {startLinuxAuthorization,executeLinuxPackage,validLinuxRootReceipt}=require('../lib/desktop/update-linux-helper.js');
const {readLinuxPackagePlan,cancelLinuxPackage}=require('../lib/desktop/update-linux.js');
const {writeDurableJson}=require('../lib/desktop/update-backup.js');
async function nativePackageFixture(t:any){
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'eac-linux-package-'));const root=await fs.realpath(temporary);
 t.after(async()=>{assert.equal(path.dirname(root).toLowerCase(),(await fs.realpath(os.tmpdir())).toLowerCase());assert.ok(path.basename(root).startsWith('eac-linux-package-'));await fs.rm(root,{recursive:true,force:true});});
 const id=crypto.randomUUID();const original=path.join(root,'transactions',id,'package');const directory=path.join(path.dirname(original),'linux-install');await fs.mkdir(directory,{recursive:true,mode:0o700});
 const installed=path.join(root,'installed');await fs.mkdir(installed,{mode:0o700});const executable=path.join(installed,'dsh-eac-shell');await fs.writeFile(executable,'old-program');await fs.writeFile(original,'downloaded');await fs.writeFile(path.join(directory,'installer.deb'),'signed-copy');
 const f=rootCase();const data=path.join(root,'data');await fs.mkdir(data,{mode:0o700});const marker=path.join(data,'original-session');await fs.writeFile(marker,'user session survives');
 const binding={environmentRoot:data,dshHome:data,userDataDir:data,registryHome:data,webviewRoot:path.join(data,'webview'),configRoot:path.join(data,'config'),guestRoot:path.join(data,'guest'),profile:'desktop',channel:'beta',webPort:64584};
 const plan={schemaVersion:1,transactionId:id,transactionDir:directory,installKind:'deb',target:f.artifact.target,version:'6.1.1',previousVersion:'6.1.0',executable,packageFile:path.join(directory,'installer.deb'),artifact:f.artifact,trustedKey:f.defaults.trustedKeys['root-test'],binding,resourceRoot:installed,sourcePackageFile:original,envelope:f.request.envelope,manager:'apt-get',identity:{name:'deepseek-harness-eac',version:'6.1.1',arch:'amd64'},installed:{name:'deepseek-harness-eac',version:'6.1.0',arch:'amd64'},phase:'prepared',systemInstallStarted:false};
 await writeDurableJson(path.join(directory,'linux-plan.json'),plan);return {root,directory,plan,executable,marker};
}
test('native package normal transaction orders exit, cold backup, authorization grant, health and commit',async t=>{
 const f=await nativePackageFixture(t);f.plan.phase='ready';await writeDurableJson(path.join(f.directory,'linux-plan.json'),f.plan);const order:string[]=[];
 await executeLinuxPackage(f.plan,{grant:async()=>{order.push('grant');assert.equal((await readLinuxPackagePlan(f.directory,f.executable)).phase,'installing');await fs.writeFile(f.executable,'new-program');},cancel:async()=>{throw Error('unexpected cancel');}},
  async()=>{order.push('exit');assert.equal(await fs.readFile(f.executable,'utf8'),'old-program');return true;},async()=>{order.push('backup');assert.equal(await fs.readFile(f.marker,'utf8'),'user session survives');},async()=>{order.push('health');assert.equal(await fs.readFile(f.executable,'utf8'),'new-program');assert.equal((await readLinuxPackagePlan(f.directory,f.executable)).phase,'health');return true;},async()=>{throw Error('unexpected stop');});
 assert.deepEqual(order,['exit','backup','grant','health']);assert.equal((await readLinuxPackagePlan(f.directory,f.executable)).phase,'committed');assert.equal(await fs.readFile(f.marker,'utf8'),'user session survives');await assert.rejects(cancelLinuxPackage(f.plan),/already-started/);
});
test('native package cancellation and a live original owner prevent the first privileged write',async t=>{
 const f=await nativePackageFixture(t);await cancelLinuxPackage(f.plan);assert.equal((await readLinuxPackagePlan(f.directory,f.executable)).phase,'cancelled');assert.equal(await fs.readFile(f.executable,'utf8'),'old-program');
 const g=await nativePackageFixture(t);g.plan.phase='ready';let cancelled=false;await assert.rejects(executeLinuxPackage(g.plan,{grant:async()=>{throw Error('must not install');},cancel:async()=>{cancelled=true;}},async()=>false,async()=>{throw Error('must not backup');},async()=>{throw Error('must not start');},async()=>true),/processes-still-running/);
 assert.equal(cancelled,true);const saved=await readLinuxPackagePlan(g.directory,g.executable);assert.equal(saved.phase,'failed');assert.equal(saved.systemInstallStarted,false);assert.equal(await fs.readFile(g.executable,'utf8'),'old-program');
});
test('native package health failure preserves data and requires confirmed candidate shutdown',async t=>{
 const f=await nativePackageFixture(t);f.plan.phase='ready';let stopped=false;
 await assert.rejects(executeLinuxPackage(f.plan,{grant:async()=>{await fs.writeFile(f.executable,'new-program');},cancel:async()=>{throw Error('unexpected cancel');}},async()=>true,async()=>{},async()=>false,async()=>{stopped=true;return true;}),/health-unconfirmed/);
 assert.equal(stopped,true);assert.equal((await readLinuxPackagePlan(f.directory,f.executable)).phase,'failed');assert.equal(await fs.readFile(f.marker,'utf8'),'user session survives');assert.equal(await fs.readFile(f.executable,'utf8'),'new-program');
});
async function fakeRoot(t:any,mode='success'){
 const f=await nativePackageFixture(t);const identity={transactionId:f.plan.transactionId,version:'6.1.1',target:'linux-x86_64-deb',token:'a'.repeat(64)};const script=path.join(f.root,'root-protocol-fixture.cjs');const marker=path.join(f.root,'privileged-write-marker');
 const source=String.raw`const fs=require('node:fs');const readline=require('node:readline');const info=IDENTITY;const mode=MODE;const marker=MARKER;
 if(mode==='deny')process.exit(126);if(mode==='fail'){process.stderr.write('update-linux-root-key-unavailable\n');process.exit(1);}if(mode==='wait'){process.stdin.resume();}else{
 const lines=readline.createInterface({input:process.stdin});process.stdout.write(JSON.stringify({...info,schemaVersion:1,ready:true,...(mode==='wrong-token'?{token:'c'.repeat(64)}:{})})+'\n');
 let granted=false;lines.once('line',line=>{const value=JSON.parse(line);if(value.action!=='install'||value.token!==info.token)process.exit(2);granted=true;fs.writeFileSync(marker,'installed only after grant');
 if(mode==='no-receipt')process.exit(0);process.stdout.write(JSON.stringify({...info,schemaVersion:1,installed:true,exitCode:0})+'\n',()=>process.exit(0));});lines.once('close',()=>{if(!granted)process.exit(0);});}`.replace('IDENTITY',JSON.stringify(identity)).replace('MODE',JSON.stringify(mode)).replace('MARKER',JSON.stringify(marker));
 await fs.writeFile(script,source);return {...f,identity,command:{file:process.execPath,args:[script]},writeMarker:marker};
}
test('authorization transport waits for authenticated ready, grants once and requires the installed receipt',{timeout:15000},async t=>{
 const f=await fakeRoot(t);const authorization=await startLinuxAuthorization(f.command,f.identity);assert.equal(await fs.stat(f.writeMarker).then(()=>true,()=>false),false);await authorization.grant();assert.equal(await fs.readFile(f.writeMarker,'utf8'),'installed only after grant');await assert.rejects(authorization.grant(),/not-ready/);
 const g=await fakeRoot(t,'no-receipt');const incomplete=await startLinuxAuthorization(g.command,g.identity);await assert.rejects(incomplete.grant(),/package-manager-failed/);
});
test('authorization cancellation keeps the original program running and does not grant installation',{timeout:15000},async t=>{
 const f=await fakeRoot(t);const authorization=await startLinuxAuthorization(f.command,f.identity);await authorization.cancel();assert.equal(await fs.stat(f.writeMarker).then(()=>true,()=>false),false);assert.equal(await fs.readFile(f.executable,'utf8'),'old-program');await assert.rejects(authorization.grant(),/not-ready/);
 for(const [mode,message]of [['deny','authorization-cancelled'],['fail','root-key-unavailable'],['wrong-token','authorization-response-invalid']]){const bad=await fakeRoot(t,mode);await assert.rejects(startLinuxAuthorization(bad.command,bad.identity),new RegExp(message));assert.equal(await fs.stat(bad.writeMarker).then(()=>true,()=>false),false);}
 const waiting=await fakeRoot(t,'wait');const control=new AbortController();const pending=startLinuxAuthorization(waiting.command,waiting.identity,control.signal);control.abort();await assert.rejects(pending,/update-cancelled/);
});
test('root receipts cannot cross transaction, version, architecture or protocol phases',()=>{
 const identity={transactionId:crypto.randomUUID(),version:'6.1.1',target:'linux-x86_64-deb',token:'a'.repeat(64)};const ready={schemaVersion:1,...identity,ready:true};assert.equal(validLinuxRootReceipt(ready,identity,'ready'),true);
 for(const wrong of [{...ready,transactionId:crypto.randomUUID()},{...ready,version:'6.1.0'},{...ready,target:'linux-aarch64-deb'},{...ready,token:'c'.repeat(64)},{...ready,installed:true}])assert.equal(validLinuxRootReceipt(wrong,identity,'ready'),false);
 assert.equal(validLinuxRootReceipt({schemaVersion:1,...identity,installed:true,exitCode:0},identity,'installed'),true);assert.equal(validLinuxRootReceipt({...ready,exitCode:0},identity,'installed'),false);
});

test('root system command entry points resolve symlinks before immutable-file validation',{skip:process.platform!=='linux'},async()=>{
 const {resolveLinuxRootCommand}=require('../lib/desktop/update-linux-root.js');
 const command=await resolveLinuxRootCommand({file:'/usr/bin/sh',args:['-c','exit 0']});
 assert.equal(command.file,await fs.realpath('/usr/bin/sh'));assert.deepEqual(command.args,['-c','exit 0']);
});
