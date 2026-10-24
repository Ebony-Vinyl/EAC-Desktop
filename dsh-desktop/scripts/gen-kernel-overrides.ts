'use strict';

// 把 vendored 内核 tarball 缓存（vendor/kernel/<version>/）接线进 package.json。
//
// Why: @deepseek-ai/dsh 0.1.2-alpha.1 未发布 npm（npmmirror / npmjs 均停在
// 0.1.1-rc.2），内核改由 GitHub tag 源码构建（见 scripts/fetch-kernel.ts），
// 产物 tarball 缓存在 vendor/kernel/<version>/（gitignored）。npm 的规则：
// overrides 指向直接依赖时值必须与依赖 spec 完全一致（EOVERRIDE），因此本
// 脚本把全部 @deepseek-ai/* 直接依赖改写为与 overrides 相同的 file: tarball
// spec，其余内核包走 overrides 兜底，保证整棵依赖树（含 peer 声明）全部解析
// 到同一份本地构建，不与 registry 上的旧版本混装。
//
// 幂等：重复运行按当前 tarball 名单整体重写 @deepseek-ai/* 相关字段。
// 用法：npm run gen-kernel-overrides [-- [vendor 子目录名]]

import fs = require('node:fs');
import path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const VENDOR_KERNEL = path.join(ROOT, 'vendor', 'kernel');

// 内核共享包在 monorepo 里靠 workspace 互链解析，发布面没人在 dependencies
// 里声明（只有裸 import / peerDependencies），legacy-peer-deps 下 npm 不会
// 安装它们。这份清单来自依赖缺口扫描（import 名单 − 已声明名单），按需人工
// 增补；生成器把它们一并写入直接依赖（file: spec）。
export const KERNEL_DEP_GAPS = [
  '@deepseek-ai/dsh-attachment',
  '@deepseek-ai/dsh-brand',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-credentials',
  '@deepseek-ai/dsh-hook-protocol',
  '@deepseek-ai/dsh-jobs',
  '@deepseek-ai/dsh-sdk-protocol',
  '@deepseek-ai/dsh-session-persistence',
  '@deepseek-ai/dsh-session-query',
  '@deepseek-ai/dsh-settings',
  '@deepseek-ai/dsh-util-time',
  '@deepseek-ai/dsh-util-workspace-path',
];

/** 从 tarball 文件名解析包名：deepseek-ai-<pkg>-<semver>.tgz → @deepseek-ai/<pkg>。 */
function packageNameOf(filename: string): string | null {
  const m = /^deepseek-ai-(.+)-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)\.tgz$/.exec(filename);
  return m ? `@deepseek-ai/${m[1]}` : null;
}

/**
 * 上游已移除的内核包白名单（0.1.7-rc.2 实测）。升版后这些包不再随内核分发，
 * 生成器把它们从 dependencies/overrides 一并剔除；白名单外的缓存缺失仍然
 * 硬错误，防止把真实漂移静默吞掉。EAC 自有代码对这些包零 import
 * （dsh-agent-presets 仅存于注释与 dsh-compact 的陈旧 peer，后者另行清理）。
 *
 * 0.2.0-rc.2 复核（2026-10-01）：tarball 名单 323 → 327，0 移除 / 4 新增
 * （dsh-client-product-analytics、dsh-client-ui-settings-session-log、
 * dsh-experimental-schedule-bundle、dsh-otel——均为上游 dependencies 正常
 * 声明，随安装闭包传递安装，无需进 KERNEL_DEP_GAPS）。本白名单成员不变，
 * 保留供降级回 0.1.7 或下次升版比对。
 *
 * 0.2.1-rc.2 移除 schedule 实验组合包、invariants 和进程内 subagent driver。
 * 仅在目标缓存确实缺少它们时清理；回构旧内核仍保留存在的包。
 */
const KERNEL_REMOVED_PACKAGES = [
  '@deepseek-ai/dsh-code-runtime',
  '@deepseek-ai/dsh-agent-presets',
  '@deepseek-ai/dsh-code-runtime-worker-thread',
  '@deepseek-ai/dsh-e2b',
  '@deepseek-ai/dsh-experimental-agent-team-web-profile',
  '@deepseek-ai/dsh-fs-e2b',
  '@deepseek-ai/dsh-settings-file',
  '@deepseek-ai/dsh-subprocess-e2b',
  '@deepseek-ai/dsh-workflow-worker-thread',
  '@deepseek-ai/dsh-experimental-schedule-bundle',
  '@deepseek-ai/dsh-invariants',
  '@deepseek-ai/dsh-subagent-in-process-driver',
] as const;

/**
 * 把内核 spec 应用到 manifest：改写存活的 @deepseek-ai/* 直接依赖、剔除
 * 白名单内已移除包（dependencies + overrides 同步删）、保留非内核安全钉。
 * 导出供 test/gen-kernel-overrides.test.ts 契约测试使用。
 */
export function applyKernelSpecs(
  manifest: { dependencies?: Record<string, string>; overrides?: Record<string, string> },
  specByName: Map<string, string>,
): { removed: string[]; rewritten: number; gaps: number } {
  manifest.dependencies = manifest.dependencies ?? {};
  const removed: string[] = [];
  let gaps = 0;
  for (const gapName of KERNEL_DEP_GAPS) {
    if (manifest.dependencies[gapName] !== undefined) continue;
    const spec = specByName.get(gapName);
    if (!spec) throw new Error(`gen-kernel-overrides: 缺口包 ${gapName} 在内核缓存里没有 tarball`);
    manifest.dependencies[gapName] = spec;
    gaps += 1;
  }
  let directCount = 0;
  for (const depName of Object.keys(manifest.dependencies)) {
    if (!depName.startsWith('@deepseek-ai/')) continue;
    const spec = specByName.get(depName);
    if (!spec) {
      if ((applyKernelSpecs as { REMOVED_SET?: Set<string> }).REMOVED_SET?.has(depName)) {
        delete manifest.dependencies[depName];
        removed.push(depName);
        continue;
      }
      throw new Error(`gen-kernel-overrides: 直接依赖 ${depName} 在内核缓存里没有对应 tarball（包被移除？）`);
    }
    manifest.dependencies[depName] = spec;
    directCount += 1;
  }
  // 保留非 @deepseek-ai 的安全钉与应用级 override。旧实现整体覆盖 overrides，
  // 会在每次重建内核缓存时静默抹掉 glob/qs 等漏洞修复钉。白名单内已移除包的
  // override 同步剔除（EOVERRIDE：overrides 指向不存在的依赖会让 npm 拒装）。
  const nonKernelOverrides = Object.entries(manifest.overrides ?? {})
    .filter(([name]) => !name.startsWith('@deepseek-ai/'));
  manifest.overrides = Object.fromEntries(
    [...nonKernelOverrides, ...specByName.entries()].sort(([a], [b]) => a.localeCompare(b)),
  );
  return { removed, rewritten: directCount, gaps };
}
(applyKernelSpecs as { REMOVED_SET?: Set<string> }).REMOVED_SET = new Set<string>(KERNEL_REMOVED_PACKAGES);

function main(): void {
  const argVersion = process.argv[2];
  const versions = fs.existsSync(VENDOR_KERNEL)
    ? fs.readdirSync(VENDOR_KERNEL).filter((e) =>
      /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/.test(e)
      && fs.statSync(path.join(VENDOR_KERNEL, e)).isDirectory())
    : [];
  if (versions.length === 0) {
    console.error('gen-kernel-overrides: vendor/kernel/ 下没有构建缓存；先运行 npm run fetch-kernel');
    process.exit(1);
  }
  const version = argVersion ?? (versions.length === 1 ? versions[0] : null);
  if (!version) {
    console.error(`gen-kernel-overrides: vendor/kernel/ 下有多个版本（${versions.join(', ')}），需显式指定`);
    process.exit(1);
  }
  const dir = path.join(VENDOR_KERNEL, version);
  if (!fs.existsSync(dir)) {
    console.error(`gen-kernel-overrides: 缓存目录不存在: ${dir}`);
    process.exit(1);
  }

  const tarballs = fs.readdirSync(dir).filter((f) => f.endsWith('.tgz'));
  const specByName = new Map<string, string>();
  for (const file of tarballs) {
    const name = packageNameOf(file);
    if (!name) {
      console.error(`gen-kernel-overrides: 无法从文件名解析包名，跳过 ${file}`);
      continue;
    }
    specByName.set(name, `file:vendor/kernel/${version}/${file}`);
  }
  if (specByName.size === 0) {
    console.error('gen-kernel-overrides: 缓存目录里没有可识别的 tarball');
    process.exit(1);
  }

  const manifestPath = path.join(ROOT, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
    dependencies?: Record<string, string>;
    overrides?: Record<string, string>;
  };
  const result = applyKernelSpecs(manifest, specByName);
  if (result.removed.length) {
    console.log(`gen-kernel-overrides: 已剔除上游移除包 ${result.removed.length} 个: ${result.removed.join(', ')}`);
  }

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`gen-kernel-overrides: 内核 ${version} → 直接依赖 ${result.rewritten} 个改写 + 缺口补 ${result.gaps} 个，overrides 共 ${specByName.size} 个包`);
}

// 仅直接执行时运行；测试经 import 复用 applyKernelSpecs，不得触发 main()。
if (require.main === module) main();
