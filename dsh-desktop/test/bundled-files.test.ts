import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stageRoot = join(root, '..', 'tauri-shell');

// 防呆（v3.0.0 事故的 Tauri 版）：sidecar 顶层 require/mount 的本地模块若未
// 列进 stage-resources 的装配清单，打包产物启动即抛 "Cannot find module"
// 并闪退。本测试静态比对两边（原 bundled-files 契约针对 main.js +
// electron-builder.yml，两者已随 Electron 壳退役，接管为 sidecar ↔ 装配清单）。

function stageLists() {
  const src = fs.readFileSync(join(stageRoot, 'stage-resources.mjs'), 'utf8');
  const out = {};
  for (const name of ['ROOT_FILES', 'LIB_DESKTOP', 'LIB_VNEXT', 'SCRIPTS']) {
    const m = src.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\]`));
    assert.ok(m, `${name} 清单解析失败`);
    out[name] = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  }
  return out;
}

function sidecarLocalRefs() {
  const src = [
    fs.readFileSync(join(stageRoot, 'sidecar', 'server.ts'), 'utf8'),
    fs.readFileSync(join(stageRoot, 'sidecar', 'capability-stubs.ts'), 'utf8'),
  ].join('\n');
  const refs = [];
  // mount('<name>') → lib/desktop/<name>.js
  for (const m of src.matchAll(/mount<[^>]*>\(['"]([\w-]+)['"]\)|mount\(['"]([\w-]+)['"]\)/g)) {
    refs.push('desktop/' + (m[1] || m[2]) + '.js');
  }
  // require(path.join(DSH_DESKTOP_ROOT, '<file>.js')) → 根模块
  for (const m of src.matchAll(/require\(path\.join\(DSH_DESKTOP_ROOT,\s*'([\w.-]+\.js)'\)\)/g)) {
    refs.push(m[1]);
  }
  // require(path.join(DSH_DESKTOP_ROOT, 'lib', ['desktop',|<dir>]?, '<file>.js'))
  for (const m of src.matchAll(/require\(path\.join\(DSH_DESKTOP_ROOT,\s*'lib',\s*(?:'([\w-]+)',\s*)?'([\w-]+\.js)'\)\)/g)) {
    refs.push((m[1] ? m[1] + '/' : '') + m[2]);
  }
  return [...new Set(refs)];
}

test('sidecar 引用/挂载的每个本地模块都在 stage-resources 装配清单中', () => {
  const lists = stageLists();
  const inList = (ref) => lists.ROOT_FILES.includes(ref)
    || lists.LIB_DESKTOP.includes(ref.replace(/^desktop\//, ''))
    || lists.LIB_VNEXT.includes(ref)
    || lists.SCRIPTS.includes(ref.replace(/^desktop\//, ''));
  const missing = sidecarLocalRefs().filter((r) => !inList(r));
  assert.deepEqual(missing, [],
    '以下模块被 sidecar 引用但未装配，会导致启动即闪退: ' + missing.join(', '));
});

test('装配清单只包含当前运行闭包与构建期职责', () => {
  // v6 Task 3.3：原断言用 deepEqual 锁死最简本体的精确条目，随插件系统接回
  // 必然失效。改为「必需项必须在 + 退役项必须不在」的双向断言，保留防呆
  // 语义（漏装配仍会红）但不再把清单锁成快照。
  const lists = stageLists();
  const mustHave = {
    ROOT_FILES: [
      'session-watcher.js', 'bundle-integrity.js', 'stable-port.js',
      'stream-write-guard.js', 'updater.js',
      // Task 3.3 插件治理闭包（companion-sync 顶层 require 链）
      'plugin-guard.js', 'plugin-updater.js', 'plugin-manager-state.js',
      'builtin-collision.js', 'patch-row-heal.js', 'profile-module-heal.js',
      'preset-sync.js', 'compact-preset-migrate.js', 'router-persona-preset-migrate.js',
    ],
    LIB_DESKTOP: [
      'proc.js', 'platform.js', 'runtime-paths.js', 'environment.js', 'profile.js',
      'runtime-patches.js', 'boot-server.js',
      'client-update.js', 'update-sources.js', 'update-signature.js', 'update-platform.js', 'update-linux.js', 'update-linux-root.js', 'update-linux-helper.js', 'update-appimage.js', 'update-appimage-helper.js',
      // Task 3.3 三件套 + lib/desktop 依赖
      'guard-box.js', 'companion-sync.js', 'plugin-ops.js',
      'install-profile.js', 'plugin-sync-registry.js',
    ],
    LIB_VNEXT: ['atomic-json.js', 'plugin-copy.js'],
    SCRIPTS: ['patch-session-manage.js', 'patch-deps.js', 'onboarding.js', 'plugin-manager-patch.js'],
  };
  assert.ok(lists.ROOT_FILES.includes('client-update-defaults.json'), '发布信任根必须随包装配');
  for (const [listName, required] of Object.entries(mustHave)) {
    for (const entry of required) {
      assert.ok(lists[listName].includes(entry), `${listName} 缺少必需项 ${entry}`);
    }
  }
  // 退役项不得回归（Electron 冻结壳 / 剥出能力 / 更新体系）。
  const retiredRoot = ['error-detail.js', 'koffi-preflight.js', 'renderer-recovery.js',
    'watchdog.js', 'session-encoding-heal.js', 'client-updater.js'];
  for (const dead of retiredRoot) {
    assert.ok(!lists.ROOT_FILES.includes(dead), `${dead} 不得出现在 ROOT_FILES`);
  }
  const retiredDesktop = ['market.js', 'feature-pack.js',
    'shortcuts.js', 'static-preview.js', 'junction-patrol.js'];
  for (const dead of retiredDesktop) {
    assert.ok(!lists.LIB_DESKTOP.includes(dead), `${dead} 不得出现在 LIB_DESKTOP`);
  }
});

test('sidecar 产物只装配 server、bridge 与内部 boot helper', () => {
  const stageScript = fs.readFileSync(join(stageRoot, 'stage-resources.mjs'), 'utf8');
  const match = stageScript.match(/for \(const f of \[([^\]]+)\]\) \{\n\s*cpSync\(path\.join\(root, 'tauri-shell', 'sidecar'/);
  assert.ok(match, 'sidecar 产物清单解析失败');
  assert.deepEqual([...match[1].matchAll(/'([^']+)'/g)].map((x) => x[1]), [
    'server.js',
    'bridge.js',
    'capability-stubs.js',
  ]);
});

test('装配清单不再携带 Electron 冻结壳独享模块', () => {
  const lists = stageLists();
  for (const dead of ['error-detail.js', 'koffi-preflight.js', 'renderer-recovery.js',
    'watchdog.js', 'session-encoding-heal.js']) {
    assert.ok(!lists.ROOT_FILES.includes(dead), `${dead} 仍待在 ROOT_FILES（已随 Electron 壳退役）`);
  }
  assert.ok(!lists.SCRIPTS.includes('koffi-preflight.cjs'), 'koffi-preflight.cjs 仍待在 SCRIPTS');
  assert.ok(!lists.SCRIPTS.includes('make-release-hashes.js'), 'make-release-hashes.js 仍待在 SCRIPTS');
});

test('Tauri 资源装配不再携带 WSL 后端', () => {
  const stageScript = fs.readFileSync(join(stageRoot, 'stage-resources.mjs'), 'utf8');
  assert.doesNotMatch(stageScript, /wsl-backend/i);
  assert.ok(!fs.existsSync(join(root, 'wsl-backend.ts')));
});

test('Tauri 资源装配不再依赖已从内核移除的 fs-ext', () => {
  const stageScript = fs.readFileSync(join(stageRoot, 'stage-resources.mjs'), 'utf8');
  assert.doesNotMatch(stageScript, /fs[-_]ext/i);
});

test('generated plugin registry is included in the staged desktop runtime', () => {
  // v6 严格模式（ADR 0006 v3）：companion-sync 剥出 → plugin-sync-registry
  // v6 Task 3.3：插件系统接回 → plugin-sync-registry 重新进入装配面。
  // 守门方向由「不得含」反转为「必须含」。
  const lists = stageLists();
  assert.ok(lists.LIB_DESKTOP.includes('plugin-sync-registry.js'),
    'plugin-sync-registry.js 必须装配（companion-sync 的生成注册表依赖）');
});

test('staging replays the owned session patch before generating the package integrity manifest',()=>{
 const source=fs.readFileSync(join(stageRoot,'stage-resources.mjs'),'utf8');const session=source.indexOf("execSync('node scripts/patch-session-manage.js'");const manifest=source.indexOf('bi.buildBundleManifest(nmDest)');assert.ok(session>=0&&manifest>session);
});
