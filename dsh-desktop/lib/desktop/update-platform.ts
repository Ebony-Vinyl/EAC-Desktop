import fs = require('node:fs');
import path = require('node:path');
import cp = require('node:child_process');
import {parseLinuxIdentity} from './update-linux';
import type { InstallKind } from './update-sources';
export function updateTarget(exe: string | undefined, platform = process.platform, arch = process.arch,
  env: NodeJS.ProcessEnv = process.env): string {
  if (!exe || !path.isAbsolute(exe)) return 'development';
  const architecture = arch === 'x64' ? 'x86_64' : arch === 'arm64' ? 'aarch64' : '';
  if (!architecture) return 'unsupported';
  let kind: InstallKind | undefined;
  if (platform === 'win32') {
    if (fs.existsSync(path.join(path.dirname(exe), '.dsh-portable'))) kind = 'portable';
    else {
      try {
        const identity = JSON.parse(fs.readFileSync(path.join(path.dirname(exe), 'eac-installation.json'), 'utf8'));
        if (identity.schemaVersion === 1 && identity.product === 'eac-desktop' && identity.installKind === 'nsis') kind = 'nsis';
      } catch { /* Unidentified trees cannot authorize native installation. */ }
    }
  } else if (platform === 'linux') {
    if (env.APPIMAGE && path.isAbsolute(env.APPIMAGE)) kind = 'appimage';
    else {
      const query = (command: string, args: string[]): string | null => {
        try { const result=cp.spawnSync(command,args,{timeout:3000,encoding:'utf8',stdio:['ignore','pipe','ignore'],env:{...env,LC_ALL:'C',LANG:'C'}});return result.status===0?result.stdout:null; }
        catch { return null; }
      };
      const owner=query('/usr/bin/dpkg-query',['--search','--',exe]);
      const expectedArch=arch==='x64'?'amd64':'arm64';
      if(owner && (owner.trim()==='deepseek-harness-eac: '+exe || owner.trim()==='deepseek-harness-eac:'+expectedArch+': '+exe)){
        const value=query('/usr/bin/dpkg-query',['--show','--showformat=${Package}\t${Version}\t${Architecture}\t${db:Status-Status}\n','--','deepseek-harness-eac']);
        try { if(value&&parseLinuxIdentity(value,'deb',true).arch===expectedArch)kind='deb'; } catch { /* An invalid owner cannot authorize installation. */ }
      }
      if(!kind){
        const value=query('/usr/bin/rpm',['--query','--file','--queryformat','%{NAME}\t%{VERSION}\t%{RELEASE}\t%{ARCH}\n','--',exe]);
        try { if(value&&parseLinuxIdentity(value,'rpm',true).arch===architecture)kind='rpm'; } catch { /* Foreign package ownership is unsupported. */ }
      }
    }
  }
  return kind ? (platform === 'win32' ? 'windows' : 'linux') + '-' + architecture + '-' + kind : 'unsupported';
}
