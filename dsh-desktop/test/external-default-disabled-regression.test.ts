/**
 * PR #489 审查意见的回归契约：**已有 config、没有 disabled 的外部插件，启动同步后
 * 不得被追写 `disabled: true`。**
 *
 * 为什么需要这条
 * --------------
 * 审查意见（lanyun077）指认的破坏性语义是真实的：`externalDefaultDisabledPlan` 的
 * `isRegistered` 从 `registeredPatchEntryIds` 收紧为 `explicitDisabledEntryIds` 之后，
 * 「装过、用户在 patch 里有 config 行、但没显式写过 disabled」的外部插件会被判成
 * 「未表态」，于是被补一条 `disabled: true` —— 用户原本启用的插件在重启后被关掉。
 *
 * 修复方式是停用整条 `externalDefaultDisabledPlan` 路径（`fae71a9e`），只剩
 * catalog `defaultEnabled: false` 这一条事实源。本文件把「停用之后行为正确」钉死。
 *
 * 为什么不用字符串断言
 * -------------------
 * 现有的 `issue-416-plugin-distribution-tiers.test.ts:352-368` 断言 `companion-sync.ts`
 * 里存在 `/externalDefaultDisabledPlan/`、`/explicitDisabledEntryIds\(patch\)/` 等字符串。
 * 但停用后这些字符串**只剩注释和 `if (false)` 里的 `void`** —— 把整条规划器从代码里
 * 彻底铲掉，只要注释在，那些断言依然是绿的。它们唯一能捕获的回归是「有人删了注释」。
 *
 * 所以这里**真调生产入口** `syncCompanionPlugins()`，读回落盘的 `cordis.patch.yml`。
 *
 * 输入形态取自审查意见给出的最小复现条件（隔离 profile + 真实文件布局）。
 * 有效性验证：把本测试跑在 `f6cf6538`（旧规划器仍在跑）上会 FAIL —— 那一版会在
 * 该行追加 `disabled: true` 并打出「外部插件默认关闭」日志。
 *
 * 一个必须知道的准备步骤：隔离 profile 里必须有**可解析的内核骨架包**
 * （`@deepseek-ai/dsh-base` / `dsh-web-app`）。否则 `resolveBundleIdentities` 的
 * `unresolvedCore` 连坐会把所有非内核包降级为 `ok:false`，规划器直接空转 ——
 * 两个版本都会「看起来没问题」，测试就失去了区分力（这是第一次实测踩到的假阴性）。
 * 真实安装里这两个包一定可解析，所以造存根是合法前提，不是迁就实现。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PKG = 'example-user-plugin';
const ENTRY_ID = 'user-plugin';

/** 用户的既有配置：有 config、**没有** disabled ⇒ 按现有语义是启用状态。 */
const PATCH_SEED = `- id: ${ENTRY_ID}
  config:
    custom: preserve-me
`;

/** 读某个 id 的顶层行块，判断是否被追加了 `disabled: true` / config 是否还在。 */
function inspectEntry(patchText: string, id: string) {
  const lines = patchText.split(/\r?\n/);
  const re = new RegExp('^-\\s*id:\\s*[\'"]?' + id + '[\'"]?\\s*$');
  const start = lines.findIndex((l) => re.test(l));
  if (start < 0) return { found: false, disabled: null, configKept: false, block: '' };
  const block: string[] = [lines[start]];
  for (let k = start + 1; k < lines.length; k += 1) {
    if (/^- /.test(lines[k]) || /^[A-Za-z]/.test(lines[k])) break;
    block.push(lines[k]);
  }
  let disabled = false;
  let configKept = false;
  let inConfig = false;
  for (const line of block) {
    if (/^ {2}config:\s*$/.test(line)) { inConfig = true; continue; }
    if (/^ {2}[^\s]/.test(line)) inConfig = false;
    if (/^ {2}disabled:\s*true\s*$/.test(line)) disabled = true;
    if (inConfig && /^ {4}custom:\s*preserve-me\s*$/.test(line)) configKept = true;
  }
  return { found: true, disabled, configKept, block: block.join('\n') };
}

function writePackage(dir: string, name: string, patchBody: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name,
    version: '0.2.0',
    main: 'index.js',
    dsh: { bundle: { patch: 'cordis.patch.yml' } },
  }, null, 2) + '\n');
  writeFileSync(join(dir, 'index.js'), 'module.exports = {};\n');
  writeFileSync(join(dir, 'cordis.patch.yml'), patchBody);
}

function makeHome(t: test.TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'eac-external-defaults-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'dsh-home');
  const profileDir = join(home, 'profiles', 'web-desktop');
  const nm = join(profileDir, 'node_modules');
  mkdirSync(nm, { recursive: true });

  // 内核骨架存根：真实部署里由应用自带、永远可解析。缺了它们，外部包会因
  // unresolvedCore 连坐被标 ok:false，规划器空转 —— 见文件头注释。
  writePackage(join(nm, '@deepseek-ai', 'dsh-base'), '@deepseek-ai/dsh-base',
    "- insert:\n    - id: dsh-base-boot\n      name: '@deepseek-ai/dsh-base'\n");
  writePackage(join(nm, '@deepseek-ai', 'dsh-web-app'), '@deepseek-ai/dsh-web-app',
    "- insert:\n    - id: dsh-web-app-server\n      name: '@deepseek-ai/dsh-web-app'\n");
  // 被测的外部插件：自带 bundle patch，entry id = user-plugin
  writePackage(join(nm, PKG), PKG, `- insert:\n    - id: ${ENTRY_ID}\n      name: '${PKG}'\n`);

  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web-desktop',
    private: true,
    dependencies: {
      '@deepseek-ai/dsh-base': 'file:./node_modules/@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app': 'file:./node_modules/@deepseek-ai/dsh-web-app',
      [PKG]: 'file:./node_modules/' + PKG,
    },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', PKG] } },
  }, null, 2) + '\n');
  writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n');
  writeFileSync(join(profileDir, 'cordis.patch.yml'), PATCH_SEED);
  return { root, home, profileDir };
}

// companion-sync 依赖一批模块级单例（通过 init 注入）。与
// `tauri-shell/sidecar/server.ts` 的 preBootSync() 调用序列逐项对应。
const runtimePaths = await import('../lib/desktop/runtime-paths.js') as {
  init: (deps: Record<string, unknown>) => void;
};
const profileMod = await import('../lib/desktop/profile.js') as {
  init: (deps: Record<string, unknown>) => void;
  ensureDesktopProfileInit: () => void;
  desktopProfileDir: () => string;
  desktopProfile: string;
};
const guardBox = await import('../lib/desktop/guard-box.js') as {
  init: (deps: Record<string, unknown>) => void;
};
const runtimePatches = await import('../lib/desktop/runtime-patches.js') as {
  init: (deps: Record<string, unknown>) => void;
};
const companionSync = await import('../lib/desktop/companion-sync.js') as {
  init: (deps: Record<string, unknown>) => void;
  syncCompanionPlugins: () => void;
  retireRemovedBuiltinPluginsGated: (dir: string) => void;
};

function runProductionSync(t: test.TestContext) {
  const { home, profileDir } = makeHome(t);
  const userData = join(home, 'user-data');
  mkdirSync(userData, { recursive: true });
  const logs: string[] = [];
  const log = (tag: string, msg: string) => { logs.push(`[${tag}] ${msg}`); };

  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(() => {
    if (prevHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prevHome;
  });

  runtimePaths.init({
    log,
    getUserDataDir: () => userData,
    isPackaged: () => false,
    resourcesPath: () => join(profileDir, '..', '..'),
    platform: 'win32',
  });
  profileMod.init({ log, getDshHome: () => home });
  runtimePatches.init({ log, getDshHome: () => home, getUserDataDir: () => userData });
  guardBox.init({ log, getDshHome: () => home, getDesktopProfile: () => profileMod.desktopProfile });
  companionSync.init({
    log,
    getDshHome: () => home,
    getUserDataDir: () => userData,
    showMainWindow: () => {},
    notify: () => {},
    platform: 'win32',
  });

  // === 生产入口：与 preBootSync() 相同的调用序列 ===
  profileMod.ensureDesktopProfileInit();
  companionSync.retireRemovedBuiltinPluginsGated(profileMod.desktopProfileDir());
  companionSync.syncCompanionPlugins();

  return {
    logs,
    after: readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8'),
  };
}

test('已有 config、未显式 disabled 的外部插件，启动同步后不被追写 disabled', (t) => {
  const { logs, after } = runProductionSync(t);
  const row = inspectEntry(after, ENTRY_ID);

  assert.equal(row.found, true, '同步不得删除用户已有的 patch 行');
  assert.equal(
    row.disabled,
    false,
    '用户已启用（有 config、无 disabled）的外部插件被追写了 disabled: true —— 这是重启后插件被关掉的回归。行块：\n' + row.block,
  );
  assert.equal(row.configKept, true, '用户的 config 必须原样保留');
  assert.deepEqual(
    logs.filter((l) => /外部插件默认关闭/.test(l)),
    [],
    '不应再出现「外部插件默认关闭」日志（该规划器已停用；出现即说明旧路径被重新接回）',
  );
});

test('同步不改动用户自己写的其他 patch 行', (t) => {
  const { after } = runProductionSync(t);
  // 除了可能的 catalog 默认关闭行，用户自己的这条必须逐字保留
  assert.match(after, /^- id: user-plugin$/m, '顶层行形状不得变化');
  assert.match(after, /^ {2}config:$/m, 'config 块不得被展开或改写');
  assert.match(after, /^ {4}custom: preserve-me$/m, 'config 值必须逐字保留');
});
