// plugin-sync 的**换行无关性**契约（2026-10-01）。
//
// 背景：`treeSha256` / `sha256File` 原先直接 `readFileSync` 取字节做 sha256。
// 而 `.gitattributes` 只给**带扩展名**的类型（`*.js` / `*.json` / `*.md` …）声明
// `text eol=lf`；**无扩展名的文本（`LICENSE`、`.gitignore`）没有该规则**，
// 于是 `core.autocrlf=true` 的 Windows 检出写成 CRLF、Linux/CI 检出写成 LF，
// 同一份内容算出两个不同的 digest —— 表现为「CI 红灯而本地全绿」。
//
// 实测（修复前）：只把 4 个文件 CRLF→LF，`plugin-sync validate` 立即从通过变失败，
// 正是 CI 报的 compact / unified-market 两个插件。
//
// 本测试锁定：文本文件的哈希与换行风格无关，二进制的哈希不受归一化影响。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  normalizeEolForHash,
  readFileForHash,
  sha256Bytes,
  treeSha256,
} from '../scripts/plugin-sync.mjs';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-sync-eol-'));
}

test('文本：CRLF 与 LF 归一化后哈希一致（平台无关）', () => {
  const dir = tempDir();
  try {
    const lf = 'hello\nworld\n';
    const crlf = lf.replaceAll('\n', '\r\n');
    const a = sha256Bytes(normalizeEolForHash(Buffer.from(lf, 'utf8')));
    const b = sha256Bytes(normalizeEolForHash(Buffer.from(crlf, 'utf8')));
    assert.equal(a, b, 'CRLF 与 LF 的文本必须算出同一个哈希');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('二进制：归一化不改字节（含 NUL 判定为二进制）', () => {
  const binary = Buffer.from([0x00, 0x01, 0x0d, 0x0a, 0xff, 0x10]);
  const out = normalizeEolForHash(binary);
  assert.equal(Buffer.compare(binary, out), 0, '二进制必须原样返回，不得改写 \\r\\n');
});

test('readFileForHash：同一份内容的 CRLF/LF 两种落盘得到同一哈希', () => {
  const dir = tempDir();
  try {
    const text = 'a\nb\nc\n';
    const lfPath = path.join(dir, 'lf.txt');
    const crlfPath = path.join(dir, 'crlf.txt');
    fs.writeFileSync(lfPath, text, 'utf8');
    fs.writeFileSync(crlfPath, text.replaceAll('\n', '\r\n'), 'utf8');
    assert.equal(
      sha256Bytes(readFileForHash(lfPath)),
      sha256Bytes(readFileForHash(crlfPath)),
      '同一内容的两种换行风格必须算出同一哈希',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('treeSha256：整棵树的摘要与换行风格无关（这是 CI 本地不一致的根因）', () => {
  const a = tempDir();
  const b = tempDir();
  try {
    const files: Record<string, string> = {
      'LICENSE': 'MIT License\n\nPermission is hereby granted.\n',
      '.gitignore': 'node_modules\n',
      'lib/client.js': 'export const x = 1;\n',
    };
    for (const [rel, text] of Object.entries(files)) {
      const p = path.join(a, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, text, 'utf8');
      const q = path.join(b, rel);
      fs.mkdirSync(path.dirname(q), { recursive: true });
      fs.writeFileSync(q, text.replaceAll('\n', '\r\n'), 'utf8');
    }
    assert.equal(
      treeSha256(a),
      treeSha256(b),
      '同一内容树在 LF / CRLF 检出的 treeSha256 必须一致',
    );
  } finally {
    fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(b, { recursive: true, force: true });
  }
});
