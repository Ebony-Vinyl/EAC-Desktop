import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import {spawn, type ChildProcess} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {captureBackup,assertInstallBoundary}=require('../lib/desktop/update-backup.js');
const {UpdateHostControl}=require('../lib/desktop/update-host-control.js');
const hostModule=require.resolve('../lib/desktop/update-host.js');
async function temp(t:any){const root=await fs.mkdtemp(path.join(os.tmpdir(),'eac-prepare-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
function waitExit(child:ChildProcess,timeoutMs=5000):Promise<boolean>{
  if(child.exitCode!==null)return Promise.resolve(true);
  return new Promise(resolve=>{const timer=setTimeout(()=>resolve(false),timeoutMs);child.once('exit',()=>{clearTimeout(timer);resolve(true);});});
}
async function fixture(t:any,scenario='good'){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'eac-host-prepare-'));const state=path.join(root,'updates');const home=path.join(root,'dsh-home');await fs.mkdir(home);
  const control=new UpdateHostControl(state,home,'web-desktop');const runtime=control.runtime();
  const fixtureFile=path.join(root,'kernel.cjs');
  await fs.writeFile(fixtureFile,
    'const fs=require("node:fs");const path=require("node:path");const host=require('+JSON.stringify(hostModule)+');\n'+
    'const events=[];const cleanups=[];let active=false;let held;let closed=false;const scenario='+JSON.stringify(scenario)+';\n'+
    'const agent={status:scenario==="busy"?"running":"idle",runMaintenance(task){if(active)throw Error("busy");active=true;const abort=new AbortController();const promise=task(abort.signal).finally(()=>active=false);held=()=>abort.abort();return promise;}};\n'+
    'const ctx={root:{fiber:{dispose:async()=>{if(scenario==="forced")process.exit(0);await cleanup();events.push("root-disposed");}}},agents:{list:()=>[agent]},sessions:{list:()=>[{},{}],flush:async()=>{events.push("flush");return scenario!=="flush-fail";}},\n'+
    'sessionPersistence:{list:async()=>[{header:{id:"stored",cwd:path.join(process.env.DSH_HOME,"registered-workspace")}}],open:async()=>({header:{id:"stored",cwd:path.join(process.env.DSH_HOME,"registered-workspace")},inheritedEventCount:0,read:async offset=>({events:offset===0?[{seq:0,type:"message",text:"durable conversation"}]:[]}),close:async()=>{}})},loader:{await:async()=>events.push("loader-settled"),entries:()=>[{subtree:{flushWrite:async()=>events.push("config-flushed")}}]},\n'+
    'hmr:{runExclusive:async fn=>{events.push("exclusive");return fn();}},appReady:{onReady:fn=>{setTimeout(fn,10);return ()=>{};}},on:()=>()=>{},effect:fn=>cleanups.push(fn()),logger:{warn:message=>events.push(message)},\n'+
    'appExit:()=>{}};\n'+
    'async function cleanup(){if(closed)return;closed=true;held?.();for(const fn of cleanups)await fn();fs.writeFileSync(path.join(process.env.DSH_EAC_UPDATE_STATE,"events.json"),JSON.stringify(events));process.stdin.destroy();process.exitCode=0;}\n'+
    'process.stdin.on("data",()=>void cleanup());host.apply(ctx);\n');
  const child=spawn(process.execPath,[fixtureFile],{env:{...process.env,...runtime.env,DSH_HOME:home,DSH_DESKTOP_PROFILE:'web-desktop'},stdio:['pipe','ignore','pipe']});
  let stderr='';child.stderr?.on('data',b=>stderr+=String(b));
  t.after(async()=>{try{if(child.exitCode===null){child.stdin?.write('stop\n');if(!await waitExit(child,2000))child.kill();}}finally{await fs.rm(root,{recursive:true,force:true});}});
  const deadline=Date.now()+5000;
  while(Date.now()<deadline){
    try{const descriptor=JSON.parse(await fs.readFile(path.join(state,'host-control.json'),'utf8'));if(descriptor.pid===child.pid)return {root,state,home,control,child,token:runtime.env.DSH_EAC_UPDATE_TOKEN,descriptor};}catch{}
    if(child.exitCode!==null)throw Error('fixture exited: '+stderr);
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  throw Error('fixture not ready: '+stderr);
}
test('backup covers credentials, sessions, attachments and settings while excluding its own transactions',async t=>{
  const root=await temp(t);const data=path.join(root,'用户 数据');await fs.mkdir(path.join(data,'sessions'),{recursive:true});
  await fs.writeFile(path.join(data,'sessions','session.jsonl'),'durable conversation\n');await fs.writeFile(path.join(data,'credentials.yml'),'private-fixture-key');
  const state=path.join(data,'client-updates');await fs.mkdir(path.join(state,'transactions'),{recursive:true});await fs.writeFile(path.join(state,'update-settings.json'),'manual local source');
  const destination=path.join(state,'transactions','backup');
  const result=await captureBackup([{id:'data',path:data,required:true,exclude:[state]},{id:'update-settings',path:path.join(state,'update-settings.json'),required:true}],destination,new AbortController().signal);
  assert.equal(result.manifest.files.length,3);assert.equal(await fs.readFile(path.join(destination,'data','credentials.yml'),'utf8'),'private-fixture-key');
  for(const file of result.manifest.files){const content=await fs.readFile(path.join(destination,file.rootId,...file.relative.split('/')));assert.equal(crypto.createHash('sha256').update(content).digest('hex'),file.sha256);}
  const manifest=JSON.parse(await fs.readFile(path.join(destination,'backup-manifest.json'),'utf8'));assert.equal(manifest.totalBytes,result.manifest.totalBytes);
});
test('backup records a junction without traversing its external target',async t=>{
  const root=await temp(t);const data=path.join(root,'data');const external=path.join(root,'external');await fs.mkdir(data);await fs.mkdir(external);await fs.writeFile(path.join(external,'must-not-copy'),'outside authority');
  await fs.symlink(external,path.join(data,'dependencies'),process.platform==='win32'?'junction':'dir');
  const result=await captureBackup([{id:'data',path:data,required:true}],path.join(root,'backup'),new AbortController().signal);
  assert.equal(result.manifest.links.length,1);assert.equal(result.manifest.files.length,0);assert.equal(result.manifest.links[0].relative,'dependencies');
});
test('backup fails before installation on missing data, cancellation and root aliases',async t=>{
  const root=await temp(t);const data=path.join(root,'data');await fs.mkdir(data);
  await assert.rejects(captureBackup([{id:'data',path:path.join(root,'missing'),required:true}],path.join(root,'backup'),new AbortController().signal),/unavailable/);
  const abort=new AbortController();abort.abort(Error('cancelled'));
  await assert.rejects(captureBackup([{id:'data',path:data,required:true}],path.join(root,'backup'),abort.signal),/cancelled/);
  const alias=path.join(root,'alias');await fs.symlink(data,alias,process.platform==='win32'?'junction':'dir');
  await assert.rejects(captureBackup([{id:'data',path:alias,required:true}],path.join(root,'backup'),new AbortController().signal),/path-link/);
  await assert.rejects(assertInstallBoundary(root,[data]),/data-overlap/);
  await assert.rejects(assertInstallBoundary(alias,[path.join(root,'other')]),/path-link/);
});
test('prepared Host shutdown proves flush, configuration settlement and owned process exit',async t=>{
  const f=await fixture(t);const transactionId=crypto.randomUUID();
  const receipt=await f.control.prepare(f.child,transactionId,new AbortController().signal,waitExit);
  assert.equal(receipt.sessionCount,2);assert.deepEqual(receipt.workspaceRoots,[path.join(f.home,'registered-workspace')]);assert.equal(receipt.rootDisposed,true);assert.equal(receipt.durable,true);assert.equal(f.child.exitCode,0);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.state,'events.json'),'utf8')),['exclusive','flush','flush','loader-settled','config-flushed']);
});
test('busy tasks and failed flush retain a live Host and do not authorize installation',async t=>{
  for(const [scenario,error] of [['busy','tasks-busy'],['flush-fail','flush-unconfirmed']]){
    const f=await fixture(t,scenario);await assert.rejects(f.control.prepare(f.child,crypto.randomUUID(),new AbortController().signal,waitExit),new RegExp(error));assert.equal(f.child.exitCode,null);
  }
});
test('forced zero-code exit is rejected because it has no completed root disposal receipt',async t=>{
  const f=await fixture(t,'forced');await assert.rejects(f.control.prepare(f.child,crypto.randomUUID(),new AbortController().signal,waitExit),/shutdown-unconfirmed/);
  assert.equal(f.child.exitCode,0);
});
test('a changed receipt cannot substitute for the authenticated Host checkpoint',async t=>{
  const f=await fixture(t);const transactionId=crypto.randomUUID();
  await assert.rejects(f.control.prepare(f.child,transactionId,new AbortController().signal,async child=>{
    const exited=await waitExit(child);const file=path.join(f.state,'transactions',transactionId,'host-prepared.json');const value=JSON.parse(await fs.readFile(file,'utf8'));value.mac='0'.repeat(64);await fs.writeFile(file,JSON.stringify(value));return exited;
  }),/receipt-invalid/);
});
test('Host control rejects browser Origin and an invalid token',async t=>{
  const f=await fixture(t);
  const request=(headers:Record<string,string>)=>new Promise<number|undefined>((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port:f.descriptor.port,path:'/prepare',method:'POST',headers},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end('{}');
  });
  assert.equal(await request({'x-eac-update-token':'0'.repeat(64)}),403);
  assert.equal(await request({'x-eac-update-token':f.token,Origin:'http://127.0.0.1:19873'}),403);
  assert.equal(f.child.exitCode,null);
});

test('fresh data defaults stable while an existing beta dpx identity survives a stable release',async t=>{
  const environment=require('../lib/desktop/environment.js');const root=await temp(t);
  const base={...process.env,DSH_EAC_DATA_ROOT:root,DSH_EAC_DPX_REGISTRY_HOME:path.join(root,'registry'),DSH_EAC_CHANNEL:'',DSH_EAC_ENVIRONMENT_DEFAULT_CHANNEL:'stable'};
  assert.equal(environment.environmentChannel(base),'stable');
  const beta=environment.ensureEacEnvironment({...base,DSH_EAC_CHANNEL:'beta'},process.platform);
  const file=path.join(beta.paths.dshHome,'sessions','keep.jsonl');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'old durable beta data');
  const reused=environment.ensureEacEnvironment(base,process.platform);assert.equal(reused.channel,'beta');assert.equal(reused.paths.dshHome,beta.paths.dshHome);assert.equal(await fs.readFile(file,'utf8'),'old durable beta data');
  assert.equal(await fs.stat(path.join(root,'dpx','dsh-environments','eac-stable')).then(()=>true,()=>false),false);
});
test('a persisted environment binding preserves redirected storage and registry across restart',async t=>{
  const environment=require('../lib/desktop/environment.js');const {persistEnvironmentBinding}=require('../lib/desktop/update-data-binding.js');const root=await temp(t);const product=path.join(root,'product');
  const beta=environment.ensureEacEnvironment({...process.env,DSH_EAC_DATA_ROOT:product,DSH_EAC_DPX_ROOT:path.join(root,'redirected storage'),DSH_EAC_DPX_REGISTRY_HOME:path.join(root,'redirected registry'),DSH_EAC_CHANNEL:'beta'},process.platform);
  persistEnvironmentBinding(product,{schemaVersion:1,product:'eac-desktop',channel:beta.channel,environmentRoot:beta.paths.root,storageRoot:beta.storageRoot,dshHome:beta.paths.dshHome,registryHome:beta.registryHome,profile:'web-desktop'});
  const env={...process.env,DSH_EAC_DATA_ROOT:product,DSH_EAC_CHANNEL:'',DSH_EAC_DPX_ROOT:'',DSH_EAC_DPX_REGISTRY_HOME:'',DSH_EAC_ENVIRONMENT_DEFAULT_CHANNEL:'stable'};
  const reused=environment.ensureEacEnvironment(env,process.platform);assert.equal(reused.channel,'beta');assert.equal(reused.paths.root,beta.paths.root);assert.equal(reused.registryHome,beta.registryHome);
  await fs.writeFile(path.join(product,'eac-data-binding.json'),'{broken');assert.throws(()=>environment.ensureEacEnvironment(env,process.platform),/binding-invalid/);
});

test('private health actually reads persisted session logs and holds Agent admission until release or disposal',async t=>{
  const f=await fixture(t);const observed=await f.control.health(f.child);assert.match(observed.sessionDigest,/^[a-f0-9]{64}$/);assert.equal(observed.storedSessionCount,1);
  assert.deepEqual(await f.control.health(f.child),observed);await f.control.releaseHealth(f.child);
  const receipt=await f.control.prepare(f.child,crypto.randomUUID(),new AbortController().signal,waitExit);assert.equal(receipt.sessionDigest,observed.sessionDigest);assert.equal(receipt.storedSessionCount,1);
});

test('owned shared runtime junction is excluded only at its exact source and target',()=>{
 const {protectedLinkTargets}=require('../lib/desktop/update-backup.js');const home=path.resolve('fixture-home');const desktop=path.resolve('fixture-install/dsh-desktop');
 const manifest={schemaVersion:1,roots:[{id:'home',path:home,present:true}],links:[{rootId:'home',relative:'profiles/node_modules/schemastery',target:path.join(desktop,'node_modules/schemastery')},{rootId:'home',relative:'notes/runtime-alias',target:path.join(desktop,'node_modules/schemastery')},{rootId:'home',relative:'profiles/node_modules/other-user-link',target:path.join(desktop,'node_modules/other')}]};
 assert.deepEqual(protectedLinkTargets(manifest,home,desktop),[path.join(desktop,'node_modules/schemastery'),path.join(desktop,'node_modules/other')]);
 manifest.links[0].target=path.resolve('different-target');assert.equal(protectedLinkTargets(manifest,home,desktop).length,3);
});
