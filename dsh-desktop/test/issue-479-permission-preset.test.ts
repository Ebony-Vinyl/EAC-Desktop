import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { childEnv, init } from '../lib/desktop/proc.js';

const require = createRequire(import.meta.url);
const {
  patchPermissionPresetSelectSource,
} = require('../scripts/patch-deps.js') as {
  patchPermissionPresetSelectSource: (source: string) => string | undefined;
};

// 逐字节对齐 0.2.1-rc.2 / 0.2.2-rc.1 PermissionPresetSettingsController 编译产物。
const CONTROLLER_FIXTURE = [
  'const PERMISSION_SETTINGS_NS = "permission";',
  'function createSnapshotStore(initial) {',
  '\tlet current = structuredClone(initial);',
  '\tconst listeners = new Set();',
  '\treturn {',
  '\t\tgetSnapshot: () => current,',
  '\t\tset: (next) => { current = next; for (const fn of listeners) fn(); },',
  '\t\tupdate: (fn) => { const next = structuredClone(current); fn(next); current = next; for (const cb of listeners) cb(); },',
  '\t\tsubscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },',
  '\t};',
  '}',
  'var PermissionPresetSettingsController = class {',
  '\t\t\tdescribeFace;',
  '\t\t\tctx;',
  '\t\t\tcatalog;',
  '\t\t\tstore = createSnapshotStore({',
  '\t\t\t\tstatus: "idle",',
  '\t\t\t\terror: null,',
  '\t\t\t\twritable: false,',
  '\t\t\t\tcurrentValue: "",',
  '\t\t\t\toptions: [],',
  '\t\t\t\trevision: 0',
  '\t\t\t});',
  '\t\t\tfollowing;',
  '\t\t\tfollowingCatalog;',
  '\t\t\tsaving = false;',
  '\t\t\tdisposed = false;',
  '\t\t\tconstructor(describeFace, ctx, catalog) {',
  '\t\t\t\tthis.describeFace = describeFace;',
  '\t\t\t\tthis.ctx = ctx;',
  '\t\t\t\tthis.catalog = catalog;',
  '\t\t\t}',
  '\t\t\tasync load() {',
  '\t\t\t\tif (this.disposed) return;',
  '\t\t\t\tthis.following ??= this.describeFace.subscribe(() => {',
  '\t\t\t\t\tthis.derive();',
  '\t\t\t\t});',
  '\t\t\t\tthis.followingCatalog ??= this.catalog.store.subscribe(() => {',
  '\t\t\t\t\tthis.derive();',
  '\t\t\t\t});',
  '\t\t\t\tthis.store.update((state) => {',
  '\t\t\t\t\tstate.status = "loading";',
  '\t\t\t\t\tstate.error = null;',
  '\t\t\t\t});',
  '\t\t\t\tawait this.describeFace.ensure();',
  '\t\t\t\tawait this.catalog.load();',
  '\t\t\t\tthis.derive();',
  '\t\t\t}',
  '\t\t\tasync select(preset) {',
  '\t\t\t\tconst state = this.store.getSnapshot();',
  '\t\t\t\tconst view = this.describeFace.getSnapshot().view?.namespaces.find((entry) => entry.ns === PERMISSION_SETTINGS_NS);',
  '\t\t\t\tif (view === void 0 || !state.writable || this.saving) return;',
  '\t\t\t\tthis.saving = true;',
  '\t\t\t\tthis.store.update((draft) => {',
  '\t\t\t\t\tdraft.status = "saving";',
  '\t\t\t\t\tdraft.error = null;',
  '\t\t\t\t});',
  '\t\t\t\tlet response;',
  '\t\t\t\ttry {',
  '\t\t\t\t\tresponse = await this.ctx.remote.settings.mutate(PERMISSION_SETTINGS_NS, [{',
  '\t\t\t\t\t\top: "set",',
  '\t\t\t\t\t\tpath: ["defaultPreset"],',
  '\t\t\t\t\t\tvalue: preset',
  '\t\t\t\t\t}], view.revision);',
  '\t\t\t\t} finally {',
  '\t\t\t\t\tthis.saving = false;',
  '\t\t\t\t}',
  '\t\t\t\tif (this.disposed) return;',
  '\t\t\t\tif (!response.ok) {',
  '\t\t\t\t\tthis.fail(response.error);',
  '\t\t\t\t\treturn;',
  '\t\t\t\t}',
  '\t\t\t\tthis.describeFace.acceptView(response.value);',
  '\t\t\t}',
  '\t\t\tdispose() {',
  '\t\t\t\tthis.disposed = true;',
  '\t\t\t\tthis.following?.();',
  '\t\t\t\tthis.following = void 0;',
  '\t\t\t}',
  '\t\t\tderive() {',
  '\t\t\t\tif (this.disposed || this.saving) return;',
  '\t\t\t\tconst mirrored = this.describeFace.getSnapshot();',
  '\t\t\t\tif (mirrored.view === void 0) return;',
  '\t\t\t\tconst view = mirrored.view.namespaces.find((entry) => entry.ns === PERMISSION_SETTINGS_NS);',
  '\t\t\t\tif (view === void 0) return;',
  '\t\t\t\tthis.store.update((state) => {',
  '\t\t\t\t\tstate.status = "ready";',
  '\t\t\t\t\tstate.error = null;',
  '\t\t\t\t\tstate.writable = mirrored.view.writable;',
  '\t\t\t\t\tstate.currentValue = view.value.defaultPreset;',
  '\t\t\t\t\tstate.options = [{ id: "read-only" }, { id: "workspace-write" }, { id: "danger-full-access" }];',
  '\t\t\t\t\tstate.revision = view.revision;',
  '\t\t\t\t});',
  '\t\t\t}',
  '\t\t\tfail(error) {',
  '\t\t\t\tthis.store.update((state) => {',
  '\t\t\t\t\tstate.status = "error";',
  '\t\t\t\t\tstate.error = error instanceof Error ? error.message : String(error.message ?? error);',
  '\t\t\t\t});',
  '\t\t\t}',
  '};',
].join('\n');

interface NamespaceView {
  ns: string;
  revision: number;
  value: { defaultPreset: string };
}

function buildPatchedControllerClass() {
  const patched = patchPermissionPresetSelectSource(CONTROLLER_FIXTURE);
  assert.ok(patched, 'patchPermissionPresetSelectSource 必须命中控制器夹具');
  const factory = new Function(`${patched}\nreturn { PermissionPresetSettingsController, createSnapshotStore };`);
  return factory() as {
    PermissionPresetSettingsController: new (describeFace: unknown, ctx: unknown, catalog: unknown) => {
      store: { getSnapshot: () => { status: string; error: string | null; currentValue: string; revision: number } };
      load: () => Promise<void>;
      select: (preset: string) => Promise<void>;
      dispose: () => void;
    };
    createSnapshotStore: <T>(initial: T) => {
      getSnapshot: () => T;
      set: (next: T) => void;
      subscribe: (fn: () => void) => () => void;
    };
  };
}

function createHarness(mutateImpl: (ns: string, ops: Array<{ value: string }>, rev?: number) => Promise<unknown>, onLoad?: () => NamespaceView) {
  const { PermissionPresetSettingsController, createSnapshotStore } = buildPatchedControllerClass();
  const mirrorStore = createSnapshotStore({
    status: 'ready',
    error: null as string | null,
    view: {
      writable: true,
      namespaces: [{ ns: 'permission', revision: 50, value: { defaultPreset: 'workspace-write' } }],
    },
  });
  let loadCalls = 0;
  const statusesDuringSave: string[] = [];
  const describeFace = {
    getSnapshot: () => mirrorStore.getSnapshot(),
    subscribe: (fn: () => void) => mirrorStore.subscribe(fn),
    ensure: async () => {},
    load: async () => {
      loadCalls += 1;
      const refreshed = onLoad
        ? onLoad()
        : { ns: 'permission', revision: 54, value: { defaultPreset: 'workspace-write' } };
      mirrorStore.set({
        status: 'ready',
        error: null,
        view: { writable: true, namespaces: [refreshed] },
      });
    },
    acceptView: (nextView: NamespaceView) => {
      mirrorStore.set({
        status: 'ready',
        error: null,
        view: { writable: true, namespaces: [nextView] },
      });
    },
  };
  const catalog = {
    store: createSnapshotStore({ value: { defaultPreset: 'workspace-write' } }),
    load: async () => {},
  };
  const calls: Array<{ ns: string; preset: string; expectedRevision: number | undefined }> = [];
  const ctx = {
    remote: {
      settings: {
        mutate: async (ns: string, ops: Array<{ value: string }>, expectedRevision?: number) => {
          calls.push({ ns, preset: ops[0]!.value, expectedRevision });
          return mutateImpl(ns, ops, expectedRevision);
        },
      },
    },
  };
  const controller = new PermissionPresetSettingsController(describeFace, ctx, catalog);
  mirrorStore.subscribe(() => {
    statusesDuringSave.push(`${controller.store.getSnapshot().status}:${controller.store.getSnapshot().currentValue}`);
  });
  return { controller, calls, getLoadCalls: () => loadCalls, statusesDuringSave };
}

test('issue #479: 并发版本落后报 settings/conflict 时刷新镜像并按新 revision 重试成功', async () => {
  const h = createHarness(async (_ns, ops, rev) => {
    if (rev === 50) {
      return {
        ok: false,
        error: { code: 'settings/conflict', message: 'expected revision 50, now 54' },
      };
    }
    assert.equal(rev, 54);
    return {
      ok: true,
      value: { ns: 'permission', revision: 55, value: { defaultPreset: ops[0]!.value } },
    };
  });
  await h.controller.load();
  await h.controller.select('read-only');
  assert.equal(h.getLoadCalls(), 1);
  assert.deepEqual(h.calls.map((c) => c.expectedRevision), [50, 54]);
  assert.equal(h.controller.store.getSnapshot().status, 'ready');
  assert.equal(h.controller.store.getSnapshot().currentValue, 'read-only');
  assert.equal(h.controller.store.getSnapshot().revision, 55);
  assert.equal(h.controller.store.getSnapshot().error, null);
  // saving 期间 load() 不应把旧值提前刷回 ready 态引发回弹闪屏
  assert.ok(h.statusesDuringSave[0]?.startsWith('saving:'), '冲突恢复 load 期间必须保持 saving 态');
});

test('issue #479: 并发二次 revision 推进且 defaultPreset 未变时保留 CAS expectedRevision 重试成功', async () => {
  let hostRevision = 54;
  const h = createHarness(
    async (_ns, ops, rev) => {
      if (rev === 50) {
        return {
          ok: false,
          error: { code: 'settings/conflict', message: 'expected revision 50, now 54' },
        };
      }
      if (rev === 54) {
        hostRevision = 58;
        return {
          ok: false,
          error: { code: 'settings/conflict', message: 'expected revision 54, now 58' },
        };
      }
      assert.equal(rev, 58, '二次重试必须严格携带最新 expectedRevision，禁止退化为无 fence 写入');
      return {
        ok: true,
        value: { ns: 'permission', revision: 59, value: { defaultPreset: ops[0]!.value } },
      };
    },
    () => ({ ns: 'permission', revision: hostRevision, value: { defaultPreset: 'workspace-write' } }),
  );
  await h.controller.load();
  await h.controller.select('danger-full-access');
  assert.equal(h.getLoadCalls(), 2);
  assert.deepEqual(h.calls.map((c) => c.expectedRevision), [50, 54, 58]);
  assert.equal(h.controller.store.getSnapshot().status, 'ready');
  assert.equal(h.controller.store.getSnapshot().currentValue, 'danger-full-access');
  assert.equal(h.controller.store.getSnapshot().error, null);
});

test('issue #479: 并发期间目标字段 defaultPreset 已被其他操作改写时严格中止重试不静默覆盖', async () => {
  const h = createHarness(
    async () => ({
      ok: false,
      error: { code: 'settings/conflict', message: 'expected revision 50, now 54' },
    }),
    // 刷新后发现另一个窗口已把 defaultPreset 改成了 read-only
    () => ({ ns: 'permission', revision: 54, value: { defaultPreset: 'read-only' } }),
  );
  await h.controller.load();
  await h.controller.select('danger-full-access');
  assert.equal(h.getLoadCalls(), 1);
  assert.deepEqual(h.calls.map((c) => c.expectedRevision), [50]);
  assert.equal(h.controller.store.getSnapshot().status, 'error');
  assert.match(h.controller.store.getSnapshot().error ?? '', /expected revision 50, now 54/);
});

test('issue #479: 非 settings/conflict 错误不盲目重试并保留错误态', async () => {
  const h = createHarness(async () => ({
    ok: false,
    error: { code: 'settings/forbidden', message: 'profile is read-only' },
  }));
  await h.controller.load();
  await h.controller.select('read-only');
  assert.equal(h.getLoadCalls(), 0);
  assert.equal(h.calls.length, 1);
  assert.equal(h.controller.store.getSnapshot().status, 'error');
  assert.equal(h.controller.store.getSnapshot().error, 'profile is read-only');
});

test('issue #479: proc.childEnv 从 0.2.x profile cordis.patch.yml 读取完全访问且不被退役 .imported 反向抬权', () => {
  const saved = process.env.DSH_PERMISSION_MODE;
  delete process.env.DSH_PERMISSION_MODE;
  const home = mkdtempSync(join(tmpdir(), 'dsh-perm-021-'));
  try {
    const profileDir = join(home, 'profiles', 'web-desktop');
    mkdirSync(profileDir, { recursive: true });
    // 模拟 0.2.x 启动后 settings.yaml 已被重命名为 settings.yaml.imported
    writeFileSync(
      join(home, 'settings.yaml.imported'),
      'permission:\n  defaultPreset: danger-full-access\n',
      'utf8',
    );
    // 1) profile 层 cordis.patch.yml（含 !!js 自定义标签干扰项）写入完全访问 -> 注入环境变量
    writeFileSync(
      join(profileDir, 'cordis.patch.yml'),
      [
        '- id: sandbox-base',
        '  config:',
        '    mode: !!js process.env.DSH_PERMISSION_MODE',
        '- id: permission',
        '  name: "@deepseek-ai/dsh-permission-presets"',
        '  config:',
        '    defaultPreset: danger-full-access',
        '',
      ].join('\n'),
      'utf8',
    );
    init({ log: () => {}, getDshHome: () => home, getDesktopProfile: () => 'web-desktop' });
    assert.equal(childEnv().DSH_PERMISSION_MODE, 'danger-full-access');

    // 2) 用户在设置页切回默认 workspace-write，ConfigEditor 删除了 override 行（只留 []），
    //    尽管 settings.yaml.imported 仍残留旧的 danger-full-access，绝不能死灰复燃抬权！
    writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n', 'utf8');
    // 推高 mtime 以跨越 Windows 文件系统粗粒度时间戳并验证签名刷新
    const future = new Date(Date.now() + 2000);
    require('node:fs').utimesSync(join(profileDir, 'cordis.patch.yml'), future, future);
    assert.equal(childEnv().DSH_PERMISSION_MODE, undefined);

    // 3) Home 层 cordis.patch.yml 优先级高于 profile 层
    writeFileSync(
      join(profileDir, 'cordis.patch.yml'),
      '- id: permission\n  config:\n    defaultPreset: danger-full-access\n',
      'utf8',
    );
    const future2 = new Date(Date.now() + 4000);
    require('node:fs').utimesSync(join(profileDir, 'cordis.patch.yml'), future2, future2);
    writeFileSync(
      join(home, 'cordis.patch.yml'),
      '- id: permission\n  config:\n    defaultPreset: read-only\n',
      'utf8',
    );
    assert.equal(childEnv().DSH_PERMISSION_MODE, undefined);
  } finally {
    if (saved !== undefined) process.env.DSH_PERMISSION_MODE = saved;
    rmSync(home, { recursive: true, force: true });
  }
});

test('issue #479: 高优先级配置文件存在但 YAML 非法时必须 fail-closed（不向低优先级 danger-full-access 回退）', () => {
  const saved = process.env.DSH_PERMISSION_MODE;
  delete process.env.DSH_PERMISSION_MODE;
  const home = mkdtempSync(join(tmpdir(), 'dsh-perm-failclosed-'));
  const warns: string[] = [];
  try {
    const profileDir = join(home, 'profiles', 'web-desktop');
    mkdirSync(profileDir, { recursive: true });
    // 低优先级 profile 层配置为完全访问
    writeFileSync(
      join(profileDir, 'cordis.patch.yml'),
      '- id: permission\n  config:\n    defaultPreset: danger-full-access\n',
      'utf8',
    );
    // 高优先级 home 层文件存在但语法损坏（例如用户刚手改收紧权限时写坏）
    writeFileSync(
      join(home, 'cordis.patch.yml'),
      '- id: permission\n  config: [unterminated\n',
      'utf8',
    );
    init({
      log: (level, msg) => { if (level === 'warn') warns.push(msg); },
      getDshHome: () => home,
      getDesktopProfile: () => 'web-desktop',
    });
    assert.equal(childEnv().DSH_PERMISSION_MODE, undefined, '高优先级文件损坏时绝不能回退到低优先级 danger-full-access');
    assert.ok(warns.some((m) => m.includes('fail-closed')), '高优先级解析失败应记录 warn 日志');
  } finally {
    if (saved !== undefined) process.env.DSH_PERMISSION_MODE = saved;
    rmSync(home, { recursive: true, force: true });
  }
});

test('issue #479: disabled group 内的 permission.defaultPreset 不得被采纳', () => {
  const saved = process.env.DSH_PERMISSION_MODE;
  delete process.env.DSH_PERMISSION_MODE;
  const home = mkdtempSync(join(tmpdir(), 'dsh-perm-disabled-group-'));
  try {
    const profileDir = join(home, 'profiles', 'web-desktop');
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(
      join(profileDir, 'cordis.patch.yml'),
      [
        '- group: true',
        '  disabled: true',
        '  config:',
        '    - id: permission',
        '      config:',
        '        defaultPreset: danger-full-access',
        '',
      ].join('\n'),
      'utf8',
    );
    init({ log: () => {}, getDshHome: () => home, getDesktopProfile: () => 'web-desktop' });
    assert.equal(childEnv().DSH_PERMISSION_MODE, undefined, 'disabled=true 的 group 中 permission 配置不得生效');

    // 取消 group 禁用后应恢复生效
    writeFileSync(
      join(profileDir, 'cordis.patch.yml'),
      [
        '- group: true',
        '  disabled: false',
        '  config:',
        '    - id: permission',
        '      config:',
        '        defaultPreset: danger-full-access',
        '',
      ].join('\n'),
      'utf8',
    );
    const future = new Date(Date.now() + 2000);
    require('node:fs').utimesSync(join(profileDir, 'cordis.patch.yml'), future, future);
    assert.equal(childEnv().DSH_PERMISSION_MODE, 'danger-full-access');
  } finally {
    if (saved !== undefined) process.env.DSH_PERMISSION_MODE = saved;
    rmSync(home, { recursive: true, force: true });
  }
});

test('issue #479: 高优先级 stat 抛出非 ENOENT 错误（如 EACCES/EIO）时必须记录 warn 并 fail-closed（不回退低优先级 danger-full-access）', () => {
  const saved = process.env.DSH_PERMISSION_MODE;
  delete process.env.DSH_PERMISSION_MODE;
  const home = mkdtempSync(join(tmpdir(), 'dsh-perm-stat-err-'));
  const homePatch = join(home, 'cordis.patch.yml');
  const fsMod = require('node:fs') as typeof import('node:fs');
  const origStatSync = fsMod.statSync;
  const warns: string[] = [];
  let injectedErr: NodeJS.ErrnoException | null = null;
  try {
    const profileDir = join(home, 'profiles', 'web-desktop');
    mkdirSync(profileDir, { recursive: true });
    // 低优先级 profile 层为完全访问
    writeFileSync(
      join(profileDir, 'cordis.patch.yml'),
      '- id: permission\n  config:\n    defaultPreset: danger-full-access\n',
      'utf8',
    );
    init({
      log: (level, msg) => { if (level === 'warn') warns.push(msg); },
      getDshHome: () => home,
      getDesktopProfile: () => 'web-desktop',
    });

    (fsMod as unknown as { statSync: typeof fsMod.statSync }).statSync = ((target: Parameters<typeof fsMod.statSync>[0], options?: Parameters<typeof fsMod.statSync>[1]) => {
      if (injectedErr && String(target) === homePatch) throw injectedErr;
      return origStatSync.call(fsMod, target, options as never);
    }) as typeof fsMod.statSync;

    // 1) ACL 权限错误（EACCES）：绝不能把非 ENOENT 当作文件缺失而回退到低优先级完全访问
    injectedErr = Object.assign(new Error(`EACCES: permission denied, stat '${homePatch}'`), { code: 'EACCES' });
    assert.equal(childEnv().DSH_PERMISSION_MODE, undefined, '高优先级 stat 报 EACCES 时必须 fail-closed');
    assert.ok(warns.some((m) => m.includes('EACCES') && m.includes('fail-closed')), '应记录包含 EACCES 与 fail-closed 的 warn 日志');

    // 2) 恢复为真正的 ENOENT（文件确实不存在）-> 允许回退到低优先级并写入热缓存
    injectedErr = null;
    assert.equal(childEnv().DSH_PERMISSION_MODE, 'danger-full-access');

    // 3) 在 5s 热缓存期内遭遇高优先级临时 I/O 错误（EIO）-> 必须绕过/失效旧缓存立即 fail-closed
    warns.length = 0;
    injectedErr = Object.assign(new Error(`EIO: i/o error, stat '${homePatch}'`), { code: 'EIO' });
    assert.equal(childEnv().DSH_PERMISSION_MODE, undefined, '热缓存期内高优先级 stat 报 EIO 必须立即 fail-closed');
    assert.ok(warns.some((m) => m.includes('EIO') && m.includes('fail-closed')), '应记录包含 EIO 与 fail-closed 的 warn 日志');

    // 4) 故障解除后再次恢复正常，不被临时错误锁死
    injectedErr = null;
    assert.equal(childEnv().DSH_PERMISSION_MODE, 'danger-full-access');
  } finally {
    (fsMod as unknown as { statSync: typeof fsMod.statSync }).statSync = origStatSync;
    if (saved !== undefined) process.env.DSH_PERMISSION_MODE = saved;
    rmSync(home, { recursive: true, force: true });
  }
});

test('issue #479: 高优先级 cordis.patch.yml 顶层结构非数组时同样 fail-closed 不向下回退', () => {
  const saved = process.env.DSH_PERMISSION_MODE;
  delete process.env.DSH_PERMISSION_MODE;
  const home = mkdtempSync(join(tmpdir(), 'dsh-perm-bad-shape-'));
  const warns: string[] = [];
  try {
    const profileDir = join(home, 'profiles', 'web-desktop');
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(
      join(profileDir, 'cordis.patch.yml'),
      '- id: permission\n  config:\n    defaultPreset: danger-full-access\n',
      'utf8',
    );
    // 语法合法的 YAML，但把 cordis.patch.yml 写成了旧版 settings.yaml 的对象结构而非数组
    writeFileSync(
      join(home, 'cordis.patch.yml'),
      'permission:\n  defaultPreset: workspace-write\n',
      'utf8',
    );
    init({
      log: (level, msg) => { if (level === 'warn') warns.push(msg); },
      getDshHome: () => home,
      getDesktopProfile: () => 'web-desktop',
    });
    assert.equal(childEnv().DSH_PERMISSION_MODE, undefined, '高优先级 patch 结构非数组时绝不回退低优先级 danger-full-access');
    assert.ok(warns.some((m) => m.includes('fail-closed')), '结构异常应记录 warn 日志');
  } finally {
    if (saved !== undefined) process.env.DSH_PERMISSION_MODE = saved;
    rmSync(home, { recursive: true, force: true });
  }
});
