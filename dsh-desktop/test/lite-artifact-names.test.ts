import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {nameLiteInstallers} from '../../tauri-shell/name-lite-installers.mjs';
async function fixture(t:any,platform:string){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eac-lite-names-'));t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('eac-lite-names-'));await fs.rm(root,{recursive:true,force:true});});
 const formats=platform==='windows'?[['nsis','Setup.exe']]:[['deb','old.deb'],['appimage','old.AppImage'],['rpm','old.rpm']];
 for(const [kind,name] of formats){await fs.mkdir(path.join(root,kind!));await fs.writeFile(path.join(root,kind!,name!),'signed fixture '+kind);}
 return {root,formats};
}
for(const platform of ['windows','linux'])for(const arch of ['x64','arm64'])test('base installer artifacts are named Lite without changing signed bytes: '+platform+'/'+arch,async t=>{
 const {root,formats}=await fixture(t,platform);const options={bundleRoot:root,version:'6.1.0',platform,arch};const result=await nameLiteInstallers(options);assert.equal(result.length,formats.length);
 for(const [index,item] of result.entries()){assert.match(item.name,new RegExp('^EAC-Lite-6\\.1\\.0-'+platform+'-'+(arch==='x64'?'x86_64':'aarch64')));assert.equal(item.sha256,crypto.createHash('sha256').update('signed fixture '+formats[index]![0]).digest('hex'));assert.equal((await fs.readFile(item.file,'utf8')),'signed fixture '+formats[index]![0]);}
 assert.deepEqual(await nameLiteInstallers(options),result);const sums=await fs.readFile(path.join(root,'SHA256SUMS-Lite.txt'),'utf8');assert.equal(sums.trim().split('\n').length,result.length);assert.ok(result.every(item=>sums.includes(item.name)));
});
test('Lite naming refuses an ambiguous or incomplete installer matrix before renaming',async t=>{
 const {root}=await fixture(t,'linux');await fs.writeFile(path.join(root,'rpm','other.rpm'),'duplicate');await assert.rejects(nameLiteInstallers({bundleRoot:root,version:'6.1.0',platform:'linux',arch:'x64'}),/exactly one/);assert.equal(await fs.readFile(path.join(root,'deb','old.deb'),'utf8'),'signed fixture deb');
 for(const options of [{version:'6.1.0-beta'},{arch:'ia32'},{platform:'darwin'}])await assert.rejects(nameLiteInstallers({bundleRoot:root,version:'6.1.0',platform:'linux',arch:'x64',...options}),/invalid Lite/);
});
