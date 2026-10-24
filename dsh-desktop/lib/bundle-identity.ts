import fs = require('node:fs');
import path = require('node:path');
import { isMap, isSeq, parseDocument } from 'yaml';
import type { Document } from 'yaml';
const { KERNEL_BUNDLE_PACKAGES } = require('../plugin-manager-state') as { KERNEL_BUNDLE_PACKAGES: Set<string> };

export interface BundleEntry { id: string; name: string; disabled: boolean }
export type BundleIdentity = { ok: true; entries: BundleEntry[]; entryIds: string[] }
  | { ok: false; error: string; entryIds?: string[] };
export type BundleIdentities = Record<string, BundleIdentity>;
const ID = /^[A-Za-z0-9_.-]+$/;
const PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;

/** Parse configuration as data, including the kernel's inert !!js scalars. */
export function parsePatchData(text: string): unknown {
  const doc = parseDocument(text, {
    customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => ({ __jsExpr: value }) }],
  });
  if (doc.errors.length) throw new Error('插件补丁 YAML 无法解析');
  return doc.toJS({ maxAliasCount: 100 });
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Registration means a loader row, not an ID mentioned in a comment or config value. */
export function registeredPatchEntryIds(text: string): Set<string> {
  const data = parsePatchData(text) ?? [];
  if (!Array.isArray(data)) throw new Error('用户补丁必须是列表');
  const ids = new Set<string>();
  for (const value of data) {
    const patch = object(value);
    for (const entry of [patch, ...(Array.isArray(patch?.insert) ? patch.insert : [])]) {
      const row = object(entry);
      if (typeof row?.id === 'string') ids.add(row.id);
    }
  }
  return ids;
}

/**
 * 哪些 entry 已经有**显式的 disabled 覆盖行**（用户/安装器已表过态）。
 *
 * 与 `registeredPatchEntryIds` 的区别（这个区别是一个真实 bug 的来源）：
 *   · `registeredPatchEntryIds` = 「这个 id 在 patch 里出现过」——**包括**只由
 *     bundle 层 `- insert: [{id, name}]` 引入、从未写过 disabled 的行。
 *   · 本函数 = 「这个 id 有一行显式写了 disabled」——只有这种才算"用户已选择"。
 *
 * 为什么必须分开：`externalDefaultDisabledPlan`（第三方插件默认禁用）用
 * `registeredPatchEntryIds` 判「已登记就跳过」。而 `dsh-theme-endfield` 这类
 * 社区包**自带 `dsh.bundle.patch`**，profile 里因此天然有一行 insert：
 *
 *     - id: theme-endfield
 *       name: dsh-theme-endfield
 *       config: { enabled: "0" }
 *
 * 这行没有 `disabled` 字段 → 插件默认**启用**。但它已"登记"，于是被跳过、
 * 永远补不上关闭行。`config.enabled` 是插件内部开关，管不了插件加载。
 * 实测后果：终末地主题默认打开，覆写 73 个 `dsw-*` 变量，与皮肤管理冲突。
 *
 * 注意 insert 行里的 `disabled` 也算显式（bundle 自己声明要关），同样尊重。
 */
export function explicitDisabledEntryIds(text: string): Set<string> {
  const data = parsePatchData(text) ?? [];
  if (!Array.isArray(data)) throw new Error('用户补丁必须是列表');
  const ids = new Set<string>();
  const consider = (entry: unknown): void => {
    const row = object(entry);
    if (!row || typeof row.id !== 'string') return;
    // 只有"写出来了 disabled"才算表态；`disabled` 为 undefined 不算。
    if (row.disabled !== undefined) ids.add(row.id);
  };
  for (const value of data) {
    const patch = object(value);
    consider(patch);
    if (Array.isArray(patch?.insert)) for (const row of patch.insert) consider(row);
  }
  return ids;
}

/** Follow the profile's Node lookup hierarchy, including profiles/node_modules. */
/**
 * 定位一个 bundle 包的真实安装目录。
 *
 * 查找顺序（缺一不可，见下方「为什么不能只往上爬」）：
 *   1. profile 目录向上逐级的 node_modules —— 标准 pnpm/npm 布局，
 *      用户市场安装的包都在这里；
 *   2. **内核安装树**（<app>/dsh-desktop/node_modules）—— 内核骨架包
 *      `@deepseek-ai/dsh-base` / `dsh-web-app` 由 app 自带，**不在 profile 里**。
 *
 * 为什么不能只往上爬（实测 2026-10-23，这是一个真实回归）：
 *   精简版/完整版两个 profile 的 node_modules 都**没有** dsh-base、dsh-web-app
 *   （已逐个确认）。它们躺在 <app>/dsh-desktop/node_modules 下，而那棵树与
 *   profile 目录**不在同一条祖先链上** —— profile 在
 *   `…/variants/<v>/data/dpx/…/dsh-home/profiles/web-desktop`，app 在
 *   `…/variants/<v>/app/dsh-desktop`。往上爬只会一路走到盘符根，
 *   然后抛「无法读取插件的安装元数据或补丁」。
 *
 *   后果不是「这两个包报错」这么小：resolveBundleIdentities 里
 *   `unresolvedCore` 一旦为真，会把**所有**非内核包标记为
 *   「核心插件元数据不可用，无法确认条目归属」—— 设置页整片飘红（60 个包里
 *   只有 2 个真有问题，却连坐全部）。
 */
function installedPackageRoot(profileDir: string, packageName: string, kernelRoots: readonly string[] = []): string {
  const segments = packageName.split('/');
  for (let directory = path.resolve(profileDir);;) {
    const candidate = path.join(directory, 'node_modules', ...segments);
    if (fs.existsSync(candidate)) return fs.realpathSync(candidate);
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  for (const root of kernelRoots) {
    if (!root) continue;
    const candidate = path.join(root, 'node_modules', ...segments);
    try {
      if (fs.existsSync(candidate)) return fs.realpathSync(candidate);
    } catch { /* 路径不可用 → 继续找下一个根 */ }
  }
  throw new Error('无法读取插件的安装元数据或补丁');
}

/** Read only declared bundle patches; never execute package code or guess a row ID. */
export function resolveBundleIdentity(
  profileDir: string,
  packageName: string,
  kernelRoots: readonly string[] = [],
): BundleIdentity {
  if (!PACKAGE.test(packageName) || packageName.split('/').some((part) => part === '.' || part === '..')) {
    return { ok: false, error: '插件包名无效' };
  }
  try {
    const root = installedPackageRoot(profileDir, packageName, kernelRoots);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (manifest.name !== packageName) throw new Error('插件包名与安装元数据不一致');
    const declared: unknown = manifest.dsh?.bundle?.patch;
    const files = typeof declared === 'string' ? [declared] : declared;
    if (!Array.isArray(files) || !files.length || !files.every((file) => typeof file === 'string' && file.length)) {
      throw new Error('插件未声明有效的 dsh.bundle.patch');
    }
    const entries: BundleEntry[] = [];
    const ids = new Set<string>();
    for (const file of files as string[]) {
      if (path.isAbsolute(file)) throw new Error('插件补丁路径超出包目录');
      const filename = fs.realpathSync(path.resolve(root, file));
      const relative = path.relative(root, filename);
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
        throw new Error('插件补丁路径超出包目录');
      }
      const patches = parsePatchData(fs.readFileSync(filename, 'utf8'));
      if (!Array.isArray(patches)) throw new Error('插件补丁必须是列表');
      for (const patch of patches) {
        const item = object(patch);
        if (!item || item.insert === undefined) continue;
        if (!Array.isArray(item.insert)) throw new Error('插件声明包含无法静态解析的插入项');
        for (const value of item.insert) {
          const row = object(value);
          if (!row || typeof row.id !== 'string' || !ID.test(row.id) || typeof row.name !== 'string' || !row.name) {
            throw new Error('插件声明包含无法静态解析的条目');
          }
          if (ids.has(row.id)) throw new Error('插件声明包含重复条目: ' + row.id);
          ids.add(row.id);
          entries.push({ id: row.id, name: row.name, disabled: row.disabled === true });
        }
      }
    }
    if (!entries.length) throw new Error('插件没有可独立切换的声明条目');
    return { ok: true, entries, entryIds: entries.map((entry) => entry.id) };
  } catch (error) {
    // Avoid returning filesystem paths from native fs errors to the client.
    return { ok: false, error: error instanceof Error && !('code' in error)
      ? error.message : '无法读取插件的安装元数据或补丁' };
  }
}

/**
 * Refuse overlapping ownership, including rows belonging to a core bundle.
 *
 * @param kernelRoots 内核安装树（<app>/dsh-desktop）。dsh-base / dsh-web-app
 *   这类内核骨架包不在 profile 的 node_modules 里，只有从这里才找得到它们的
 *   真实声明。不传也能跑，但内核包会解析失败并触发下面的降级逻辑。
 */
export function resolveBundleIdentities(
  profileDir: string,
  packageNames: readonly string[],
  kernelRoots: readonly string[] = [],
): BundleIdentities {
  const results: BundleIdentities = Object.create(null) as BundleIdentities;
  const owners = new Map<string, string[]>();
  for (const name of new Set(packageNames)) {
    const identity = resolveBundleIdentity(profileDir, name, kernelRoots);
    results[name] = identity;
    if (identity.ok) for (const entry of identity.entries) {
      owners.set(entry.id, [...owners.get(entry.id) || [], name]);
    }
  }
  const unresolvedCore = packageNames.some((name) => KERNEL_BUNDLE_PACKAGES.has(name) && !results[name]?.ok);
  for (const [id, names] of owners) if (names.length > 1) {
    for (const name of names) results[name] = {
      ok: false, error: '插件条目归属冲突: ' + id, entryIds: results[name]?.entryIds || [],
    };
  }
  // 内核声明解析不出来时，**不能**把「未知 id 一律当作无主」——否则外部 bundle
  // 可以冒领 permission / plugin-manager 这些核心行。这一点必须保留。
  //
  // 但早先的实现是「一票否决、全体连坐」：只要有一个内核包没解析成功，就把
  // 所有非内核包标成 ok:false。实际部署里内核骨架包（dsh-base / dsh-web-app）
  // 由 app 自带、**不在 profile 的 node_modules**，于是**每个**安装都命中，
  // 设置页整片飘红（2026-10-23 实测：60 个包里 58 个是误报）。
  //
  // 正确做法是先把内核包找出来（installedPackageRoot 现在会搜内核安装树，
  // 见上面的 kernelRoots），只有**确实仍然**解析不出内核声明时，才退回到
  // 保守策略。也就是说：连坐不再是常态，只有内核真的读不到才发生。
  if (unresolvedCore) {
    for (const [name, identity] of Object.entries(results)) {
      if (!KERNEL_BUNDLE_PACKAGES.has(name) && identity.ok) {
        results[name] = { ok: false, error: '核心插件元数据不可用，无法确认条目归属', entryIds: identity.entryIds };
      }
    }
  }
  return results;
}

/** Apply all bundle overrides atomically in memory; package defaults need explicit false. */
export function toggleBundleInPatch(text: string, identity: Extract<BundleIdentity, { ok: true }>, enabled: boolean): string {
  const doc: Document = parseDocument(text || '[]\n', {
    customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }],
  });
  if (doc.errors.length) throw new Error('用户补丁 YAML 无法解析');
  if (doc.contents === null) doc.contents = doc.createNode([]);
  if (!isSeq(doc.contents)) throw new Error('用户补丁必须是列表');
  const declared = new Map(identity.entries.map((entry) => [entry.id, entry.name]));
  const checkRow = (value: unknown): void => {
    const row = object(value);
    if (row && object(row.id)?.__jsExpr !== undefined) {
      throw new Error('用户补丁包含无法静态解析的插件标识');
    }
    if (row && typeof row.id === 'string' && declared.has(row.id)
      && row.name !== undefined && row.name !== declared.get(row.id)) {
      throw new Error('用户补丁的插件条目归属冲突: ' + row.id);
    }
  };
  const data: unknown = parsePatchData(text || '[]\n') || [];
  for (const value of data as unknown[]) {
    checkRow(value);
    const patch = object(value);
    if (Array.isArray(patch?.insert)) for (const row of patch.insert) checkRow(row);
  }
  for (const entry of identity.entries) {
    const overrides = doc.contents.items.filter((item) => isMap(item) && item.get('id') === entry.id);
    if (overrides.length > 1) throw new Error('用户补丁包含重复插件覆盖: ' + entry.id);
    const existing = overrides[0];
    if (isMap(existing)) existing.set('disabled', !enabled);
    else doc.contents.add(doc.createNode({ id: entry.id, disabled: !enabled }));
  }
  return doc.toString();
}

/**
 * 删除 patch 里某个 id 的 `disabled: true` 顶层行（连同它的 config 块）。
 *
 * 用途：把被「外部层默认禁用」误标的随包核心插件恢复回来。皮肤管理器就是
 * 这种情况 —— 它被移出 COMPANION_PLUGINS 后不再被该策略排除，于是被写成
 * `- id: ui-skin-deep-whale-manager / disabled: true`，设置页「皮肤管理」整节消失。
 *
 * 只删 disabled 为 true 的行；用户主动启用的行（disabled: false）不动。
 * 插入型行（`- insert:` 块里的条目）不在顶层，不会被误删。
 *
 * @returns removed 表示是否真的删了；patch 为处理后的文本。
 */
export function removeDisabledRow(text: string, id: string): { patch: string; removed: boolean } {
  if (!text || !text.includes(id)) return { patch: text, removed: false };
  let doc: Document;
  try {
    doc = parseDocument(text, {
      customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }],
    });
  } catch {
    return { patch: text, removed: false };
  }
  if (doc.errors.length || !isSeq(doc.contents)) return { patch: text, removed: false };
  const items = doc.contents.items;
  let removed = false;
  // 从后往前删，避免索引位移。
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (!isMap(item)) continue;
    if (item.get('id') !== id) continue;
    if (item.get('disabled') !== true) continue;
    items.splice(i, 1);
    removed = true;
  }
  return removed ? { patch: doc.toString(), removed } : { patch: text, removed: false };
}
