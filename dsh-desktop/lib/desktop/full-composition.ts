'use strict';

import fs = require('node:fs');
import path = require('node:path');
import { APP_ROOT } from './runtime-paths';

interface Composition {
  schemaVersion: number;
  profile: string;
  managedPackages: string[];
}

export function readComposition(root: string = APP_ROOT): Composition | null {
  if (process.env.DSH_EAC_SOURCE_DEBUG === '1' && process.env.DSH_EAC_SOURCE_FLAVOR === 'lite') {
    const data = process.env.DSH_EAC_DATA_ROOT;
    if (!data || !path.isAbsolute(data) || !fs.existsSync(path.join(data, '.eac-source-debug'))) {
      throw new Error('Lite source debugging requires a registered isolated data root');
    }
    return null;
  }
  const file = path.join(root, 'assets', 'full-pack', 'composition.json');
  if (!fs.existsSync(file)) return null;
  const value = JSON.parse(fs.readFileSync(file, 'utf8')) as Composition;
  if (value.schemaVersion !== 1 || value.profile !== 'web-desktop' || !Array.isArray(value.managedPackages)) {
    throw new Error('Invalid full EAC composition manifest');
  }
  return value;
}

// Only a new, atomically seeded profile receives pack ownership. Existing profiles
// remain untouched, and a missing/invalid receipt never bypasses legacy retirement.

/** full 档开箱默认激活的皮肤（wiring id）。用户 2026-10-24 拍板：虎鲸链路。 */
export const FULL_DEFAULT_SKIN = 'ui-skin-orca-link';

/**
 * 全新播种后的初始皮肤状态：往 profile patch 写 dsh-skin managed 段，
 * 默认款 disabled:false、其余 true。皮肤管理器（deep-whale-manager）按
 * 相同段格式接管后续切换 —— 播种时先写好等于「开箱即默认款」。
 * 只在 managed 段完全不存在时写入（用户切换过 = 段已存在，绝不覆盖）。
 */
function seedDefaultSkinState(profileDir: string): boolean {
  const patch = path.join(profileDir, 'cordis.patch.yml');
  try {
    if (!fs.existsSync(patch)) return false;
    const text = fs.readFileSync(patch, 'utf8');
    if (text.includes('dsh-skin managed')) return false;
    const skinIds = collectSeedSkinWiringIds(profileDir);
    if (!skinIds.length) return false;
    const lines = ['', '# --- dsh-skin managed (auto-generated; do not edit) ---'];
    for (const id of skinIds) lines.push(`- id: ${id}`, `  disabled: ${id === FULL_DEFAULT_SKIN ? 'false' : 'true'}`);
    lines.push('# --- end dsh-skin managed ---', '');
    fs.writeFileSync(patch, text.replace(/\s*$/, '') + lines.join('\n'));
    return true;
  } catch {
    return false;
  }
}

/** 从 profile node_modules 收集已装皮肤包的 wiring id（读各包 skin.json）。 */
function collectSeedSkinWiringIds(profileDir: string): string[] {
  const ids: string[] = [];
  const nm = path.join(profileDir, 'node_modules');
  const visit = (dir: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.name.startsWith('@')) { visit(full); continue; }
      const manifest = path.join(full, 'skin.json');
      if (!fs.existsSync(manifest)) continue;
      try {
        const wiring = JSON.parse(fs.readFileSync(manifest, 'utf8'))?.wiring?.id;
        if (typeof wiring === 'string' && wiring) ids.push(wiring);
      } catch { /* 损坏的 manifest 跳过 */ }
    }
  };
  visit(nm);
  return [...new Set(ids)].sort();
}

export function seedFullProfile(profileDir: string, root: string = APP_ROOT): boolean {
  const composition = readComposition(root);
  if (!composition || fs.existsSync(path.join(profileDir, 'package.json'))) return false;
  const safeMode = path.join(path.resolve(profileDir, '..', '..'), 'guard', 'safe-mode.json');
  if (fs.existsSync(safeMode) && JSON.parse(fs.readFileSync(safeMode, 'utf8')).active === true) return false;
  const seed = path.join(root, 'assets', 'full-pack', 'profile-seed');
  if (!fs.existsSync(path.join(seed, 'package.json')) || !fs.existsSync(path.join(seed, 'node_modules'))) {
    throw new Error('Full EAC offline profile seed is incomplete');
  }
  if (fs.existsSync(profileDir) && fs.readdirSync(profileDir).length) {
    throw new Error('Refusing to overwrite a nonempty uninitialized profile');
  }
  const staging = `${profileDir}.full-seed-${process.pid}`;
  if (fs.existsSync(staging)) throw new Error('Interrupted full profile seed exists: ' + staging);
  fs.mkdirSync(path.dirname(profileDir), { recursive: true });
  fs.cpSync(seed, staging, { recursive: true, dereference: true });
  fs.writeFileSync(path.join(staging, '.eac-full-ownership.json'), JSON.stringify({
    schemaVersion: 1,
    profile: composition.profile,
    managedPackages: composition.managedPackages,
    // 记录每个随包插件的播种版本：adoptFullProfile 据此区分「随包版本漂移」
    // 与「用户自己换过版本」，前者才允许刷新。
    versions: seedPackageVersions(seed, composition.managedPackages),
    seededAt: new Date().toISOString(),
  }, null, 2) + '\n');
  if (fs.existsSync(profileDir)) fs.rmdirSync(profileDir);
  fs.renameSync(staging, profileDir);
  // 开箱默认皮肤（虎鲸链路）：仅在 managed 段缺席时写入，用户后续切换不覆盖。
  if (seedDefaultSkinState(profileDir)) {
    // 播种日志由调用方（profile.ts）统一打；这里静默成功。
  }
  return true;
}

/** 随包种子中各受管插件的版本表（缺失 package.json 的项不记录）。 */
function seedPackageVersions(seed: string, managedPackages: string[]): Record<string, string> {
  const versions: Record<string, string> = {};
  for (const name of managedPackages) {
    const version = packageVersion(path.join(seed, 'node_modules', ...name.split('/')));
    if (version !== null) versions[name] = version;
  }
  return versions;
}

export function bindFullHostClosure(home: string, root: string = APP_ROOT): void {
  const modules = path.join(root, 'node_modules');
  const shared = path.join(home, 'profiles', 'node_modules');
  for (const entry of fs.readdirSync(modules, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const names = entry.name.startsWith('@')
      ? fs.readdirSync(path.join(modules, entry.name)).map((name) => `${entry.name}/${name}`)
      : [entry.name];
    for (const name of names) {
      const source = path.join(modules, ...name.split('/'));
      const target = path.join(shared, ...name.split('/'));
      if (!fs.existsSync(path.join(source, 'package.json')) || fs.existsSync(target)) continue;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.symlinkSync(source, target, 'junction');
    }
  }
}

export function packOwnsPatchEntry(profileDir: string, id: string, text: string, root: string = APP_ROOT): boolean {
  if (!readComposition(root)) return false;
  try {
    const yaml = require('yaml') as { parseDocument(text: string, options: { logLevel: string }): { errors: unknown[]; toJSON(): unknown } };
    const document = yaml.parseDocument(text, { logLevel: 'silent' });
    if (document.errors.length) return false;
    const rows = document.toJSON();
    return Array.isArray(rows) && rows.some((row: unknown) => {
      if (!row || typeof row !== 'object') return false;
      const entry = row as { id?: unknown; name?: unknown };
      return entry.id === id && typeof entry.name === 'string' && packOwnsPackage(profileDir, entry.name, root);
    });
  } catch { return false; }
}

export function packOwnsPackage(profileDir: string, name: string, root: string = APP_ROOT): boolean {
  const composition = readComposition(root);
  if (!composition || !composition.managedPackages.includes(name)) return false;
  try {
    const receipt = JSON.parse(fs.readFileSync(path.join(profileDir, '.eac-full-ownership.json'), 'utf8')) as Composition;
    if (receipt.schemaVersion !== 1 || receipt.profile !== composition.profile || !receipt.managedPackages.includes(name)) return false;
    const manifest = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
    return typeof manifest.dependencies?.[name] === 'string';
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// 既有 profile 的增量补齐（issue #464）
//
// 最简本体（不带 full-pack）建出的隔离环境里，profile 只有官方 base/web-app，
// 62 个随包插件一个都没注册。而 seedFullProfile 对「已存在的 profile」直接
// 返回 false（这条不能动：它保证绝不覆盖用户数据），于是 full 包装进这种旧
// 环境后，随包插件永远补不上 —— UI 里看不到任何插件，且全程无提示。
//
// 补齐只做「加法」，终态等价于全新播种（用户既有数据原样保留）：
//   - 缺失的 managedPackages：从随包种子拷入（先 staging 再 rename，避免半拷贝）
//   - profile 清单：并入缺失的 dependencies / dsh.profile.bundles
//   - profile 补丁层：并入缺失的随包行（保留用户已有行及其禁用状态）
//   - 归属凭据：写 .eac-full-ownership.json，并记录每个包的随包版本
// 绝不做：不删用户文件、不覆盖用户自装包、不动 profile 以外的任何东西。
//
// 版本漂移：只有「凭据记录里属于随包、且磁盘版本仍等于凭据记录版本」的包才会被
// 随包内容替换。用户自己换过版本的包一律保留，避免把用户的市场安装降级。
// ---------------------------------------------------------------------------

interface SeedManifest {
  dependencies?: Record<string, string>;
  dsh?: { profile?: { bundles?: unknown } };
}

interface FullReceipt {
  schemaVersion: number;
  profile: string;
  managedPackages: string[];
  versions?: Record<string, string>;
  adoptedAt?: string;
}

export interface AdoptReport {
  /** 本次从随包种子补入的包。 */
  adopted: string[];
  /** 本次被随包版本刷新（漂移且仍归随包所有）的包。 */
  refreshed: string[];
  /** 磁盘上已存在但不归随包所有的包 —— 原样保留。 */
  kept: string[];
}

function readJsonOrNull<T>(file: string): T | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return null; }
}

function packageVersion(dir: string): string | null {
  const value = readJsonOrNull<{ version?: unknown }>(path.join(dir, 'package.json'));
  return typeof value?.version === 'string' ? value.version : null;
}

/** 删除文件/链接/目录本身（junction 只删链接，不跟进目标）。 */
function removeEntry(target: string): void {
  let stat: fs.Stats;
  try { stat = fs.lstatSync(target); } catch { return; }
  if (stat.isSymbolicLink() || stat.isFile()) fs.rmSync(target, { force: true });
  else fs.rmSync(target, { recursive: true, force: true });
}

/**
 * rename 的瞬时失败重试：Windows 上杀软/索引器会短暂持有新拷贝目录内文件的
 * 句柄，导致 EPERM/EBUSY/EACCES。实测 computer-user（含 .ps1）首次必失败、
 * 第二次即成功，所以退避重试而不是放弃。同步 sleep 以避免引入异步启动路径。
 */
function renameWithRetry(from: string, to: string, attempts = 10): void {
  const buffer = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 1; ; attempt++) {
    try { fs.renameSync(from, to); return; }
    catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const transient = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES' || code === 'ENOTEMPTY';
      if (!transient || attempt >= attempts) throw err;
      Atomics.wait(buffer, 0, 0, 100 * attempt);
    }
  }
}

/** 用 src 整体替换 dest；先落到同目录 staging 再 rename，避免留下半拷贝。 */
function replaceDirectory(src: string, dest: string): void {
  const staging = `${dest}.eac-adopt-${process.pid}`;
  removeEntry(staging);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, staging, { recursive: true, dereference: true });
  removeEntry(dest);
  try {
    renameWithRetry(staging, dest);
  } catch (err) {
    // 退避后仍失败：清掉 staging，避免留下垃圾目录后重新抛出。
    removeEntry(staging);
    throw err;
  }
}

function writeFileAtomicSync(file: string, data: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

/** 待并入的随包补丁行：缺失 id、且其目标包确实在磁盘上。 */
function missingPackPatchBlocks(profileDir: string, seed: string): string[] {
  const seedFile = path.join(seed, 'cordis.patch.yml');
  if (!fs.existsSync(seedFile)) return [];
  const seedText = fs.readFileSync(seedFile, 'utf8');
  const blocks = seedText.split(/^(?=-\s*id:)/m).filter((block) => /^-\s*id:/.test(block));
  if (!blocks.length) return [];
  let text = '';
  try { text = fs.readFileSync(path.join(profileDir, 'cordis.patch.yml'), 'utf8'); } catch { /* 缺失按空处理 */ }
  const existing = new Set([...text.matchAll(/^-\s*id:\s*(\S+)\s*$/gm)].map((match) => match[1] as string));
  return blocks.filter((block) => {
    const id = /^-\s*id:\s*(\S+)/.exec(block)?.[1];
    if (id === undefined || existing.has(id)) return false;
    // 行指向的包必须真实存在：否则 dsh 会因缺 package.json 报 ENOENT 并禁用该行。
    const name = /^\s*name:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(block)?.[1];
    if (name === undefined) return false;
    return fs.existsSync(path.join(profileDir, 'node_modules', ...name.split('/'), 'package.json'));
  });
}

/** 并入随包补丁行；用户已有行及其禁用状态原样保留。返回是否写入。 */
function mergePackPatchRows(profileDir: string, blocks: string[]): boolean {
  if (!blocks.length) return false;
  const patchFile = path.join(profileDir, 'cordis.patch.yml');
  let text = '';
  try { text = fs.readFileSync(patchFile, 'utf8'); } catch { /* 缺失按空处理 */ }
  const body = blocks.join('').replace(/\s*$/, '\n');
  const stripped = text.replace(/#[^\n]*/g, '').trim();
  const next = stripped === '' || stripped === '[]' ? body : text.replace(/\s*$/, '\n') + body;
  writeFileAtomicSync(patchFile, next);
  return true;
}

/**
 * 把已存在的 profile 补齐到随包完整清单。返回本次实际发生的变更；
 * 不适用（lite / 无 profile / 安全模式 / 已是最新）时返回 null 且不写任何文件。
 */
export function adoptFullProfile(profileDir: string, root: string = APP_ROOT): AdoptReport | null {
  const composition = readComposition(root);
  if (!composition) return null;
  const manifestFile = path.join(profileDir, 'package.json');
  // 无 profile 时走 seedFullProfile 的全新播种路径，不在这里处理。
  if (!fs.existsSync(manifestFile)) return null;
  const safeMode = path.join(path.resolve(profileDir, '..', '..'), 'guard', 'safe-mode.json');
  if (readJsonOrNull<{ active?: unknown }>(safeMode)?.active === true) return null;
  const seed = path.join(root, 'assets', 'full-pack', 'profile-seed');
  const seedManifest = readJsonOrNull<SeedManifest>(path.join(seed, 'package.json'));
  if (!seedManifest || !fs.existsSync(path.join(seed, 'node_modules'))) {
    throw new Error('Full EAC offline profile seed is incomplete');
  }
  const manifest = readJsonOrNull<SeedManifest>(manifestFile);
  // 清单读不出来就什么都不做：宁可少补，也不覆盖用户数据。
  if (!manifest || typeof manifest !== 'object') return null;

  const receiptFile = path.join(profileDir, '.eac-full-ownership.json');
  const receipt = readJsonOrNull<FullReceipt>(receiptFile);
  const receiptValid = !!receipt && receipt.schemaVersion === 1 && receipt.profile === composition.profile
    && Array.isArray(receipt.managedPackages);
  const owned = new Set<string>(receiptValid ? receipt.managedPackages : []);
  const hasVersions = receiptValid && !!receipt!.versions && typeof receipt!.versions === 'object'
    && Object.keys(receipt!.versions).length > 0;
  const recorded: Record<string, string> = hasVersions ? { ...receipt!.versions! } : {};
  const seedDeps = seedManifest.dependencies ?? {};
  const dependencies: Record<string, string> = { ...(manifest.dependencies ?? {}) };
  const adopted: string[] = [];
  const refreshed: string[] = [];
  const kept: string[] = [];
  const versions: Record<string, string> = { ...recorded };

  // 兼容已发布 full 包写下的旧凭据（只有 managedPackages，没有 versions）。
  // 旧凭据无法区分「随包版本漂移」与「用户自己换过版本」，所以本次只把磁盘现状
  // 记为基线、不刷新任何包；下一次启动基线已存在，随包升级即可正常刷新。
  const baselineMigration = receiptValid && !hasVersions;
  if (baselineMigration) {
    for (const name of composition.managedPackages) {
      const have = packageVersion(path.join(profileDir, 'node_modules', ...name.split('/')));
      if (have !== null) versions[name] = have;
    }
  }

  for (const name of composition.managedPackages) {
    const src = path.join(seed, 'node_modules', ...name.split('/'));
    const want = packageVersion(src);
    if (want === null) continue;
    const dest = path.join(profileDir, 'node_modules', ...name.split('/'));
    const have = packageVersion(dest);
    if (have === null) {
      replaceDirectory(src, dest);
      versions[name] = want;
      adopted.push(name);
      continue;
    }
    if (!owned.has(name)) { kept.push(name); continue; }
    if (baselineMigration) { kept.push(name); continue; }
    // 磁盘版本已不等于凭据记录的版本 —— 用户自己换过，保留用户的。
    if (recorded[name] !== have) { kept.push(name); continue; }
    if (have === want) continue;
    replaceDirectory(src, dest);
    versions[name] = want;
    refreshed.push(name);
  }

  const changed = adopted.length > 0 || refreshed.length > 0;

  // 清单：并入「归随包所有且已落盘」的依赖与 bundles 声明。
  // 只声明真实存在的包 —— 成员指空会拖垮插件树；用户自己换过版本的包不在此列。
  const nextOwned = new Set<string>(owned);
  for (const name of adopted) nextOwned.add(name);
  for (const name of refreshed) nextOwned.add(name);
  let dependenciesChanged = false;
  for (const name of nextOwned) {
    const spec = seedDeps[name];
    if (typeof spec !== 'string') continue;
    if (dependencies[name] === spec) continue;
    if (!fs.existsSync(path.join(profileDir, 'node_modules', ...name.split('/'), 'package.json'))) continue;
    dependencies[name] = spec;
    dependenciesChanged = true;
  }
  if (dependenciesChanged) manifest.dependencies = dependencies;
  const dsh = manifest.dsh && typeof manifest.dsh === 'object' ? manifest.dsh : (manifest.dsh = {});
  const section = dsh.profile && typeof dsh.profile === 'object' ? dsh.profile : (dsh.profile = {});
  const rawBundles = section.bundles;
  const bundleSet = new Set<string>(
    (Array.isArray(rawBundles) ? rawBundles : []).filter((value): value is string => typeof value === 'string'),
  );
  let bundlesChanged = false;
  for (const name of composition.managedPackages) {
    if (bundleSet.has(name)) continue;
    if (!fs.existsSync(path.join(profileDir, 'node_modules', ...name.split('/'), 'package.json'))) continue;
    bundleSet.add(name);
    bundlesChanged = true;
  }
  if (bundlesChanged) section.bundles = [...bundleSet];

  const patchBlocks = missingPackPatchBlocks(profileDir, seed);
  if (!changed && !bundlesChanged && !dependenciesChanged && !patchBlocks.length && !baselineMigration) return null;

  // 写入顺序：凭据 -> 补丁行 -> 清单。
  // 凭据先落盘，保证「包已拷入」与「归属已记录」不会因崩溃而错位（否则下次启动
  // 会把随包包误判成用户包而永不更新）；清单最后写，它的缺失可由下次启动自愈。
  if (changed || baselineMigration) {
    const nextReceipt: FullReceipt = {
      schemaVersion: 1,
      profile: composition.profile,
      managedPackages: [...nextOwned],
      versions,
      adoptedAt: new Date().toISOString(),
    };
    writeFileAtomicSync(receiptFile, JSON.stringify(nextReceipt, null, 2) + '\n');
  }
  // 幂等：只追加「缺失 id 且目标包存在」的随包行，故每次可安全调用。
  mergePackPatchRows(profileDir, patchBlocks);
  if (dependenciesChanged || bundlesChanged) {
    writeFileAtomicSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  }
  return { adopted, refreshed, kept };
}
