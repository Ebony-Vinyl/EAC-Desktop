import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { patchSessionManage, MARKER } = require('../scripts/patch-session-manage.js');

// 第三方插件 dsh-session-manager 的旧代码：按 0.1.x 的 list() 形状（直接是
// header）查会话目录。0.2.x 之后 list() 返回 { header, revision, sizeBytes }。
const OLD_SHAPE = [
  '    const headers = await persistence.list();',
  '    const meta = headers.find((header) => header.id === sessionId);',
  '    if (meta === void 0) return void 0;',
].join('\n');

function fixture(body: string) {
  const root = mkdtempSync(join(tmpdir(), 'eac-session-manager-'));
  mkdirSync(join(root, 'dsh-session-manager', 'lib'), { recursive: true });
  const file = join(root, 'dsh-session-manager', 'lib', 'index.js');
  writeFileSync(file, body, 'utf8');
  return { root, file };
}

test('dsh-session-manager: 兼容 0.2.x 的 list() 快照形状', () => {
  const { root, file } = fixture(OLD_SHAPE);
  try {
    assert.equal(patchSessionManage(root), 1, '应修改 1 个文件');
    const patched = readFileSync(file, 'utf8');
    assert.ok(patched.startsWith('// ' + MARKER), '应带补丁标记');
    assert.ok(
      patched.includes('entry.header !== void 0 && entry.header.id === sessionId'),
      '应同时识别 header 与快照两种形状',
    );
    assert.ok(
      patched.includes('const meta = found !== void 0 && found.header !== void 0 ? found.header : found;'),
      '应把快照解包回 header',
    );
    // 幂等：已打补丁的文件不再改动
    assert.equal(patchSessionManage(root), 0, '重复运行不应再修改');
    assert.equal(readFileSync(file, 'utf8'), patched);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('dsh-session-manager: 已打补丁的旧副本升级到兼容形状', () => {
  const { root, file } = fixture('// ' + MARKER + ': 对话删除/归档管理运行时补丁\n' + OLD_SHAPE);
  try {
    assert.equal(patchSessionManage(root), 1, '升级规则应命中');
    const expected = [
      '    const snapshots = await persistence.list();',
      '    const found = snapshots.find((entry) => entry !== void 0 && (entry.id === sessionId || (entry.header !== void 0 && entry.header.id === sessionId)));',
      '    const meta = found !== void 0 && found.header !== void 0 ? found.header : found;',
      '    if (meta === void 0) return void 0;',
    ].join('\n');
    assert.equal(readFileSync(file, 'utf8').split('\n').slice(1).join('\n'), expected);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
