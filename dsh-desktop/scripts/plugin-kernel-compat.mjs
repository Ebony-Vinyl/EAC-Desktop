#!/usr/bin/env node
/**
 * 内置插件 ↔ 内核导出兼容门禁（零依赖，CI / 本地均可直接跑）
 *
 * 事故背景（5.4.0）：内置 picturereader 3.3.2 顶层写了
 *     import { settingsNamespace } from '@deepseek-ai/dsh-settings'
 * 而内核 0.1.3 起 dsh-settings 只导出 SettingsConflictError / SettingsProvider /
 * default / redactSecrets（命名空间校验收进 register() 内部）。ESM 具名导入在
 * 「链接期」解析：缺失导出会让该模块整体加载失败
 *     SyntaxError: The requested module '@deepseek-ai/dsh-settings'
 *     does not provide an export named 'settingsNamespace'
 * 失败冒泡到 cordis:include 组 → dsh web 退出码 1 → 保护中心记 boot-failed 事故 →
 * 救援链进入安全模式（safeModePatch 只留核心行），用户侧表现为「一对话就报错」
 * 且插件大范围消失。本门禁把同类问题拦在 CI 阶段。
 *
 * 做法（只读文件 + 正则，绝不 import / 执行插件代码）：
 *   1. 扫 assets/plugins 下 .js/.mjs/.cjs 的具名导入与重导出：
 *        import { a, b as c } from '@deepseek-ai/<pkg>'
 *        export { a } from '@deepseek-ai/<pkg>'
 *   2. 只对「插件真正引用到的」内核包解析导出集合
 *      （内核位于 node_modules/@deepseek-ai，由 vendored tarball 安装）
 *   3. 逐个比对：引用符号不在该包导出集合里 → 报告并退出码 1
 *
 * 防假阳性取舍（宁可漏判、绝不误判，避免 CI 无故变红）：
 *   · 导出集合按「包目录下所有 JS 文件的导出声明求并集」—— 是真实导出的超集，
 *     因此最多漏判，不会把存在的导出误判为缺失。
 *   · 无法静态枚举导出的包（CJS / 解析不出任何导出名）整包跳过并计入 skipped。
 *   · 注释里的示例 import 会被剥除，不参与判定。
 *   · 只判具名导入；default / 命名空间导入与运行时 API 语义差异不在本门禁范围。
 *
 * 用法：
 *   node scripts/plugin-kernel-compat.mjs
 *   node scripts/plugin-kernel-compat.mjs --json
 *   node scripts/plugin-kernel-compat.mjs --kernel <dir> --plugins <dir>   # 夹具 / 测试
 * 退出码：0 = 通过；1 = 命中不兼容，或环境不满足（内核未安装）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = join(HERE, '..');

export const DEFAULT_KERNEL_ROOT = join(DESKTOP_ROOT, 'node_modules', '@deepseek-ai');
export const DEFAULT_PLUGINS_ROOT = join(DESKTOP_ROOT, 'assets', 'plugins');

const KERNEL_SCOPE = '@deepseek-ai/';
const CODE_EXT = /\.(?:c|m)?js$/i;
// 不参与扫描：依赖树、随包分发的浏览器 vendor 产物、更新包缓存
const SKIP_DIRS = new Set(['node_modules', 'vendor', 'releases', '.git', '.pnpm']);

const RE_EXPORT_LIST = /export\s*\{([^}]*)\}/g;
const RE_EXPORT_DECL = /export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
const RE_EXPORT_STAR_AS = /export\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s*from/g;
const RE_NAMED_FROM = /(?:^|[^\w$.])(?:import|export)\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
// 客户端（浏览器）bundle 的内核引用：打包产物保留 require / from / import() 形态。
const RE_CLIENT_REQUIRE = /([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"](@deepseek-ai\/[^'"]+)['"]\s*\)/g;
const RE_CLIENT_IMPORT_CALL = /import\(\s*['"](@deepseek-ai\/[^'"]+)['"]\s*\)/g;

/** 剥除块注释与行注释（保守：字符串里的 `//` 可能被一并剥掉 → 最多漏判）。 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:"'\\])\/\/[^\n]*/g, '$1');
}

function readTextSafe(file) {
  try { return readFileSync(file, 'utf8'); } catch { return ''; }
}

function readJsonSafe(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

/** 递归收集目录下的源码文件（不跟随符号链接，避免目录闭环）。 */
function walkFiles(root, out = []) {
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkFiles(full, out);
    } else if (entry.isFile() && CODE_EXT.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** 从源码文本收集导出名（包目录内所有文件求并集 = 真实导出的超集）。 */
export function collectExportNames(text, into = new Set()) {
  for (const m of text.matchAll(RE_EXPORT_LIST)) {
    for (const piece of m[1].split(',')) {
      const raw = piece.trim().replace(/^type\s+/, '');
      if (!raw) continue;
      const as = /\bas\s+([A-Za-z_$][\w$]*)$/.exec(raw);
      into.add(as ? as[1] : raw);
    }
  }
  for (const m of text.matchAll(RE_EXPORT_DECL)) into.add(m[1]);
  for (const m of text.matchAll(RE_EXPORT_STAR_AS)) into.add(m[1]);
  if (/\bexport\s+default\b/.test(text)) into.add('default');
  return into;
}

/** 解析「具名 from」语句里被引用的符号：`a` / `a as b` 都要求被导入方导出 `a`。 */
function symbolOf(piece) {
  const raw = piece.trim().replace(/^type\s+/, '');
  if (!raw) return '';
  const as = /\bas\s+([A-Za-z_$][\w$]*)$/.exec(raw);
  const symbol = (as ? raw.slice(0, raw.length - as[0].length) : raw).trim();
  return /^[A-Za-z_$][\w$]*$/.test(symbol) ? symbol : '';
}

/**
 * 解析指定内核包的导出集合。
 * @returns Map<包名, {dir, exists, exports:Set<string>, skipped:boolean, reason:string}>
 */
export function collectKernelExports(kernelRoot, packageNames) {
  const result = new Map();
  for (const pkg of packageNames) {
    const dir = join(kernelRoot, pkg);
    const dirExists = existsSync(dir);
    const pkgJson = readJsonSafe(join(dir, 'package.json'));
    const names = new Set();
    let hasEsmSyntax = false;
    if (dirExists) {
      for (const file of walkFiles(dir)) {
        const text = stripComments(readTextSafe(file));
        if (/(?:^|\n)\s*(?:import|export)\s/m.test(text) || /\bexport\s*[[{*]/.test(text)) hasEsmSyntax = true;
        collectExportNames(text, names);
      }
    }
    const isEsm = pkgJson?.type === 'module' || hasEsmSyntax;
    let reason = '';
    if (!dirExists) reason = 'missing';
    else if (!isEsm) reason = 'cjs';
    else if (names.size === 0) reason = 'no-static-exports';
    result.set(pkg, {
      dir,
      exists: dirExists,
      exports: names,
      skipped: dirExists && reason !== 'missing' && reason !== '',
      reason,
    });
  }
  return result;
}

/**
 * 客户端（浏览器侧）bundle 的排除判定。
 *
 * 插件的 `lib/client/**`、`client.js`（package.json exports["./client"] 指向的入口）
 * 是被内核 Web 前端加载面送进浏览器的代码，其 `@deepseek-ai/dsh-client-*`
 * 导入既不由 Node 解析、也不参与服务端 ESM 链接期 —— 即使写错也只影响前端渲染，
 * 不会拖垮插件树。本门禁只对「服务端（host）侧源码」判定，故整块排除。
 */
function clientSideExcluder(pluginDir, pkgJson) {
  const dirs = new Set();
  const files = new Set();
  const toPosix = (p) => p.replace(/\\/g, '/');
  const clientExport = pkgJson && pkgJson.exports && pkgJson.exports['./client'];
  const spec = typeof clientExport === 'string'
    ? clientExport
    : (clientExport && (clientExport.default || clientExport.import || clientExport.require));
  if (typeof spec === 'string' && spec) {
    const abs = toPosix(join(pluginDir, spec));
    files.add(abs);
    const dir = abs.slice(0, abs.lastIndexOf('/'));
    // 入口就在插件根（如 ./client.js）时不排除整个插件目录
    if (dir && dir !== toPosix(pluginDir)) dirs.add(dir + '/');
  }
  return (file) => {
    const p = toPosix(file);
    if (files.has(p)) return true;
    for (const d of dirs) if (p.startsWith(d)) return true;
    if (p.includes('/client/')) return true;
    return /(^|\/)client\.(?:c|m)?js$/i.test(p);
  };
}

/** 从客户端 bundle 收集内核 spec 引用（require / from / import() 与命名空间属性）。 */
function collectClientRefs(text, plugin, file, into) {
  if (!text.includes(KERNEL_SCOPE)) return;
  const push = (spec, symbol) => {
    if (!spec.startsWith(KERNEL_SCOPE)) return;
    const rest = spec.slice(KERNEL_SCOPE.length);
    const pkg = rest.split('/')[0];
    into.push({ plugin, file, spec, pkg, subpath: rest.slice(pkg.length), symbol: symbol || '' });
  };
  for (const m of text.matchAll(RE_NAMED_FROM)) {
    if (!m[1].trim()) { push(m[2], ''); continue; }
    for (const piece of m[1].split(',')) push(m[2], symbolOf(piece));
  }
  for (const m of text.matchAll(RE_CLIENT_REQUIRE)) {
    const alias = m[1];
    push(m[2], '');
    const esc = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const a of text.matchAll(new RegExp('\\b' + esc + '\\s*\\.\\s*([A-Za-z_$][\\w$]*)', 'g'))) push(m[2], a[1]);
  }
  for (const m of text.matchAll(RE_CLIENT_IMPORT_CALL)) push(m[1], '');
}

function dedupeClientRefs(refs) {
  const seen = new Set();
  const out = [];
  for (const ref of refs) {
    const key = ref.spec + '|' + ref.symbol;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

/** 客户端引用可加载性：包存在；声明了 exports["./client"] 时其入口文件必须存在。 */
export function clientEntryExists(kernelRoot, pkg) {
  const dir = join(kernelRoot, pkg);
  if (!existsSync(dir)) return { exists: false, entry: false };
  const pkgJson = readJsonSafe(join(dir, 'package.json'));
  const clientExport = pkgJson && pkgJson.exports && pkgJson.exports['./client'];
  const spec = typeof clientExport === 'string'
    ? clientExport
    : (clientExport && (clientExport.default || clientExport.import || clientExport.require));
  if (typeof spec === 'string' && spec) return { exists: true, entry: existsSync(join(dir, spec)) };
  return { exists: true, entry: true };
}

/** 扫描内置插件源码里的内核引用：服务端侧判具名导出，客户端 bundle 判包与入口。 */
export function scanPluginImports(pluginsRoot) {
  const refs = [];
  const clientRefs = [];
  let pluginCount = 0;
  let fileCount = 0;
  let clientFileCount = 0;
  let dirs = [];
  try { dirs = readdirSync(pluginsRoot, { withFileTypes: true }); } catch { return { refs, clientRefs, pluginCount, fileCount, clientFileCount }; }
  for (const entry of dirs) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    pluginCount += 1;
    const pluginDir = join(pluginsRoot, entry.name);
    const isClientSide = clientSideExcluder(pluginDir, readJsonSafe(join(pluginDir, 'package.json')));
    for (const file of walkFiles(pluginDir)) {
      const rel = relative(pluginsRoot, file);
      if (isClientSide(file)) {
        clientFileCount += 1;
        collectClientRefs(stripComments(readTextSafe(file)), entry.name, rel, clientRefs);
        continue;
      }
      fileCount += 1;
      const text = stripComments(readTextSafe(file));
      if (!text.includes(KERNEL_SCOPE)) continue;
      for (const m of text.matchAll(RE_NAMED_FROM)) {
        const spec = m[2];
        if (!spec.startsWith(KERNEL_SCOPE)) continue;
        const pkg = spec.slice(KERNEL_SCOPE.length).split('/')[0];
        for (const piece of m[1].split(',')) {
          const symbol = symbolOf(piece);
          if (!symbol) continue;
          refs.push({ plugin: entry.name, file: rel, spec, pkg, symbol });
        }
      }
    }
  }
  return { refs, clientRefs: dedupeClientRefs(clientRefs), pluginCount, fileCount, clientFileCount };
}

/** 门禁主体：返回 { ok, hits, skipped, stats, kernelRoot, pluginsRoot, kernelExists }。 */
export function checkCompatibility(opts = {}) {
  const kernelRoot = opts.kernelRoot || DEFAULT_KERNEL_ROOT;
  const pluginsRoot = opts.pluginsRoot || DEFAULT_PLUGINS_ROOT;
  const kernelExists = existsSync(kernelRoot);
  const scan = scanPluginImports(pluginsRoot);
  const packages = [...new Set(scan.refs.map((r) => r.pkg))].sort();
  const kernel = collectKernelExports(kernelRoot, packages);

  const hits = [];
  const skipped = [];
  let checkedPackages = 0;
  for (const [pkg, info] of kernel) {
    if (info.skipped) skipped.push({ pkg, reason: info.reason });
    else checkedPackages += 1;
  }
  for (const ref of scan.refs) {
    const info = kernel.get(ref.pkg);
    if (!info) continue;
    if (!info.exists) {
      hits.push({ ...ref, type: 'missing-package', available: [] });
      continue;
    }
    if (info.skipped) continue; // 无法静态枚举导出：按通过处理（防假阳性）
    if (!info.exports.has(ref.symbol)) {
      hits.push({ ...ref, type: 'missing-export', available: [...info.exports].sort().slice(0, 12) });
    }
  }

  const clientRefs = scan.clientRefs || [];
  const clientPackages = [...new Set(clientRefs.map((r) => r.pkg))].sort();
  const clientKernel = collectKernelExports(kernelRoot, clientPackages);
  const clientHits = [];
  for (const ref of clientRefs) {
    const info = clientKernel.get(ref.pkg);
    if (info && !info.exists) {
      clientHits.push({ ...ref, type: 'missing-package', available: [] });
      continue;
    }
    if (!clientEntryExists(kernelRoot, ref.pkg).entry) {
      clientHits.push({ ...ref, type: 'missing-client-entry', available: [] });
      continue;
    }
    if (ref.symbol && !ref.subpath && info && !info.skipped && info.exists && !info.exports.has(ref.symbol)) {
      clientHits.push({ ...ref, type: 'missing-export', available: [...info.exports].sort().slice(0, 12) });
    }
  }
  const allHits = hits.concat(clientHits);

  return {
    ok: allHits.length === 0,
    kernelRoot,
    pluginsRoot,
    kernelExists,
    hits: allHits,
    skipped,
    stats: {
      pluginCount: scan.pluginCount,
      fileCount: scan.fileCount,
      clientFileCount: scan.clientFileCount,
      clientRefCount: clientRefs.length,
      clientCheckedPackages: clientPackages.length,
      clientMissingCount: clientHits.length,
      referencedPackages: packages.length,
      checkedPackages,
      refCount: scan.refs.length,
    },
  };
}

export function formatReport(result) {
  const lines = ['[plugin-kernel-compat] 内置插件 ↔ 内核导出兼容校验'];
  lines.push(`  插件 ${result.stats.pluginCount} 个 / 服务端源码 ${result.stats.fileCount} 个文件 / 具名导入 ${result.stats.refCount} 处`);
  if (result.stats.clientFileCount) {
    lines.push(`  另静态核验客户端（浏览器侧）bundle ${result.stats.clientFileCount} 个文件 / 内核引用 ${result.stats.clientRefCount ?? 0} 处（涉及 ${result.stats.clientCheckedPackages ?? 0} 个包）`);
  }
  lines.push(`  引用内核包 ${result.stats.referencedPackages} 个（已静态解析导出 ${result.stats.checkedPackages} 个，跳过 ${result.skipped.length} 个）`);
  if (result.skipped.length) {
    lines.push(`  跳过（无法静态枚举导出）: ${result.skipped.map((s) => `${s.pkg}(${s.reason})`).join(', ')}`);
  }
  if (result.ok) {
    lines.push('  ✓ 通过：未发现「导入内核不存在的导出」。');
    return lines.join('\n');
  }
  lines.push(`  ✗ 命中 ${result.hits.length} 处不兼容 —— ESM 链接期即失败，会拖垮整棵插件树：`);
  for (const h of result.hits) {
    lines.push(`    · ${h.plugin}  ${h.file}`);
    const what = h.type === 'missing-package'
      ? `内核中不存在包 ${h.spec}`
      : h.type === 'missing-client-entry'
        ? `内核包 ${h.spec} 的客户端入口缺失（exports["./client"] 指向的文件不存在）`
        : `内核 ${h.spec} 不导出 "${h.symbol}"（现有导出示例：${h.available.join(', ')}）`;
    lines.push(`        import { ${h.symbol} } from '${h.spec}'  →  ${what}`);
  }
  lines.push('    修复方向：改用当前内核真实存在的 API（例如内核 0.1.3 起 settings 命名空间');
  lines.push('    校验收进 sctx.settings.register(NS, Config, ...)），或把内置插件升级到适配');
  lines.push('    当前内核的版本 —— 切勿让内置插件静态导入内核已删除的品牌函数。');
  return lines.join('\n');
}

function readArg(argv, name) {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : undefined;
}

export function main(argv = process.argv.slice(2)) {
  const json = argv.includes('--json');
  const kernelArg = readArg(argv, '--kernel');
  const pluginsArg = readArg(argv, '--plugins');
  const result = checkCompatibility({
    ...(kernelArg ? { kernelRoot: kernelArg } : {}),
    ...(pluginsArg ? { pluginsRoot: pluginsArg } : {}),
  });

  if (!result.kernelExists) {
    if (json) {
      process.stdout.write(JSON.stringify({ ok: false, error: 'kernel-missing', kernelRoot: result.kernelRoot }, null, 2) + '\n');
    } else {
      console.error('[plugin-kernel-compat] 内核目录不存在: ' + result.kernelRoot);
      console.error('  请先安装依赖（npm run ci:install / npm ci），再运行本门禁。');
    }
    return 1;
  }

  if (json) {
    process.stdout.write(JSON.stringify(result, (_k, v) => (v instanceof Set ? [...v] : v), 2) + '\n');
  } else if (result.ok) {
    console.log(formatReport(result));
  } else {
    console.error(formatReport(result));
  }
  return result.ok ? 0 : 1;
}

const invokedDirectly = process.argv[1] !== undefined
  && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) process.exitCode = main();
