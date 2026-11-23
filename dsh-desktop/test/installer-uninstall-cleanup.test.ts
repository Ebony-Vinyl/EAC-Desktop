import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';

// 卸载期"删除应用数据"行为回归：
//   - 模板只清 $APPDATA/$LOCALAPPDATA\${BUNDLEID}，EAC 的真实用户数据在产品名目录下，
//     故 hooks 增加 NSIS_HOOK_POSTUNINSTALL 把官方语义补到产品数据根；
//   - 勾选（$DeleteAppDataCheckboxState = 1）才删；未勾选 / 静默卸载一律保留；
//   - 数据根内的 profiles\node_modules 是指向安装目录的 junction，RmDir /r 不得跟进
//     目标（canary 目录钉住这条，防卸载误删安装树之外的用户文件）。

const makensis=process.env.EAC_TEST_MAKENSIS||path.join(os.homedir(),'AppData/Local/tauri/nsis-3.11/makensis.exe');
const hooks=path.resolve(import.meta.dirname,'../../tauri-shell/installer-hooks.nsh');
const unavailable=process.platform!=='win32'||!existsSync(makensis);

function execute(file:string,args:string[]):Promise<{code:number|null;output:string}>{
 return new Promise((resolve,reject)=>{
  const child=spawn(file,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  child.once('error',reject);child.once('exit',code=>resolve({code,output}));
 });
}

async function fixture(t:any,appDataState:0|1,assumeLastInstall=false){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eac-nsis-uninst-'));
 t.after(async()=>{const resolved=path.resolve(root);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('eac-nsis-uninst-'));await fs.rm(resolved,{recursive:true,force:true});});

 const installDir=path.join(root,'inst');
 const dataDir=path.join(root,'data 根','Deepseek Harness EAC');
 const roamingDir=path.join(root,'roaming 根','Deepseek Harness EAC');
 const canary=path.join(root,'canary');

 await fs.mkdir(path.join(dataDir,'profiles','node_modules'),{recursive:true});
 await fs.writeFile(path.join(dataDir,'marker.txt'),'user data');
 await fs.mkdir(roamingDir,{recursive:true});
 await fs.writeFile(path.join(roamingDir,'locale-state.json'),'{}');
 await fs.mkdir(canary,{recursive:true});
 await fs.writeFile(path.join(canary,'canary.txt'),'do not delete');
 await fs.symlink(canary,path.join(dataDir,'profiles','node_modules','canary-link'),'junction');

 const script=path.join(root,'fixture.nsi');
 // NSIS 主脚本必须带 UTF-8 BOM：夹具路径含中文（data 根），无 BOM 会按 ANSI 解码成乱码。
 await fs.writeFile(script,'\ufeff'+`Unicode true
RequestExecutionLevel user
Name "EAC uninstall cleanup fixture"
OutFile "${path.join(root,'fixture.exe')}"
InstallDir "${installDir}"
!define ARCH "x64"
!define VERSION "6.1.0"
!define MAINBINARYNAME "dsh-eac-shell"
!define ESTIMATEDSIZE "1"
!define UNINSTKEY "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\EACUninstallFixture"
${assumeLastInstall ? '!define DSH_ASSUME_LAST_INSTALL' : '; 未声明：走真实"其它安装"扫描'}
!define DSH_PRODUCT_DATA_DIR "${dataDir}"
!define DSH_PRODUCT_ROAMING_DIR "${roamingDir}"
!include MUI2.nsh
!include FileFunc.nsh
!include x64.nsh
!include WordFunc.nsh
Var UpdateMode
Var DeleteAppDataCheckboxState
!include "${hooks}"
Section Install
  SetOutPath "$INSTDIR"
  FileOpen $0 "$INSTDIR\\app.txt" w
  FileWrite $0 "app"
  FileClose $0
  WriteUninstaller "$INSTDIR\\uninstall.exe"
SectionEnd
Section Uninstall
  RMDir /r "$INSTDIR"
  !ifmacrodef NSIS_HOOK_POSTUNINSTALL
    !insertmacro NSIS_HOOK_POSTUNINSTALL
  !endif
SectionEnd
Function .onInit
  StrCpy $UpdateMode 1
FunctionEnd
Function un.onInit
  StrCpy $DeleteAppDataCheckboxState ${appDataState}
FunctionEnd
`);

 const built=await execute(makensis,['/V2',script]);
 assert.equal(built.code,0,built.output);
 const installed=await execute(path.join(root,'fixture.exe'),['/S']);
 assert.equal(installed.code,0,installed.output);
 assert.ok(existsSync(path.join(installDir,'uninstall.exe')),'应生成卸载器');

 // 生产路径同样用 _?= 原地卸载（安装器的接管宏即如此调用）；不加则卸载器会把自己
 // 复制到 %TEMP% 后异步重启，spawn 提前返回导致断言读到中间态。
 const uninstalled=await execute(path.join(installDir,'uninstall.exe'),['/S','_?='+installDir]);
 assert.equal(uninstalled.code,0,uninstalled.output);
 return {root,installDir,dataDir,roamingDir,canary};
}

test('勾选"删除应用数据"时清理产品数据根，且不跟进其中指向外部的 junction',{skip:unavailable},async t=>{
 const f=await fixture(t,1,true);
 assert.equal(existsSync(f.dataDir),false,'产品数据根应被删除');
 assert.equal(existsSync(f.roamingDir),false,'Roaming 产品数据根应被删除');
 assert.equal(existsSync(path.join(f.canary,'canary.txt')),true,'junction 目标（安装树之外）不得被删除');
});

test('未勾选删除应用数据时保留产品数据根',{skip:unavailable},async t=>{
 const f=await fixture(t,0);
 assert.equal(existsSync(path.join(f.dataDir,'marker.txt')),true,'未勾选时不得删除用户数据');
 assert.equal(existsSync(path.join(f.canary,'canary.txt')),true);
});
