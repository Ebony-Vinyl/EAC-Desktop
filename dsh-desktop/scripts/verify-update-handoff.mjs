import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const sourcePath=name=>/^(dsh-desktop|tauri-shell|\.github\/workflows)\//.test(name)&&/\.(?:[cm]?js|ts|rs|html|nsh|json|toml|lock|ps1|ya?ml)$|\/\.gitignore$/.test(name);
export function auditHandoff({root,manifest,changedFiles=[]}){
  const errors=[];const covered=new Set();
  const safe=name=>typeof name==='string'&&name.length>0&&!name.includes('\\')&&!path.posix.isAbsolute(name)&&!name.split('/').includes('..');
  for(const entry of manifest.files){
    if(!safe(entry.path)||covered.has(entry.path)){errors.push({path:entry.path,error:'invalid-or-duplicate-path'});continue;}
    covered.add(entry.path);let bytes;
    try{bytes=fs.readFileSync(path.join(root,entry.path));}catch{errors.push({path:entry.path,error:'source-missing'});continue;}
    const lf=Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n'));
    if(digest(bytes)!==entry.sha256&&digest(lf)!==entry.lfSha256)errors.push({path:entry.path,error:'source-digest-mismatch'});
    if(!entry.path.endsWith('.rs'))continue;
    for(const match of bytes.toString('utf8').matchAll(/\binclude_(?:str|bytes)!\s*\(\s*"([^"\r\n]+)"/g)){
      const dependency=path.posix.normalize(path.posix.join(path.posix.dirname(entry.path),match[1]));
      if(!safe(dependency)||!fs.existsSync(path.join(root,dependency)))errors.push({path:dependency,error:'rust-include-missing',referencedBy:entry.path});
      else if(changedFiles.includes(dependency)&&!manifest.files.some(item=>item.path===dependency))errors.push({path:dependency,error:'rust-include-not-in-manifest',referencedBy:entry.path});
    }
  }
  for(const name of new Set(changedFiles.filter(sourcePath)))if(!covered.has(name))errors.push({path:name,error:'changed-source-not-in-manifest'});
  return {schemaVersion:1,pass:errors.length===0,sourceFiles:covered.size,changedSourceFiles:new Set(changedFiles.filter(sourcePath)).size,errors};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
    if(process.argv.length!==3)throw Error('Usage: node dsh-desktop/scripts/verify-update-handoff.mjs <effective-source-manifest.json>');
    const manifest=JSON.parse(fs.readFileSync(path.resolve(root,process.argv[2]),'utf8'));
    const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
    if(git(['rev-parse','HEAD'])!==manifest.gitHead)throw Error('handoff-head-mismatch');
    const paths=[...git(['diff','--name-only','--diff-filter=ACMRD','HEAD','--']).split('\n'),...git(['ls-files','--others','--exclude-standard']).split('\n')].filter(Boolean);
    const result=auditHandoff({root,manifest,changedFiles:paths});console.log(JSON.stringify(result,null,2));process.exitCode=result.pass?0:2;
  }catch(error){console.error(error.message);process.exitCode=2;}
}
