'use strict';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat, readdir, readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const shapes={windows:[['nsis','.exe','-Setup']],linux:[['deb','.deb',''],['appimage','.AppImage',''],['rpm','.rpm','']]};
async function sha256(file){const hash=createHash('sha256');for await(const bytes of createReadStream(file))hash.update(bytes);return hash.digest('hex');}
export async function nameLiteInstallers({bundleRoot,version,platform,arch}){
  const architecture=arch==='x64'?'x86_64':arch==='arm64'?'aarch64':'';
  if(!architecture||!Object.hasOwn(shapes,platform)||typeof bundleRoot!=='string'||!path.isAbsolute(bundleRoot)||typeof version!=='string'||!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version))throw Error('invalid Lite artifact options');
  const plans=[];
  for(const [directory,extension,suffix] of shapes[platform]){
    const root=path.join(bundleRoot,directory);const stat=await lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('installer directory must be a plain directory');
    const entries=(await readdir(root)).filter(name=>name.toLowerCase().endsWith(extension.toLowerCase()));
    if(entries.length!==1)throw Error('expected exactly one '+directory+' installer');
    const original=path.join(root,entries[0]);const source=await lstat(original);if(!source.isFile()||source.isSymbolicLink())throw Error('installer must be a plain file');
    const name='EAC-Lite-'+version+'-'+platform+'-'+architecture+suffix+extension;
    plans.push({original,file:path.join(root,name),name,sha256:await sha256(original)});
  }
  // Validate every target before renaming so a partial matrix cannot appear ready.
  for(const item of plans){if(item.original!==item.file){try{await lstat(item.file);}catch(error){if(error.code==='ENOENT')continue;throw error;}throw Error('Lite artifact destination already exists');}}
  for(const item of plans){if(item.original!==item.file)await rename(item.original,item.file);if(await sha256(item.file)!==item.sha256)throw Error('installer changed during naming');}
  const sums=plans.map(item=>item.sha256+'  '+path.relative(bundleRoot,item.file).split(path.sep).join('/')).join('\n')+'\n';
  await writeFile(path.join(bundleRoot,'SHA256SUMS-Lite.txt'),sums,{encoding:'utf8'});
  return plans.map(({name,file,sha256})=>({name,file,sha256}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const options={};for(const arg of process.argv.slice(2)){const match=/^--(platform|arch|bundle-root)=(.+)$/.exec(arg);if(!match||Object.hasOwn(options,match[1]))throw Error('invalid artifact naming argument');options[match[1]]=match[2];}
  const version=JSON.parse(await readFile(path.join(repository,'dsh-desktop/package.json'),'utf8')).version;
  const artifacts=await nameLiteInstallers({bundleRoot:options['bundle-root']?path.resolve(options['bundle-root']):path.join(repository,'tauri-shell/target/release/bundle'),platform:options.platform|| (process.platform==='win32'?'windows':process.platform),arch:options.arch||process.arch,version});
  for(const artifact of artifacts)console.log(artifact.name+' '+artifact.sha256);
}
