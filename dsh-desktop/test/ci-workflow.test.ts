import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflow = parse(readFileSync(join(repositoryRoot, '.github', 'workflows', 'staged-runtime-artifact.yml'), 'utf8')) as {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  jobs: Record<string, {
    'runs-on': string;
    permissions?: Record<string, string>;
    strategy: { matrix: { include: { runner: string; os: string; arch: string; target: string }[] } };
    steps: { name: string; run?: string; uses?: string; if?: string; 'continue-on-error'?: boolean; with?: Record<string, unknown> }[];
  }>;
};
const build = workflow.jobs.build;
assert.ok(build, '复用工作流必须保留安装包装配job');

function step(name: string) {
  const result = build.steps.find(candidate => candidate.name === name);
  assert.ok(result, '缺少装配步骤：' + name);
  assert.notEqual(result['continue-on-error'], true, name + ' 不得忽略失败');
  return result;
}

function requireOrder(names: string[]): void {
  const positions = names.map(name => {
    step(name);
    return build.steps.findIndex(candidate => candidate.name === name);
  });
  for (let index = 1; index < positions.length; index++) {
    assert.ok(positions[index] > positions[index - 1], names[index] + ' 必须在 ' + names[index - 1] + ' 之后');
  }
}

test('安装包装配仅由workflow_call调用，本地测试保留独立入口', () => {
  assert.deepEqual(Object.keys(workflow.on), ['workflow_call']);
  const manifest = JSON.parse(readFileSync(join(repositoryRoot, 'dsh-desktop', 'package.json'), 'utf8'));
  assert.equal(manifest.scripts.pretest, 'npm run build');
  assert.match(manifest.scripts.test, /^node scripts\/test-runner\.js test\/\*\.test\.ts /);
  assert.equal(manifest.scripts['test:native'], 'node scripts/build-native.js test');
});

test('复用安装包工作流覆盖四个平台架构并验证实际runner架构', () => {
  assert.equal(build['runs-on'], '${{ matrix.runner }}');
  assert.deepEqual(build.strategy.matrix.include, [
    { runner: 'windows-latest', os: 'windows', arch: 'x64', target: 'win32' },
    { runner: 'windows-11-arm', os: 'windows', arch: 'arm64', target: 'win32' },
    { runner: 'ubuntu-22.04', os: 'linux', arch: 'x64', target: 'linux' },
    { runner: 'ubuntu-22.04-arm', os: 'linux', arch: 'arm64', target: 'linux' },
  ]);
  assert.match(step('Verify native runner architecture').run ?? '', /process\.arch !== '\$\{\{ matrix\.arch \}\}'/);
  requireOrder(['Checkout', 'Verify native runner architecture', 'Install dependencies', 'Assemble staged runtime']);
});

test('装配必须先完成固定资源准备，校验闭包后才能构建安装包', () => {
  assert.match(step('Prepare vendored kernel').run ?? '', /scripts\/fetch-kernel\.js/);
  assert.equal(step('Install dependencies').run, 'npm run ci:install');
  assert.equal(step('Fetch bundled Node and npm runtimes').run, 'npm run fetch-runtime');
  assert.equal(step('Fetch Cargo dependencies').run, 'cargo fetch --locked');
  assert.equal(step('Assemble staged runtime').run, 'node tauri-shell/stage-resources.mjs --target=${{ matrix.target }} --skip-npm');
  assert.equal(step('Verify staged closure and bundle integrity').run, 'node dsh-desktop/scripts/verify-staged-runtime.mjs');
  requireOrder([
    'Verify dsh-dpx submodule pin', 'Prepare vendored kernel', 'Install dependencies',
    'Fetch bundled Node and npm runtimes', 'Fetch Cargo dependencies',
    'Assemble staged runtime', 'Verify staged closure and bundle integrity', 'Build Tauri installers',
  ]);
});

test('安装包工作流显式限制GITHUB_TOKEN权限且job不提升权限', () => {
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  for (const job of Object.values(workflow.jobs)) {
    if (job.permissions) assert.deepEqual(job.permissions, { contents: 'read' });
  }
});

test('缓存与安装包按架构隔离，缺少产物必须失败', () => {
  assert.equal(step('Cache vendored kernel').with?.key,
    "${{ runner.os }}-${{ matrix.arch }}-kernel-${{ env.KERNEL_VERSION }}-${{ hashFiles('dsh-desktop/scripts/fetch-kernel.ts') }}");
  const windows = step('Upload Windows installer packages');
  const linux = step('Upload Linux installer packages');
  assert.equal(windows.with?.name, 'eac-lite-windows-${{ matrix.arch }}-installers');
  assert.equal(linux.with?.name, 'eac-lite-linux-${{ matrix.arch }}-installers');
  assert.equal(windows.if, "runner.os == 'Windows'");
  assert.equal(linux.if, "runner.os == 'Linux'");
  for (const upload of [windows, linux]) assert.equal(upload.with?.['if-no-files-found'], 'error');
  assert.match(String(windows.with?.path), /bundle\/nsis\/EAC-Lite-\*\.exe/);
  assert.match(String(windows.with?.path), /portable\/SHA256SUMS\.txt/);
  assert.match(String(windows.with?.path), /portable\/EAC-Lite-\*\.zip/);
  assert.match(String(linux.with?.path), /bundle\/rpm\/EAC-Lite-\*\.rpm/);
  requireOrder(['Build Tauri installers', 'Name Lite installer artifacts', 'Build portable package', 'Upload Windows installer packages']);
  requireOrder(['Build Tauri installers', 'Name Lite installer artifacts', 'Audit RPM package', 'Upload Linux installer packages']);
});
