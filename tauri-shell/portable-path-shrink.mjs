// 打包时长路径根治模块：对 staging 树做两类**安全可逆**的变换，
// 把 zip 内最长条目从 ~174 压到 ~135，让 Explorer 右键解压在
// 目标目录 ≤ 120 字符时不再报 0x80010135（路径太长）。
//
// ═══════════════════════════════════════════════════════════════════
// 变换 A：剔除 node_modules 里的死重（.map / .d.ts / esnext / esm）
// ═══════════════════════════════════════════════════════════════════
// 依据（2026-10-24 实测，lite zip 33044 文件条目）：
//   最长 174 字符的条目全部是 @opentelemetry 的编译副产物：
//     ...otlp-transformer\node_modules\@opentelemetry\resources\build\
//        esnext\detectors\platform\node\machine-id\getMachineId-*.js.map
//   这类文件运行时（Node require 链）**永不加载**：
//     - .js.map / *.map      —— 浏览器 devtools 专属，服务端运行不用
//     - .d.ts / .d.mts/.cts  —— 类型声明，仅 tsc 用
//     - build/esnext、build/esm —— 包作者发布的**重复**编译目标；
//       Node 的 CJS require 只走 build/src（package.json exports 决定），
//       esnext/esm 目录与运行无关（本产物无 ESM 双加载路径）
//   剔除量约 14300 个文件 / 33% 条目，同时显著缩包。
//
// 为什么敢在打包时删而不动源 staged 树：
//   变换发生在 make-portable.mjs 的 .staging-portable-* 临时目录里，
//   staged-resources 与安装版（NSIS）不受影响 —— 安装版无 260 限制问题。
//
// 防误删护栏：
//   - 只处理路径含 node_modules 的条目（dsh-desktop 源码、皮肤、
//     sidecar、dpx 一律不碰）
//   - 只删白名单后缀/目录名，白名单之外一字不动
//   - 删除前断言：命中的目录里必须同时存在 build\src（运行面还在），
//     否则跳过该包（宁可不缩，不删运行面）
//
// ═══════════════════════════════════════════════════════════════════
// 变换 B：皮肤 runtime 哈希名缩短（64 hex → 前 16 hex）
// ═══════════════════════════════════════════════════════════════════
// 依据（2026-10-24 审计 skin-hash-audit.mjs，full 13 皮肤）：
//   只有 2 个皮肤（maid-atelier / orca-link）有 assets/runtime/，
//   内含 <64hex>.<png|webp> 内容寻址资源（31 + 11 个）。
//   引用面**封闭在包内**：assets/runtime/manifest.json（全名数组）+
//   lib/client.js + lib/index.js（内嵌全名字符串）。外部零引用。
//   16 位截断（64bit）实测零碰撞（42 个文件全宇宙唯一）。
//   改名后同步重写 manifest 与两份 JS —— 包内自洽，皮肤功能无损。
//   收益：这批文件路径 130~155 → 82~107。
//
// 若未来某皮肤引用面越出包内（audit FAIL），本模块对它**跳过不缩**，
// 绝不产出断链包。

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const DEAD_SUFFIX = /\.(js\.map|cjs\.map|mjs\.map|map|d\.ts|d\.mts|d\.cts)$/i;
const DEAD_DIR_PARTS = /(^|[\\/])node_modules[\\/].+[\\/]build[\\/](esnext|esm)([\\/]|$)/i;

/**
 * 变换 A：剔除 staging 树内 node_modules 死重。
 * @returns {{removed:number, byKind:Object<string,number>}}
 */
export function pruneNodeModulesDeadWeight(staging, log = () => {}) {
  const removed = { count: 0, bytes: 0 };
  const byKind = {};
  // 先收集再删：readdirSync 迭代中删除会跳条目
  const victims = [];
  const walk = (dir) => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        // esnext/esm 目录整体标记（父级必须是 node_modules 内的 build）
        if ((e.name === 'esnext' || e.name === 'esm') && DEAD_DIR_PARTS.test(full + path.sep)) {
          victims.push({ path: full, dir: true, kind: 'build/' + e.name });
        } else {
          walk(full);
        }
      } else if (DEAD_SUFFIX.test(e.name) && full.includes('node_modules')) {
        victims.push({ path: full, dir: false, kind: 'suffix:' + path.extname(e.name) });
      }
    }
  };
  walk(staging);

  const rmdirRecursive = (p) => {
    let size = 0;
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, e.name);
      if (e.isDirectory()) size += rmdirRecursive(full);
      else { size += fs.statSync(full).size; fs.rmSync(full, { force: true }); }
    }
    fs.rmdirSync(p);
    return size;
  };

  for (const v of victims) {
    try {
      if (v.dir) {
        // 护栏：包内必须仍有 build/src 运行面
        const pkgBuild = path.dirname(v.path);
        if (!fs.existsSync(path.join(pkgBuild, 'src'))) { continue; }
        removed.bytes += rmdirRecursive(v.path);
      } else {
        removed.bytes += fs.statSync(v.path).size;
        fs.rmSync(v.path, { force: true });
      }
      removed.count++;
      byKind[v.kind] = (byKind[v.kind] ?? 0) + 1;
    } catch { /* 单条失败不阻断打包 */ }
  }
  log(`prune: 剔除 ${removed.count} 条 / ${(removed.bytes / 1048576).toFixed(1)} MB`);
  return { removed: removed.count, bytes: removed.bytes, byKind };
}

const HEX64_FILE = /^([0-9a-f]{64})(\.[a-z0-9]+)$/i;

/**
 * 变换 B：皮肤 runtime 哈希名缩短 + 包内引用同步重写。
 * 每包独立审计，审计不过就跳过该包（不缩也不报错中断）。
 *
 * 扫描面（2026-10-24 full 打包实测教训）：
 *   皮肤包有两处实物 —— assets/skins/（staged 直接装配）与
 *   assets/full-pack/profile-seed/node_modules/（EAC-Pack 全量载荷，full 档独有）。
 *   只扫前者会漏掉 seed 里的第二份，门禁在 188 字符处炸（见 make-portable 门禁）。
 *   所以：扫 staging 下**所有** `assets/skins` 前缀目录 + 所有含 `assets/runtime`
 *   的皮肤形态包（按包根 = runtime 上两级判定）。
 * @returns {{packages:number, renamed:number, skipped:string[]}}
 */
export function shortenSkinRuntimeNames(staging, log = () => {}) {
  const SHORT = 16;
  let renamed = 0;
  const touched = [];
  const skipped = [];

  // 找出所有「包根」：staging 内任何含 assets/runtime 的目录，包根 = runtime 上两级。
  const pkgRoots = [];
  const walkFind = (d) => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    // 剪枝：node_modules 里只进 @scope/skin 与 *skin* 命名的目录，避免全量扫 3 万目录
    for (const e of ents) {
      const full = path.join(d, e.name);
      if (!e.isDirectory()) continue;
      if (e.name === 'runtime' && path.basename(path.dirname(full)) === 'assets') {
        pkgRoots.push(path.dirname(path.dirname(full)));
        continue;
      }
      // 剪枝规则：目录名含 skin、或是 @scope（可能含皮肤）、或是 assets/node_modules 祖先
      if (/skin/i.test(e.name) || e.name.startsWith('@') || e.name === 'node_modules' || e.name === 'assets' || e.name === 'full-pack' || e.name === 'profile-seed' || e.name === 'dsh-desktop') {
        walkFind(full);
      }
    }
  };
  walkFind(staging);

  for (const pkg of pkgRoots) {
    const runtime = path.join(pkg, 'assets', 'runtime');
    const dir = path.relative(staging, pkg).split(path.sep).pop();
    if (!fs.existsSync(runtime)) continue;

    const files = fs.readdirSync(runtime).filter((f) => f !== 'manifest.json');
    if (!files.length) continue;
    if (!files.every((f) => HEX64_FILE.test(f))) { skipped.push(dir + '(非规范名)'); continue; }

    // 16 位碰撞检测
    const map = new Map(); // old -> new
    const seen = new Set();
    let collide = false;
    for (const f of files) {
      const m = HEX64_FILE.exec(f);
      const short = m[1].slice(0, SHORT) + m[2];
      if (seen.has(short)) { collide = true; break; }
      seen.add(short);
      map.set(f, short);
    }
    if (collide) { skipped.push(dir + '(16位碰撞)'); continue; }

    // 引用面审计：包内文本引用的 64 位名必须全部在改名集中
    const nameSet = new Set(files);
    let foreignRef = false;
    const textFiles = [];
    // manifest.json 在 assets/runtime 里 —— 文本扫描必须进 runtime 但只读文本文件，
    // 跳过的是 runtime 里的**二进制资源**（png/webp），不是 runtime 目录本身。
    // （初版把目录判断写反，跳过了整个 runtime → manifest 没重写 → 断链，
    //  dry-run 验收抓住：manifest⊂disk=false。此处为修复版。）
    const walk = (d, isRuntime) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) { walk(full, isRuntime || (d === pkg && e.name === 'assets' && false)); continue; }
        if (!/\.(js|json|css|html)$/.test(e.name)) continue;
        const t = fs.readFileSync(full, 'utf8');
        for (const hit of t.matchAll(/[0-9a-f]{64}\.[a-z0-9]+/gi)) {
          if (!nameSet.has(hit[0])) { foreignRef = true; break; }
        }
        if (foreignRef) break;
        textFiles.push({ full, text: t });
      }
    };
    walk(pkg, false);
    if (foreignRef) { skipped.push(dir + '(引用面越界)'); continue; }

    // 执行：先重写文本引用，再改名文件（引用先就位，中断也不留断链）
    let pkgRenamed = 0;
    for (const tf of textFiles) {
      let t = tf.text;
      for (const [old, short] of map) t = t.split(old).join(short);
      // 路由校验正则放宽（2026-10-24 用户手测抓到）：皮肤包 index.js 的
      // skin-assets 路由用 /^[a-f0-9]{64}\.(png|webp)$/ 白名单校验文件名，
      // 改名后 16 位名全部 404 —— 虎鲸娘图片丢失的直接原因。
      t = t.replace(/\[a-f0-9\]\{64\}/g, '[a-f0-9]{16}(?:[a-f0-9]{48})?');
      if (t !== tf.text) fs.writeFileSync(tf.full, t);
    }
    for (const [old, short] of map) {
      fs.renameSync(path.join(runtime, old), path.join(runtime, short));
      pkgRenamed++;
    }
    renamed += pkgRenamed;
    if (pkgRenamed) touched.push(`${dir}(${pkgRenamed})`);
  }
  log(`skin-shorten: ${touched.join(', ') || '无'}${skipped.length ? ' | 跳过: ' + skipped.join(', ') : ''}`);
  return { packages: touched.length, renamed, skipped };
}

// ═══════════════════════════════════════════════════════════════════
// 变换 C：seed payload tgz/chunk 改名（full 档专用，lite 树无此路径自动跳过）
// ═══════════════════════════════════════════════════════════════════
// 背景（2026-10-24 full 打包门禁实测）：seed 里最长的条目是
//   .../eac-plugin-suite-assets/assets/payload/@dsh-external_dsh-client-ui-skin-
//   deep-whale-day-night-0.1.12.tgz  → 前缀 124 + 文件名 64 = 188 字符
// 56/71 个 payload 文件超 150。目录链不能动（NSIS 装配 + pnpm 布局），
// 但**文件名可以**：引用面封闭在 suite 包内 ——
//   · bootstrap.json（assets 包自己的清单）：items[].file / parts[].file / extraFiles
//     （注意 dsh-pet 是 chunk 分片：本体名只在 items[].file 出现、
//       parts[].file 指向 .chunk-NNN.bin 分片 —— 两者都要映射）
//   · catalog/{aio,eac,community,skins}.json：`file:dist/<name>.tgz` 形态
// 运行时定位走 require.resolve('eac-plugin-suite-assets') + bootstrap 的
// file 字段，不依赖原始文件名。改名为 p00.tgz / p00.tgz.chunk-000.bin。
// 收益（实测）：seed 内最长 207(zip 相对) → 150。
export function shortenSeedPayloadNames(staging, log = () => {}) {
  const suite = path.join(staging, 'dsh-desktop', 'assets', 'full-pack', 'profile-seed',
    'node_modules', 'eac-plugin-suite');
  const assetsPkg = path.join(suite, 'node_modules', 'eac-plugin-suite-assets');
  const payload = path.join(assetsPkg, 'assets', 'payload');
  const bootFile = path.join(assetsPkg, 'assets', 'bootstrap.json');
  if (!fs.existsSync(payload) || !fs.existsSync(bootFile)) {
    log('seed-shorten: 无 seed payload（lite 档），跳过');
    return { renamed: 0, refsRewritten: 0 };
  }

  // 1) 建映射：目录内每个文件 old→short；.tgz 本体 pNN.tgz；chunk 保持尾缀。
  //    items[].file 可能引用不在磁盘上的本体名（chunk 分片场景，如 dsh-pet）——
  //    这些名字也要进映射（bootstrap 引用它们），short 名按出现顺序编。
  const map = new Map();
  let seq = 0;
  const nextName = (ext) => 'p' + String(seq++).padStart(2, '0') + ext;
  const diskFiles = fs.readdirSync(payload).sort();
  // 先给磁盘文件定短名（保证 chunk 与其母 tgz 同前缀，可读性）
  for (const f of diskFiles) {
    const m = /^(.+?\.tgz)(\.chunk-\d+\.bin)?$/.exec(f);
    if (!m) { map.set(f, nextName(path.extname(f) || '.bin')); continue; }
    if (!map.has(m[1])) map.set(m[1], nextName('.tgz'));
    if (m[2]) map.set(f, map.get(m[1]) + m[2]);
  }
  // bootstrap 里引用但磁盘没有的名字（chunk 母名）：按映射需要补
  const boot = JSON.parse(fs.readFileSync(bootFile, 'utf8'));
  const scanRefs = (o, out) => {
    if (Array.isArray(o)) { o.forEach((x) => scanRefs(x, out)); return; }
    if (o && typeof o === 'object') for (const v of Object.values(o)) {
      if (typeof v === 'string' && /\.(tgz|bin)$/.test(v)) out.push(v);
      else if (v && typeof v === 'object') scanRefs(v, out);
    }
  };
  const bootRefs = [];
  scanRefs(boot.items, bootRefs); scanRefs(boot.extraFiles, bootRefs);
  for (const r of bootRefs) {
    if (map.has(r)) continue;
    // 未落盘的引用名（chunk 母体）：给占位短名（安装器按 parts 拼分片，母名仅标识用）
    map.set(r, nextName('.tgz'));
  }

  // 2) 重写 bootstrap.json（结构化改，保字段顺序语义：直接字符串替换最小侵入）
  let bootText = fs.readFileSync(bootFile, 'utf8');
  // 长名先替换（避免短名是长名前缀的误替换——本方案 pNN 无此前缀关系，稳妥起见仍排序）
  for (const [old, s] of [...map.entries()].sort((a, b) => b[0].length - a[0].length)) {
    bootText = bootText.split(JSON.stringify(old)).join(JSON.stringify(s));
  }
  fs.writeFileSync(bootFile, bootText);

  // 3) 重写 catalog/*.json（file:dist/<name>.tgz）
  let catCount = 0;
  const catDir = path.join(suite, 'catalog');
  if (fs.existsSync(catDir)) {
    for (const f of fs.readdirSync(catDir)) {
      if (!f.endsWith('.json')) continue;
      const p = path.join(catDir, f);
      let t = fs.readFileSync(p, 'utf8');
      const orig = t;
      for (const [old, s] of [...map.entries()].sort((a, b) => b[0].length - a[0].length)) {
        t = t.split(old).join(s);
      }
      if (t !== orig) { fs.writeFileSync(p, t); catCount++; }
    }
  }

  // 4) 改名磁盘文件
  let renamed = 0;
  for (const f of diskFiles) {
    const s = map.get(f);
    if (s && s !== f) { fs.renameSync(path.join(payload, f), path.join(payload, s)); renamed++; }
  }

  // 5) 完整性自检：改写后的引用分两类，都合法 ——
  //    a) 磁盘上存在的文件（普通 tgz / chunk 分片）
  //    b) chunk 母名（items[].file 指向逻辑名，实体是 parts[].file 的分片；
  //       母名不在磁盘是设计内，判据：存在短名 === 该引用 的映射，
  //       且磁盘上有 <短名>.chunk-000.bin）
  const boot2 = JSON.parse(fs.readFileSync(bootFile, 'utf8'));
  const refs2 = [];
  scanRefs(boot2.items, refs2); scanRefs(boot2.extraFiles, refs2);
  const disk2 = new Set(fs.readdirSync(payload));
  const shortToOld = new Map([...map.entries()].map(([o, s]) => [s, o]));
  let broken = 0;
  const brokenNames = [];
  for (const r of refs2) {
    if (disk2.has(r)) continue;                                  // a) 磁盘实文件
    const old = shortToOld.get(r);                              // b) chunk 母名
    if (old !== undefined && disk2.has(r + '.chunk-000.bin')) continue;
    broken++; brokenNames.push(r);
  }
  if (broken) throw new Error(`seed-shorten: bootstrap 改写后 ${broken} 处引用悬空: ${brokenNames.slice(0, 5).join(', ')}`);
  log(`seed-shorten: 改名 ${renamed} 文件 / bootstrap 重写 / catalog ${catCount} 个文件`);
  return { renamed, refsRewritten: catCount };
}

// ═══════════════════════════════════════════════════════════════════
// 变换 D：otel 平台死代码剔除（167 → ~130 的最后一击）
// ═══════════════════════════════════════════════════════════════════
// 依据（2026-10-24 实测读码）：@opentelemetry/resources 的
// build/src/detectors/platform/index.js 是**硬编码 require("./node")**
// （CJS 无条件走 node 实现），package.json 的 browser 字段只影响
// bundler、Node require 链不看。因此（win64 产物）：
//   platform/browser/**   —— 100% 死代码
//   node/machine-id/getMachineId-{darwin,linux,win32}.js —— 运行时按
//     process.platform 挑一个，其余两个不加载；但它们很小（~300B），
//     收益主要在 browser 目录。
// 只处理 @opentelemetry 包内的 platform/browser 目录（名字即语义，
// 不做内容嗅探），其余包一概不碰。
export function pruneOtelPlatformBrowser(staging, log = () => {}) {
  let removed = 0, bytes = 0;
  const otelRoot = path.join(staging, 'dsh-desktop', 'node_modules', '@opentelemetry');
  if (!fs.existsSync(otelRoot)) return { removed: 0, bytes: 0 };
  const measureRm = (p) => {
    let s = 0;
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, e.name);
      if (e.isDirectory()) s += measureRm(full);
      else { s += fs.statSync(full).size; fs.rmSync(full, { force: true }); }
    }
    fs.rmdirSync(p);
    return s;
  };
  const hunt = (d) => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const full = path.join(d, e.name);
      if (!e.isDirectory()) continue;
      if (e.name === 'browser' && /detectors[\\/]platform$/.test(d)) {
        try { bytes += measureRm(full); removed++; } catch { /* 不阻断 */ }
        continue;
      }
      hunt(full);
    }
  };
  hunt(otelRoot);
  // 空目录清尾：platform/ 下删掉 browser 后父目录仍合法（node 还在）
  log(`otel-platform: 剔除 platform/browser 目录 ${removed} 处 / ${(bytes / 1048576).toFixed(2)} MB`);
  return { removed, bytes };
}

// ═══════════════════════════════════════════════════════════════════
// 变换 E：otel machine-id 非 win 平台实现剔除（167 → 143 的收尾）
// ═══════════════════════════════════════════════════════════════════
// 依据（2026-10-24 读码实测）：machine-id/getMachineId.js 用动态
// import() 按 process.platform 运行时挑实现：
//   darwin/linux/bsd/unsupported 在 win32 上永远不会被加载。
// 本产物是 windows-x86_64 专用（zip 名与 updateTarget 均含 win），
// 删除非 win 实现是纯减法。保留 getMachineId.js 主选择器与 -win.js。
// 注意：不仅 otlp-transformer 嵌套份，顶层 resources@2.11 也有同构
// 目录 —— 全部 @opentelemetry/**/machine-id/ 都处理。
export function pruneNonWinPlatformImpls(staging, log = () => {}) {
  const otelRoot = path.join(staging, 'dsh-desktop', 'node_modules', '@opentelemetry');
  if (!fs.existsSync(otelRoot)) return { removed: 0 };
  const DEAD = /^getMachineId-(darwin|linux|bsd|unsupported)\.(js|d\.ts|js\.map)$/;
  let removed = 0;
  const hunt = (d) => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const full = path.join(d, e.name);
      if (!e.isDirectory()) continue;
      if (e.name === 'machine-id' && /platform[\\/]node$/.test(d)) {
        for (const f of fs.readdirSync(full)) {
          if (DEAD.test(f)) { fs.rmSync(path.join(full, f), { force: true }); removed++; }
        }
        continue;
      }
      hunt(full);
    }
  };
  hunt(otelRoot);
  log(`otel-machine-id: 剔除非 win 平台实现 ${removed} 个文件`);
  return { removed };
}

// ═══════════════════════════════════════════════════════════════════
// 变换 F：seed previews 皮肤目录名缩短（159 → ~140 的收尾）
// ═══════════════════════════════════════════════════════════════════
// 依据（2026-10-24 审计）：previews/<皮肤名>/{light,dark}.png 的引用面
// 封闭在 assets 包内两处 —— bootstrap.json extraFiles[].file（30 处）与
// gallery.json（30 处），形态均为 "previews/<皮肤>/light.png"。
// 目录名 deep-whale-day-night(20) → vN(2)，省 18 字符。
// client.js / index.js 不引用 previews（实测 0 处）。
export function shortenSeedPreviewDirs(staging, log = () => {}) {
  const assetsPkg = path.join(staging, 'dsh-desktop', 'assets', 'full-pack', 'profile-seed',
    'node_modules', 'eac-plugin-suite', 'node_modules', 'eac-plugin-suite-assets');
  const previews = path.join(assetsPkg, 'assets', 'previews');
  const bootFile = path.join(assetsPkg, 'assets', 'bootstrap.json');
  const gallery = path.join(assetsPkg, 'assets', 'gallery.json');
  if (!fs.existsSync(previews)) return { renamed: 0 };
  if (!fs.existsSync(bootFile)) return { renamed: 0 };

  const dirs = fs.readdirSync(previews).sort();
  const map = new Map();
  dirs.forEach((d, i) => map.set(d, 'v' + i));

  // 引用面审计：extraFiles + gallery 的 previews/ 引用必须全部命中映射
  const boot = JSON.parse(fs.readFileSync(bootFile, 'utf8'));
  for (const e of boot.extraFiles ?? []) {
    const skin = String(e.file ?? '').split('/')[1];
    if (String(e.file ?? '').startsWith('previews/') && !map.has(skin)) {
      throw new Error(`seed-previews: 未知引用 ${e.file}，拒绝改名`);
    }
  }
  let galleryText = fs.existsSync(gallery) ? fs.readFileSync(gallery, 'utf8') : null;
  if (galleryText) {
    for (const m of galleryText.matchAll(/previews\/([^/"']+)/g)) {
      if (!map.has(m[1])) throw new Error(`seed-previews: gallery 未知引用 ${m[1]}`);
    }
  }

  // 先改文本引用，再改目录名（引用先就位）
  let bootText = fs.readFileSync(bootFile, 'utf8');
  for (const [old, s] of map) bootText = bootText.split(`previews/${old}/`).join(`previews/${s}/`);
  fs.writeFileSync(bootFile, bootText);
  if (galleryText) {
    for (const [old, s] of map) galleryText = galleryText.split(`previews/${old}/`).join(`previews/${s}/`);
    fs.writeFileSync(gallery, galleryText);
  }
  let renamed = 0;
  for (const [old, s] of map) {
    fs.renameSync(path.join(previews, old), path.join(previews, s));
    renamed++;
  }
  log(`seed-previews: 目录改名 ${renamed} 个（v0..v${renamed - 1}）`);
  return { renamed };
}

// ═══════════════════════════════════════════════════════════════════
// 变换 G：删 otlp-transformer 的 unused 嵌套 resources（159 → 156→…）
// ═══════════════════════════════════════════════════════════════════
// 依据（2026-10-24 读码实测）：
//   otlp-transformer/build/src/**/*.js 里 **零处** require("@opentelemetry/resources")
//   （只有 .d.ts/.map 提及，且那些已被变换 A 清掉）—— 它的
//   node_modules/@opentelemetry/resources@2.9.0 是 unused dep，整支可删。
//   对照组 sdk-metrics 的 MeterProvider.js:9 有运行时 require，其嵌套份
//   **必须保留**（本函数不碰它）。
// 判定不靠白名单而靠**实测扫描**：删前再扫一遍 otlp-transformer/build/src
// 的 .js 是否出现 @opentelemetry/resources —— 出现即跳过（自保护）。
export function pruneUnusedNestedResources(staging, log = () => {}) {
  const target = path.join(staging, 'dsh-desktop', 'node_modules', '@opentelemetry',
    'otlp-transformer', 'node_modules', '@opentelemetry', 'resources');
  if (!fs.existsSync(target)) return { removed: 0 };
  // 自保护：宿主包运行面（build/src/*.js，esm/esnext 已被 A 删）零引用才删
  // target = .../otlp-transformer/node_modules/@opentelemetry/resources
  // 上跳 3 级 = otlp-transformer（初版只跳 2 级指到 node_modules，hostSrc
  // 永不存在 → 自保护永远 early-return，159 一轮白跑 —— 教训：路径改动必须打印）
  const hostPkg = path.dirname(path.dirname(path.dirname(target)));
  const hostSrc = path.join(hostPkg, 'build', 'src');
  if (!fs.existsSync(hostSrc)) { log('nested-resources: 宿主 build/src 不存在（异常布局），保留'); return { removed: 0 }; }
  let used = false;
  const hunt = (d) => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) hunt(full);
      else if (e.name.endsWith('.js')) {
        const t = fs.readFileSync(full, 'utf8');
        if (t.includes('@opentelemetry/resources')) { used = true; return; }
      }
    }
  };
  hunt(hostSrc);
  if (used) { log('nested-resources: otlp-transformer 运行面引用了，保留'); return { removed: 0 }; }
  const measureRm = (p) => {
    let s = 0;
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, e.name);
      if (e.isDirectory()) s += measureRm(full);
      else { s += fs.statSync(full).size; fs.rmSync(full, { force: true }); }
    }
    fs.rmdirSync(p);
    return s;
  };
  const bytes = measureRm(target);
  // 清掉空的祖先（otlp-transformer/node_modules/@opentelemetry、node_modules）
  const nm = path.join(path.dirname(path.dirname(target)));
  try { if (fs.existsSync(nm) && fs.readdirSync(nm).length === 0) fs.rmdirSync(nm); } catch { /* 非空留着 */ }
  log(`nested-resources: 删除 otlp-transformer 未用嵌套 resources / ${(bytes / 1048576).toFixed(2)} MB`);
  return { removed: 1, bytes };
}

// ═══════════════════════════════════════════════════════════════════
// 变换 H：删孤儿 sdk-metrics / sdk-trace（154 → 150 收口）
// ═══════════════════════════════════════════════════════════════════
// 依据（2026-10-24 依赖面实测）：产品里只有两个消费者 ——
//   @deepseek-ai/dsh-otel 与 dsh-host-product-telemetry-otel，
//   它们的 dependencies 只含 api/api-logs/core/otlp-exporter-base/
//   otlp-transformer/resources/sdk-logs —— **没有 sdk-metrics/sdk-trace**。
//   这两包是 pnpm 解析残留的孤儿，且各自拖着嵌套 resources@2.9.0
//   （154 字符长的源头）。删除前自保护：全 dsh-desktop/node_modules
//   的 @deepseek-ai 层 .js 里 require("@opentelemetry/sdk-metrics|sdk-trace")
//   必须为 0，否则跳过。
export function pruneOrphanSdks(staging, log = () => {}) {
  const nm = path.join(staging, 'dsh-desktop', 'node_modules');
  if (!fs.existsSync(nm)) return { removed: [] };
  // 自保护扫描：@deepseek-ai 包（产品代码）运行面是否引用
  let used = false; const usedBy = [];
  const dsRoot = path.join(nm, '@deepseek-ai');
  if (fs.existsSync(dsRoot)) {
    const scan = (d) => {
      let ents;
      try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (used) return;
        const full = path.join(d, e.name);
        if (e.isDirectory()) scan(full);
        else if (e.name.endsWith('.js')) {
          const t = fs.readFileSync(full, 'utf8');
          if (t.includes('"@opentelemetry/sdk-metrics"') || t.includes("'@opentelemetry/sdk-metrics'")
            || t.includes('"@opentelemetry/sdk-trace"') || t.includes("'@opentelemetry/sdk-trace'")) {
            used = true; usedBy.push(path.relative(staging, full));
          }
        }
      }
    };
    scan(dsRoot);
  }
  if (used) { log(`orphan-sdks: 产品代码引用了（${usedBy[0]}），保留`); return { removed: [] }; }
  const removed = [];
  const otelRoot = path.join(nm, '@opentelemetry');
  for (const name of ['sdk-metrics', 'sdk-trace']) {
    const p = path.join(otelRoot, name);
    if (!fs.existsSync(p)) continue;
    let size = 0;
    const rm = (q) => {
      for (const e of fs.readdirSync(q, { withFileTypes: true })) {
        const full = path.join(q, e.name);
        if (e.isDirectory()) size += rm(full);
        else { size += fs.statSync(full).size; fs.rmSync(full, { force: true }); }
      }
      fs.rmdirSync(q);
      return size;
    };
    size += rm(p);
    removed.push(`${name}(${(size / 1048576).toFixed(1)}MB)`);
  }
  log(`orphan-sdks: 删除 ${removed.join(', ') || '无'}`);
  return { removed };
}

// ═══════════════════════════════════════════════════════════════════
// 变换 I：三处收尾（151 → ≤146）
// ═══════════════════════════════════════════════════════════════════
// 1) libreoffice-kit 的 sources/ 源码补丁文档（.patch）—— vendored 构建材料，
//    运行时不读（二进制已在 bin/）。删除整个 sources/engine/native/patches。
// 2) seed prompts/<皮肤>/manifest.json（151）—— 与 previews 同构：目录名
//    缩 vN，引用面 bootstrap 的 items[].promptFile / extraFiles（封闭）。
// 3) sdk-logs 嵌套 resources（152）运行时必需 —— 但其长文件仅
//    machine-id/{getMachineId.js,getMachineId-win.js,execAsync.js} 等，
//    152 ≤ 门禁 150 差 2 字符：把 build/src/detectors/platform 目录**整体**
//    下沉不可行；改为删 platform/node 下非入口的 *.d.ts（A 已删 .map/.d.ts？
//    A 只删后缀命中的 —— sdk-logs 嵌套层在 node_modules 里应已被 A 覆盖，
//    剩余 152 的是 .js 本体，动不了）。→ sdk-logs 嵌套份保留，靠 1+2 把
//    门禁压到 ≤150（152 那条仍会超 —— 需要评估）。
export function finalTrim(staging, log = () => {}) {
  let removedFiles = 0;

  // 1) libreoffice patch 文档
  const patches = path.join(staging, 'dsh-desktop', 'node_modules', '@deepseek-ai',
    'libreoffice-kit-win32-x64', 'sources', 'engine', 'native', 'patches');
  if (fs.existsSync(patches)) {
    const rm = (p) => {
      for (const e of fs.readdirSync(p, { withFileTypes: true })) {
        const full = path.join(p, e.name);
        if (e.isDirectory()) rm(full);
        else { fs.rmSync(full, { force: true }); removedFiles++; }
      }
      fs.rmdirSync(p);
    };
    try { rm(patches); } catch { /* 不阻断 */ }
  }

  // 2) prompts 目录名缩短（与 previews 同构）
  const assetsPkg = path.join(staging, 'dsh-desktop', 'assets', 'full-pack', 'profile-seed',
    'node_modules', 'eac-plugin-suite', 'node_modules', 'eac-plugin-suite-assets');
  const prompts = path.join(assetsPkg, 'assets', 'prompts');
  const bootFile = path.join(assetsPkg, 'assets', 'bootstrap.json');
  if (fs.existsSync(prompts) && fs.existsSync(bootFile)) {
    const dirs = fs.readdirSync(prompts).sort();
    const map = new Map();
    dirs.forEach((d, i) => map.set(d, 'w' + i));
    // 引用面：bootstrap.json + items[].promptFile 里 prompts/<皮肤>/
    let t = fs.readFileSync(bootFile, 'utf8');
    let hit = 0;
    for (const [old, s] of map) {
      const before = t;
      t = t.split(`prompts/${old}/`).join(`prompts/${s}/`);
      if (t !== before) hit++;
    }
    fs.writeFileSync(bootFile, t);
    let renamed = 0;
    for (const [old, s] of map) {
      if (fs.existsSync(path.join(prompts, old))) {
        fs.renameSync(path.join(prompts, old), path.join(prompts, s));
        renamed++;
      }
    }
    log(`final-trim: prompts 目录改名 ${renamed} 个`);
  }

  log(`final-trim: 共删 ${removedFiles} 个补丁文档文件`);
  return { removedFiles };
}

// ═══════════════════════════════════════════════════════════════════
// Inspector 的 Issues Markdown 是运行资源，只缩短便携树内的目录并同步 URL、摘要。
export function shortenInspectorDescriptionPaths(staging, log = () => {}) {
  const devtools = path.join(staging, 'dsh-desktop', 'node_modules', '@deepseek-ai',
    'dsh-experimental-inspector', 'lib', 'devtools');
  const prefix = 'models/issues_manager/descriptions/';
  const source = path.join(devtools, prefix);
  if (!fs.existsSync(source)) return { moved: 0 };
  const destination = path.join(devtools, 'i');
  if (fs.existsSync(destination)) throw new Error('inspector-shorten: 目标目录已存在');

  const manifestFile = path.join(devtools, 'resource-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  // 保留上游按 document.baseURI / worker location 选择根地址的逻辑。
  const reference = /new URL\(`descriptions\/(\$\{\w+\})`, new URL\("models\/issues_manager\/MarkdownIssueDescription\.js",/g;
  const changes = [];
  let references = 0;
  for (const entry of manifest.files) {
    if (!entry.path.startsWith('chunks/') || !entry.path.endsWith('.js')) continue;
    const file = path.join(devtools, entry.path);
    const text = fs.readFileSync(file, 'utf8');
    const rewritten = text.replace(reference, (_match, variable) => {
      references++;
      return 'new URL(`../../i/' + variable + '`, new URL("models/issues_manager/MarkdownIssueDescription.js",';
    });
    if (rewritten !== text) changes.push({ file, entry, text: rewritten });
  }
  if (references !== 1) throw new Error(`inspector-shorten: 预期 1 处资源 URL，实际 ${references}`);

  let moved = 0;
  for (const entry of manifest.files) {
    if (entry.path.startsWith(prefix)) {
      entry.path = 'i/' + entry.path.slice(prefix.length);
      moved++;
    }
  }
  if (!moved) throw new Error('inspector-shorten: 资源清单缺少 Issues Markdown');
  fs.renameSync(source, destination);
  for (const change of changes) {
    fs.writeFileSync(change.file, change.text);
    change.entry.bytes = Buffer.byteLength(change.text);
    change.entry.sha256 = createHash('sha256').update(change.text).digest('hex');
  }
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  log(`inspector-shorten: ${moved} 个资源移至 i/，同步资源 URL 与清单摘要`);
  return { moved };
}

// 变换 J（必须最后跑）：bundle-manifest.json 文件数重算
// ═══════════════════════════════════════════════════════════════════
// 背景（2026-10-24 产物级事故）：dsh-desktop/bundle-manifest.json 固化每个包
// 的期望文件数（构建期生成）。变换 A/H 剔除文件后，启动期 verifyBundleIntegrity
// 按旧数校验 → "files lost (expected=170, actual=60)" → boot.start 失败、
// 产物白屏。调试实例无此文件（legacy install 跳过）所以没暴露。
// 修法：所有变换跑完后重数每个包的实际文件数写回 manifest。
// 校验语义保持：启动时数的数 = 打包时数的数，防用户侧文件丢失仍然有效。
export function rebuildBundleManifest(staging, log = () => {}) {
  const dd = path.join(staging, 'dsh-desktop');
  const manifestFile = path.join(dd, 'bundle-manifest.json');
  if (!fs.existsSync(manifestFile)) { log('bundle-manifest: 无（legacy），跳过'); return { updated: 0 }; }
  const nm = path.join(dd, 'node_modules');
  if (!fs.existsSync(nm)) return { updated: 0 };
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const countFiles = (dir) => {
    let n = 0;
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
    for (const e of ents) {
      if (e.isDirectory()) n += countFiles(path.join(dir, e.name));
      else n++;
    }
    return n;
  };
  let updated = 0;
  const dropped = [];
  for (const name of Object.keys(manifest.packages ?? {})) {
    const pkgDir = path.join(nm, ...name.split('/'));
    if (!fs.existsSync(pkgDir)) {
      // 包被整支删（如 sdk-metrics/sdk-trace）：从清单移除，否则校验报目录缺失
      delete manifest.packages[name];
      dropped.push(name);
      updated++;
      continue;
    }
    const actual = countFiles(pkgDir);
    if (manifest.packages[name].files !== actual) {
      manifest.packages[name] = { files: actual };
      updated++;
    }
  }
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  log(`bundle-manifest: 重算 ${updated} 个包的文件数${dropped.length ? '；移除整删包: ' + dropped.join(', ') : ''}`);
  return { updated, dropped };
}

// ═══════════════════════════════════════════════════════════════════
// 变换 K：皮肤包 bundle patch 的 wiring id 规范化
// ═══════════════════════════════════════════════════════════════════
// 依据（2026-10-24 用户手测抓到「切蓝色幻想无效」）：皮肤包自带的
// cordis.patch.yml 里 insert 行的 id 必须等于 skin.json 的 wiring.id ——
// 皮肤管理器的 managed 段与 stripManagedBlock 全按 wiring.id 工作。
// @linxin666/dsh-client-ui-skin-blue-fantasy 上游包写的是裸名
// blue-fantasy（13 款中唯一的异类），导致：
//   managed 段写 ui-skin-blue-fantasy: false（启用）
//   bundle 层残留 blue-fantasy 行（无 disabled，默认启用）→ 两行并存
//   stripManagedBlock 认不出裸名行 → 永远无法关掉/切换
// 修法：打包时对照 skin.json wiring.id 规范 patch 行 id。查过的皮肤里
// 只有 blue-fantasy 不齐；本变换通用处理所有不齐的包。
export function normalizeSkinWiringIds(staging, log = () => {}) {
  const scan = (skinsParent) => {
    if (!fs.existsSync(skinsParent)) return 0;
    let fixed = 0;
    for (const scope of fs.readdirSync(skinsParent, { withFileTypes: true })) {
      if (!scope.isDirectory()) continue;
      const scopeDir = path.join(skinsParent, scope.name);
      if (scope.name.startsWith('@')) {
        fixed += scan(scopeDir);
        continue;
      }
      // 皮肤包目录：读 skin.json 与 cordis.patch.yml 对照
      const sj = path.join(scopeDir, 'skin.json');
      const pj = path.join(scopeDir, 'cordis.patch.yml');
      if (!fs.existsSync(sj) || !fs.existsSync(pj)) continue;
      try {
        const wiring = JSON.parse(fs.readFileSync(sj, 'utf8'))?.wiring?.id;
        if (typeof wiring !== 'string' || !wiring) continue;
        let t = fs.readFileSync(pj, 'utf8');
        // insert 行的 id 若 ≠ wiring.id 且是 wiring.id 去前缀形态 → 规范
        const m = /(- id:\s*)'?(?!ui-skin-)([a-zA-Z0-9_-]+)'?(\s*\n\s*name:\s*['"][^'"]+['"])/.exec(t);
        if (m && wiring === 'ui-skin-' + m[2]) {
          t = t.replace(m[0], m[1] + wiring + m[3]);
          fs.writeFileSync(pj, t);
          fixed++;
          log(`wiring-id: ${scope.name} patch id ${m[2]} → ${wiring}`);
        }
      } catch { /* 损坏的包跳过 */ }
    }
    return fixed;
  };
  let total = 0;
  // 两个皮肤实物面：assets/skins 与 seed node_modules（后者含 @scope 嵌套）
  total += scan(path.join(staging, 'dsh-desktop', 'assets', 'skins'));
  total += scan(path.join(staging, 'dsh-desktop', 'assets', 'full-pack', 'profile-seed', 'node_modules'));
  log(`wiring-id: 规范化 ${total} 个皮肤包的 patch 行 id`);
  return { fixed: total };
}
