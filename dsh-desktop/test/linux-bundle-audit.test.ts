import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { auditLinuxBundle } from '../../tauri-shell/audit-linux-bundle.mjs';
import { pruneLinuxPayloads, pruneNonLinuxPrebuilds } from '../../tauri-shell/stage-platform-prune.mjs';

function elf64(machine: number): Buffer {
  const data = Buffer.alloc(20);
  data.write('\x7fELF', 0, 'binary');
  data.writeUInt8(2, 4);
  data.writeUInt8(1, 5);
  data.writeUInt16LE(machine, 18);
  return data;
}

const ELF = elf64(62);
const ELF_ARM64 = elf64(183);

// 默认造带 native 围栏载荷（supervisor/snapshot）的树；native: false 造
// 「围栏当前不随包」的树（ISO-003：装配面 NATIVE_MODULES=[] 的现状）。
function fixture(elf = ELF, options: { native?: boolean } = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eac-linux-bundle-'));
  const runtime = path.join(root, 'dsh-desktop', 'vendor', 'node', 'node');
  const nativeFiles = options.native === false ? [] : [
    path.join(root, 'dsh-desktop', 'native', 'supervisor', 'index.node'),
    path.join(root, 'dsh-desktop', 'native', 'snapshot', 'index.node'),
  ];
  for (const file of [runtime, ...nativeFiles]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, elf);
  }
  fs.chmodSync(runtime, 0o755);
  return root;
}

test('Linux bundle audit accepts ELF runtime and native modules', () => {
  const root = fixture();
  try {
    assert.deepEqual(auditLinuxBundle(root), { filesChecked: 3, nativeModules: 2 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ISO-003：进程隔离围栏（native/{supervisor,snapshot}）当前不随包
//（stage-resources.mjs 的 NATIVE_MODULES=[]，ADR 0003 已裁废）—— 缺失不得
// 报错；存在时仍由通用 walk 校验 ELF/目标架构（见下方 PE native 用例）。
test('Linux bundle audit treats the native fence payloads as optional (not staged)', () => {
  const root = fixture(ELF, { native: false });
  try {
    assert.deepEqual(auditLinuxBundle(root), { filesChecked: 1, nativeModules: 0 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Linux bundle audit accepts arm64 ELF and the matching node-pty prebuild', () => {
  const root = fixture(ELF_ARM64);
  const ptyBuild = path.join(root, 'dsh-desktop', 'node_modules', 'node-pty', 'build', 'Release', 'pty.node');
  const ptyPrebuilt = path.join(root, 'dsh-desktop', 'node_modules', 'node-pty', 'prebuilds', 'linux-arm64', 'pty.node');
  for (const file of [ptyBuild, ptyPrebuilt]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, ELF_ARM64);
  }
  try {
    assert.doesNotThrow(() => auditLinuxBundle(root, { targetArch: 'arm64' }));
    assert.throws(() => auditLinuxBundle(root, { targetArch: 'x64' }), /not x64 ELF/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Linux bundle audit rejects Windows payloads anywhere in the reachable tree', () => {
  const root = fixture();
  const helper = path.join(root, 'dsh-desktop', 'assets', 'plugins', 'pet', 'helper.exe');
  fs.mkdirSync(path.dirname(helper), { recursive: true });
  fs.writeFileSync(helper, Buffer.from('MZ'));
  try {
    assert.throws(() => auditLinuxBundle(root), /Windows payload.*helper\.exe/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// 存在性校验仍生效：fixture 里 native/snapshot/index.node 在场，PE 内容必须被拒。
test('Linux bundle audit rejects a PE native module and a non-executable runtime', () => {
  const root = fixture();
  const native = path.join(root, 'dsh-desktop', 'native', 'snapshot', 'index.node');
  fs.writeFileSync(native, Buffer.from('MZ fake PE'));
  fs.chmodSync(path.join(root, 'dsh-desktop', 'vendor', 'node', 'node'), 0o644);
  try {
    assert.throws(() => auditLinuxBundle(root), /not executable|not ELF/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Linux bundle audit rejects musl native modules in the glibc distribution', () => {
  const root = fixture();
  const native = path.join(root, 'dsh-desktop', 'node_modules', '@img', 'sharp-linuxmusl-x64', 'addon.node');
  fs.mkdirSync(path.dirname(native), { recursive: true });
  fs.writeFileSync(native, ELF);
  try {
    assert.throws(() => auditLinuxBundle(root), /musl payload in glibc bundle.*addon\.node/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Linux bundle audit rejects node-addon-system bin/musl variant', () => {
  const root = fixture();
  const native = path.join(
    root, 'dsh-desktop', 'node_modules', '@deepseek-ai',
    'node-addon-system-linux-x64', 'bin', 'musl', 'system.node',
  );
  fs.mkdirSync(path.dirname(native), { recursive: true });
  fs.writeFileSync(native, ELF);
  try {
    assert.throws(() => auditLinuxBundle(root), /musl payload in glibc bundle.*bin\/musl\/system\.node/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Linux bundle audit accepts the glibc node-addon-system variant', () => {
  const root = fixture();
  const native = path.join(
    root, 'dsh-desktop', 'node_modules', '@deepseek-ai',
    'node-addon-system-linux-x64', 'bin', 'glibc', 'system.node',
  );
  fs.mkdirSync(path.dirname(native), { recursive: true });
  fs.writeFileSync(native, ELF);
  try {
    assert.doesNotThrow(() => auditLinuxBundle(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Linux bundle audit rejects embedded local build paths', () => {
  const root = fixture();
  const generated = path.join(root, 'dsh-desktop', 'generated.js');
  fs.writeFileSync(generated, 'const source = "/home/alice/work/eac/private.ts";');
  try {
    assert.throws(
      () => auditLinuxBundle(root, { forbiddenPaths: ['/home/alice/work/eac'] }),
      /local build path.*generated\.js/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Linux bundle audit scans the complete extracted artifact outside the resource root', () => {
  const artifact = fs.mkdtempSync(path.join(os.tmpdir(), 'eac-linux-artifact-'));
  const resources = path.join(artifact, 'usr', 'lib', 'deepseek-harness-eac');
  fs.mkdirSync(resources, { recursive: true });
  const payload = fixture();
  fs.cpSync(path.join(payload, 'dsh-desktop'), path.join(resources, 'dsh-desktop'), { recursive: true });
  const leaked = path.join(artifact, 'usr', 'bin', 'generated-launcher');
  fs.mkdirSync(path.dirname(leaked), { recursive: true });
  fs.writeFileSync(leaked, '#!/bin/sh\nexec /root/code/eacnolinux/private-bin\n');
  try {
    assert.throws(
      () => auditLinuxBundle(resources, {
        scanRoot: artifact,
        forbiddenPaths: ['/root/code/eacnolinux'],
      }),
      /local build path.*usr\/bin\/generated-launcher/,
    );
  } finally {
    fs.rmSync(payload, { recursive: true, force: true });
    fs.rmSync(artifact, { recursive: true, force: true });
  }
});

for (const [arch, elf] of [['x64', ELF], ['arm64', ELF_ARM64]] as const) {
  test(`Linux distribution pruning cleans nested koffi and bundled pnpm for ${arch}`, t => {
    const root = fixture(elf);
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const desktop = path.join(root, 'dsh-desktop');
    const glibc = `node_modules/@deepseek-ai/dsh-fs-local/node_modules/@koromix/koffi-linux-${arch}/linux_${arch}/koffi.node`;
    const musl = `node_modules/@deepseek-ai/dsh-fs-local/node_modules/@koromix/koffi-linux-${arch}/musl_${arch}/koffi.node`;
    const pnpm = 'vendor/pnpm/dist';
    const keep = [glibc, `${pnpm}/node_modules/@reflink/reflink-linux-${arch}-gnu/reflink.node`];
    const drop = [
      musl,
      `${pnpm}/node_modules/@reflink/reflink-linux-${arch}-musl/reflink.node`,
      `${pnpm}/node_modules/@reflink/reflink-darwin-arm64/reflink.node`,
      `${pnpm}/node_modules/@reflink/reflink-win32-x64-msvc/reflink.node`,
      `${pnpm}/vendor/fastlist-0.3.0-x64.exe`,
      `${pnpm}/node_modules/node-pty/prebuilds/win32-x64/pty.node`,
    ];
    for (const relative of [...keep, ...drop]) {
      const file = path.join(desktop, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, /darwin/.test(relative) ? Buffer.from([0xcf, 0xfa, 0xed, 0xfe])
        : /win32|\.exe$/.test(relative) ? Buffer.from('MZ') : elf);
    }
    const entry = path.join(desktop, pnpm, 'pnpm.cjs');
    fs.writeFileSync(entry, '// pnpm entry must be preserved\n');
    assert.throws(() => auditLinuxBundle(root, { targetArch: arch }), /musl payload|Windows payload|not ELF/);

    pruneNonLinuxPrebuilds(desktop, arch);
    pruneLinuxPayloads(desktop, arch);

    for (const relative of keep) assert.deepEqual(fs.readFileSync(path.join(desktop, relative)), elf);
    for (const relative of drop) assert.equal(fs.existsSync(path.join(desktop, relative)), false, relative);
    assert.equal(fs.readFileSync(entry, 'utf8'), '// pnpm entry must be preserved\n');
    assert.doesNotThrow(() => auditLinuxBundle(root, { targetArch: arch }));
  });
}

test('Linux bundle audit rejects a musl suffix in bundled pnpm dependencies', t => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const addon = path.join(root, 'dsh-desktop', 'vendor', 'pnpm', 'dist', 'node_modules', '@reflink', 'reflink-linux-x64-musl', 'reflink.node');
  fs.mkdirSync(path.dirname(addon), { recursive: true });
  fs.writeFileSync(addon, ELF);
  assert.throws(() => auditLinuxBundle(root), /musl payload in glibc bundle/);
});
