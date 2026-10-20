import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {verifyManifest,stableVersion}=require('../dsh-desktop/lib/desktop/update-sources.js');
const {verifyMinisign}=require('../dsh-desktop/lib/desktop/update-signature.js');
export const RELEASE_TARGETS=['windows-x86_64-nsis','windows-aarch64-nsis','windows-x86_64-portable','windows-aarch64-portable','linux-x86_64-appimage','linux-aarch64-appimage','linux-x86_64-deb','linux-aarch64-deb','linux-x86_64-rpm','linux-aarch64-rpm'];
function publicPacket(text){
 const trimmed=text.trim();const decoded=Buffer.from(trimmed,'base64').toString('utf8');
 const raw=decoded.startsWith('untrusted comment:')?decoded:trimmed;
 const line=raw.split(/\r?\n/).find(line=>line&&!line.startsWith('untrusted comment:'));
 const packet=Buffer.from(line||'','base64');
 if(packet.length!==42||packet.subarray(0,2).toString()!=='Ed')throw Error('update-release-public-key-invalid');return packet;
}
function sign(bytes,algorithm,key,id,timestamp){
 const signature=crypto.sign(null,bytes,key);const comment='timestamp:'+timestamp;
 const global=crypto.sign(null,Buffer.concat([signature,Buffer.from(comment)]),key);
 return 'untrusted comment: EAC complete-package release\n'+Buffer.concat([Buffer.from(algorithm),id,signature]).toString('base64')+'\ntrusted comment: '+comment+'\n'+global.toString('base64');
}
export async function createUpdateManifest(options){
 const {spec,publicKey,privateKey,keyId}=options;
 if(!spec||spec.schemaVersion!==1||spec.product!=='com.deepseek.dsh.desktop.tauri'||spec.channel!=='stable'||typeof spec.version!=='string'||typeof spec.publishedAt!=='string'||!Number.isFinite(Date.parse(spec.publishedAt))||!Array.isArray(spec.artifacts)||!spec.artifacts.length)throw Error('update-release-spec-invalid');
 stableVersion(spec.version);
 if(typeof keyId!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(keyId))throw Error('update-release-key-id-invalid');
 const key=crypto.createPrivateKey(privateKey);if(key.asymmetricKeyType!=='ed25519')throw Error('update-release-private-key-invalid');
 const packet=publicPacket(publicKey);const rawPublic=crypto.createPublicKey(key).export({type:'spki',format:'der'}).subarray(-32);
 if(!crypto.timingSafeEqual(rawPublic,packet.subarray(10)))throw Error('update-release-key-mismatch');
 const seen=new Set();const platforms={};const timestamp=Math.floor(Date.parse(spec.publishedAt)/1000);
 for(const artifact of spec.artifacts){
  if(!artifact||!RELEASE_TARGETS.includes(artifact.target)||seen.has(artifact.target)||typeof artifact.file!=='string'||!path.isAbsolute(artifact.file)||typeof artifact.url!=='string')throw Error('update-release-artifact-invalid');
  if(artifact.url.startsWith('https://')){const url=new URL(artifact.url);if(url.username||url.password||url.hash)throw Error('update-release-url-invalid');}
  else if(!artifact.url||artifact.url.includes('\\')||artifact.url.includes(':')||artifact.url.startsWith('/')||artifact.url.split('/').some(part=>!part||part==='..'||part==='.'||/[\x00-\x1f]/.test(part)))throw Error('update-release-url-invalid');
  seen.add(artifact.target);const stat=await fs.lstat(artifact.file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1)throw Error('update-release-file-invalid');
  const sha=crypto.createHash('sha256');const prehash=crypto.createHash('blake2b512');let size=0;
  for await(const chunk of createReadStream(artifact.file)){size+=chunk.length;sha.update(chunk);prehash.update(chunk);}
  const after=await fs.stat(artifact.file);if(size!==stat.size||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||after.ino!==stat.ino)throw Error('update-release-file-changed');
  const digest=prehash.digest();const signature=sign(digest,'ED',key,packet.subarray(2,10),timestamp);verifyMinisign(digest,signature,publicKey,true);
  platforms[artifact.target]={url:artifact.url,size,sha256:sha.digest('hex'),signature};
 }
 if(!options.allowPartial&&RELEASE_TARGETS.some(target=>!seen.has(target)))throw Error('update-release-matrix-incomplete');
 const manifest={schemaVersion:1,product:spec.product,channel:'stable',version:spec.version,publishedAt:spec.publishedAt,notes:typeof spec.notes==='string'?spec.notes:'',platforms};
 const payload=Buffer.from(JSON.stringify(manifest));const envelope={schemaVersion:1,keyId,payload:payload.toString('base64'),signature:sign(payload,'Ed',key,packet.subarray(2,10),timestamp)};
 verifyManifest(envelope,{schemaVersion:1,github:{repo:''},gitee:{repo:''},geoUrl:'',trustedKeys:{[keyId]:publicKey}});
 return {envelope,manifest,completeMatrix:seen.size===RELEASE_TARGETS.length};
}
async function main(){
 const args=process.argv.slice(2);const opts={};
 for(let i=0;i<args.length;i++){
  if(args[i]==='--allow-partial'){opts.allowPartial=true;continue;}
  if(!['--spec','--private-key','--public-key','--key-id','--out'].includes(args[i])||!args[i+1]||args[i+1].startsWith('--'))throw Error('update-release-arguments-invalid');opts[args[i].slice(2)]=args[++i];
 }
 for(const name of ['spec','private-key','public-key','key-id','out'])if(!opts[name])throw Error('update-release-arguments-invalid');
 const spec=JSON.parse(await fs.readFile(path.resolve(opts.spec),'utf8'));const publicKey=await fs.readFile(path.resolve(opts['public-key']),'utf8');const privateKey=await fs.readFile(path.resolve(opts['private-key']),'utf8');
 const result=await createUpdateManifest({spec,publicKey,privateKey,keyId:opts['key-id'],allowPartial:opts.allowPartial===true});
 await fs.writeFile(path.resolve(opts.out),JSON.stringify(result.envelope,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({version:result.manifest.version,targets:Object.keys(result.manifest.platforms),completeMatrix:result.completeMatrix}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))void main().catch(error=>{console.error(/^update-[a-z-]+$/.test(error.message)?error.message:'update-release-generation-failed');process.exitCode=1;});