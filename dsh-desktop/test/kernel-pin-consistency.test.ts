// 内核版本钉一致性：内核版本散布在多个必须同步的位置（历史上各自手改，
// 升级时容易漏改一处导致 fetch-kernel 拉错 tag / 冒烟断言错版本）。本测试
// 把三处钉子锁在一起 —— 升内核时 package.json 是唯一事实源，改完这里其他
// 位置不同步就会红：
//   1. package.json  dependencies 的 file:vendor/kernel/<ver>/ 前缀
//   2. scripts/fetch-kernel.ts  DEFAULT_TAG = 'dsh-v<ver>'
//   3. docs/archive/upgrade-test-441.js（Electron 退役后归档，钉子语义保留）
//      「安装树内核 = <ver>」硬断言

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
  overrides: Record<string, string>;
};

const kernelPrefixes = Object.values(pkg.dependencies)
  .filter((v) => v.startsWith('file:vendor/kernel/'))
  .map((v) => v.slice('file:vendor/kernel/'.length).split('/')[0]);
assert.ok(kernelPrefixes.length > 0, 'package.json 应有 file:vendor/kernel/<ver>/ 依赖');
const kernelVersion = kernelPrefixes[0];

// 源码里是否出现指向 GitHub REST API 主机的 URL（issue #393 的根因）。
// 刻意不用子串判断：子串在任意位置都会命中（含 `api.github.com.evil.test`），
// 既不可靠，也会被 CodeQL 按 js/incomplete-url-substring-sanitization 报错。
function hitsGithubApiHost(source: string): boolean {
  const urls = source.match(/https?:\/\/[^\s'"()\[\]]+/g) ?? [];
  return urls.some((raw) => {
    try {
      return new URL(raw).host.toLowerCase() === 'api.github.com';
    } catch {
      return false;
    }
  });
}

test('package.json 所有内核依赖钉同一版本', () => {
  assert.ok(kernelPrefixes.every((v) => v === kernelVersion),
    'package.json 出现多个内核版本钉: ' + [...new Set(kernelPrefixes)].join(', '));
});

test('内核 overrides 与直接依赖钉同一版本', () => {
  for (const [name, spec] of Object.entries(pkg.overrides)) {
    if (!name.startsWith('@deepseek-ai/')) continue;
    assert.ok(spec.startsWith(`file:vendor/kernel/${kernelVersion}/`), `${name}: ${spec}`);
    if (pkg.dependencies[name] !== undefined) assert.equal(spec, pkg.dependencies[name], name);
  }
});

test('锁文件沿用同一份内核接线且不残留旧版 tarball', () => {
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, { dependencies?: Record<string, string>; resolved?: string }>;
  };
  assert.deepEqual(lock.packages['']?.dependencies, pkg.dependencies);
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (!entry.resolved?.startsWith('file:vendor/kernel/')) continue;
    assert.ok(entry.resolved.startsWith(`file:vendor/kernel/${kernelVersion}/`), `${name}: ${entry.resolved}`);
  }
});

test('安装包工作流缓存版本与 package.json 内核钉一致', () => {
  const workflow = readFileSync(join(ROOT, '..', '.github', 'workflows', 'staged-runtime-artifact.yml'), 'utf8');
  assert.equal(/KERNEL_VERSION: '([^']+)'/.exec(workflow)?.[1], kernelVersion);
});

test('fetch-kernel DEFAULT_TAG 与 package.json 内核钉一致', () => {
  const src = readFileSync(join(ROOT, 'scripts', 'fetch-kernel.ts'), 'utf8');
  const m = src.match(/const DEFAULT_TAG = 'dsh-v([^']+)'/);
  assert.ok(m, 'fetch-kernel.ts 未找到 DEFAULT_TAG');
  assert.equal(m![1], kernelVersion,
    `fetch-kernel DEFAULT_TAG=${m![1]} != package.json 内核钉=${kernelVersion}`);
});

test('fetch-kernel 钉版 commit 表覆盖 DEFAULT_TAG（issue #393：零 API 请求）', () => {
  // 钉版 tag 必须在 KERNEL_TAG_COMMITS 里有 40 位小写十六进制记录，否则缓存冷时
  // 又走 git ls-remote；更糟的是有人把回落改回匿名 REST API → CI 矩阵并发 403。
  const src = readFileSync(join(ROOT, 'scripts', 'fetch-kernel.ts'), 'utf8');
  const table = src.match(/const KERNEL_TAG_COMMITS: Record<string, string> = \{([\s\S]*?)\n\};/);
  assert.ok(table, 'fetch-kernel.ts 未找到 KERNEL_TAG_COMMITS 钉版表');
  // tag 用行前缀定位而非拼进正则：避免把 kernelVersion 里的正则元字符当模式
  // 解释（CodeQL js/incomplete-string-escaping 提示的正是这类隐患）。
  const expectedEntry = `'dsh-v${kernelVersion}':`;
  const entryLine = table![1]!.split('\n').find((line) => line.trim().startsWith(expectedEntry));
  assert.ok(entryLine !== undefined,
    `KERNEL_TAG_COMMITS 缺少 'dsh-v${kernelVersion}' 的记录（升内核时同步补）`);
  const sha = /'([0-9a-f]{40})'/.exec(entryLine!)?.[1];
  assert.ok(sha !== undefined,
    `KERNEL_TAG_COMMITS['dsh-v${kernelVersion}'] 必须是 40 位小写十六进制 commit: ${entryLine}`);
  assert.equal(hitsGithubApiHost(src), false,
    'fetch-kernel.ts 又出现了指向 GitHub REST API 主机的 URL（匿名配额 → CI 矩阵并发随机 403）');
});

test('upgrade-test-441 内核断言与 package.json 内核钉一致', () => {
  // 5.3.3 批次 F：该脚本已归档到仓库根 docs/archive/（Electron 退役后不可再
  // 跑），钉子语义保留 —— 升内核仍须同步归档件里的硬断言，防止按旧文档
  // 回溯时被误导。
  const src = readFileSync(join(ROOT, '..', 'docs', 'archive', 'upgrade-test-441.js'), 'utf8');
  assert.ok(src.includes(`kern === '${kernelVersion}'`),
    `归档的 upgrade-test-441.js 内核硬断言未钉住 ${kernelVersion}（升内核后记得同步）`);
});
