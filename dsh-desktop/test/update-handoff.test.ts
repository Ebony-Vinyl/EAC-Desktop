import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {auditHandoff} from '../scripts/verify-update-handoff.mjs';
const hash=(bytes:any)=>crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(t:any){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'eac-handoff-closure-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const write=(name:string,text:string)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);return {path:name,sha256:hash(text),lfSha256:hash(text.replace(/\r\n/g,'\n'))};};
 const main=write('tauri-shell/src/main.rs','const PAGE:&str=include_str!("client-update.html");\n');
 return {root,write,main};
}
test('handoff refuses an omitted Rust include even when all selected file hashes match',t=>{
 const f=fixture(t);const changedFiles=['tauri-shell/src/main.rs','tauri-shell/src/client-update.html'];
 const missing=auditHandoff({root:f.root,manifest:{files:[f.main]},changedFiles});assert.equal(missing.pass,false);assert.ok(missing.errors.some((x:any)=>x.error==='rust-include-missing'));
 const page=f.write(changedFiles[1],'<h1>客户端更新</h1>');const omitted=auditHandoff({root:f.root,manifest:{files:[f.main]},changedFiles});assert.equal(omitted.pass,false);assert.ok(omitted.errors.some((x:any)=>x.error==='changed-source-not-in-manifest'));
 assert.equal(auditHandoff({root:f.root,manifest:{files:[f.main,page]},changedFiles}).pass,true);
});
test('handoff checks changed build sources and permits only recorded LF conversion',t=>{
 const f=fixture(t),page=f.write('tauri-shell/src/client-update.html','<p>update</p>\r\n'),build=f.write('tauri-shell/stage-resources.mjs','// stage\n');const manifest={files:[f.main,page,build]};
 fs.writeFileSync(path.join(f.root,page.path),'<p>update</p>\n');assert.equal(auditHandoff({root:f.root,manifest}).pass,true);
 assert.equal(auditHandoff({root:f.root,manifest:{files:[f.main,page]},changedFiles:[build.path]}).pass,false);
 fs.writeFileSync(path.join(f.root,page.path),'<p>changed</p>\n');assert.ok(auditHandoff({root:f.root,manifest}).errors.some((x:any)=>x.error==='source-digest-mismatch'));
});
