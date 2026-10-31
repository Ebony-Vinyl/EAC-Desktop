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

test('安装载荷裁剪 v3：特征前置、引用豁免、规则桶与许可保留', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-development-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // 每项恰好一个文件；目录命中时其内部文件一并计入。
  const removed = [
    'pkg/lib/index.js.map',
    'pkg/tests/alpha.test.js', // 有测试特征 → 整删
    'pkg/tests/fixture.json', // 同目录连带
    'pkg/CHANGELOG.md',
    'pkg/CHANGES.md', // 文档扩展名 → 元数据（changes.js 运行模块不在此列）
    'pkg/lib/index.d.ts',
    'pkg/dist/deep/nested.d.cts',
    'pkg/.eslintrc.json',
    'pkg/docs/guide/intro.md', // docs 无条件整删
    'pkg/docs/other.md',
    'pkg/coverage/lcov.info',
    'pkg/Examples/demo.spec.js', // 大小写不敏感 + 有特征
    'pkg2/Specs/api.spec.js', // specs 名同样大小写不敏感
  ];
  const retained = [
    'pkg/lib/index.js',
    'pkg/lib/typert.host.js',
    'pkg/node_modules/zod/src/v4/core/check.ts', // 运行期 TS 源码保留（L2-C 另行验证）
    'pkg/node_modules/zod/v4/core/check.js',
    'pkg/data/key.map', // 非映射命名的数据文件
    'pkg/prompts/system.md', // 非元数据命名的 .md（可能是运行期模板）
    'pkg/test-suite/helpers.js', // 无测试特征 → 整目录保留（特征前置）
    'pkg2/tests/only.data', // 无特征 → 保留（独立包避免 Windows 大小写不敏感目录合并）
    'pkg/changes.js', // 运行模块：changes 元数据规则只认文档扩展名
    'pkg2/lib2/doc/Document.js', // yaml/dist/doc 教训：doc 目录含 JS → 整目录保留
    'pkg2/lib2/doc/runtime.js',
    'pkg/docs/data.json', // 被保留 JS 显式引用 → 引用豁免
    'pkg/LICENSE',
    'pkg/NOTICE.md',
    'pkg/package.json',
  ];
  for (const file of [...removed, ...retained]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), 'fixture');
  }
  fs.writeFileSync(
    path.join(root, 'pkg/lib/loader.js'),
    'const data = require("../docs/data.json");\nmodule.exports = data;\n',
  );

  const result = pruneDevelopmentPayloads(root);
  assert.equal(result.removed, removed.length);
  assert.equal(result.journal.totalRemoved, removed.length);
  assert.equal(result.journal.referenceScan.exemptedFiles, 1);
  assert.deepEqual(result.journal.exemptions, [
    { path: 'pkg/docs/data.json', referencedBy: 'pkg/lib/loader.js' },
  ]);
  assert.equal(result.journal.byRule.maps, 1);
  assert.equal(result.journal.byRule.metadata, 3); // CHANGELOG.md + CHANGES.md + .eslintrc.json
  assert.equal(result.journal.byRule.declarations, 2);
  assert.equal(result.journal.directories.docs, 2); // data.json 豁免不计入删除
  assert.equal(result.journal.directories.tests, 2);
  assert.equal(result.journal.directories.specs, 1);
  assert.equal(result.journal.emptyDirsRemoved, 4); // tests/Examples/coverage/Specs 清空后被删；docs 因豁免保留

  for (const file of removed) assert.equal(fs.existsSync(path.join(root, file)), false, file);
  for (const file of retained) assert.equal(fs.existsSync(path.join(root, file)), true, file);
  assert.equal(fs.existsSync(path.join(root, 'pkg/coverage')), false, '清空的规则目录应被删除');
  assert.equal(fs.existsSync(path.join(root, 'pkg/docs')), true, '含豁免文件的目录保留');

  assert.equal(pruneDevelopmentPayloads(root).removed, 0); // 幂等
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
