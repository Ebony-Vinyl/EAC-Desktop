import crypto = require('node:crypto');
import fs = require('node:fs');
import fsp = require('node:fs/promises');
import path = require('node:path');
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { writeJsonAtomic, readJsonFile } from '../atomic-json';
import { autoSelect, effectiveSource, initialSelection, localFile, parseSelection,
  readRemoteJson, resolveUpdate, fetchUpdate } from './update-sources';
import type { ReadRemote, ResolvedUpdate, SourceSelection, UpdateDefaults } from './update-sources';
import { verifyPackage } from './update-signature';

export interface DataBinding {
  environmentRoot: string;
  dshHome: string;
  profile: string;
  channel: string;
  registryHome: string;
  userDataDir: string;
  webPort: number;
  webviewRoot: string;
  configRoot: string;
  guestRoot: string;
}
export interface InstallHandoff {commit(): Promise<void>; cancel(): Promise<void>;}
export interface UpdateContext {
  stateDir: string;
  defaults: UpdateDefaults;
  currentVersion: string;
  target: string;
  binding(): DataBinding;
  notify(presentation: Presentation): void;
  readRemote?: ReadRemote;
  prepare?(transactionId: string, signal: AbortSignal, plan: UpdatePlan, progress: (message: string) => void): Promise<InstallHandoff | void>;
}
export interface Presentation {
  phase: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'installing' | 'error';
  version?: string;
  progress?: number;
  cancellable?: boolean;
  message?: string;
}
export interface UpdatePlan {
  schemaVersion: 1;
  transactionId: string;
  update: ResolvedUpdate;
  binding: DataBinding;
  packageFile: string;
  prepared: boolean;
}
export class ClientUpdate {
  private selection: SourceSelection;
  private presentation: Presentation = {phase: 'idle'};
  private plan: UpdatePlan | null = null;
  private operation: AbortController | null = null;
  private task: Promise<unknown> | null = null;
  private settingsInvalid = false;
  private readonly settingsFile: string;
  private readonly stateFile: string;
  constructor(private readonly ctx: UpdateContext) {
    this.settingsFile = path.join(ctx.stateDir, 'update-settings.json');
    this.stateFile = path.join(ctx.stateDir, 'update-state.json');
    fs.mkdirSync(ctx.stateDir, {recursive: true, mode: 0o700});
    const settingsExisted = fs.existsSync(this.settingsFile);
    const saved = readJsonFile(this.settingsFile);
    // Invalid persisted configuration fails visibly; it must never erase manual choices.
    try { if (settingsExisted && !saved) throw new Error('update-invalid-source-settings');
      this.selection = saved ? parseSelection(saved) : initialSelection(); }
    catch { this.selection = initialSelection(); this.settingsInvalid = true;
      this.presentation = {phase: 'error', message: 'update-invalid-source-settings'}; }
    if (!settingsExisted) writeJsonAtomic(this.settingsFile, this.selection);
    const previous = readJsonFile(this.stateFile);
    if (!this.settingsInvalid && previous && previous.phase !== 'idle') {
      this.presentation = {phase: 'error', message: '上次更新未完成，请重新检查；恢复材料已保留'};
    } else if (!this.settingsInvalid && previous?.schemaVersion===1 && previous.phase==='idle'
      && previous.version===this.ctx.currentVersion && typeof previous.completedTransactionId==='string'
      && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(previous.completedTransactionId)) {
      this.presentation = {phase:'idle',version:this.ctx.currentVersion,message:'已更新到 '+this.ctx.currentVersion};
    }
  }
  completeRestart(transactionId: string, version: string): void {
    const saved=readJsonFile(this.stateFile);
    if(this.settingsInvalid||this.task||this.operation||version!==this.ctx.currentVersion)throw new Error('update-completion-identity-mismatch');
    if(saved?.phase==='idle'&&saved.completedTransactionId===transactionId&&saved.version===version)return;
    if(saved?.transactionId!==transactionId||saved.version!==version)throw new Error('update-completion-identity-mismatch');
    this.plan=null;
    this.publish({phase:'idle',version,message:'已更新到 '+version},transactionId);
  }
  status(): Presentation { return {...this.presentation}; }
  settings(): Record<string, unknown> {
    let effective: {id: string; notice: string};
    try { effective = effectiveSource(this.selection, this.ctx.defaults); }
    catch (error) { effective = {id: this.selection.preferredSourceId, notice: (error as Error).message}; }
    return {selection: {...this.selection}, releaseChannel: 'stable', availableChannels: ['stable'],
      effectiveSourceId: this.plan?.update.sourceId || effective.id, notice: this.plan?.update.notice || effective.notice, giteeConfigured: !!this.ctx.defaults.gitee.repo,
      signingConfigured: Object.keys(this.ctx.defaults.trustedKeys).length > 0, currentVersion: this.ctx.currentVersion,
      target: this.ctx.target, presentation: this.status()};
  }
  private publish(presentation: Presentation, completedTransactionId?: string): void {
    this.presentation = presentation;
    writeJsonAtomic(this.stateFile, {schemaVersion: 1, ...presentation, ...(completedTransactionId ? {completedTransactionId} : {}),
      transactionId: this.plan?.transactionId || null, updatedAt: new Date().toISOString()});
    this.ctx.notify(this.status());
  }
  private async run<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.plan?.prepared) throw new Error('update-installation-in-progress');
    if (this.task) throw new Error('update-busy');
    const operation = new AbortController(); this.operation = operation;
    const task = Promise.resolve().then(() => fn(operation.signal)); this.task = task;
    try { return await task; }
    catch (error) {
      this.publish({phase: operation.signal.aborted ? 'idle' : 'error',
        message: operation.signal.aborted ? '本次更新已取消' : safeUpdateError(error)});
      throw new Error(operation.signal.aborted ? 'update-cancelled' : safeUpdateError(error));
    } finally { if (this.operation === operation) this.operation = null; if (this.task === task) this.task = null; }
  }
  async cancel(message = '本次更新已取消'): Promise<void> {
    if (this.plan?.prepared) return;
    // Normal shutdown also calls cancel. An idle controller has no work to cancel
    // and must preserve its authenticated completion record.
    if (!this.plan && !this.task && !this.operation && this.presentation.phase==='idle') return;
    this.operation?.abort(new Error('update-cancelled'));
    await this.task?.catch(() => {});
    this.plan = null; this.publish({phase: 'idle', ...(message ? {message} : {})});
  }
  async configure(value: unknown): Promise<Record<string, unknown>> {
    if (this.plan?.prepared) throw new Error('update-installation-in-progress');
    const next = parseSelection(value);
    await this.cancel('');
    this.settingsInvalid = false; this.selection = next; writeJsonAtomic(this.settingsFile, next);
    return this.settings();
  }
  async selectAutomatically(): Promise<Record<string, unknown>> {
    if (this.plan?.prepared) throw new Error('update-installation-in-progress');
    await this.cancel('');
    await this.run(async signal => {
      const next = await autoSelect(this.ctx.defaults, this.ctx.readRemote || readRemoteJson, signal);
      this.settingsInvalid = false; this.selection = {...next, localPath: this.selection.localPath, customUrl: this.selection.customUrl};
      writeJsonAtomic(this.settingsFile, this.selection);
    });
    return this.settings();
  }
  async initialize(): Promise<void> {
    if (this.ctx.defaults.geoUrl && !this.settingsInvalid && this.selection.selectionMode === 'auto' && !this.selection.geoDetectedAt) await this.selectAutomatically();
  }
  async check(): Promise<Presentation> {
    return this.run(async signal => {
      if (this.settingsInvalid) throw new Error('update-invalid-source-settings');
      this.plan = null; this.publish({phase: 'checking'});
      let update: ResolvedUpdate | null;
      try {
        update = await resolveUpdate(this.selection, this.ctx.defaults, this.ctx.currentVersion,
          this.ctx.target, signal, this.ctx.readRemote || readRemoteJson);
      } catch (error) {
        const selected = effectiveSource(this.selection, this.ctx.defaults).id;
        const fallback = selected === 'github' ? 'gitee' : 'github';
        if (signal.aborted || this.selection.selectionMode !== 'auto' || !['github', 'gitee'].includes(selected)
          || !this.ctx.defaults[fallback].repo) throw error;
        update = await resolveUpdate({...this.selection, selectionMode: 'manual', preferredSourceId: fallback},
          this.ctx.defaults, this.ctx.currentVersion, this.ctx.target, signal, this.ctx.readRemote || readRemoteJson);
        if (update) update.notice = '首选来源暂不可用，本次使用 ' + (fallback === 'github' ? 'GitHub' : 'Gitee');
      }
      if (signal.aborted) throw signal.reason;
      if (!update) { this.publish({phase: 'idle', message: '没有适合当前安装形态的较新稳定版'}); return this.status(); }
      const transactionId = crypto.randomUUID();
      const packageFile = path.join(this.ctx.stateDir, 'transactions', transactionId, 'package');
      this.plan = {schemaVersion: 1, transactionId, update, binding: this.ctx.binding(), packageFile, prepared: false};
      this.publish({phase: 'available', version: update.manifest.version, message: update.notice});
      return this.status();
    });
  }
  async download(): Promise<Presentation> {
    return this.run(async signal => {
      const plan = this.plan;
      if (!plan || this.presentation.phase !== 'available') throw new Error('update-plan-required');
      const {artifact} = plan.update;
      await fsp.mkdir(path.dirname(plan.packageFile), {recursive: true, mode: 0o700});
      const space = await fsp.statfs(path.dirname(plan.packageFile));
      if (space.bavail * space.bsize < artifact.size * 2) throw new Error('update-disk-space');
      this.publish({phase: 'downloading', version: plan.update.manifest.version, progress: 0});
      let downloaded = 0; let lastTick = 0;
      const counter = new Transform({transform: (chunk: Buffer, _encoding, done) => {
        downloaded += chunk.length;
        if (downloaded > artifact.size) return done(new Error('package-size-mismatch'));
        const now = Date.now();
        if (now - lastTick > 250) { lastTick = now; this.publish({phase: 'downloading',
          version: plan.update.manifest.version, progress: downloaded / artifact.size}); }
        done(null, chunk);
      }});
      let source: Readable;
      if (plan.update.sourceId === 'local') {
        // Re-resolve on every copy: a removed drive or a replaced source cannot bypass containment.
        const selected = path.resolve(this.selection.localPath);
        const root = (await fsp.lstat(selected)).isDirectory() ? selected : path.dirname(selected);
        const local = await localFile(root, artifact.url);
        source = fs.createReadStream(local);
      } else {
        const response = await fetchUpdate(plan.update.location,
          AbortSignal.any([signal, AbortSignal.timeout(30 * 60 * 1000)]));
        if (!response.ok || !response.body) throw new Error('update-package-http-' + response.status);
        source = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
      }
      const partial = plan.packageFile + '.partial';
      try {
        await pipeline(source, counter, fs.createWriteStream(partial, {flags: 'wx', mode: 0o600}), {signal});
        const key = this.ctx.defaults.trustedKeys[plan.update.keyId];
        if (!key) throw new Error('untrusted-update-key');
        await verifyPackage(partial, artifact, key);
        if (signal.aborted) throw signal.reason;
        await fsp.rename(partial, plan.packageFile);
        writeJsonAtomic(path.join(path.dirname(plan.packageFile), 'plan.json'), plan);
        this.publish({phase: 'ready', version: plan.update.manifest.version, progress: 1});
        return this.status();
      } catch (error) { await fsp.unlink(partial).catch(() => {}); throw error; }
    });
  }
  async prepare(): Promise<UpdatePlan> {
    return this.run(async signal => {
      const plan = this.plan;
      if (!plan || this.presentation.phase !== 'ready') throw new Error('verified-update-required');
      if (!this.ctx.prepare) throw new Error('update-save-confirmation-unavailable');
      if (JSON.stringify(this.ctx.binding()) !== JSON.stringify(plan.binding)) throw new Error('update-data-binding-changed');
      const progress = (message: string): void => {signal.throwIfAborted();this.publish({phase:'installing',version:plan.update.manifest.version,message,cancellable:true});};
      progress('正在验证完整包，完成前可以取消');
      await verifyPackage(plan.packageFile, plan.update.artifact, this.ctx.defaults.trustedKeys[plan.update.keyId]!);
      const handoff = await this.ctx.prepare(plan.transactionId, signal, plan, progress);
      if (!handoff) throw new Error('update-install-handoff-unavailable');
      try {
        signal.throwIfAborted();
        plan.prepared = true;
        writeJsonAtomic(path.join(path.dirname(plan.packageFile), 'plan.json'), plan);
        this.publish({phase: 'installing', version: plan.update.manifest.version, message: '保存与备份完成，正在交接安装', cancellable: false});
        await handoff.commit();
      } catch (error) {
        plan.prepared = false;
        await handoff.cancel();
        throw error;
      }
      return JSON.parse(JSON.stringify(plan)) as UpdatePlan;
    });
  }
}
function safeUpdateError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  // Only stable, non-sensitive error codes reach the page or persisted status.
  return /^[a-z][a-z0-9-]{0,100}$/.test(message) ? message : 'update-operation-failed';
}
