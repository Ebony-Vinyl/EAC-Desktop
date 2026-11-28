import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const portable = require('../lib/desktop/portable-data.js') as {
  PORTABLE_OWNER_FILE: string;
  PORTABLE_POINTER_FILE: string;
  PORTABLE_SHARE_FILE: string;
  PORTABLE_COPY_STATE_FILE: string;
  readOwnerRecord(dataRoot: string): {dataRoot: string; channel: string; createdAt: string} | null;
  readPointerRecord(installRoot: string): {dataRoot: string; reason: string} | null;
  writeOwnerRecord(dataRoot: string, environmentRoot: string, registryHome: string, channel: string, installRoot: string): Record<string, unknown>;
  writePointerRecord(installRoot: string, dataRoot: string, reason: 'update-handoff' | 'legacy-pointer'): void;
  removePointerRecord(installRoot: string): void;
  findEnvironmentRoot(container: string, channel?: string): {root: string; channel: string} | null;
  copyEnvironmentContents(source: string, target: string): {files: number; bytes: number};
  preparePortableData(options: Record<string, unknown>): {
    mode: string;
    dataRoot: string;
    migrated?: boolean;
    channel: string;
    sourceEnvironmentRoot?: string;
  };
  finishPortableData(options: Record<string, unknown>): void;
  ENVIRONMENT_COPY_EXCLUDES: string[];
};
function temporary(t: {after(fn: () => void): void}): string {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'eac-portable-data-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return root;
}

function layout(root: string): {install: string; data: string; env: string} {
  const install = path.join(root, '便携 目录');
  const data = path.join(install, 'data');
  const env = path.join(data, 'dpx', 'dsh-environments', 'eac-beta');
  fs.mkdirSync(env, {recursive: true});
  fs.mkdirSync(path.join(env, 'dsh-home'), {recursive: true});
  fs.mkdirSync(path.join(env, 'appdata'), {recursive: true});
  fs.writeFileSync(path.join(env, '.dpx-environment.json'), JSON.stringify({kind: 'DPXEnvironment', name: 'eac-beta', root: env}));
  fs.writeFileSync(path.join(env, 'dsh-home', 'session.jsonl'), '会话');
  return {install, data, env};
}

/** 在指定容器下造一个 `eac-<channel>` 环境根（清单 + dsh-home 内的文件）。 */
function environment(container: string, channel: string, files: Record<string, string>): string {
  const envRoot = path.join(container, 'dsh-environments', 'eac-' + channel);
  fs.mkdirSync(path.join(envRoot, 'dsh-home'), {recursive: true});
  fs.writeFileSync(path.join(envRoot, '.dpx-environment.json'), JSON.stringify({kind: 'DPXEnvironment', name: 'eac-' + channel, root: envRoot}));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(envRoot, 'dsh-home', name), text);
  return envRoot;
}

/** 复制中断的现场：清单已写好、内容不全，但留下 in-progress 状态。 */
function interruptedCopy(envRoot: string, source: string): void {
  fs.writeFileSync(path.join(envRoot, portable.PORTABLE_COPY_STATE_FILE), JSON.stringify({schemaVersion: 1, state: 'in-progress', source, updatedAt: new Date().toISOString()}));
}

/** 测试接缝：按 dpx 的真实顺序先建环境根（写清单），再由 L2 复制内容。 */
function ensureStub(env: NodeJS.ProcessEnv) {
  const envRoot = path.join(env.DSH_EAC_DATA_ROOT!, 'dpx', 'dsh-environments', 'eac-' + env.DSH_EAC_CHANNEL);
  fs.mkdirSync(path.join(envRoot, 'dsh-home'), {recursive: true});
  fs.writeFileSync(path.join(envRoot, '.dpx-environment.json'), JSON.stringify({kind: 'DPXEnvironment', name: 'eac-' + env.DSH_EAC_CHANNEL, root: envRoot}));
  return {
    paths: {root: envRoot, dshHome: path.join(envRoot, 'dsh-home')},
    registryHome: path.join(env.DSH_EAC_DATA_ROOT!, 'dpx', 'registry'),
    channel: env.DSH_EAC_CHANNEL,
  } as never;
}

/** 在临时通道环境里运行：`build` 有值就模拟 L1 注入构建通道，`undefined` 则清空。 */
function withChannelEnv<T>(build: string | undefined, run: () => T): T {
  const previousBuild = process.env.DSH_EAC_ENVIRONMENT_DEFAULT_CHANNEL;
  const previousChannel = process.env.DSH_EAC_CHANNEL;
  if (build === undefined) delete process.env.DSH_EAC_ENVIRONMENT_DEFAULT_CHANNEL;
  else process.env.DSH_EAC_ENVIRONMENT_DEFAULT_CHANNEL = build;
  delete process.env.DSH_EAC_CHANNEL;
  try {
    return run();
  } finally {
    if (previousBuild === undefined) delete process.env.DSH_EAC_ENVIRONMENT_DEFAULT_CHANNEL;
    else process.env.DSH_EAC_ENVIRONMENT_DEFAULT_CHANNEL = previousBuild;
    if (previousChannel === undefined) delete process.env.DSH_EAC_CHANNEL;
    else process.env.DSH_EAC_CHANNEL = previousChannel;
  }
}

/** 模拟 beta/stable 构建：L1 通过 `DSH_EAC_ENVIRONMENT_DEFAULT_CHANNEL` 告诉 sidecar 自己是什么通道。 */
function withBuildChannel<T>(channel: string, run: () => T): T {
  return withChannelEnv(channel, run);
}

/** 清空通道相关环境变量：让「从源数据推断通道」的用例不受开发机环境影响。 */
function withoutChannelEnv<T>(run: () => T): T {
  return withChannelEnv(undefined, run);
}

test('owner and pointer records round-trip and reject foreign/relative roots', t => {
  const root = temporary(t); const {install, data} = layout(root);
  assert.equal(portable.readOwnerRecord(data), null);
  portable.writeOwnerRecord(data, path.join(data, 'dpx', 'dsh-environments', 'eac-beta'), path.join(data, 'dpx', 'registry'), 'beta', install);
  const owner = portable.readOwnerRecord(data);
  assert.equal(owner?.channel, 'beta');
  assert.equal(owner?.dataRoot, path.resolve(data));
  fs.writeFileSync(path.join(data, portable.PORTABLE_OWNER_FILE), JSON.stringify({schemaVersion: 1, product: 'eac-desktop', installKind: 'portable', dataRoot: 'relative', environmentRoot: 'x', registryHome: 'y', channel: 'beta', createdAt: 'x', updatedAt: 'x'}));
  assert.equal(portable.readOwnerRecord(data), null, '相对路径的所有权记录必须拒绝');
  portable.writePointerRecord(install, data, 'update-handoff');
  assert.equal(portable.readPointerRecord(install)?.reason, 'update-handoff');
  fs.writeFileSync(path.join(install, portable.PORTABLE_POINTER_FILE), JSON.stringify({schemaVersion: 1, product: 'eac-desktop', dataRoot: path.join(root, 'missing'), reason: 'legacy-pointer', updatedAt: 'x'}));
  assert.equal(portable.readPointerRecord(install), null, '指针目标不存在时视为无效');
  portable.removePointerRecord(install);
  assert.equal(portable.readPointerRecord(install), null);
});

test('environment copy keeps user data but never copies dpx-owned identity files', t => {
  const root = temporary(t); const source = path.join(root, '旧 数据', 'dpx', 'dsh-environments', 'eac-beta');
  fs.mkdirSync(path.join(source, 'dsh-home'), {recursive: true});
  fs.writeFileSync(path.join(source, '.dpx-environment.json'), 'old-manifest');
  fs.writeFileSync(path.join(source, 'dsh-distribution.json'), 'old-descriptor');
  fs.writeFileSync(path.join(source, 'AGENTS.md'), 'old-guide');
  fs.writeFileSync(path.join(source, 'dsh-home', 'session.jsonl'), 'durable session');
  fs.mkdirSync(path.join(source, 'desktop'), {recursive: true});
  fs.writeFileSync(path.join(source, 'desktop', 'launcher.exe'), 'legacy launcher');
  const target = path.join(root, '新 数据', 'dpx', 'dsh-environments', 'eac-beta');
  fs.mkdirSync(path.join(target, 'dsh-home'), {recursive: true});
  fs.writeFileSync(path.join(target, '.dpx-environment.json'), 'new-manifest');
  const stats = portable.copyEnvironmentContents(source, target);
  assert.ok(stats.files >= 1);
  assert.equal(fs.readFileSync(path.join(target, 'dsh-home', 'session.jsonl'), 'utf8'), 'durable session');
  assert.equal(fs.readFileSync(path.join(target, '.dpx-environment.json'), 'utf8'), 'new-manifest');
  assert.equal(fs.existsSync(path.join(target, 'dsh-distribution.json')), false);
  assert.equal(fs.existsSync(path.join(target, 'AGENTS.md')), false);
  assert.equal(fs.existsSync(path.join(target, 'desktop')), false);
});

test('import copies legacy environment data without touching the source', t => {
  const root = temporary(t);
  const source = path.join(root, 'legacy');
  const sourceEnv = path.join(source, 'dpx', 'dsh-environments', 'eac-beta');
  fs.mkdirSync(path.join(sourceEnv, 'dsh-home'), {recursive: true});
  fs.writeFileSync(path.join(sourceEnv, 'dsh-home', 'session.jsonl'), 'legacy session');
  fs.writeFileSync(path.join(sourceEnv, '.dpx-environment.json'), JSON.stringify({kind: 'DPXEnvironment', name: 'eac-beta', root: sourceEnv}));
  fs.writeFileSync(path.join(source, 'eac-data-binding.json'), JSON.stringify({schemaVersion: 1, product: 'eac-desktop', channel: 'beta', environmentRoot: sourceEnv, storageRoot: path.join(source, 'dpx'), dshHome: path.join(sourceEnv, 'dsh-home'), registryHome: path.join(source, 'dpx', 'registry'), profile: 'web-desktop'}));
  const data = path.join(root, 'install', 'data');
  const ensure = (env: NodeJS.ProcessEnv) => {
    const envRoot = path.join(env.DSH_EAC_DATA_ROOT!, 'dpx', 'dsh-environments', 'eac-' + env.DSH_EAC_CHANNEL);
    fs.mkdirSync(path.join(envRoot, 'dsh-home'), {recursive: true});
    fs.writeFileSync(path.join(envRoot, '.dpx-environment.json'), JSON.stringify({kind: 'DPXEnvironment', name: 'eac-beta', root: envRoot}));
    return {paths: {root: envRoot, dshHome: path.join(envRoot, 'dsh-home')}, registryHome: path.join(env.DSH_EAC_DATA_ROOT!, 'dpx', 'registry'), channel: env.DSH_EAC_CHANNEL} as never;
  };
  const runtime = withoutChannelEnv(() => portable.preparePortableData({mode: 'import', sourceRoot: source, dataRoot: data, installRoot: path.join(root, 'install'), programRoot: path.join(root, 'program'), ensure}));
  assert.equal(runtime.channel, 'beta');
  assert.equal(fs.readFileSync(path.join(data, 'dpx', 'dsh-environments', 'eac-beta', 'dsh-home', 'session.jsonl'), 'utf8'), 'legacy session');
  assert.equal(fs.readFileSync(path.join(sourceEnv, 'dsh-home', 'session.jsonl'), 'utf8'), 'legacy session', '导入不能修改源数据');
  portable.finishPortableData({...runtime, ensure: undefined, ensured: ensure({DSH_EAC_DATA_ROOT: data, DSH_EAC_CHANNEL: 'beta', PATH: process.env.PATH} as NodeJS.ProcessEnv)});
  assert.equal(portable.readOwnerRecord(data)?.channel, 'beta');
});

test('relocate quarantines old dpx metadata and rebuilds a fresh environment in place', t => {
  const root = temporary(t);
  const install = path.join(root, 'portable');
  const data = path.join(install, 'data');
  const oldEnv = path.join(data, 'dpx', 'dsh-environments', 'eac-beta');
  fs.mkdirSync(path.join(oldEnv, 'dsh-home'), {recursive: true});
  fs.writeFileSync(path.join(oldEnv, 'dsh-home', 'session.jsonl'), 'old session');
  fs.writeFileSync(path.join(oldEnv, '.dpx-environment.json'), JSON.stringify({kind: 'DPXEnvironment', name: 'eac-beta', root: 'Z:\\old\\data\\dpx\\dsh-environments\\eac-beta'}));
  fs.writeFileSync(path.join(data, 'eac-data-binding.json'), JSON.stringify({schemaVersion: 1, product: 'eac-desktop', channel: 'beta', environmentRoot: 'Z:\\old', storageRoot: 'Z:\\old\\dpx', dshHome: 'Z:\\old\\dsh-home', registryHome: 'Z:\\old\\registry', profile: 'web-desktop'}));
  const ensure = (env: NodeJS.ProcessEnv) => {
    const envRoot = path.join(env.DSH_EAC_DATA_ROOT!, 'dpx', 'dsh-environments', 'eac-' + env.DSH_EAC_CHANNEL);
    fs.mkdirSync(path.join(envRoot, 'dsh-home'), {recursive: true});
    return {paths: {root: envRoot, dshHome: path.join(envRoot, 'dsh-home')}, registryHome: path.join(env.DSH_EAC_DATA_ROOT!, 'dpx', 'registry'), channel: env.DSH_EAC_CHANNEL} as never;
  };
  const runtime = portable.preparePortableData({mode: 'relocate', dataRoot: data, installRoot: install, programRoot: path.join(root, 'program'), ensure});
  assert.equal(runtime.mode, 'relocate');
  assert.equal(fs.readFileSync(path.join(data, 'dpx', 'dsh-environments', 'eac-beta', 'dsh-home', 'session.jsonl'), 'utf8'), 'old session');
  const stale = fs.readdirSync(data).filter(name => name.startsWith('dpx.stale-'));
  assert.equal(stale.length, 1);
  assert.equal(fs.existsSync(path.join(data, 'eac-data-binding.json')), false, '旧绑定必须隔离，避免下次启动读到旧根');
  assert.equal(fs.readFileSync(path.join(data, stale[0]!, 'dsh-environments', 'eac-beta', 'dsh-home', 'session.jsonl'), 'utf8'), 'old session');
});

test('relocate retries against the newest complete stale when the current dpx is partial', t => {
  const root = temporary(t); const {install, data, env} = layout(root);
  fs.writeFileSync(path.join(env, 'dsh-home', 'session.jsonl'), 'old-but-complete');
  // 上一次搬迁失败后的现场：完整环境在 dpx.stale-old，当前 dpx 只有半成品。
  fs.renameSync(path.join(data, 'dpx'), path.join(data, 'dpx.stale-old'));
  fs.mkdirSync(path.join(data, 'dpx', 'registry'), {recursive: true});
  const binding = path.join(data, 'eac-data-binding.json');
  fs.writeFileSync(binding, JSON.stringify({schemaVersion: 1, product: 'eac-desktop', channel: 'beta', environmentRoot: env, storageRoot: path.join(data, 'dpx'), dshHome: path.join(env, 'dsh-home'), registryHome: path.join(data, 'dpx', 'registry'), profile: 'web-desktop'}));
  const ensure = (value: NodeJS.ProcessEnv) => {
    const envRoot = path.join(value.DSH_EAC_DATA_ROOT!, 'dpx', 'dsh-environments', 'eac-' + value.DSH_EAC_CHANNEL);
    fs.mkdirSync(path.join(envRoot, 'dsh-home'), {recursive: true});
    return {paths: {root: envRoot, dshHome: path.join(envRoot, 'dsh-home')}, registryHome: path.join(value.DSH_EAC_DATA_ROOT!, 'dpx', 'registry'), channel: value.DSH_EAC_CHANNEL} as never;
  };
  const runtime = portable.preparePortableData({mode: 'relocate', dataRoot: data, installRoot: install, programRoot: path.join(root, 'program'), ensure});
  assert.equal(runtime.mode, 'relocate');
  assert.equal(fs.readFileSync(path.join(data, 'dpx', 'dsh-environments', 'eac-beta', 'dsh-home', 'session.jsonl'), 'utf8'), 'old-but-complete');
  assert.equal(fs.existsSync(binding), false, '旧绑定必须隔离');
  assert.ok(fs.readdirSync(data).some(name => name.startsWith('dpx.stale-')), '半成品与完整旧目录都必须保留');
});

test('relocate can resume when the current dpx was already quarantined', t => {
  const root = temporary(t); const {install, data, env} = layout(root);
  fs.writeFileSync(path.join(env, 'dsh-home', 'session.jsonl'), 'already-stale');
  fs.renameSync(path.join(data, 'dpx'), path.join(data, 'dpx.stale-old'));
  const ensure = (value: NodeJS.ProcessEnv) => {
    const envRoot = path.join(value.DSH_EAC_DATA_ROOT!, 'dpx', 'dsh-environments', 'eac-' + value.DSH_EAC_CHANNEL);
    fs.mkdirSync(path.join(envRoot, 'dsh-home'), {recursive: true});
    return {paths: {root: envRoot, dshHome: path.join(envRoot, 'dsh-home')}, registryHome: path.join(value.DSH_EAC_DATA_ROOT!, 'dpx', 'registry'), channel: value.DSH_EAC_CHANNEL} as never;
  };
  const runtime = portable.preparePortableData({mode: 'relocate', dataRoot: data, installRoot: install, programRoot: path.join(root, 'program'), ensure});
  assert.equal(runtime.mode, 'relocate');
  assert.equal(fs.readFileSync(path.join(data, 'dpx', 'dsh-environments', 'eac-beta', 'dsh-home', 'session.jsonl'), 'utf8'), 'already-stale');
});

test('findEnvironmentRoot handles both a product root and a direct environment dir', t => {
  const root = temporary(t); const {env} = layout(root);
  assert.deepEqual(portable.findEnvironmentRoot(env), {root: path.resolve(env), channel: 'beta'});
  assert.deepEqual(portable.findEnvironmentRoot(path.join(root, '便携 目录', 'data')), {root: path.resolve(env), channel: 'beta'});
  assert.equal(portable.findEnvironmentRoot(path.join(root, 'empty')), null);
});

test('moved portable data is quarantined instead of deleted', t => {
  const root = temporary(t); const {install, data} = layout(root);
  fs.writeFileSync(path.join(data, 'eac-data-binding.json'), JSON.stringify({schemaVersion: 1, product: 'eac-desktop', channel: 'beta', environmentRoot: '', storageRoot: '', dshHome: '', registryHome: '', profile: 'web-desktop'}));
  const runtime = portable.preparePortableData({dataRoot: data, installRoot: install, programRoot: path.join(root, 'program'), mode: 'reset', channel: 'beta'});
  assert.equal(runtime.mode, 'reset');
  const stale = fs.readdirSync(data).filter(name => name.startsWith('dpx.stale-'));
  assert.equal(stale.length, 1, '旧 dpx 元数据必须保留为 stale 目录');
  assert.equal(fs.existsSync(path.join(data, stale[0]!, 'dsh-environments', 'eac-beta', 'dsh-home', 'session.jsonl')), true);
  assert.equal(fs.existsSync(path.join(data, 'eac-data-binding.json')), false);
});

test('finishPortableData writes ownership for owned roots and a pointer for handoff', t => {
  const root = temporary(t); const {install, data} = layout(root);
  const ensured = {paths: {root: path.join(data, 'dpx', 'dsh-environments', 'eac-beta')}, registryHome: path.join(data, 'dpx', 'registry'), channel: 'beta'} as never;
  portable.finishPortableData({mode: 'owned', dataRoot: data, installRoot: install, programRoot: path.join(root, 'program'), channel: 'beta', ensured});
  assert.equal(portable.readOwnerRecord(data)?.channel, 'beta');
  fs.unlinkSync(path.join(data, portable.PORTABLE_OWNER_FILE));
  portable.finishPortableData({mode: 'handoff', dataRoot: data, installRoot: install, programRoot: path.join(root, 'program'), channel: 'beta', ensured});
  assert.equal(portable.readPointerRecord(install)?.dataRoot, path.resolve(data));
  assert.equal(fs.existsSync(path.join(data, portable.PORTABLE_SHARE_FILE)), true, '沿用旧位置时必须写共享标记，卸载器据此保留数据');
  assert.equal(portable.readOwnerRecord(data), null, '延续旧位置时不能把当前目录标记为已拥有');
});

test('relocate rebinds host closure links to the current program tree', {skip: process.platform !== 'win32'}, t => {
  const root = temporary(t);
  const install = path.join(root, 'portable');
  const data = path.join(install, 'data');
  // 真实布局里闭包链接指向 <install>\dsh-desktop\node_modules\*；用同名段让
  // repairHostClosure 的「另一个安装闭包」判定生效。
  const oldProgram = path.join(root, 'old', 'dsh-desktop');
  const newProgram = path.join(root, 'new', 'dsh-desktop');
  for (const program of [oldProgram, newProgram]) {
    fs.mkdirSync(path.join(program, 'node_modules', 'pkg-a'), {recursive: true});
    fs.writeFileSync(path.join(program, 'node_modules', 'pkg-a', 'package.json'), '{}');
  }
  const envRoot = path.join(data, 'dpx', 'dsh-environments', 'eac-beta');
  const shared = path.join(envRoot, 'dsh-home', 'profiles', 'node_modules');
  fs.mkdirSync(shared, {recursive: true});
  fs.writeFileSync(path.join(envRoot, '.dpx-environment.json'), JSON.stringify({kind: 'DPXEnvironment', name: 'eac-beta', root: envRoot}));
  fs.writeFileSync(path.join(envRoot, 'dsh-home', 'session.jsonl'), 'session');
  fs.symlinkSync(path.join(oldProgram, 'node_modules', 'pkg-a'), path.join(shared, 'pkg-a'), 'junction');
  const ensure = (env: NodeJS.ProcessEnv) => {
    const root2 = path.join(env.DSH_EAC_DATA_ROOT!, 'dpx', 'dsh-environments', 'eac-' + env.DSH_EAC_CHANNEL);
    fs.mkdirSync(path.join(root2, 'dsh-home'), {recursive: true});
    return {paths: {root: root2, dshHome: path.join(root2, 'dsh-home')}, registryHome: path.join(env.DSH_EAC_DATA_ROOT!, 'dpx', 'registry'), channel: env.DSH_EAC_CHANNEL} as never;
  };
  portable.preparePortableData({mode: 'relocate', dataRoot: data, installRoot: install, programRoot: newProgram, channel: 'beta', ensure});
  const link = path.join(data, 'dpx', 'dsh-environments', 'eac-beta', 'dsh-home', 'profiles', 'node_modules', 'pkg-a');
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true, '闭包条目必须仍是链接');
  const target = path.resolve(path.dirname(link), fs.readlinkSync(link));
  assert.equal(
    target.toLowerCase().startsWith(path.resolve(newProgram).toLowerCase() + path.sep),
    true,
    `搬迁后闭包必须重绑到当前程序根，实际指向 ${target}`,
  );
  assert.equal(fs.readFileSync(path.join(data, 'dpx', 'dsh-environments', 'eac-beta', 'dsh-home', 'session.jsonl'), 'utf8'), 'session');
});

test('import follows the build channel instead of the stale stable environment', t => {
  const root = temporary(t);
  const source = path.join(root, 'legacy');
  const storage = path.join(source, 'dpx');
  const stableEnv = environment(storage, 'stable', {'session.jsonl': 'stable session'});
  const betaEnv = environment(storage, 'beta', {'session.jsonl': 'beta session'});
  fs.writeFileSync(path.join(source, 'eac-data-binding.json'), JSON.stringify({schemaVersion: 1, product: 'eac-desktop', channel: 'beta', environmentRoot: betaEnv, storageRoot: storage, dshHome: path.join(betaEnv, 'dsh-home'), registryHome: path.join(storage, 'registry'), profile: 'web-desktop'}));
  const data = path.join(root, 'install', 'data');
  const runtime = withBuildChannel('beta', () => portable.preparePortableData({mode: 'import', sourceRoot: source, dataRoot: data, installRoot: path.join(root, 'install'), programRoot: path.join(root, 'program'), ensure: ensureStub}));
  assert.equal(runtime.channel, 'beta', '不得因为源里还有 stable 就把构建通道改成 stable');
  assert.equal(runtime.sourceEnvironmentRoot, path.resolve(betaEnv), '必须先定通道再挑数据源');
  assert.equal(fs.readFileSync(path.join(data, 'dpx', 'dsh-environments', 'eac-beta', 'dsh-home', 'session.jsonl'), 'utf8'), 'beta session');
  assert.equal(fs.existsSync(path.join(data, 'dpx', 'dsh-environments', 'eac-stable')), false, '不能跨通道建出第二个环境');
  assert.equal(fs.readFileSync(path.join(stableEnv, 'dsh-home', 'session.jsonl'), 'utf8'), 'stable session', '导入只复制，源数据不动');
});

test('relocate skips an interrupted copy and uses the last complete environment', t => {
  const root = temporary(t);
  const install = path.join(root, 'portable');
  const data = path.join(install, 'data');
  const stale = path.join(data, 'dpx.stale-2026-11-20T00-00-00-000Z');
  const complete = environment(stale, 'beta', {'session-a.jsonl': 'a', 'session-b.jsonl': 'b'});
  // 上次搬迁在「建好环境、内容没复制完」时中断：清单在、文件缺，带 in-progress。
  const partial = environment(path.join(data, 'dpx'), 'beta', {'session-b.jsonl': 'b-partial'});
  interruptedCopy(partial, complete);
  const older = new Date(Date.now() - 3600 * 1000);
  fs.utimesSync(stale, older, older);
  const runtime = withBuildChannel('beta', () => portable.preparePortableData({mode: 'relocate', dataRoot: data, installRoot: install, programRoot: path.join(root, 'program'), ensure: ensureStub}));
  assert.equal(runtime.channel, 'beta');
  assert.equal(runtime.sourceEnvironmentRoot, path.resolve(complete), '必须跳过中断现场，选最近一个完整环境');
  const target = path.join(data, 'dpx', 'dsh-environments', 'eac-beta', 'dsh-home');
  assert.equal(fs.readFileSync(path.join(target, 'session-a.jsonl'), 'utf8'), 'a', '完整环境里的文件不能丢');
  assert.equal(fs.readFileSync(path.join(target, 'session-b.jsonl'), 'utf8'), 'b');
  const state = JSON.parse(fs.readFileSync(path.join(data, 'dpx', 'dsh-environments', 'eac-beta', portable.PORTABLE_COPY_STATE_FILE), 'utf8')) as {state: string; files: number};
  assert.equal(state.state, 'complete', '复制成功后必须落完成标记，供下一次重试识别');
  assert.ok(state.files >= 2, '完成标记要记录实际复制的文件数');
  assert.ok(fs.readdirSync(data).filter(name => name.startsWith('dpx.stale-')).length >= 2, '半成品与完整旧目录都必须保留');
});

test('relocate fails closed when every environment is an interrupted copy', t => {
  const root = temporary(t);
  const install = path.join(root, 'portable');
  const data = path.join(install, 'data');
  const partial = environment(path.join(data, 'dpx'), 'beta', {'session-a.jsonl': 'a'});
  interruptedCopy(partial, 'Z:\\old\\data\\dpx\\dsh-environments\\eac-beta');
  let ensured = false;
  const ensure = (env: NodeJS.ProcessEnv) => {
    ensured = true;
    return ensureStub(env);
  };
  assert.throws(
    () => withBuildChannel('beta', () => portable.preparePortableData({mode: 'relocate', dataRoot: data, installRoot: install, programRoot: path.join(root, 'program'), ensure})),
    /portable-relocate-source-incomplete/,
  );
  assert.equal(ensured, false, '没有完整来源时不得建新环境、不得把半成品复制成完成态');
  const stale = fs.readdirSync(data).filter(name => name.startsWith('dpx.stale-'));
  assert.equal(stale.length, 1, '中断现场必须保留，不能删除');
  assert.equal(fs.readFileSync(path.join(data, stale[0]!, 'dsh-environments', 'eac-beta', 'dsh-home', 'session-a.jsonl'), 'utf8'), 'a');
  assert.equal(fs.existsSync(path.join(data, 'eac-data-owner.json')), false, '失败时不能写所有权记录');
});
