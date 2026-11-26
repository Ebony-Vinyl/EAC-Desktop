'use strict';

// 便携版数据根（P2/P3/P4）的 L2 侧实现。
//
// L1 只做三件事：判定便携形态、显示原生选择框、把「模式 + 目标根 + 来源根」
// 传进来。所有文件动作都在这里完成，且只动 EAC 自己的便携数据：
//   * import   ：把 C 盘旧产品数据**复制**到 <便携>\data（来源原样保留）；
//   * relocate ：便携目录换路径后，把旧 dpx 元数据隔离为 .stale-*，在新路径
//                用 dpx 公开 API 重建环境，再复制环境内容（不重写 dpx 注册表）；
//   * reset    ：只隔离旧元数据，让新环境从空开始（旧数据保留为 .stale-*）。
//
// 为什么不是「直接移动 data 目录」：dpx 的 registry/环境清单与
// eac-data-binding.json 都记录绝对路径，且没有 relocate API；直接搬会让
// createEnvironment 以「已注册在旧路径」fail closed。这里只调用 dpx 的
// createEnvironment（公开 API），不手写它的注册表或环境清单。
//
// 宿主闭包 junction（<dsh-home>/profiles/node_modules）指向程序目录，换路径后
// 必须重绑。自愈实现归 full-composition.repairHostClosure()（#520）；这里只在
// 迁移完成后调用一次，不维护第二套重绑逻辑。

import fs = require('node:fs');
import path = require('node:path');
import {writeJsonAtomic} from '../atomic-json';
import {repairHostClosure} from './full-composition';
import {ensureEacEnvironment} from './environment';
import type {EnsuredEnvironment} from './environment';

export const PORTABLE_MARKER_FILE = '.dsh-portable';
export const PORTABLE_DATA_DIR = 'data';
export const PORTABLE_OWNER_FILE = 'eac-data-owner.json';
export const PORTABLE_POINTER_FILE = '.dsh-portable-data.json';
/** 便携版仍在共享旧数据根时留下的标记；NSIS 卸载器见到就保留数据。 */
export const PORTABLE_SHARE_FILE = 'eac-portable-share.json';
/**
 * 环境根的复制状态标记（环境根内）。
 *
 * 复制**开始前**写 `in-progress`，写成功后才改写 `complete`；重试时只有
 * `complete`（或完全没有标记的原始数据）才允许当数据源。只看
 * `.dpx-environment.json` 存在会把「建好环境、内容没复制完」的半成品当成
 * 完整数据（#528 评审 2/3）。
 */
export const PORTABLE_COPY_STATE_FILE = '.eac-copy-state.json';

export const PORTABLE_MODES = ['owned', 'pointer', 'handoff', 'explicit', 'import', 'relocate', 'reset'] as const;
export type PortableMode = typeof PORTABLE_MODES[number];

/** 环境根里由 dpx 拥有、不能从旧环境复制过来的文件/目录。 */
export const ENVIRONMENT_COPY_EXCLUDES = [
  '.dpx-environment.json',
  'dsh-distribution.json',
  'AGENTS.md',
  'desktop',
  // 迁移状态属于当前环境根自己，不能从旧环境复制过来（否则新环境会顶着
  // 旧的 complete 标记冒充已完成）。
  PORTABLE_COPY_STATE_FILE,
] as const;

export interface PortableOwnerRecord {
  schemaVersion: 1;
  product: 'eac-desktop';
  installKind: 'portable';
  dataRoot: string;
  installRoot: string;
  environmentRoot: string;
  registryHome: string;
  channel: string;
  createdAt: string;
  updatedAt: string;
}

export interface PortablePointerRecord {
  schemaVersion: 1;
  product: 'eac-desktop';
  dataRoot: string;
  reason: 'update-handoff' | 'legacy-pointer';
  updatedAt: string;
}

export interface PrepareOptions {
  dataRoot: string;
  programRoot: string;
  installRoot: string;
  mode?: string | undefined;
  sourceRoot?: string | undefined;
  channel?: string | undefined;
  log?: ((tag: string, message: string) => void) | undefined;
  /** 测试接缝：默认调用真实 dpx；窄接口避免把宿主对象声明成 any。 */
  ensure?: ((env: NodeJS.ProcessEnv) => EnsuredEnvironment) | undefined;
}

export interface PortableRuntime {
  mode: PortableMode;
  dataRoot: string;
  installRoot: string;
  programRoot: string;
  channel: string;
  migrated?: boolean;
  sourceEnvironmentRoot?: string;
}

export interface FinishOptions extends PortableRuntime {
  ensured: EnsuredEnvironment;
}

const CHANNEL = /^[a-z][a-z0-9-]{0,59}$/;

function now(): string {
  return new Date().toISOString();
}

function normalizeMode(value: string | undefined): PortableMode {
  return value && (PORTABLE_MODES as readonly string[]).includes(value) ? value as PortableMode : 'explicit';
}

function absolute(value: string, label: string): string {
  if (!path.isAbsolute(value)) throw new Error('portable-' + label + '-invalid');
  return path.resolve(value);
}

function exists(target: string): boolean {
  try {fs.lstatSync(target); return true;} catch (error) {if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error;}
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' ? value as Record<string, unknown> : null;
  } catch {return null;}
}

export function readOwnerRecord(dataRoot: string): PortableOwnerRecord | null {
  const value = readJson(path.join(dataRoot, PORTABLE_OWNER_FILE));
  if (!value || value.schemaVersion !== 1 || value.product !== 'eac-desktop' || value.installKind !== 'portable'
    || typeof value.dataRoot !== 'string' || typeof value.installRoot !== 'string'
    || typeof value.environmentRoot !== 'string' || typeof value.registryHome !== 'string'
    || typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string'
    || typeof value.channel !== 'string' || !CHANNEL.test(value.channel)) return null;
  return value as unknown as PortableOwnerRecord;
}

/** 读取便携指针；目标必须是已存在的绝对目录，否则视为无效（不阻塞启动）。 */
export function readPointerRecord(installRoot: string): PortablePointerRecord | null {
  const value = readJson(path.join(installRoot, PORTABLE_POINTER_FILE));
  if (!value || value.schemaVersion !== 1 || value.product !== 'eac-desktop' || typeof value.dataRoot !== 'string'
    || !['update-handoff', 'legacy-pointer'].includes(String(value.reason)) || typeof value.updatedAt !== 'string') return null;
  const root = value.dataRoot;
  if (!path.isAbsolute(root) || !exists(root) || !fs.statSync(root).isDirectory()) return null;
  return value as unknown as PortablePointerRecord;
}

export function writePointerRecord(installRoot: string, dataRoot: string, reason: PortablePointerRecord['reason']): void {
  const record: PortablePointerRecord = {schemaVersion: 1, product: 'eac-desktop', dataRoot: path.resolve(dataRoot), reason, updatedAt: now()};
  writeJsonAtomic(path.join(installRoot, PORTABLE_POINTER_FILE), record);
}

export function removePointerRecord(installRoot: string): void {
  // 不用 fs.rmSync(force)：Node 24.11 在 Windows + 非 ASCII 路径上会静默不删
  // （实测），而便携目录含中文是常态。
  try {fs.unlinkSync(path.join(installRoot, PORTABLE_POINTER_FILE));} catch { /* 不存在即完成 */ }
}

export function writeShareMarker(dataRoot: string, installRoot: string): void {
  writeJsonAtomic(path.join(dataRoot, PORTABLE_SHARE_FILE), {
    schemaVersion: 1,
    product: 'eac-desktop',
    reason: 'portable-pointer',
    portableRoot: path.resolve(installRoot),
    updatedAt: now(),
  });
}

export function removeShareMarker(dataRoot: string): void {
  try {fs.unlinkSync(path.join(dataRoot, PORTABLE_SHARE_FILE));} catch { /* 不存在即完成 */ }
}

export function writeOwnerRecord(dataRoot: string, environmentRoot: string, registryHome: string, channel: string, installRoot: string): PortableOwnerRecord {
  const previous = readOwnerRecord(dataRoot);
  const record: PortableOwnerRecord = {
    schemaVersion: 1, product: 'eac-desktop', installKind: 'portable', dataRoot: path.resolve(dataRoot),
    installRoot: path.resolve(installRoot), environmentRoot: path.resolve(environmentRoot), registryHome: path.resolve(registryHome),
    channel, createdAt: previous?.createdAt || now(), updatedAt: now(),
  };
  writeJsonAtomic(path.join(dataRoot, PORTABLE_OWNER_FILE), record);
  return record;
}

/**
 * 在候选位置里找出一个 `eac-<channel>` 环境根（可直接是环境根，或 dpx storageRoot）。
 *
 * 传 `channel` 时只认该通道：判定顺序必须是「先定通道、再挑数据源」，
 * 否则 beta 构建会把 stable 的数据复制进 beta 环境（#528 评审 1）。
 */
export function findEnvironmentRoot(container: string, channel?: string): {root: string; channel: string} | null {
  const directManifest = path.join(container, '.dpx-environment.json');
  if (fs.existsSync(directManifest)) {
    const manifest = readJson(directManifest);
    const name = typeof manifest?.name === 'string' ? manifest.name : '';
    const found = name.startsWith('eac-') ? name.slice(4) : 'stable';
    return channel && found !== channel ? null : {root: path.resolve(container), channel: found};
  }
  for (const storage of environmentStorages(container)) {
    const candidates = validEnvironmentNames(storage);
    if (!candidates.length) continue;
    if (channel) {
      const exact = candidates.find(name => name === 'eac-' + channel);
      if (exact) return {root: path.join(storage, exact), channel};
      continue;
    }
    const name = candidates.length === 1
      ? candidates[0]!
      : (candidates.includes('eac-stable') ? 'eac-stable' : candidates[0]!);
    return {root: path.join(storage, name), channel: name.slice(4)};
  }
  return null;
}

function environmentStorages(container: string): string[] {
  return [path.join(container, 'dpx', 'dsh-environments'), path.join(container, 'dsh-environments')];
}

function validEnvironmentNames(storage: string): string[] {
  if (!fs.existsSync(storage)) return [];
  return fs.readdirSync(storage, {withFileTypes: true})
    .filter(entry => entry.isDirectory() && /^eac-[a-z][a-z0-9-]{0,59}$/.test(entry.name))
    .map(entry => entry.name).sort();
}

/** 容器里的全部 `eac-*` 环境（不挑通道，用于通道匹配失败后的兜底）。 */
function listEnvironments(container: string): Array<{root: string; channel: string}> {
  if (fs.existsSync(path.join(container, '.dpx-environment.json'))) {
    const direct = findEnvironmentRoot(container);
    return direct ? [direct] : [];
  }
  const out: Array<{root: string; channel: string}> = [];
  for (const storage of environmentStorages(container)) {
    for (const name of validEnvironmentNames(storage)) out.push({root: path.join(storage, name), channel: name.slice(4)});
  }
  return out;
}

function channelFromBinding(container: string): string | null {
  const value = readJson(path.join(container, 'eac-data-binding.json'));
  const channel = typeof value?.channel === 'string' ? value.channel : '';
  return CHANNEL.test(channel) ? channel : null;
}

function normalizeChannel(value: string | undefined): string | null {
  const raw = String(value ?? '').trim().toLowerCase().replace(/-+$/, '');
  return CHANNEL.test(raw) ? raw : null;
}

interface ChannelPreference {
  channel: string;
  /** 通道来自显式注入/构建通道/目标根绑定，而不是从源数据推断。 */
  authoritative: boolean;
}

/**
 * 期望通道：显式注入 > L1 注入的构建通道 > 目标根已有绑定。
 *
 * 源数据的通道**不参与**这里的判定：它只用来选择数据源。反过来（先看源绑定）
 * 会让 beta 便携版导入 stable 旧数据时把整机通道改成 stable，并落进
 * `eac-data-binding.json` 变成永久状态（#528 评审 1）。
 */
function channelPreference(options: PrepareOptions, dataRoot: string): ChannelPreference {
  const explicit = normalizeChannel(options.channel);
  if (explicit) return {channel: explicit, authoritative: true};
  const build = normalizeChannel(process.env.DSH_EAC_ENVIRONMENT_DEFAULT_CHANNEL);
  if (build) return {channel: build, authoritative: true};
  const bound = normalizeChannel(channelFromBinding(dataRoot) ?? undefined);
  if (bound) return {channel: bound, authoritative: true};
  return {channel: 'stable', authoritative: false};
}

/**
 * 让同一 sidecar 后续的 `ensureEacEnvironment()`（不带参数、读 process.env）
 * 沿用本次判定的通道。只有完全没有构建通道信息（测试/开发态）时才采用
 * 从源数据推断出来的通道，避免覆盖 L1 的构建通道。
 */
function adoptChannel(channel: string): void {
  const build = normalizeChannel(process.env.DSH_EAC_ENVIRONMENT_DEFAULT_CHANNEL);
  if (!build || build === channel) process.env.DSH_EAC_CHANNEL = channel;
}

/** 在导入源里挑环境：先同通道，再源绑定通道，最后退回唯一/最近使用的环境。 */
function selectSourceEnvironment(sourceRoot: string, channel: string): {root: string; channel: string} | null {
  const same = findEnvironmentRoot(sourceRoot, channel);
  if (same) return same;
  const environments = listEnvironments(sourceRoot);
  if (!environments.length) return null;
  if (new Set(environments.map(entry => entry.channel)).size === 1) return environments[0]!;
  const bound = channelFromBinding(sourceRoot);
  const boundEnvironment = bound ? environments.find(entry => entry.channel === bound) : undefined;
  if (boundEnvironment) return boundEnvironment;
  return environments
    .map(entry => ({entry, mtime: fs.statSync(entry.root).mtimeMs}))
    .sort((left, right) => right.mtime - left.mtime)[0]!.entry;
}

/** 复制状态：没有标记的环境根是原始数据（视为完整）；in-progress 是中断现场。 */
function copyState(root: string): 'complete' | 'in-progress' {
  const value = readJson(path.join(root, PORTABLE_COPY_STATE_FILE));
  return value && value.state === 'in-progress' ? 'in-progress' : 'complete';
}

function markCopyState(root: string, state: 'in-progress' | 'complete', source: string, stats?: {files: number; bytes: number}): void {
  writeJsonAtomic(path.join(root, PORTABLE_COPY_STATE_FILE), {
    schemaVersion: 1,
    state,
    source: path.resolve(source),
    ...(stats ? {files: stats.files, bytes: stats.bytes} : {}),
    updatedAt: now(),
  });
}

function copyEntry(source: string, target: string, stats?: {files: number; bytes: number}): void {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) {
    const link = fs.readlinkSync(source);
    const isDirectory = (() => {try {return fs.statSync(source).isDirectory();} catch {return false;}})();
    try {fs.symlinkSync(link, target, isDirectory ? 'junction' : 'file');} catch { /* 悬空链接复制失败不影响数据文件 */ }
    return;
  }
  if (stat.isDirectory()) {
    fs.mkdirSync(target, {recursive: true});
    for (const name of fs.readdirSync(source)) copyEntry(path.join(source, name), path.join(target, name), stats);
    return;
  }
  if (stat.isFile()) {
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.copyFileSync(source, target);
    if (stats) {stats.files += 1; stats.bytes += stat.size;}
  }
}

/**
 * 复制环境内容到**新建**的环境根。
 *
 * 排除 dpx 自己的清单/描述符/指南：这些必须由新环境的 createEnvironment 写入，
 * 旧文件里的绝对 root 会让新环境自相矛盾。其余条目（含未知插件数据）原样复制。
 *
 * 不用 `fs.cpSync`：Node 24.11 在 Windows + 非 ASCII 路径上会进程级崩溃
 * （0xC0000409，实测可复现），而用户目录/便携目录含中文是常态。
 */
export function copyEnvironmentContents(sourceRoot: string, targetRoot: string, log?: (tag: string, message: string) => void): {files: number; bytes: number} {
  const source = absolute(sourceRoot, 'source');
  const target = absolute(targetRoot, 'target');
  if (source === target) throw new Error('portable-copy-source-target-same');
  const excluded = new Set<string>(ENVIRONMENT_COPY_EXCLUDES);
  // 统计边复制边累加：只算真正复制过去的文件（排除 dpx 清单/迁移标记），
  // 也省掉一次 GB 级源目录的预扫描。
  const copied = {files: 0, bytes: 0};
  const guide = path.join(target, 'dsh-home', 'AGENTS.md');
  const guideText = fs.existsSync(guide) ? fs.readFileSync(guide, 'utf8') : null;
  for (const name of fs.readdirSync(source)) {
    if (excluded.has(name)) continue;
    copyEntry(path.join(source, name), path.join(target, name), copied);
  }
  // 旧环境的 dsh-home/AGENTS.md 记录的是旧环境根；新环境的指南由 dpx 生成，
  // 复制完成后恢复它，避免用户读到已失效的绝对路径。
  if (guideText !== null) fs.writeFileSync(guide, guideText);
  log?.('portable', `复制环境内容 ${source} -> ${target}（${copied.files} 文件 / ${copied.bytes} 字节）`);
  return copied;
}

function secureName(value: string): string {
  return value.replace(/[^0-9A-Za-z-]/g, '-');
}

function quarantine(dataRoot: string, name: string): string {
  const stamp = secureName(now());
  const source = path.join(dataRoot, name);
  if (!exists(source)) return '';
  const target = path.join(dataRoot, name + '.stale-' + stamp);
  fs.renameSync(source, target);
  return target;
}

/** 产品数据根下所有 dpx 元数据容器（当前 + 历次隔离），新的在前。 */
function dataContainers(dataRoot: string): string[] {
  return fs.readdirSync(dataRoot, {withFileTypes: true})
    .filter(entry => entry.isDirectory() && (entry.name === 'dpx' || entry.name.startsWith('dpx.stale-')))
    .map(entry => ({name: entry.name, mtime: fs.statSync(path.join(dataRoot, entry.name)).mtimeMs}))
    .sort((left, right) => right.mtime - left.mtime)
    .map(entry => path.join(dataRoot, entry.name));
}

/**
 * 在 data 根里找**最近一个完整**环境。
 *
 * 搬迁/重建中途失败会留下一个不完整的 `dpx/` 与更早的完整 `dpx.stale-*`；
 * 重试时不能只盯着最新目录（那正是半成品）。「完整」不是「有清单」：
 * 建环境时清单就已经写好了，复制中断的现场同样有清单、内容却缺；只有复制
 * 完成标记才作数（无标记的原始数据视为完整）。全都不完整时返回 null，
 * 由调用方 fail closed，绝不拿半成品当来源。
 *
 * 通道优先：同一份数据可能同时有 stable/beta 两套环境，先按期望通道挑，
 * 挑不到再退回最新的完整环境。
 */
function findLatestEnvironment(dataRoot: string, channel?: string): {root: string; channel: string; container: string} | null {
  const environments: Array<{root: string; channel: string; container: string}> = [];
  for (const container of dataContainers(dataRoot)) {
    for (const found of listEnvironments(container)) environments.push({...found, container});
  }
  const complete = environments.filter(entry => copyState(entry.root) === 'complete');
  if (!complete.length) return null;
  // dataContainers 已按容器 mtime 倒序，complete 保留同样的先后顺序。
  return (channel && complete.find(entry => entry.channel === channel)) || complete[0]!;
}

/** 数据根里是否存在环境根（不管完整与否），用于区分「没有数据」与「只有半成品」。 */
function hasAnyEnvironment(dataRoot: string): boolean {
  return dataContainers(dataRoot).some(container => listEnvironments(container).length > 0);
}

function ensureTarget(dataRoot: string, channel: string, ensure?: (env: NodeJS.ProcessEnv) => EnsuredEnvironment): EnsuredEnvironment {
  const env = {...process.env, DSH_EAC_DATA_ROOT: dataRoot, DSH_EAC_CHANNEL: channel};
  return (ensure || ((value: NodeJS.ProcessEnv) => ensureEacEnvironment(value, process.platform)))(env);
}

function prepareImport(options: PrepareOptions, dataRoot: string): PortableRuntime {
  const sourceRoot = absolute(options.sourceRoot || '', 'source');
  const preference = channelPreference(options, dataRoot);
  // 先定通道，再在同通道内挑数据源：反过来会在 stable/beta 双份旧数据里
  // 挑错通道，把 stable 的会话/配置复制进 beta 环境。
  const found = selectSourceEnvironment(sourceRoot, preference.channel);
  if (!found) throw new Error('portable-import-source-environment-missing');
  // 只有完全拿不到通道信息时，才接受源数据推断出来的通道。
  const channel = preference.authoritative
    ? preference.channel
    : (channelFromBinding(sourceRoot) || found.channel || preference.channel);
  adoptChannel(channel);
  if (found.channel !== channel) {
    options.log?.('portable', `导入源是 ${found.channel} 通道，当前构建通道 ${channel}；只复制内容，不改通道`);
  }
  const ensured = ensureTarget(dataRoot, channel, options.ensure);
  // 复制前先落 in-progress：中断后重试不得把这个环境当完整来源。
  markCopyState(ensured.paths.root, 'in-progress', found.root);
  const stats = copyEnvironmentContents(found.root, ensured.paths.root, options.log);
  markCopyState(ensured.paths.root, 'complete', found.root, stats);
  copyAuxiliaryData(sourceRoot, dataRoot, options.log);
  repairHostClosure(ensured.paths.dshHome, absolute(options.programRoot, 'program'));
  return {mode: 'import', dataRoot, installRoot: absolute(options.installRoot, 'install'), programRoot: absolute(options.programRoot, 'program'), channel, migrated: true, sourceEnvironmentRoot: found.root};
}

/** 产品数据根下的辅助数据（WebView2 profile / 窗口状态 / guest profile）。 */
function copyAuxiliaryData(sourceRoot: string, dataRoot: string, log?: (tag: string, message: string) => void): void {
  for (const name of ['webview', 'config', 'browser-guests']) {
    const source = path.join(sourceRoot, name);
    const target = path.join(dataRoot, name);
    if (!exists(source) || exists(target)) continue;
    try {
      copyEntry(source, target);
      log?.('portable', `复制辅助数据 ${name}`);
    } catch (error) {
      // 辅助数据缺失不阻断导入；环境数据（会话/配置）才是主目标。
      log?.('portable', `辅助数据 ${name} 复制失败（继续）: ${String((error as Error)?.message || error)}`);
    }
  }
}

function prepareRelocate(options: PrepareOptions, dataRoot: string): PortableRuntime {
  const binding = path.join(dataRoot, 'eac-data-binding.json');
  const preference = channelPreference(options, dataRoot);
  // 先隔离当前 dpx（可能只是上次失败留下的半成品），再从所有 stale 中挑
  // 最近一个**完整**环境。只认最新目录会在重试时选中半成品并永久失败。
  quarantine(dataRoot, 'dpx');
  const source = findLatestEnvironment(dataRoot, preference.channel);
  if (!source) {
    throw new Error(hasAnyEnvironment(dataRoot) ? 'portable-relocate-source-incomplete' : 'portable-relocate-environment-missing');
  }
  if (exists(binding)) {
    try {fs.renameSync(binding, path.join(source.container, 'eac-data-binding.json'));} catch { /* 旧绑定可有可无 */ }
  }
  persistRelocateLog(options.dataRoot, source.container);
  const channel = preference.authoritative
    ? preference.channel
    : (channelFromBinding(source.container) || source.channel);
  adoptChannel(channel);
  if (source.channel !== channel) {
    options.log?.('portable', `搬迁源是 ${source.channel} 通道，当前构建通道 ${channel}；只复制内容，不改通道`);
  }
  const ensured = ensureTarget(dataRoot, channel, options.ensure);
  markCopyState(ensured.paths.root, 'in-progress', source.root);
  const stats = copyEnvironmentContents(source.root, ensured.paths.root, options.log);
  markCopyState(ensured.paths.root, 'complete', source.root, stats);
  repairHostClosure(ensured.paths.dshHome, absolute(options.programRoot, 'program'));
  return {mode: 'relocate', dataRoot, installRoot: absolute(options.installRoot, 'install'), programRoot: absolute(options.programRoot, 'program'), channel, migrated: true, sourceEnvironmentRoot: source.root};
}

function prepareReset(options: PrepareOptions, dataRoot: string): PortableRuntime {
  const binding = path.join(dataRoot, 'eac-data-binding.json');
  const preference = channelPreference(options, dataRoot);
  const previous = findLatestEnvironment(dataRoot) ?? findEnvironmentRoot(dataRoot);
  // 新建空数据时保持原通道（例如 beta），不能静默退回 stable。
  const channel = preference.authoritative
    ? preference.channel
    : (previous?.channel || preference.channel);
  adoptChannel(channel);
  const stale = quarantine(dataRoot, 'dpx');
  if (exists(binding)) {
    try {fs.renameSync(binding, path.join(dataRoot, '.eac-data-binding.stale-' + secureName(now())));} catch { /* 旧绑定可有可无 */ }
  }
  return {mode: 'reset', dataRoot, installRoot: absolute(options.installRoot, 'install'), programRoot: absolute(options.programRoot, 'program'), channel, migrated: Boolean(stale)};
}

function persistRelocateLog(dataRoot: string, stale: string): void {
  try {writeJsonAtomic(path.join(dataRoot, 'portable-relocate.json'), {schemaVersion: 1, stale, at: now()});} catch { /* 诊断增强，不影响搬迁 */ }
}

/** sidecar 启动早期（ensureEacEnvironment 之前）调用。 */
export function preparePortableData(options: PrepareOptions): PortableRuntime {
  const dataRoot = absolute(options.dataRoot, 'data-root');
  const mode = normalizeMode(options.mode);
  fs.mkdirSync(dataRoot, {recursive: true});
  if (mode === 'import') return prepareImport(options, dataRoot);
  if (mode === 'relocate') return prepareRelocate(options, dataRoot);
  if (mode === 'reset') return prepareReset(options, dataRoot);
  // owned/pointer/handoff/explicit 不搬数据：只报告期望通道，交给
  // ensureEacEnvironment 按自己的规则（绑定/构建通道）建环境。
  return {mode, dataRoot, installRoot: absolute(options.installRoot, 'install'), programRoot: absolute(options.programRoot, 'program'), channel: channelPreference(options, dataRoot).channel};
}

/** ensureEacEnvironment 之后调用：写所有权标记 / 指针，并清理迁移请求。 */
export function finishPortableData(options: FinishOptions): void {
  const {mode, dataRoot, ensured} = options;
  if (mode === 'handoff') {
    writePointerRecord(options.installRoot, dataRoot, 'update-handoff');
    writeShareMarker(dataRoot, options.installRoot);
    return;
  }
  if (mode === 'pointer') {
    if (!readPointerRecord(options.installRoot)) writePointerRecord(options.installRoot, dataRoot, 'legacy-pointer');
    writeShareMarker(dataRoot, options.installRoot);
    return;
  }
  if (mode === 'explicit') return;
  // owned / import / relocate / reset：当前根已完全由本便携目录拥有。
  writeOwnerRecord(dataRoot, ensured.paths.root, ensured.registryHome, ensured.channel, options.installRoot);
  removeShareMarker(dataRoot);
  removePointerRecord(options.installRoot);
}
