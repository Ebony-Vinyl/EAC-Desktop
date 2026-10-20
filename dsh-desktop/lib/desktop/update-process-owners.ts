import cp = require('node:child_process');
import fsp = require('node:fs/promises');
import path = require('node:path');
interface ProcessRow {pid:number;parentPid:number;}
export interface LinuxProcessStat extends ProcessRow {state:string;startTime:string;}
export function parseLinuxProcessStat(value:string):LinuxProcessStat {
  if(typeof value!=='string'||value.length>65536)throw new Error('update-process-owners-invalid');
  const start=/^([1-9][0-9]*) \(/.exec(value);const close=value.lastIndexOf(') ');
  if(!start||close<start[0].length)throw new Error('update-process-owners-invalid');
  const fields=value.slice(close+2).trim().split(/\s+/);const pid=Number(start[1]);const parentPid=Number(fields[1]);
  if(fields.length<20||!Number.isSafeInteger(pid)||!Number.isSafeInteger(parentPid)||parentPid<0||!/^\d+$/.test(fields[1]!)||!/^[RSDZTWtXxIKWP]$/.test(fields[0]!)||!/^\d+$/.test(fields[19]!))throw new Error('update-process-owners-invalid');
  return {pid,parentPid,state:fields[0]!,startTime:fields[19]!};
}
function validateRoots(roots:number[],excludeSubtree?:number):void {
  if(!roots.length||roots.some(pid=>!Number.isSafeInteger(pid)||pid<1)||(excludeSubtree!==undefined&&(!Number.isSafeInteger(excludeSubtree)||excludeSubtree<1)))throw new Error('update-process-owners-invalid');
}
function owners(rows:ProcessRow[],roots:number[],excludeSubtree?:number):number[] {
  const descendants=(initial:number[]):Set<number>=>{
    const found=new Set(initial);let changed=true;
    while(changed){changed=false;for(const row of rows){if(found.has(row.parentPid)&&!found.has(row.pid)){found.add(row.pid);changed=true;}}}return found;
  };
  const excluded=excludeSubtree===undefined?new Set<number>():descendants([excludeSubtree]);
  return [...descendants(roots)].filter(pid=>!excluded.has(pid)).sort((a,b)=>a-b);
}
export async function captureLinuxProcessOwners(roots:number[],excludeSubtree?:number,procRoot='/proc'):Promise<number[]> {
  validateRoots(roots,excludeSubtree);const rows:ProcessRow[]=[];
  const entries=await fsp.readdir(procRoot);if(entries.length>100000)throw new Error('update-process-owners-unavailable');
  for(const name of entries){
    if(!/^[1-9][0-9]*$/.test(name))continue;
    try {
      const value=parseLinuxProcessStat(await fsp.readFile(path.join(procRoot,name,'stat'),'utf8'));
      if(value.pid!==Number(name))throw new Error('update-process-owners-invalid');rows.push(value);
    }catch(error){
      const code=(error as NodeJS.ErrnoException).code;
      if(code==='ENOENT'||code==='ESRCH')continue;
      if((code==='EACCES'||code==='EPERM')&&!roots.includes(Number(name)))continue;
      throw new Error('update-process-owners-unavailable');
    }
  }
  return owners(rows,roots,excludeSubtree);
}
export async function captureProcessOwners(roots:number[],excludeSubtree?:number):Promise<number[]>{
  validateRoots(roots,excludeSubtree);
  if(process.platform==='linux')return captureLinuxProcessOwners(roots,excludeSubtree);
  if(process.platform!=='win32')throw new Error('update-process-platform-unsupported');
  const script="$ErrorActionPreference='Stop';@{processes=@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId)}|ConvertTo-Json -Depth 4 -Compress";
  const value=await new Promise<{processes?:Array<{ProcessId:number;ParentProcessId:number}>}>((resolve,reject)=>{
    cp.execFile('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,encoding:'utf8',timeout:10000,maxBuffer:4*1024*1024},(error,stdout)=>{
      if(error)return reject(new Error('update-process-owners-unavailable'));try{resolve(JSON.parse(stdout));}catch{reject(new Error('update-process-owners-invalid'));}
    });
  });
  if(!Array.isArray(value.processes)||value.processes.some(row=>!Number.isSafeInteger(row.ProcessId)||row.ProcessId<0||!Number.isSafeInteger(row.ParentProcessId)||row.ParentProcessId<0))throw new Error('update-process-owners-invalid');
  return owners(value.processes.map(row=>({pid:row.ProcessId,parentPid:row.ParentProcessId})),roots,excludeSubtree);
}
