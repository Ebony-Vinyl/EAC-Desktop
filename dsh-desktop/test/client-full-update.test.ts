import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {verifyMinisign, verifyPackage} = require('../lib/desktop/update-signature.js');
const {stableVersion, compareVersion, verifyManifest, effectiveSource, autoSelect, initialSelection,
  resolveUpdate, localFile, parseSelection} = require('../lib/desktop/update-sources.js');
const {ClientUpdate} = require('../lib/desktop/client-update.js');
const key = crypto.generateKeyPairSync('ed25519');
const keyId = crypto.randomBytes(8);
const publicKey = Buffer.concat([Buffer.from('Ed'), keyId,
  (key.publicKey.export({format:'der',type:'spki'}) as Buffer).subarray(-32)]).toString('base64');
const defaults = {schemaVersion:1,github:{repo:'DSH-EAC/EAC-Desktop'},gitee:{repo:''},
  geoUrl:'https://geo.example/',trustedKeys:{test:publicKey}};
function sign(data: Buffer, prehashed=false): string {
  const message = prehashed ? crypto.createHash('blake2b512').update(data).digest() : data;
  const signature = crypto.sign(null,message,key.privateKey);
  const packet = Buffer.concat([Buffer.from(prehashed?'ED':'Ed'),keyId,signature]);
  const comment = 'timestamp:1791849600';
  const global = crypto.sign(null,Buffer.concat([signature,Buffer.from(comment)]),key.privateKey);
  return 'untrusted comment: signature\n'+packet.toString('base64')+'\ntrusted comment: '+comment+'\n'+global.toString('base64');
}
const packageBytes = Buffer.from('signed full update package');
function manifest(version='6.0.1', overrides: Record<string,unknown>={}) {
  return {schemaVersion:1,product:'eac-desktop',releaseChannel:'stable',version,publishedAt:'2026-10-13T00:00:00Z',
    artifacts:[{target:'windows-x86_64-portable',installKind:'portable',url:'package.zip',size:packageBytes.length,
      sha256:crypto.createHash('sha256').update(packageBytes).digest('hex'),signature:sign(packageBytes,true)}],...overrides};
}
function envelope(value: unknown) {
  const payload=Buffer.from(JSON.stringify(value));
  return {schemaVersion:1,keyId:'test',payload:payload.toString('base64'),signature:sign(payload)};
}
async function temp(t: any) {const root=await fs.mkdtemp(path.join(os.tmpdir(),'eac-update-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
const binding = {environmentRoot:'old-eac-beta',dshHome:'old-home',profile:'web-desktop',channel:'beta',registryHome:'registry',userDataDir:'desktop',webPort:19888};
test('stable comparison rejects prereleases, build metadata and malformed versions',()=>{
  for(const value of ['6.0.1-beta.1','6.0.1+build','06.0.1','6x0x1','v6.0.1','6.0','6.0.1.0'])assert.throws(()=>stableVersion(value));
  assert.equal(compareVersion('6.0.10','6.0.9'),1);assert.equal(compareVersion('6.0.0','6.0.0'),0);
});
test('minisign validates raw and prehashed signatures and rejects trusted comment tampering',()=>{
  verifyMinisign(packageBytes,Buffer.from(sign(packageBytes)).toString('base64'),publicKey);
  verifyMinisign(packageBytes,sign(packageBytes),Buffer.from('untrusted comment: public key\n'+publicKey).toString('base64'));
  verifyMinisign(packageBytes,sign(packageBytes),publicKey);verifyMinisign(packageBytes,sign(packageBytes,true),publicKey);
  assert.throws(()=>verifyMinisign(Buffer.from('changed'),sign(packageBytes),publicKey),/verification/);
  assert.throws(()=>verifyMinisign(packageBytes,sign(packageBytes).replace('timestamp:1791849600','timestamp:1'),publicKey),/trusted-comment/);
});
test('signed manifests cannot replace product, channel, keys or target identity',()=>{
  assert.equal(verifyManifest(envelope(manifest()),defaults).manifest.version,'6.0.1');
  assert.throws(()=>verifyManifest({...envelope(manifest()),keyId:'attacker'},defaults),/untrusted/);
  for(const overrides of [{product:'other-product'},{releaseChannel:'beta'},{version:'6.0.1-beta.1'}]) assert.throws(()=>verifyManifest(envelope(manifest('6.0.1',overrides)),defaults));
  const a=manifest().artifacts[0]!;
  assert.throws(()=>verifyManifest(envelope(manifest('6.0.1',{artifacts:[a,a]})),defaults),/duplicate/);
  assert.throws(()=>verifyManifest(envelope(manifest('6.0.1',{artifacts:[{...a,installKind:'nsis'}]})),defaults),/invalid-artifact/);
  assert.throws(()=>verifyManifest(envelope(manifest('6.0.1',{artifacts:[{...a,target:'linux-x86_64-portable'}]})),defaults),/invalid-artifact/);
});
test('auto selection uses country only and preserves Gitee preference while unavailable',async()=>{
  const cn=await autoSelect(defaults,async()=>({country:'CN',ip:'never persisted'}),new AbortController().signal);
  assert.equal(cn.preferredSourceId,'gitee');assert.equal(effectiveSource(cn,defaults).id,'github');assert.ok(!('ip' in cn));
  assert.equal(effectiveSource(cn,{...defaults,gitee:{repo:'org/repo'}}).id,'gitee');
  assert.throws(()=>effectiveSource({...cn,selectionMode:'manual'},defaults),/gitee-not-configured/);
  for(const result of [{country:'US'},{country:'unknown'},null]){
    const s=await autoSelect(defaults,async()=>result,new AbortController().signal);assert.equal(s.preferredSourceId,'github');
  }
});
test('manual configuration rejects insecure and credential-bearing custom URLs',()=>{
  for(const url of ['http://source.example/','https://user:secret@source.example/','https://source.example/#fragment'])assert.throws(()=>parseSelection({...initialSelection(),customUrl:url}));
  assert.throws(()=>parseSelection({...initialSelection(),releaseChannel:'beta'}));
});
test('release metadata excludes drafts, prereleases and foreign tags, matching exact target',async()=>{
  const seen:string[]=[];
  const releases=[{tag_name:'V6.0.1',assets:[{name:'stable.json',browser_download_url:'https://release.example/stable.json'}]},
    {tag_name:'v7.0.0',draft:true},{tag_name:'v8.0.0',prerelease:true},{tag_name:'v9.0.0-beta.1'},{tag_name:'other-v9.0.0'}];
  const read=async(url:string)=>{seen.push(url);return url.includes('/releases?')?releases:envelope(manifest());};
  const update=await resolveUpdate(initialSelection(),defaults,'6.0.0','windows-x86_64-portable',new AbortController().signal,read);
  assert.equal(update.manifest.version,'6.0.1');assert.equal(update.location,'https://release.example/package.zip');assert.equal(seen.length,2);
  assert.equal(await resolveUpdate(initialSelection(),defaults,'6.0.0','windows-aarch64-portable',new AbortController().signal,read),null);
});
test('release pagination selects newest eligible stable version across pages',async()=>{
  const read=async(url:string)=>{
    if(/[?&]page=1(?:&|$)/.test(url))return Array.from({length:100},(_,i)=>({tag_name:i===0?'v6.0.1':'ignore',assets:[{name:'stable.json',browser_download_url:'https://release.example/6.0.1/stable.json'}]}));
    if(/[?&]page=2(?:&|$)/.test(url))return [{tag_name:'v6.0.2',assets:[{name:'stable.json',browser_download_url:'https://release.example/6.0.2/stable.json'}]}];
    return envelope(manifest(url.includes('/6.0.2/')?'6.0.2':'6.0.1'));
  };
  const update=await resolveUpdate(initialSelection(),defaults,'6.0.0','windows-x86_64-portable',new AbortController().signal,read);
  assert.equal(update.manifest.version,'6.0.2');
});
test('release and manifest version disagreement is rejected',async()=>{
  await assert.rejects(resolveUpdate(initialSelection(),defaults,'6.0.0','windows-x86_64-portable',new AbortController().signal,
    async(url:string)=>url.includes('/releases?')?[{tag_name:'v6.0.2',assets:[{name:'stable.json',browser_download_url:'https://release.example/stable.json'}]}]:envelope(manifest())),/version-mismatch/);
});
test('manual custom failure never falls back to an official source',async()=>{
  const requests:string[]=[];
  await assert.rejects(resolveUpdate({...initialSelection(),selectionMode:'manual',preferredSourceId:'custom',customUrl:'https://custom.example/stable.json'},defaults,'6.0.0','windows-x86_64-portable',new AbortController().signal,
    async(url:string)=>{requests.push(url);throw Error('offline');}),/offline/);
  assert.deepEqual(requests,['https://custom.example/stable.json']);
});
test('offline source verifies manifest and copies a signed full package without networking',async t=>{
  const root=await temp(t);await fs.writeFile(path.join(root,'stable.json'),JSON.stringify(envelope(manifest())));await fs.writeFile(path.join(root,'package.zip'),packageBytes);
  const source={...initialSelection(),selectionMode:'manual',preferredSourceId:'local',localPath:root};
  let requests=0;const states:unknown[]=[];
  const ctx={stateDir:path.join(root,'state'),defaults,currentVersion:'6.0.0',target:'windows-x86_64-portable',binding:()=>({...binding}),notify:(s:unknown)=>states.push(s),readRemote:async()=>{requests++;throw Error('network-forbidden');}};
  const updater=new ClientUpdate(ctx);await updater.configure(source);await updater.initialize();
  assert.equal((await updater.check()).phase,'available');assert.equal((await updater.download()).phase,'ready');assert.equal(requests,0);
  assert.ok(states.some((s:any)=>s.phase==='downloading'));assert.equal(updater.settings().selection.selectionMode,'manual');
  await assert.rejects(updater.prepare(),/save-confirmation-unavailable/);
  assert.equal(updater.status().phase,'error');
  const reopened=new ClientUpdate(ctx);assert.equal(reopened.settings().selection.preferredSourceId,'local');
});
test('package size, digest, signature and key are independently enforced',async t=>{
  const root=await temp(t);const file=path.join(root,'package');await fs.writeFile(file,packageBytes);const artifact=manifest().artifacts[0]!;
  await verifyPackage(file,artifact,publicKey);
  await assert.rejects(verifyPackage(file,{...artifact,size:artifact.size+1},publicKey),/identity/);
  await assert.rejects(verifyPackage(file,{...artifact,sha256:'0'.repeat(64)},publicKey),/identity/);
  await assert.rejects(verifyPackage(file,{...artifact,signature:sign(Buffer.from('other'),true)},publicKey),/verification/);
});
test('local sources refuse traversal, absolute paths and directory junctions',async t=>{
  const root=await temp(t);await fs.writeFile(path.join(root,'package.zip'),packageBytes);
  for(const value of ['../package.zip','sub/../package.zip','/package.zip','C:/package.zip','sub\\package.zip','./package.zip'])await assert.rejects(localFile(root,value));
  const real=path.join(root,'real');await fs.mkdir(real);await fs.writeFile(path.join(real,'package.zip'),packageBytes);
  const link=path.join(root,'link');await fs.symlink(real,link,process.platform==='win32'?'junction':'dir');
  await assert.rejects(localFile(root,'link/package.zip'),/link/);await assert.rejects(localFile(link,'package.zip'),/link/);
});
test('source changes abort pending checks before changing the persisted selection',async t=>{
  const root=await temp(t);let entered!:()=>void;const started=new Promise<void>(r=>entered=r);
  const updater=new ClientUpdate({stateDir:root,defaults,currentVersion:'6.0.0',target:'windows-x86_64-portable',binding:()=>({...binding}),notify:()=>{},
    readRemote:async(_url:string,signal:AbortSignal)=>{entered();return new Promise((_r,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}});
  const pending=updater.check();await started;
  const handled=assert.rejects(pending,/cancelled/);
  await updater.configure({...initialSelection(),selectionMode:'manual',preferredSourceId:'github'});await handled;
  assert.equal(updater.status().phase,'idle');assert.equal(updater.settings().selection.selectionMode,'manual');
});
test('data binding changes after download stop preparation before save/backup',async t=>{
  const root=await temp(t);await fs.writeFile(path.join(root,'stable.json'),JSON.stringify(envelope(manifest())));await fs.writeFile(path.join(root,'package.zip'),packageBytes);
  let current={...binding};let prepare=0;const updater=new ClientUpdate({stateDir:path.join(root,'state'),defaults,currentVersion:'6.0.0',target:'windows-x86_64-portable',binding:()=>current,notify:()=>{},prepare:async()=>{prepare++;}});
  await updater.configure({...initialSelection(),selectionMode:'manual',preferredSourceId:'local',localPath:root});await updater.check();await updater.download();
  current={...binding,dshHome:'new-empty-stable'};await assert.rejects(updater.prepare(),/binding-changed/);assert.equal(prepare,0);
});

test('invalid persisted source settings remain intact and disable auto probing',async t=>{
  const root=await temp(t);const settings=path.join(root,'update-settings.json');const broken='{broken';await fs.writeFile(settings,broken);
  let network=0;const updater=new ClientUpdate({stateDir:root,defaults,currentVersion:'6.0.0',target:'windows-x86_64-portable',binding:()=>({...binding}),notify:()=>{},readRemote:async()=>{network++;return {};}});
  await updater.initialize();assert.equal(network,0);assert.equal(await fs.readFile(settings,'utf8'),broken);
  await assert.rejects(updater.check(),/invalid-source-settings/);assert.equal(await fs.readFile(settings,'utf8'),broken);
  await updater.configure({...initialSelection(),selectionMode:'manual'});assert.equal(updater.settings().selection.selectionMode,'manual');
});
test('auto fallback records actual source without rewriting user preference',async t=>{
  const root=await temp(t);const d={...defaults,gitee:{repo:'org/repo'}};
  const updater=new ClientUpdate({stateDir:root,defaults:d,currentVersion:'6.0.0',target:'windows-x86_64-portable',binding:()=>({...binding}),notify:()=>{},readRemote:async(url:string)=>{
    if(url.startsWith('https://gitee.com/'))throw Error('offline');
    if(url.includes('/releases?'))return [{tag_name:'v6.0.1',assets:[{name:'stable.json',browser_download_url:'https://release.example/stable.json'}]}];
    return envelope(manifest());
  }});
  await updater.configure({...initialSelection(),preferredSourceId:'gitee',geoCountry:'CN',geoDetectedAt:'2026-10-13T00:00:00Z'});
  await updater.check();assert.equal(updater.settings().effectiveSourceId,'github');assert.equal(updater.settings().selection.preferredSourceId,'gitee');
});
test('Gitee release adapter resolves its link-style asset metadata',async()=>{
  const d={...defaults,gitee:{repo:'org/repo'}};
  const read=async(url:string)=>url.includes('/releases?')?[{tag_name:'v6.0.1',assets:{links:[{name:'stable.json',url:'https://release.example/stable.json'}]}}]:envelope(manifest());
  const update=await resolveUpdate({...initialSelection(),preferredSourceId:'gitee'},d,'6.0.0','windows-x86_64-portable',new AbortController().signal,read);
  assert.equal(update.sourceId,'gitee');
});

async function downloadedForInstall(t:any,prepare:any){
  const root=await temp(t);await fs.writeFile(path.join(root,'stable.json'),JSON.stringify(envelope(manifest())));await fs.writeFile(path.join(root,'package.zip'),packageBytes);
  const stateDir=path.join(root,'state');const updater=new ClientUpdate({stateDir,defaults,currentVersion:'6.0.0',target:'windows-x86_64-portable',binding:()=>({...binding}),notify:()=>{},prepare});
  await updater.configure({...initialSelection(),selectionMode:'manual',preferredSourceId:'local',localPath:root});await updater.check();await updater.download();return {updater,stateDir};
}
test('installation commits only after save, helper ACK and the durable prepared plan',async t=>{
  const events:string[]=[];let f:any;
  f=await downloadedForInstall(t,async(id:string,signal:AbortSignal,plan:any)=>{
    assert.equal(signal.aborted,false);assert.equal(plan.transactionId,id);assert.equal(plan.prepared,false);events.push('saved-and-acknowledged');
    return {commit:async()=>{const stored=JSON.parse(await fs.readFile(path.join(f.stateDir,'transactions',id,'plan.json'),'utf8'));assert.equal(stored.prepared,true);assert.equal(f.updater.status().phase,'installing');events.push('committed');},cancel:async()=>events.push('cancelled')};
  });
  const plan=await f.updater.prepare();assert.equal(plan.prepared,true);assert.deepEqual(events,['saved-and-acknowledged','committed']);
  await assert.rejects(f.updater.configure(initialSelection()),/installation-in-progress/);
});
test('failed helper commit cancels takeover and missing ACK cannot report installing',async t=>{
  let cancelled=0;const f=await downloadedForInstall(t,async()=>({commit:async()=>{throw Error('update-helper-not-ready');},cancel:async()=>{cancelled++;}}));
  await assert.rejects(f.updater.prepare(),/helper-not-ready/);assert.equal(cancelled,1);assert.equal(f.updater.status().phase,'error');
  const g=await downloadedForInstall(t,async()=>{});await assert.rejects(g.updater.prepare(),/handoff-unavailable/);assert.equal(g.updater.status().phase,'error');
});

test('preparation publishes cancellable progress and cancellation awaits the actual prepare task',async t=>{
 let entered!:()=>void;const started=new Promise<void>(resolve=>entered=resolve);let left=false;
 const f=await downloadedForInstall(t,async(_id:string,signal:AbortSignal,_plan:any,progress:any)=>{
  progress('正在展开并校验完整包，完成前可以取消');entered();
  await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));left=true;throw signal.reason;
 });
 const preparing=f.updater.prepare();const rejected=assert.rejects(preparing,/cancelled/);await started;
 assert.equal(f.updater.status().phase,'installing');assert.equal(f.updater.status().cancellable,true);
 await f.updater.cancel();await rejected;assert.equal(left,true);assert.equal(f.updater.status().phase,'idle');
});

test('signed planned platform manifests retain product identity and normalize only after signature verification',()=>{
 const value=manifest();const a=value.artifacts[0];const planned={schemaVersion:1,product:'com.deepseek.dsh.desktop.tauri',channel:'stable',version:value.version,publishedAt:value.publishedAt,platforms:{[a.target]:{url:a.url,size:a.size,sha256:a.sha256,signature:a.signature}}};
 assert.deepEqual(verifyManifest(envelope(planned),defaults).manifest.artifacts,value.artifacts);
 for(const altered of [{...planned,product:'other'},{...planned,channel:'beta'},{...planned,artifacts:value.artifacts},{...planned,releaseChannel:'stable'}])assert.throws(()=>verifyManifest(envelope(altered),defaults),/invalid-manifest/);
 assert.throws(()=>verifyManifest({...envelope(planned),payload:Buffer.from(JSON.stringify({...planned,version:'6.0.2'})).toString('base64')},defaults),/verification/);
});

test('authenticated restart completion clears interrupted status while preserving manual source selection',async t=>{
 const root=await temp(t);const stateDir=path.join(root,'updates');await fs.mkdir(stateDir);const transactionId=crypto.randomUUID();const source={...initialSelection(),selectionMode:'manual',preferredSourceId:'local',localPath:root};
 await fs.writeFile(path.join(stateDir,'update-settings.json'),JSON.stringify(source));await fs.writeFile(path.join(stateDir,'update-state.json'),JSON.stringify({schemaVersion:1,phase:'installing',version:'6.0.1',transactionId}));
 const ctx={stateDir,defaults,currentVersion:'6.0.1',target:'windows-x86_64-portable',binding:()=>binding,notify:()=>{}};const update=new ClientUpdate(ctx);assert.equal(update.status().phase,'error');
 assert.throws(()=>update.completeRestart(crypto.randomUUID(),'6.0.1'),/completion-identity-mismatch/);assert.throws(()=>update.completeRestart(transactionId,'6.0.2'),/completion-identity-mismatch/);
 update.completeRestart(transactionId,'6.0.1');update.completeRestart(transactionId,'6.0.1');await update.cancel();assert.equal(update.status().phase,'idle');assert.equal(update.status().message,'已更新到 6.0.1');assert.deepEqual(update.settings().selection,source);
 const reopened=new ClientUpdate(ctx);assert.equal(reopened.status().phase,'idle');assert.equal(reopened.status().message,'已更新到 6.0.1');assert.deepEqual(reopened.settings().selection,source);await reopened.cancel();const persisted=JSON.parse(await fs.readFile(path.join(stateDir,'update-state.json'),'utf8'));assert.equal(persisted.completedTransactionId,transactionId);assert.equal(persisted.version,'6.0.1');
});
