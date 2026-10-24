import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinPluginDirs } from '../../tauri-shell/distro.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts: string[]): string => readFileSync(join(root, ...parts), 'utf8');
// 递归收集目录下所有 .js 的仓库相对路径；目录不存在（已清除）返回空数组。
const listJs = (dir: string, ...parts: string[]): string[] => {
  const base = join(dir, ...parts);
  if (!existsSync(base)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    const rel = join(...parts, entry.name);
    if (entry.isDirectory()) out.push(...listJs(dir, rel));
    else if (entry.name.endsWith('.js')) out.push(rel);
  }
  return out;
};
const main = read('tauri-shell', 'src', 'main.rs');
const server = read('tauri-shell', 'sidecar', 'server.ts');
const stubs = read('tauri-shell', 'sidecar', 'capability-stubs.ts');
const stage = read('tauri-shell', 'stage-resources.mjs');
const build = read('tauri-shell', 'build.rs');
const platform = read('dsh-desktop', 'lib', 'desktop', 'platform.ts');
const skinAssets = [
  read('tauri-shell', 'host-profile.json'),
  read('tauri-shell', 'skin-manager-artifact.lock.json'),
  read('tauri-shell', 'artifacts', 'resolved', 'system.default', 'skin.json'),
  read('tauri-shell', 'artifacts', 'resolved', 'system.default', 'snapshot.json'),
].join('\n');

test('minimal shell has no recovery center entry points', () => {
  assert.doesNotMatch(main, /\/recovery-center|DSH_DESKTOP_RECOVERY|"rc\.open"|"shell\.relaunch-safe-mode"/);
  assert.equal(existsSync(join(root, 'dsh-desktop', 'assets', 'recovery-center.html')), false);
  assert.equal(existsSync(join(root, 'dsh-desktop', 'assets', 'recovery-center-preload.js')), false);
  assert.doesNotMatch(skinAssets, /recovery-center(?:\.html)?|恢复中心|safe-mode|card-raised/);
});

test('minimal sidecar does not register retired recovery RPC families', () => {
  assert.doesNotMatch(server, /DSH_DESKTOP_RECOVERY/);
  assert.doesNotMatch(server, /stubs\.(?:rcMethods|rescueMethods|guardMethods)/);
  assert.doesNotMatch(stubs, /['"](?:rc|rescue|guard)\.[\w-]+['"]\s*:/);
});

// v6 Task 3.3：插件系统接回后，平台抽象重新暴露插件能力矩阵。
// 原断言（pluginCapabilityDetails 不存在）随接回反转：现在锁住它必须存在，
// 且保持按平台判定可用性的语义。防呆方向由"必须不存在"改为"必须存在且完整"。
test('platform abstraction exposes plugin capability matrix after Task 3.3', () => {
  assert.match(platform, /pluginCapabilityDetails/);
  assert.match(platform, /PluginCapability/);
  assert.match(platform, /status: 'supported' \| 'external-dependency' \| 'unavailable'/);
  // 四个受能力矩阵管辖的插件必须全部有平台判定项。
  for (const id of ['computer-user', 'picturereader', 'dsh-dafeiyu', 'dsh-stt']) {
    assert.match(platform, new RegExp(`${id}`), `能力矩阵缺少 ${id}`);
  }
});

test('minimal shell has no float, update, about, or renderer heartbeat implementation', () => {
  assert.doesNotMatch(main, /"float\.(?:open|close)"|fn open_float_window|fn update_page|fn about_page/);
  assert.doesNotMatch(main, /"(?:client-update\.(?:show|hide)|shell\.about|shell\.exit-dismiss|log\.renderer-heartbeat)"/);
});

test('staging excludes retired recovery and isolation modules', () => {
  // v6 Task 3.3：插件治理闭包接回后，plugin-copy.js 重新进入装配面
  //（companion-sync 消费），故自退役清单移除；其余仍必须被排除。
  for (const retired of [
    'recovery-center.html',
    'recovery-center-preload.js',
    'state.js',
    'log.js',
    'logger.js',
    'shared/protocol.js',
  ]) {
    const escaped = retired.replaceAll('.', '\\.');
    // 词边界防止子串误匹配（如 plugin-manager-state.js 含 'state.js'）。
    assert.doesNotMatch(stage, new RegExp(`(^|[^-\\w])${escaped}`));
  }
  // 接回项必须真实进入装配清单，反向锁住 Task 3.3 不被回退。
  for (const revived of ['plugin-copy.js', 'companion-sync.js', 'guard-box.js', 'plugin-ops.js', 'file-roots.js']) {
    assert.match(stage, new RegExp(revived.replaceAll('.', '\\.')));
  }
});

test('minimal shell keeps boot recovery, native window actions, and system notification', () => {
  assert.match(server, /['"]boot\.start['"]\s*:/);
  assert.match(server, /['"]boot\.restart['"]\s*:/);
  assert.match(main, /fn died_page\(/);
  assert.match(main, /"win\.minimize"\s*=>/);
  assert.match(main, /"win\.open-browser"\s*=>/);
  assert.match(main, /"win\.viewport-beat"\s*=>/);
  assert.match(main, /"shell\.system-notification"\s*=>/);
});

test('WS JSON-RPC client remains a single staged source for the main window bridge', () => {
  assert.match(build, /\.join\("assets"\)[\s\S]*\.join\("ws-jsonrpc-client\.js"\)/);
  assert.match(build, /bridge-bundle\.js/);
  assert.match(main, /BRIDGE_JS: &str = include_str!/);
  assert.match(stage, /'ws-jsonrpc-client\.js'/);
});

test('bundle integrity remains in build manifest generation and startup verification', () => {
  assert.match(stage, /buildBundleManifest|bundle-integrity\.js/);
  assert.match(server, /verifyBundle/);
});

// ADR 0006 v4「源码删除」裁决：supervisor / extension-host / recovery-center 的进程隔离
// 运行时源码已剥出，本机残留的 tsc 编译产物（未被 git 跟踪）属死代码——require 闭包已断
// （host-bootstrap.js 未跟踪、shared/protocol.js 已列 RETIRED_PATHS）。此处锁死不得回归。
test('isolation runtime leaves no compiled .js residue', () => {
  const residue = ['supervisor', 'extension-host', 'recovery-center'].flatMap((retired) =>
    listJs(join(root, 'dsh-desktop'), 'lib', retired),
  );
  assert.deepEqual(residue, [], '隔离运行时源码已剥出，lib 下不得残留 .js 编译产物');
});

// ISO-005（GAP D3）：运行时清单必须等于装配面实物 —— 三口径（装配 BUILTIN_PLUGIN_DIRS /
// 账本 builtin / 运行时 COMPANION_PLUGINS）漂移的机器门。收敛前 COMPANION 有 44 项而
// 实物只有 9 项，35 项每次启动只留「配套插件源目录无效，跳过」，既无日志价值也让
// 「随包面」在运行期失真。此后：清单 1:1 对齐装配面，不随包的插件一律走 RETIRED 兜底。
test('runtime companion registry matches the staged builtin set and retires the rest', async () => {
  // 随包面口径已移到 tauri-shell/distro.mjs（装配 / 描述符 / 测试共用唯一事实源），
  // 不再从 stage-resources.mjs 源码正则解析。
  const stagedDirs = [...builtinPluginDirs('lite')];
  assert.ok(stagedDirs.length > 0, '装配面必须至少随包一个内置插件');

  const companion = await import('../lib/desktop/companion-sync.js') as {
    COMPANION_PLUGINS: { id: string; name: string; dir?: string }[];
    RETIRED_BUILTIN_PLUGINS: { id: string; name: string }[];
  };
  const dirOf = (p: { name: string; dir?: string }): string =>
    p.dir || (p.name.includes('/') ? p.name.split('/').pop()! : p.name);

  // 1) 运行时登记面 = 装配面（逐项一致，无悬空项、无漏登记项）。
  //
  // 例外：皮肤管理器（dsh-client-ui-skin-deep-whale-manager）随包但**不走**
  // COMPANION_PLUGINS。它自带 `dsh.bundle.patch`，挂载行由包内 cordis.patch.yml
  // 提供；若再登记进配套表，同一包会被两处各注册一个 entry，内核报
  // `duplicate exact route "/api/dsh/skins"` 且 `1 entry did not activate`，
  // 管理器不激活 → 不写 body 皮肤属性 → 所有皮肤静默失效（2026-10-23 实测）。
  // 它的「随包」由 distro 清单证明（上面的 stagedDirs + 下面的实物校验）。
  const BUNDLE_WIRED_CORE = new Set(['dsh-client-ui-skin-deep-whale-manager']);
  assert.deepEqual(
    companion.COMPANION_PLUGINS.map(dirOf).sort(),
    stagedDirs.filter((d) => !BUNDLE_WIRED_CORE.has(d)).sort(),
    'COMPANION_PLUGINS 必须与装配面 BUILTIN_PLUGIN_DIRS 一致（ISO-005：不再有静默跳过项）',
  );
  // 2) 每个登记项都有实物目录（装配脚本同样 fail-fast 校验）。
  for (const dir of stagedDirs) {
    assert.equal(
      existsSync(join(root, 'dsh-desktop', 'assets', 'plugins', dir, 'package.json')), true,
      `随包插件实物缺失: assets/plugins/${dir}`,
    );
  }
  // 3) 运行时清单与退役清单零交集（同一插件不得既登记又退役）。
  const companionIds = new Set(companion.COMPANION_PLUGINS.map((p) => p.id));
  const companionNames = new Set(companion.COMPANION_PLUGINS.map((p) => p.name));
  const retiredIds = new Set(companion.RETIRED_BUILTIN_PLUGINS.map((p) => p.id));
  const retiredNames = new Set(companion.RETIRED_BUILTIN_PLUGINS.map((p) => p.name));
  for (const id of companionIds) {
    assert.equal(retiredIds.has(id), false, `${id} 不得同时出现在运行时清单与退役清单`);
  }
  for (const name of companionNames) {
    assert.equal(retiredNames.has(name), false, `${name} 不得同时出现在运行时清单与退役清单`);
  }
  // 4) 退役面覆盖：台账 main 线中不在装配面的插件必须逐条有 RETIRED 兜底
  //（老 profile 的行/包副本清理依据，id↔包名映射见 RETIRED_BUILTIN_PLUGINS）；
  // 台账包名与收敛前的 COMPANION 登记值一致，由本断言锁定。
  const ledger = JSON.parse(read('dsh-desktop', 'assets', 'SOURCES.json')) as {
    components: { line: string; type: string; name: string; path?: string }[];
  };
  const uncovered = ledger.components
    .filter((c) => c.line === 'main' && c.type === 'plugin')
    .filter((c) => !stagedDirs.includes(String(c.path || '').split('/').pop() || ''))
    .filter((c) => !retiredNames.has(c.name))
    .map((c) => c.name);
  assert.deepEqual(uncovered, [], '不在包的台账插件必须逐条有 RETIRED_BUILTIN_PLUGINS 兜底（缺失=老 profile 残留无人清理）');
  // 5) 精简版停用清单的既有约束（ISO-005 复核）：⊆ 运行时清单，且不命中核心组
  //（核心组锁定停用路径，核心插件在精简版也保持默认启用）。
  const lite = await import('../lib/desktop/install-profile.js') as { LITE_DEFAULT_DISABLED: readonly string[] };
  const registry = await import('../lib/desktop/plugin-sync-registry.js') as { DISTRIBUTION_BUILTIN_PLUGIN_IDS: string[] };
  const coreIds = new Set(registry.DISTRIBUTION_BUILTIN_PLUGIN_IDS);
  for (const id of lite.LITE_DEFAULT_DISABLED) {
    assert.ok(companionIds.has(id), `LITE_DEFAULT_DISABLED 的 ${id} 不在运行时清单（无实物项不得留在精简版停用清单）`);
    assert.equal(coreIds.has(id), false, `LITE_DEFAULT_DISABLED 的 ${id} 属于核心集，不得默认停用`);
  }
});
