import fs = require('node:fs');
import fsp = require('node:fs/promises');
import path = require('node:path');
import crypto = require('node:crypto');
import http = require('node:http');
import type {ChildProcess} from 'node:child_process';
import {hostIdentity, receiptMac} from './update-host';
import {plainPath, writeDurableJson} from './update-backup';
export interface HostPrepared {
  schemaVersion: 1; transactionId: string; nonce: string; kernelPid: number;
  identity: string; sessionCount: number; workspaceRoots: string[]; sessionDigest?: string | null; storedSessionCount?: number; durable: true; rootDisposed: true; shutdownConfirmed: true; exitMode: 'prepared';
}
export class UpdateHostControl {
  private token = '';
  private readonly identity: string;
  constructor(private readonly stateDir: string, home: string, profile: string) {this.identity = hostIdentity(home, profile);}
  runtime(): {overlays: string[]; env: NodeJS.ProcessEnv} {
    this.token = crypto.randomBytes(32).toString('hex');
    const runtimeDir = path.join(this.stateDir, 'runtime');
    fs.mkdirSync(runtimeDir, {recursive: true, mode: 0o700});
    const overlay = path.join(runtimeDir, 'update-host.patch.yml');
    const hostModule = path.join(__dirname, 'update-host.js');
    fs.writeFileSync(overlay, '- insert:\n    - id: eac-update-host-runtime\n      name: ' + JSON.stringify(hostModule) + '\n', {mode: 0o600});
    return {overlays: [overlay], env: {DSH_EAC_UPDATE_HEALTH_BOOT: process.env.DSH_EAC_UPDATE_HEALTH_TOKEN ? '1' : '', DSH_EAC_UPDATE_STATE: this.stateDir, DSH_EAC_UPDATE_TOKEN: this.token,
      // Native file watching can fail on the kernel's exclusive credential-lock file.
      // Polling preserves the same HMR checks; explicit operator choices still win.
      ...(process.platform === 'win32' && process.env.CHOKIDAR_USEPOLLING === undefined
        ? {CHOKIDAR_USEPOLLING: '1', CHOKIDAR_INTERVAL: process.env.CHOKIDAR_INTERVAL || '300'} : {}),
    }};
  }

  async health(kernel: ChildProcess | null): Promise<{sessionDigest:string;storedSessionCount:number;configReadable:true}> {
    const value=await this.requestHealth(kernel,'/health');
    if(value.configReadable!==true||typeof value.sessionDigest!=='string'||!/^[a-f0-9]{64}$/.test(value.sessionDigest)||!Number.isSafeInteger(value.storedSessionCount)||Number(value.storedSessionCount)<0)throw new Error('update-data-read-unconfirmed');
    return {sessionDigest:value.sessionDigest,storedSessionCount:Number(value.storedSessionCount),configReadable:true};
  }
  async releaseHealth(kernel: ChildProcess | null): Promise<void> {
    const value=await this.requestHealth(kernel,'/release-health');if(value.released!==true)throw new Error('update-health-release-unconfirmed');
  }
  private async requestHealth(kernel: ChildProcess | null, route: string): Promise<Record<string,unknown>> {
    if(!kernel?.pid || kernel.exitCode!==null || !this.token)throw new Error('update-host-unavailable');
    await plainPath(path.join(this.stateDir,'host-control.json'));
    const descriptor=JSON.parse(await fsp.readFile(path.join(this.stateDir,'host-control.json'),'utf8')) as {pid:number;identity:string;port:number};
    if(descriptor.pid!==kernel.pid||descriptor.identity!==this.identity||!Number.isInteger(descriptor.port)||descriptor.port<1||descriptor.port>65535)throw new Error('update-host-identity-mismatch');
    const value=await new Promise<Record<string,unknown>>((resolve,reject)=>{
      const request=http.request({hostname:'127.0.0.1',port:descriptor.port,path:route,method:'POST',headers:{'x-eac-update-token':this.token},timeout:15000},response=>{
        let text='';response.on('data',(chunk:Buffer)=>{text+=chunk.toString('utf8');if(text.length>4096)request.destroy(new Error('update-host-response-too-large'));});
        response.once('error',reject);response.once('end',()=>{try{const result=JSON.parse(text);if(response.statusCode!==200)reject(new Error(result.error||'update-data-read-unconfirmed'));else resolve(result);}catch{reject(new Error('update-host-invalid-response'));}});
      });request.once('error',reject);request.once('timeout',()=>request.destroy(new Error('update-host-health-timeout')));request.end();
    });
    if(value.identity!==this.identity||value.kernelPid!==kernel.pid)throw new Error('update-host-identity-mismatch');return value;
  }
  async prepare(kernel: ChildProcess | null, transactionId: string, signal: AbortSignal,
    waitForExit: (kernel: ChildProcess, timeoutMs: number) => Promise<boolean>): Promise<HostPrepared> {
    if (!kernel?.pid || !this.token) throw new Error('update-save-confirmation-unavailable');
    signal.throwIfAborted();
    const descriptorPath = path.join(this.stateDir, 'host-control.json');
    let descriptor: {pid?: number; port?: number; identity?: string};
    try {await plainPath(descriptorPath); descriptor = JSON.parse(await fsp.readFile(descriptorPath, 'utf8'));} catch {throw new Error('update-save-confirmation-unavailable');}
    if (descriptor.pid !== kernel.pid || descriptor.identity !== this.identity
      || !Number.isInteger(descriptor.port) || descriptor.port! < 1 || descriptor.port! > 65535) throw new Error('update-host-identity-mismatch');
    const nonce = crypto.randomBytes(32).toString('hex');
    const body = JSON.stringify({transactionId, nonce, identity: this.identity});
    const accepted = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = http.request({hostname: '127.0.0.1', port: descriptor.port!, path: '/prepare', method: 'POST',
        headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'x-eac-update-token': this.token},
        timeout: 15000, signal}, response => {
        let text = ''; response.on('data', (chunk: Buffer) => {
          text += chunk.toString('utf8'); if (text.length > 4096) request.destroy(new Error('update-host-response-too-large'));
        });
        response.once('error', reject);
        response.on('end', () => {
          try {const value = JSON.parse(text) as Record<string, unknown>;
            if (response.statusCode !== 200) reject(new Error(typeof value.error === 'string' ? value.error : 'update-host-preparation-failed'));
            else resolve(value);
          } catch {reject(new Error('update-host-invalid-response'));}
        });
      });
      request.once('timeout', () => request.destroy(new Error('update-host-preparation-timeout')));
      request.once('error', reject); request.end(body);
    });
    if (accepted.accepted !== true || accepted.kernelPid !== kernel.pid) throw new Error('update-host-preparation-unconfirmed');
    // No kill, signal or escalation: a still-live kernel cannot authorize installation.
    if (!await waitForExit(kernel, 15000)) throw new Error('update-kernel-exit-unconfirmed');
    if (kernel.exitCode !== 0 || kernel.signalCode !== null) throw new Error('update-kernel-exit-failed');
    signal.throwIfAborted();
    const receiptFile = path.join(this.stateDir, 'transactions', transactionId, 'host-prepared.json');
    let receipt: {payload?: HostPrepared; mac?: string};
    try {await plainPath(receiptFile); receipt = JSON.parse(await fsp.readFile(receiptFile, 'utf8'));}
    catch {throw new Error('update-shutdown-unconfirmed');}
    const payload = receipt.payload;
    if (!payload || payload.schemaVersion !== 1 || payload.transactionId !== transactionId || payload.nonce !== nonce
      || payload.kernelPid !== kernel.pid || payload.identity !== this.identity || payload.durable !== true || payload.rootDisposed !== true || payload.shutdownConfirmed !== true || payload.exitMode !== 'prepared'
      || !Array.isArray(payload.workspaceRoots) || payload.workspaceRoots.some(root => typeof root !== 'string' || !path.isAbsolute(root))
      || !Number.isSafeInteger(payload.sessionCount) || payload.sessionCount < 0 || typeof receipt.mac !== 'string') throw new Error('update-host-receipt-invalid');
    const expected = receiptMac(payload, this.token);
    if (receipt.mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(receipt.mac), Buffer.from(expected))) throw new Error('update-host-receipt-invalid');
    await writeDurableJson(path.join(this.stateDir, 'transactions', transactionId, 'save-confirmation.json'), payload);
    return payload;
  }
}
