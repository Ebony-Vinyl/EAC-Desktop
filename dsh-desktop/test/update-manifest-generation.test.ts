import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {createUpdateManifest,RELEASE_TARGETS} from '../../tauri-shell/create-update-manifest.mjs';
const require=createRequire(import.meta.url);
const {verifyManifest}=require('../lib/desktop/update-sources.js');
const {verifyPackage}=require('../lib/desktop/update-signature.js');
async function fixture(t:any){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eac-manifest-'));t.after(async()=>{const resolved=path.resolve(root);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('eac-manifest-'));await fs.rm(resolved,{recursive:true,force:true});});
 const key=crypto.generateKeyPairSync('ed25519');const id=crypto.randomBytes(8);const publicKey=Buffer.concat([Buffer.from('Ed'),id,(key.publicKey.export({type:'spki',format:'der'}) as Buffer).subarray(-32)]).toString('base64');const privateKey=key.privateKey.export({type:'pkcs8',format:'pem'});
 const artifacts=[];for(const target of RELEASE_TARGETS){const file=path.join(root,target+'.package');await fs.writeFile(file,'isolated package for '+target);artifacts.push({target,file,url:'https://release.example/EAC-6.0.1-'+target+'.package'});}
 const spec={schemaVersion:1,product:'com.deepseek.dsh.desktop.tauri',channel:'stable',version:'6.0.1',publishedAt:'2026-10-14T00:00:00Z',artifacts};return {root,keyId:'fixture',privateKey,publicKey,spec};
}
test('release generator signs all ten platform targets and its exact envelope and package signatures verify',async t=>{
 const f=await fixture(t);const output=await createUpdateManifest(f);assert.equal(output.completeMatrix,true);assert.deepEqual(Object.keys(output.manifest.platforms),RELEASE_TARGETS);
 const verified=verifyManifest(output.envelope,{schemaVersion:1,trustedKeys:{fixture:f.publicKey}});assert.equal(verified.manifest.version,'6.0.1');assert.equal(verified.manifest.artifacts.length,10);
 for(const artifact of verified.manifest.artifacts){const file=f.spec.artifacts.find(item=>item.target===artifact.target)!.file;await verifyPackage(file,artifact,f.publicKey);assert.equal(artifact.sha256,crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex'));}
});
test('partial matrix requires explicit opt-in and keeps completion false',async t=>{
 const f=await fixture(t);f.spec.artifacts=f.spec.artifacts.slice(0,1);await assert.rejects(createUpdateManifest(f),/matrix-incomplete/);const result=await createUpdateManifest({...f,allowPartial:true});assert.equal(result.completeMatrix,false);
});
test('release generator refuses mismatched keys, prereleases, foreign identity, duplicate targets and insecure URLs',async t=>{
 const f=await fixture(t);const other=crypto.generateKeyPairSync('ed25519');await assert.rejects(createUpdateManifest({...f,privateKey:other.privateKey.export({type:'pkcs8',format:'pem'})}),/key-mismatch/);
 for(const change of [{product:'other'},{channel:'beta'},{version:'6.0.1-beta.1'}])await assert.rejects(createUpdateManifest({...f,spec:{...f.spec,...change}}));
 await assert.rejects(createUpdateManifest({...f,spec:{...f.spec,artifacts:[...f.spec.artifacts,f.spec.artifacts[0]]}}),/artifact-invalid/);
 for(const url of ['http://unsafe.example/package','https://user:password@example/package','../escape','C:/package'])await assert.rejects(createUpdateManifest({...f,spec:{...f.spec,artifacts:[{...f.spec.artifacts[0],url}]},allowPartial:true}),/url-invalid/);
});