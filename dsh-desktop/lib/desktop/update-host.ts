import http = require('node:http');
import fs = require('node:fs');
import path = require('node:path');
import crypto = require('node:crypto');
export const name = 'eac-update-host';
export const inject = ['sessions', 'sessionPersistence', 'agents', 'loader', 'hmr', 'appExit', 'appReady'];
interface Agent {
  status: string;
  runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>;
}
interface LoaderTree {await(): Promise<void>; flushWrite?(): Promise<void>; entries(): Iterable<{subtree?: LoaderTree}>;}
export interface HostContext {
  agents: {list(): Agent[]};
  sessions: {list(): unknown[]; flush(session: unknown): Promise<boolean>};
  sessionPersistence: {list(): Promise<ReadonlyArray<{header: {id?: string; cwd?: string}}>>; open?(id: string, access: 'read'): Promise<{header: unknown; inheritedEventCount: number; read(offset: number, length: number): Promise<{events: readonly unknown[]}>; close(): Promise<void>}>};
  loader: LoaderTree;
  hmr: {runExclusive<T>(operation: () => Promise<T>): Promise<T>};
  appExit(code: number): void;
  appReady: {onReady(callback: () => void): () => void};
  on(event: string, listener: (...args: unknown[]) => unknown): () => void;
  effect(factory: () => () => Promise<void>): unknown;
  logger: {warn(message: string): void};
  root: {fiber: {dispose(): Promise<void>}};
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function hostIdentity(home: string, profile: string): string {
  return crypto.createHash('sha256').update(home + '\0' + profile).digest('hex');
}
export function receiptMac(payload: unknown, token: string): string {
  return crypto.createHmac('sha256', token).update(JSON.stringify(payload)).digest('hex');
}
function writeReceipt(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
  const temporary = file + '.tmp-' + crypto.randomUUID();
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try {fs.writeFileSync(fd, JSON.stringify(value) + '\n'); fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
  fs.renameSync(temporary, file);
}
export function apply(ctx: HostContext): void {
  const stateDir = process.env.DSH_EAC_UPDATE_STATE;
  const token = process.env.DSH_EAC_UPDATE_TOKEN;
  if (!stateDir || !path.isAbsolute(stateDir) || !token || !/^[a-f0-9]{64}$/.test(token)) return;
  const controlFile = path.join(stateDir, 'host-control.json');
  const identity = hostIdentity(process.env.DSH_HOME || '', process.env.DSH_DESKTOP_PROFILE || '');
  const healthBoot = process.env.DSH_EAC_UPDATE_HEALTH_BOOT === '1';
  let frozen = healthBoot; let healthHeld = false; let ready = false; let closing = false;
  let pending: {transactionId: string; nonce: string; sessionCount: number; workspaceRoots: string[]; sessionDigest: string | null; storedSessionCount: number} | null = null;
  const rootFiber = ctx.root.fiber;
  const requestAppExit = ctx.appExit;
  const heldAgents: Array<() => void> = [];
  const rejectNewAgent = ctx.on('agent/created', () => {if (frozen) throw new Error('update-preparing');});
  const releaseAgents = (): void => {for (const release of heldAgents.splice(0)) release();};

  const reserveAgents = (): void => {
    const agents=ctx.agents.list();
    if(agents.some(agent=>agent.status!=='idle'))throw new Error('update-tasks-busy');
    for(const agent of agents){
      let release!:()=>void;const hold=new Promise<void>(resolve=>release=resolve);
      const maintenance=agent.runMaintenance(async signal=>{if(signal.aborted)return;signal.addEventListener('abort',release,{once:true});await hold;signal.removeEventListener('abort',release);});
      heldAgents.push(release);void maintenance.catch(()=>{});
    }
  };
  const reply = (response: http.ServerResponse, status: number, value: unknown): Promise<void> => new Promise((resolve, reject) => {
    response.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Connection': 'close'});
    response.once('error', reject); response.end(JSON.stringify(value), () => resolve());
  });
  const server = http.createServer((request, response) => {void (async () => {
    const supplied = String(request.headers['x-eac-update-token'] || '');
    if (request.headers.origin || !/^[a-f0-9]{64}$/.test(supplied) || supplied.length !== token.length
      || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) {await reply(response, 403, {error: 'update-control-denied'}); return;}
    if(request.method==='POST' && request.url==='/health'){
      if(!ready||closing||pending)throw new Error('update-host-busy');
      let observation!:PersistenceObservation;
      await ctx.hmr.runExclusive(async()=>{
        if(!healthHeld){frozen=true;try{reserveAgents();healthHeld=true;}catch(error){frozen=false;releaseAgents();throw error;}}
        await ctx.loader.await();observation=await observePersistence(ctx,true);
      });
      await reply(response,200,{schemaVersion:1,identity,kernelPid:process.pid,configReadable:true,...observation});return;
    }
    if(request.method==='POST' && request.url==='/release-health'){
      if(pending||closing)throw new Error('update-host-busy');
      await ctx.hmr.runExclusive(async()=>{healthHeld=false;frozen=false;releaseAgents();});
      await reply(response,200,{released:true,kernelPid:process.pid,identity});return;
    }
    if (request.method !== 'POST' || request.url !== '/prepare') {await reply(response, 404, {error: 'update-control-method'}); return;}
    if (!ready || closing || (frozen && !healthHeld && !healthBoot)) {await reply(response, 409, {error: 'update-host-busy'}); return;}
    let body = ''; for await (const chunk of request) {body += String(chunk); if (body.length > 4096) throw new Error('update-control-body');}
    const params = JSON.parse(body) as {transactionId?: string; nonce?: string; identity?: string};
    if (!params.transactionId || !UUID.test(params.transactionId) || !params.nonce || !/^[a-f0-9]{64}$/.test(params.nonce)
      || params.identity !== identity) throw new Error('update-control-identity');
    let disposal: Promise<void> | null = null;
    let disconnected = false;
    response.once('close', () => {
      if (!response.writableFinished) {disconnected = true; frozen = false; releaseAgents();}
    });
    await ctx.hmr.runExclusive(async () => {
      if (disconnected || response.destroyed) throw new Error('update-cancelled');
      frozen = true;
      try {
        if (!healthHeld) reserveAgents();
        healthHeld=false;
        const sessions = ctx.sessions.list();
        for (const session of sessions) if (!await ctx.sessions.flush(session)) throw new Error('update-session-flush-unconfirmed');
        await ctx.loader.await();
        const trees = new Set<LoaderTree>([ctx.loader]);
        for (const entry of ctx.loader.entries()) if (entry.subtree) trees.add(entry.subtree);
        for (const tree of trees) if (tree.flushWrite) await tree.flushWrite();
        if (closing) throw new Error('update-host-closing');
        if (disconnected || response.destroyed) throw new Error('update-cancelled');
        const snapshots = await ctx.sessionPersistence.list();
        if (snapshots.some(record => record.header.cwd !== undefined && (!record.header.cwd || !path.isAbsolute(record.header.cwd)))) throw new Error('update-workspace-root-unidentified');
        const workspaceRoots = [...new Set(snapshots.map(record => record.header.cwd)
          .filter((cwd): cwd is string => typeof cwd === 'string'))].sort();
        const observation = await observePersistence(ctx,false);
        pending = {transactionId: params.transactionId!, nonce: params.nonce!, sessionCount: sessions.length, workspaceRoots, sessionDigest: observation.sessionDigest, storedSessionCount: observation.storedSessionCount};
        await reply(response, 200, {accepted: true, kernelPid: process.pid});
        // Withdraw root admission synchronously while still holding HMR. Release
        // this transaction before awaiting teardown so neither side waits on itself.
        disposal = rootFiber.dispose();
      } catch (error) {
        pending = null; frozen = false; releaseAgents(); throw error;
      }
    });
    if (!disposal || !pending) throw new Error('update-root-disposal-unconfirmed');
    await disposal;
    const completed = pending as {transactionId: string; nonce: string; sessionCount: number; workspaceRoots: string[]; sessionDigest: string | null; storedSessionCount: number};
    const payload = {schemaVersion: 1, transactionId: completed.transactionId, nonce: completed.nonce,
      kernelPid: process.pid, identity, sessionCount: completed.sessionCount, workspaceRoots: completed.workspaceRoots, sessionDigest: completed.sessionDigest, storedSessionCount: completed.storedSessionCount, durable: true,
      rootDisposed: true, shutdownConfirmed: true, exitMode: 'prepared'};
    writeReceipt(path.join(stateDir, 'transactions', completed.transactionId, 'host-prepared.json'),
      {payload, mac: receiptMac(payload, token)});
    requestAppExit(0);
    await new Promise<void>(resolve => process.stdout.write('', () => resolve()));
    await new Promise<void>(resolve => process.stderr.write('', () => resolve()));
    // This is the process's normal exit after the awaited durability boundary;
    // no parent-process signal or timeout can manufacture the receipt above.
    process.exit(0);
  })().catch(async error => {
    const code = error instanceof Error && /^update-[a-z-]+$/.test(error.message) ? error.message : 'update-host-preparation-failed';
    if (response.headersSent) {try {ctx.logger.warn(code);} catch { /* The root logger may already be disposed. */ }}
    if (!response.headersSent && !response.destroyed) {
      const code = error instanceof Error && /^update-[a-z-]+$/.test(error.message) ? error.message : 'update-host-preparation-failed';
      await reply(response, 409, {error: code}).catch(() => {});
    }
  });});
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  server.on('error', () => ctx.logger.warn('update-host-control-unavailable'));
  const publish = (): void => {
    const address = server.address();
    if (ready && !closing && address && typeof address !== 'string') {
      writeReceipt(controlFile, {schemaVersion: 1, pid: process.pid, port: address.port, identity});
    }
  };
  const cancelReady = ctx.appReady.onReady(() => {ready = true; publish();});
  server.listen(0, '127.0.0.1', publish);
  ctx.effect(() => async () => {
    writeReceipt(path.join(stateDir, 'host-shutdown-trace.json'), {schemaVersion: 1, kernelPid: process.pid, pending: !!pending});
    closing = true; cancelReady(); rejectNewAgent(); releaseAgents();
    server.closeIdleConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    try {const value = JSON.parse(fs.readFileSync(controlFile, 'utf8')); if (value.pid === process.pid) fs.unlinkSync(controlFile);} catch { /* Another generation may own the descriptor. */ }
  });
}

interface PersistenceObservation {sessionDigest: string | null; storedSessionCount: number;}
function canonical(value: unknown): string {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}';
  return JSON.stringify(value)??'null';
}
async function observePersistence(ctx: HostContext, required: boolean): Promise<PersistenceObservation> {
  const records=await ctx.sessionPersistence.list();
  if(records.length && (!ctx.sessionPersistence.open || records.some(record=>typeof record.header.id!=='string'))){
    if(required)throw new Error('update-session-read-unavailable');return {sessionDigest:null,storedSessionCount:records.length};
  }
  const hash=crypto.createHash('sha256');
  for(const record of [...records].sort((a,b)=>a.header.id!.localeCompare(b.header.id!))){
    const handle=await ctx.sessionPersistence.open!(record.header.id!,'read');
    try {
      hash.update(canonical(handle.header)+'\0'+String(handle.inheritedEventCount)+'\0');let offset=0;
      for(;;){const slice=await handle.read(offset,1000);if(!slice.events.length)break;for(const event of slice.events)hash.update(canonical(event)+'\0');offset+=slice.events.length;}
    } finally {await handle.close();}
  }
  return {sessionDigest:hash.digest('hex'),storedSessionCount:records.length};
}
