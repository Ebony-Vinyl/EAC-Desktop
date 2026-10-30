// darwin payload 裁剪纯函数测试（stage-resources.mjs 装配期使用）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertSupportedStageArch,
  isLinuxElfForArch,
  isMachO,
  pruneDarwinPayloads,
  pruneDevelopmentPayloads,
  pruneLinuxPayloads,
  pruneMuslNodeAddonBinaries,
  pruneNonLinuxPrebuilds,
  pruneNonDarwinPrebuilds,
} from '../../tauri-shell/stage-platform-prune.mjs';

const MACHO64 = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x00, 0x00]);
const ELF = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x00]);

test('安装载荷裁剪嵌套 Zod 自测和 source maps，保留运行时类型、源文件和其他包资源', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-development-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const removed = ['pkg/lib/index.js.map', 'pkg/node_modules/zod/src/v4/core/tests/check.test.ts'];
  const retained = ['pkg/lib/index.js', 'pkg/lib/index.d.ts', 'pkg/lib/typert.host.js',
    'pkg/node_modules/zod/src/v4/core/check.ts', 'pkg/node_modules/zod/v4/core/check.js',
    'other/src/tests/runtime.js', 'pkg/assets/key.map'];
  for (const file of [...removed, ...retained]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), 'fixture');
  }
  assert.equal(pruneDevelopmentPayloads(root), removed.length);
  for (const file of removed) assert.equal(fs.existsSync(path.join(root, file)), false, file);
  for (const file of retained) assert.equal(fs.existsSync(path.join(root, file)), true, file);
  assert.equal(pruneDevelopmentPayloads(root), 0);
});

function elf64(machine: number): Buffer {
  const data = Buffer.alloc(20);
  data.write('\x7fELF', 0, 'binary');
  data.writeUInt8(2, 4);
  data.writeUInt8(1, 5);
  data.writeUInt16LE(machine, 18);
  return data;
}

const ELF_X64 = elf64(62);
const ELF_ARM64 = elf64(183);

test('stage 只接受 x64 与 arm64', () => {
  assert.doesNotThrow(() => assertSupportedStageArch('x64'));
  assert.doesNotThrow(() => assertSupportedStageArch('arm64'));
  assert.throws(() => assertSupportedStageArch('ia32'), /不支持目标架构.*ia32/);
  assert.throws(() => assertSupportedStageArch('arm'), /不支持目标架构.*arm/);
});

test('isMachO 识别 64 位小端 Mach-O 魔数，缺失文件返回 false', () => {
  assert.equal(isMachO('/nonexistent-file'), false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-'));
  const macho = path.join(dir, 'a.node');
  const elf = path.join(dir, 'b.node');
  fs.writeFileSync(macho, MACHO64);
  fs.writeFileSync(elf, ELF);
  assert.equal(isMachO(macho), true);
  assert.equal(isMachO(elf), false);
});

test('pruneDarwinPayloads 删除 exe/dll 与非 Mach-O .node，保留 Mach-O .node 和普通文件', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-'));
  fs.mkdirSync(path.join(dir, 'nested'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'empty-dir'));
  fs.writeFileSync(path.join(dir, 'keep.node'), MACHO64);
  fs.writeFileSync(path.join(dir, 'drop-elf.node'), ELF);
  fs.writeFileSync(path.join(dir, 'tool.exe'), 'MZ');
  fs.writeFileSync(path.join(dir, 'lib.dll'), 'MZ');
  fs.writeFileSync(path.join(dir, 'keep.txt'), 'text');
  fs.writeFileSync(path.join(dir, 'nested', 'keep2.node'), MACHO64);
  pruneDarwinPayloads(dir);
  assert.equal(fs.existsSync(path.join(dir, 'keep.node')), true);
  assert.equal(fs.existsSync(path.join(dir, 'drop-elf.node')), false);
  assert.equal(fs.existsSync(path.join(dir, 'tool.exe')), false);
  assert.equal(fs.existsSync(path.join(dir, 'lib.dll')), false);
  assert.equal(fs.existsSync(path.join(dir, 'keep.txt')), true);
  assert.equal(fs.existsSync(path.join(dir, 'nested', 'keep2.node')), true);
  assert.equal(fs.existsSync(path.join(dir, 'empty-dir')), false);
});

test('pruneNonDarwinPrebuilds 只保留 darwin-arm64 目录', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prebuilds-'));
  const pre = path.join(dir, 'node_modules', 'node-pty', 'prebuilds');
  fs.mkdirSync(pre, { recursive: true });
  for (const p of ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64']) {
    fs.mkdirSync(path.join(pre, p), { recursive: true });
  }
  fs.writeFileSync(path.join(pre, 'darwin-arm64', 'pty.node'), MACHO64);
  pruneNonDarwinPrebuilds(path.join(dir, 'node_modules'));
  assert.deepEqual(fs.readdirSync(pre), ['darwin-arm64']);
});

test('isLinuxElfForArch 只接受与目标 64 位架构匹配的 ELF', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linux-elf-'));
  const x64 = path.join(dir, 'x64.node');
  const arm64 = path.join(dir, 'arm64.node');
  fs.writeFileSync(x64, ELF_X64);
  fs.writeFileSync(arm64, ELF_ARM64);

  assert.equal(isLinuxElfForArch(x64, 'x64'), true);
  assert.equal(isLinuxElfForArch(x64, 'arm64'), false);
  assert.equal(isLinuxElfForArch(arm64, 'arm64'), true);
  assert.equal(isLinuxElfForArch(arm64, 'x64'), false);
});

test('pruneLinuxPayloads 按目标架构保留 ELF 并删除异架构载荷', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linux-payload-'));
  fs.writeFileSync(path.join(dir, 'x64.node'), ELF_X64);
  fs.writeFileSync(path.join(dir, 'arm64.node'), ELF_ARM64);
  fs.writeFileSync(path.join(dir, 'tool.exe'), 'MZ');

  pruneLinuxPayloads(dir, 'arm64');

  assert.deepEqual(fs.readdirSync(dir), ['arm64.node']);
});

test('pruneNonLinuxPrebuilds 分别保留 linux-x64 与 linux-arm64', () => {
  for (const arch of ['x64', 'arm64'] as const) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linux-prebuilds-'));
    const pre = path.join(dir, 'node-pty', 'prebuilds');
    fs.mkdirSync(pre, { recursive: true });
    for (const platformArch of ['linux-x64', 'linux-arm64', 'darwin-arm64', 'win32-x64']) {
      fs.mkdirSync(path.join(pre, platformArch));
    }

    pruneNonLinuxPrebuilds(dir, arch);

    assert.deepEqual(fs.readdirSync(pre), [`linux-${arch}`]);
  }
});

test('pruneMuslNodeAddonBinaries 只删 node-addon-system 的 musl 变体，保留 glibc', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'musl-addon-'));
  const scope = path.join(dir, '@deepseek-ai');
  const linux = path.join(scope, 'node-addon-system-linux-x64');
  const darwin = path.join(scope, 'node-addon-system-darwin-arm64');
  const other = path.join(scope, 'dsh-tool-bash');
  for (const base of [linux, darwin, other]) {
    fs.mkdirSync(path.join(base, 'bin', 'musl'), { recursive: true });
    fs.mkdirSync(path.join(base, 'bin', 'glibc'), { recursive: true });
    fs.writeFileSync(path.join(base, 'bin', 'musl', 'system.node'), ELF_X64);
    fs.writeFileSync(path.join(base, 'bin', 'glibc', 'system.node'), ELF_X64);
  }

  pruneMuslNodeAddonBinaries(dir);

  assert.equal(fs.existsSync(path.join(linux, 'bin', 'musl')), false);
  assert.equal(fs.existsSync(path.join(linux, 'bin', 'glibc', 'system.node')), true);
  // 非 linux 平台包与其他 @deepseek-ai 包不受影响
  assert.equal(fs.existsSync(path.join(darwin, 'bin', 'musl', 'system.node')), true);
  assert.equal(fs.existsSync(path.join(other, 'bin', 'musl', 'system.node')), true);
});

test('pruneMuslNodeAddonBinaries 在缺少 glibc 兜底时拒绝剔除', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'musl-addon-'));
  const linux = path.join(dir, '@deepseek-ai', 'node-addon-system-linux-arm64');
  fs.mkdirSync(path.join(linux, 'bin', 'musl'), { recursive: true });
  fs.writeFileSync(path.join(linux, 'bin', 'musl', 'system.node'), ELF_ARM64);

  assert.throws(() => pruneMuslNodeAddonBinaries(dir), /缺少 glibc\/system\.node/);
  assert.equal(fs.existsSync(path.join(linux, 'bin', 'musl', 'system.node')), true);
});
