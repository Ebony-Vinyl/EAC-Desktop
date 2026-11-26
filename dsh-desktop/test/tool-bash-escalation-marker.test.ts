// 装配树绊网：可选升级字段补丁必须落在三个工具包上。
//
// dsh-tool-bash 不再以 vendored 产物入库，其唯一差异（全权限会话不提供升级
// 目标）由 scripts/patch-deps.ts 在安装/装配期生成。锚点失配时 patch-deps 只
// 告警跳过，功能会静默回归，因此这里对安装树的 marker 做硬断言。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const kernelRoot = join(__dirname, '..', 'node_modules', '@deepseek-ai');
const MARKER = 'dsh-desktop-optional-escalation';
const targets = [
  ['dsh-tool-pwsh', join(kernelRoot, 'dsh-tool-pwsh', 'lib', 'index.js')],
  ['dsh-tool-fs', join(kernelRoot, 'dsh-tool-fs', 'lib', 'index.js')],
  ['dsh-tool-bash', join(kernelRoot, 'dsh-tool-bash', 'lib', 'index.js')],
];

test('可选升级字段补丁在三个工具包的安装树文件上都有 marker', (t) => {
  if (!existsSync(kernelRoot)) {
    t.skip('无 node_modules（纯仓库 CI），跳过安装树绊网');
    return;
  }
  for (const [name, file] of targets) {
    assert.ok(existsSync(file), name + ' 未安装：' + file);
    assert.ok(
      readFileSync(file, 'utf8').includes(MARKER),
      name + ' 缺少 ' + MARKER + ' —— patch-deps 锚点失配，全权限会话会重新暴露升级字段',
    );
  }
});
