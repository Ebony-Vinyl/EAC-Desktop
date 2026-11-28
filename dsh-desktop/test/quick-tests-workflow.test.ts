import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const workflow = parse(readFileSync(new URL('../../.github/workflows/quick-tests.yml', import.meta.url), 'utf8'));
const job = workflow.jobs.test;

test('快速测试仅由 PR 触发，并取消重复运行', () => {
  assert.deepEqual(Object.keys(workflow.on), ['pull_request']);
  assert.equal(workflow.on.pull_request, null);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.concurrency['cancel-in-progress'], true);
  assert.equal(workflow.concurrency.group, 'quick-tests-${{ github.event.pull_request.number || github.ref }}');
});

test('快速测试准备完整依赖后运行现有测试，任何失败都必须阻断', () => {
  assert.equal(job['runs-on'], 'windows-latest');
  assert.equal(job.defaults.run['working-directory'], 'dsh-desktop');
  assert.notEqual(job['continue-on-error'], true);
  const checkout = job.steps.find(step => step.uses === 'actions/checkout@v4');
  assert.equal(checkout.with.submodules, 'recursive');
  const setup = job.steps.find(step => step.uses === 'actions/setup-node@v4');
  assert.equal(workflow.env.NODE_VERSION, '24');
  assert.equal(setup.with.cache, 'npm');
  assert.equal(setup.with['cache-dependency-path'], 'dsh-desktop/package-lock.json');
  const kernelCache = job.steps.find(step => step.id === 'kernel-cache');
  assert.equal(kernelCache.with.path, 'dsh-desktop/vendor/kernel/${{ env.KERNEL_VERSION }}');
  const commands = [
    'node tauri-shell/check-dpx-pin.mjs',
    'node scripts/fetch-kernel.js',
    'npm run ci:install -- --no-audit --no-fund',
    'npm run fetch-runtime',
    'npm test',
  ];
  let previous = -1;
  for (const command of commands) {
    const position = job.steps.findIndex(step => step.run === command);
    assert.ok(position > previous, `${command} 必须存在且按依赖顺序执行`);
    assert.equal(job.steps[position].if, undefined, `${command} 不得跳过`);
    assert.notEqual(job.steps[position]['continue-on-error'], true);
    previous = position;
  }
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.scripts.pretest, 'npm run build');
});

test('快速测试不调用打包工作流、装配、安装器、产物上传或发布', () => {
  assert.deepEqual(Object.keys(workflow.jobs), ['test']);
  assert.equal(job.uses, undefined);
  for (const step of job.steps) {
    if (step.uses) {
      assert.match(step.uses, /^actions\/(checkout|setup-node|cache)@/);
    }
    assert.doesNotMatch(step.run || '', /stage-resources|verify-staged-runtime|make-portable|tauri.*\bbuild\b|cargo\s+build|makensis|Compress-Archive|gh\s+release/);
  }
});
