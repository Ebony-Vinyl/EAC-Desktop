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

export const PORTABLE_MODES = ['owned', 'pointer', 'handoff', 'explicit', 'import', 'relocate', 'reset'] as const;
export type PortableMode = typeof PORTABLE_MODES[number];

/** 环境根里由 dpx 拥有、不能从旧环境复制过来的文件/目录。 */
export const ENVIRONMENT_COPY_EXCLUDES = [
  '.dpx-environment.json',
  'dsh-distribution.json',
  'AGENTS.md',
  'desktop',
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

/** 在候选位置里找出一个 `eac-<channel>` 环境根（可直接是环境根，或 dpx storageRoot）。 */
export function findEnvironmentRoot(container: string): {root: string; channel: string} | null {
  const directManifest = path.join(container, '.dpx-environment.json');
  if (fs.existsSync(directManifest)) {
    const manifest = readJson(directManifest);
    const name = typeof manifest?.name === 'string' ? manifest.name : '';
    return {root: path.resolve(container), channel: name.startsWith('eac-') ? name.slice(4) : 'stable'};
  }
  const storages = [path.join(container, 'dpx', 'dsh-environments'), path.join(container, 'dsh-environments')];
  for (const storage of storages) {
    if (!fs.existsSync(storage)) continue;
    const candidates = fs.readdirSync(storage, {withFileTypes: true})
      .filter(entry => entry.isDirectory() && /^eac-[a-z][a-z0-9-]{0,59}$/.test(entry.name))
      .map(entry => entry.name).sort();
    if (!candidates.length) continue;
    const name = candidates.length === 1
      ? candidates[0]!
      : (candidates.includes('eac-stable') ? 'eac-stable' : candidates[0]!);
    return {root: path.join(storage, name), channel: name.slice(4)};
  }
  return null;
}

function channelFromBinding(container: string): string | null {
  const value = readJson(path.join(container, 'eac-data-binding.json'));
  const channel = typeof value?.channel === 'string' ? value.channel : '';
  return CHANNEL.test(channel) ? channel : null;
}

function treeStats(root: string): {files: number; bytes: number} {
  const stats = {files: 0, bytes: 0};
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, {withFileTypes: true})) {
      if (entry.isSymbolicLink()) continue;
      const location = path.join(current, entry.name);
      if (entry.isDirectory()) walk(location);
      else if (entry.isFile()) {const stat = fs.statSync(location); stats.files += 1; stats.bytes += stat.size;}
    }
  };
  walk(root);
  return stats;
}

function copyEntry(source: string, target: string): void {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) {
    const link = fs.readlinkSync(source);
    const isDirectory = (() => {try {return fs.statSync(source).isDirectory();} catch {return false;}})();
    try {fs.symlinkSync(link, target, isDirectory ? 'junction' : 'file');} catch { /* 悬空链接复制失败不影响数据文件 */ }
    return;
  }
  if (stat.isDirectory()) {
    fs.mkdirSync(target, {recursive: true});
    for (const name of fs.readdirSync(source)) copyEntry(path.join(source, name), path.join(target, name));
    return;
  }
  if (stat.isFile()) {
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.copyFileSync(source, target);
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
  const before = treeStats(source);
  const guide = path.join(target, 'dsh-home', 'AGENTS.md');
  const guideText = fs.existsSync(guide) ? fs.readFileSync(guide, 'utf8') : null;
  for (const name of fs.readdirSync(source)) {
    if (excluded.has(name)) continue;
    copyEntry(path.join(source, name), path.join(target, name));
  }
  // 旧环境的 dsh-home/AGENTS.md 记录的是旧环境根；新环境的指南由 dpx 生成，
  // 复制完成后恢复它，避免用户读到已失效的绝对路径。
  if (guideText !== null) fs.writeFileSync(guide, guideText);
  log?.('portable', `复制环境内容 ${source} -> ${target}（${before.files} 文件 / ${before.bytes} 字节）`);
  return before;
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
 * 重试时不能只盯着最新目录（那正是半成品），否则永远报 environment-missing。
 */
function findLatestEnvironment(dataRoot: string): {root: string; channel: string; container: string} | null {
  for (const container of dataContainers(dataRoot)) {
    const found = findEnvironmentRoot(container);
    if (found && exists(path.join(found.root, '.dpx-environment.json'))) return {...found, container};
  }
  return null;
}

function ensureTarget(dataRoot: string, channel: string, ensure?: (env: NodeJS.ProcessEnv) => EnsuredEnvironment): EnsuredEnvironment {
  const env = {...process.env, DSH_EAC_DATA_ROOT: dataRoot, DSH_EAC_CHANNEL: channel};
  return (ensure || ((value: NodeJS.ProcessEnv) => ensureEacEnvironment(value, process.platform)))(env);
}

function prepareImport(options: PrepareOptions, dataRoot: string): PortableRuntime {
  const sourceRoot = absolute(options.sourceRoot || '', 'source');
  const found = findEnvironmentRoot(sourceRoot);
  if (!found) throw new Error('portable-import-source-environment-missing');
  const channel = options.channel && CHANNEL.test(options.channel) ? options.channel : (channelFromBinding(sourceRoot) || found.channel);
  // 让同一 sidecar 后续的 ensureEacEnvironment 继续使用这一通道，避免导入后
  // 又按默认 stable 建出第二个环境。
  process.env.DSH_EAC_CHANNEL = channel;
  const ensured = ensureTarget(dataRoot, channel, options.ensure);
  copyEnvironmentContents(found.root, ensured.paths.root, options.log);
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
  const bindingChannel = channelFromBinding(dataRoot);
  // 先隔离当前 dpx（可能只是上次失败留下的半成品），再从所有 stale 中挑
  // 最近一个**完整**环境。只认最新目录会在重试时选中半成品并永久失败。
  quarantine(dataRoot, 'dpx');
  const source = findLatestEnvironment(dataRoot);
  if (!source) throw new Error('portable-relocate-environment-missing');
  if (exists(binding)) {
    try {fs.renameSync(binding, path.join(source.container, 'eac-data-binding.json'));} catch { /* 旧绑定可有可无 */ }
  }
  persistRelocateLog(options.dataRoot, source.container);
  const channel = options.channel && CHANNEL.test(options.channel)
    ? options.channel
    : (bindingChannel || channelFromBinding(source.container) || source.channel);
  process.env.DSH_EAC_CHANNEL = channel;
  const ensured = ensureTarget(dataRoot, channel, options.ensure);
  copyEnvironmentContents(source.root, ensured.paths.root, options.log);
  repairHostClosure(ensured.paths.dshHome, absolute(options.programRoot, 'program'));
  return {mode: 'relocate', dataRoot, installRoot: absolute(options.installRoot, 'install'), programRoot: absolute(options.programRoot, 'program'), channel, migrated: true, sourceEnvironmentRoot: source.root};
}

function prepareReset(options: PrepareOptions, dataRoot: string): PortableRuntime {
  const binding = path.join(dataRoot, 'eac-data-binding.json');
  const bindingChannel = channelFromBinding(dataRoot);
  const previous = findLatestEnvironment(dataRoot) ?? findEnvironmentRoot(dataRoot);
  const channel = options.channel && CHANNEL.test(options.channel)
    ? options.channel
    : (bindingChannel || previous?.channel || 'stable');
  const stale = quarantine(dataRoot, 'dpx');
  if (exists(binding)) {
    try {fs.renameSync(binding, path.join(dataRoot, '.eac-data-binding.stale-' + secureName(now())));} catch { /* 旧绑定可有可无 */ }
  }
  // 新建空数据时保持原通道（例如 beta），不能静默退回 stable。
  process.env.DSH_EAC_CHANNEL = channel;
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
  return {mode, dataRoot, installRoot: absolute(options.installRoot, 'install'), programRoot: absolute(options.programRoot, 'program'), channel: options.channel && CHANNEL.test(options.channel) ? options.channel : 'stable'};
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
