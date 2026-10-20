// P1 自愈链路（形态 1）回归：environment-diagnose.mjs 的四态输出契约。
//
// 背景：环境 fail-closed 时 sidecar 已退场（exit(2)），bridge 与 environment.*
// RPC 一起消失。`/died` 页要能诊断环境，就必须有一条不依赖 sidecar 的通道 ——
// L1 壳用随包 node 跑这个脚本。因此这个脚本的输出契约是页面可用性的前提：
//   - 任何情况下都输出**单行 JSON**（成功与失败都是），页面才能解析；
//   - `status` 只读、不落盘；
//   - `plan` 是 dry run，绝不删东西；
//   - `remove` 在未登记目录上必须失败（拒绝接管别人的数据）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const script = path.join(repoRoot, 'dsh-desktop', 'scripts', 'environment-diagnose.mjs');
const dpxAvailable = fs.existsSync(path.join(repoRoot, 'third_party', 'dsh-dpx', 'src', 'index.js'));

const tempDirs: string[] = [];
function tempRoot(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `eac-diag-${label}-`));
  const nested = path.join(dir, '产品 Data Root');
  fs.mkdirSync(nested, { recursive: true });
  tempDirs.push(dir);
  return nested;
}
test.after(() => {
  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows 句柄 */ }
  }
});

function isolatedEnv(productRoot: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DSH_EAC_DATA_ROOT: productRoot,
    // These fixtures exercise legacy beta; fresh stable selection has dedicated tests.
    DSH_EAC_CHANNEL: 'beta',
    DSH_EAC_DPX_REGISTRY_HOME: path.join(productRoot, 'registry'),
    DSH_EAC_CHANNEL: 'beta',
    USERPROFILE: path.join(productRoot, 'fake-home'),
    HOME: path.join(productRoot, 'fake-home'),
    LOCALAPPDATA: path.join(productRoot, 'fake-local'),
    ...extra,
  };
}

/** 跑脚本，返回 { code, json }；无论成败都要求 stdout 是合法单行 JSON。 */
function runScript(env: NodeJS.ProcessEnv, args: string[]): { code: number; json: Record<string, unknown> } {
  let stdout = '';
  let code = 0;
  try {
    stdout = execFileSync(process.execPath, [script, ...args], { env, encoding: 'utf8' });
  } catch (error) {
    const failure = error as { stdout?: string; status?: number };
    stdout = String(failure.stdout ?? '');
    code = typeof failure.status === 'number' ? failure.status : 1;
  }
  const text = stdout.trim();
  assert.ok(text.length > 0, `脚本必须输出 JSON，实际为空（args=${args.join(' ')}）`);
  assert.ok(!text.includes('\n'), `脚本输出必须是单行 JSON，实际多行：${text.slice(0, 200)}`);
  return { code, json: JSON.parse(text) as Record<string, unknown> };
}

test('status：干净环境输出 ok/isolation/diagnosis，且不落盘', { skip: !dpxAvailable && 'submodule 未初始化' }, () => {
  const productRoot = tempRoot('status');
  const env = isolatedEnv(productRoot);
  const before = fs.existsSync(path.join(productRoot, 'dpx', 'dsh-environments', 'eac-beta'));

  const { code, json } = runScript(env, ['--action=status']);
  assert.equal(code, 0);
  assert.equal(json.ok, true);
  assert.equal(json.action, 'status');
  const isolation = json.isolation as Record<string, string>;
  const diagnosis = json.diagnosis as Record<string, unknown>;
  assert.equal(isolation.name, 'eac-beta');
  assert.equal(isolation.channel, 'beta');
  assert.ok(String(isolation.root).includes('产品 Data Root'), '必须如实回传含空格/中文的根');
  assert.equal(typeof diagnosis.registered, 'boolean');
  assert.equal(typeof diagnosis.removable, 'boolean');
  assert.ok(Array.isArray(diagnosis.problems));

  // 只读：诊断不得创建环境根。
  const after = fs.existsSync(path.join(productRoot, 'dpx', 'dsh-environments', 'eac-beta'));
  assert.equal(after, before, 'status 必须无副作用');
});

test('plan：dry run 给出删除计划但不落盘', { skip: !dpxAvailable && 'submodule 未初始化' }, () => {
  const productRoot = tempRoot('plan');
  const env = isolatedEnv(productRoot);
  // 先创建一个已登记环境，plan 才有对象。
  const environment = {
    ...env,
  };
  const ensure = runScript(environment, ['--action=status']);
  assert.equal(ensure.code, 0);

  // 用适配层创建（脚本本身不做创建，repair 才幂等确保）。
  const repair = runScript(environment, ['--action=repair']);
  assert.equal(repair.code, 0, `repair 应成功：${JSON.stringify(repair.json).slice(0, 200)}`);

  const rootDir = path.join(productRoot, 'dpx', 'dsh-environments', 'eac-beta');
  const marker = path.join(rootDir, 'dsh-home', 'keep-me.txt');
  fs.writeFileSync(marker, '用户数据');

  const plan = runScript(environment, ['--action=plan', '--purge']);
  assert.equal(plan.code, 0);
  assert.equal(plan.json.ok, true);
  assert.ok(fs.existsSync(marker), 'plan 不得删除任何数据');
  const remove = plan.json.remove as { plan: { root: { action: string } } };
  assert.equal(remove.plan.root.action, 'delete', '计划应说明会删环境根');
});

test('remove：未登记的非空目录必须被拒绝（拒绝接管别人的数据）', { skip: !dpxAvailable && 'submodule 未初始化' }, () => {
  const productRoot = tempRoot('untakeover');
  const env = isolatedEnv(productRoot);
  // 手工造一个未注册的非空环境根。
  const strayRoot = path.join(productRoot, 'dpx', 'dsh-environments', 'eac-beta');
  fs.mkdirSync(strayRoot, { recursive: true });
  const strayFile = path.join(strayRoot, 'user-data.txt');
  fs.writeFileSync(strayFile, '不能被静默接管');

  const { code, json } = runScript(env, ['--action=remove', '--purge']);
  assert.notEqual(code, 0, '未登记目录的 remove 必须失败');
  assert.equal(json.ok, false);
  assert.match(String(json.error), /dsh-dpx|未登记|Refusing|adopt/i);
  // 数据必须原样保留。
  assert.equal(fs.readFileSync(strayFile, 'utf8'), '不能被静默接管');
});

test('未知 action 必须 fail loud（不得静默成功）', { skip: !dpxAvailable && 'submodule 未初始化' }, () => {
  const productRoot = tempRoot('unknown');
  const { code, json } = runScript(isolatedEnv(productRoot), ['--action=bogus']);
  assert.notEqual(code, 0);
  assert.equal(json.ok, false);
  assert.match(String(json.error), /未知 action/);
});

test('dpx 模块缺失时也输出 JSON（页面才能显示原因）', () => {
  const productRoot = tempRoot('missing-dpx');
  const missing = path.join(productRoot, 'no-such-dpx');
  const { code, json } = runScript(isolatedEnv(productRoot, { DSH_DPX_ROOT: missing }), ['--action=status']);
  assert.notEqual(code, 0);
  assert.equal(json.ok, false);
  assert.match(String(json.error), /dsh-dpx 模块缺失/);
});

test('stage 必须装配该脚本（否则 /died 页自愈在所有正式包里失效）', () => {
  const stage = fs.readFileSync(path.join(repoRoot, 'tauri-shell', 'stage-resources.mjs'), 'utf8');
  assert.match(stage, /'environment-diagnose\.mjs'/, 'stage 的 SCRIPTS 清单必须包含诊断脚本');
  // L1 壳必须按装配路径查找它。
  const mainRs = fs.readFileSync(path.join(repoRoot, 'tauri-shell', 'src', 'main.rs'), 'utf8');
  assert.match(mainRs, /environment-diagnose\.mjs/);
  assert.match(mainRs, /environment-diagnose\.mjs 缺失|环境诊断脚本缺失/);
});

test('L1 必须给诊断子进程注入 DSH_RESOURCE_ROOT（否则打包态找不到 dpx）', () => {
  // 回归（实测踩中）：打包态 dpx payload 在 <resources>/dpx/src/index.js，
  // 适配层只能经 DSH_RESOURCE_ROOT 定位。首版实现的诊断子进程没传这个变量，
  // 于是退化成开发态相对路径查找 —— 安装树上不存在，导致「自愈功能在
  // 自己产出的正式包里必然失效」。这条断言把它钉住。
  const mainRs = fs.readFileSync(path.join(repoRoot, 'tauri-shell', 'src', 'main.rs'), 'utf8');
  const diagnostics = mainRs.slice(mainRs.indexOf('fn run_environment_action'));
  assert.ok(diagnostics.length > 0, '必须存在 run_environment_action');
  // 在 run_environment_action 函数体内必须出现 DSH_RESOURCE_ROOT 注入。
  const body = diagnostics.slice(0, diagnostics.indexOf('\n}\n'));
  assert.match(body, /DSH_RESOURCE_ROOT/, '诊断子进程必须收到 DSH_RESOURCE_ROOT');
  assert.match(body, /resource_root\(\)/, '必须注入真实资源根而不是硬编码路径');

  // 适配层侧也必须真的消费该变量（两侧语义一致才算通）。
  const environment = fs.readFileSync(path.join(repoRoot, 'dsh-desktop', 'lib', 'desktop', 'environment.ts'), 'utf8');
  assert.match(environment, /DSH_RESOURCE_ROOT/, '适配层必须读取 DSH_RESOURCE_ROOT 定位随包 dpx');
  assert.match(environment, /'dpx',\s*'src',\s*'index\.js'/, '打包态路径约定必须是 <resources>/dpx/src/index.js');
});
