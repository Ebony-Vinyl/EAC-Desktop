'use strict';

// V4 运行时补丁（ADR 0002 L2 业务服务层，幂等；Wave 1 自 runtime-patches.js
// 类型化迁出，行为零变更）：覆盖三处运行副本 —— profile 共享 junction 根、
// 内置 app 副本（__dirname/node_modules）、用户更新过的 agent overlay
// （<userData>/agent/node_modules）。agent 更新会换掉 overlay 整树，
// 补丁随 syncCompanionPlugins 每次启动重放。

import path = require('node:path');
import os = require('node:os');
import fs = require('node:fs');
import { APP_ROOT } from './runtime-paths';
import { writeFileAtomic } from '../atomic-json.js';
// scripts/patch-session-manage.js 尚未类型化（工具链脚本，暂不收编）。
const { patchSessionManage } = require('../../scripts/patch-session-manage') as {
  patchSessionManage(root: string, log: (m: string) => void): number;
};

/** 注入接口：由宿主（Electron main / Tauri sidecar）在启动时提供。 */
export interface RuntimePatchesCtx {
  log(tag: string, msg: string): void;
  getDshHome(): string | null;
  getUserDataDir(): string;
}

let ctx!: RuntimePatchesCtx;
export function init(d: RuntimePatchesCtx): void { ctx = d; }

function runtimePatchRoots(): string[] {
  const home = ctx.getDshHome() || path.join(os.homedir(), '.dsh');
  const roots = [
    path.join(home, 'profiles', 'node_modules'),
    path.join(APP_ROOT, 'node_modules'),
    path.join(ctx.getUserDataDir(), 'agent', 'node_modules'),
  ];
  // 每个 profile 有自己的 node_modules（插件实际装在这里，例如
  // dsh-session-manager）。第三方插件也要打补丁，否则它自带的删除链路
  // 仍按旧版 persistence.list() 形状查目录。
  try {
    const profiles = path.join(home, 'profiles');
    for (const name of fs.readdirSync(profiles)) {
      const nm = path.join(profiles, name, 'node_modules');
      if (fs.existsSync(nm)) roots.push(nm);
    }
  } catch {
    /* 没有 profiles 目录（开发/极简环境）：忽略 */
  }
  return roots;
}

// 对话删除 / 归档管理（dsh-session-manager 插件的前置依赖）：
// dsh-workspace + dsh-host-apiproxy + dsh-session + dsh-client-connection +
// dsh-client-ui-workspace 的外科手术式扩展（详见 scripts/patch-session-manage.js
// 头注释）。锚点不匹配（官方包结构变化）时自动跳过，绝不损坏文件。
export function applySessionManageFix(): void {
  for (const root of runtimePatchRoots()) {
    if (!root || !fs.existsSync(root)) continue;
    try {
      const n = patchSessionManage(root, (m) => ctx.log('boot', m));
      if (n > 0) ctx.log('boot', '对话删除补丁: 已应用到 ' + root);
    } catch (err) {
      ctx.log('boot', '对话删除补丁失败(' + root + '): ' + (err as Error).message);
    }
  }
}

// 内核前端 CSS：反色标签（Tag solid tone）的文字不可见。
//
// @deepseek-ai/dsh-web-frontend 的 index-*.css 里有：
//
//   ._tag_brmue_4[data-tone=solid]{
//     background: var(--dsw-alias-label-primary);
//     color:      var(--dsw-alias-bg-layer-3);
//   }
//
// bg-layer-3 是「背景层色」，语义是背景而不是前景。它在皮肤下解析为
// #e0e7f6e0（浅色 + 高透明度），压在同为深色的 label-primary 底上，实测
// 文字对比度只有 1.0~1.1（WCAG 正文要求 ≥4.5）——表现为纯色块看不见字。
// Agent 预设页选中卡片上的「内置」「新任务默认」徽章正是这个。
//
// 这与用户此前反馈的插件侧问题是同一类写法错误（EAC-Pack 用 source-patch
// 修了 5 个第三方包）。区别在于内核前端产物随 @deepseek-ai/dsh-web-frontend
// 下发，不在 EAC-Pack 的补丁管辖内，只能在运行时副本上就地改写。
//
// 修法：color 换成与 label-primary 配对的 label-primary-foreground。
// 该变量四套皮肤都有定义且随主题反色，亮暗模式都正确。
//
// 为什么不用 !important 覆盖层：覆盖层需要与内核保持相同特异性否则被压回，
// 而一旦用 !important 就会影响将来内核新增的同名规则。就地替换与原规则
// 特异性完全一致，行为最可预测。

/** 必须逐字节匹配内核产物的原始写法（属性值无引号）。 */
const KERNEL_TAG_TONE_BROKEN =
  '._tag_brmue_4[data-tone=solid]{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}';
const KERNEL_TAG_TONE_FIXED =
  '._tag_brmue_4[data-tone=solid]{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary-foreground,#fff)}';

export function applyKernelTagToneFix(): void {
  for (const root of runtimePatchRoots()) {
    if (!root || !fs.existsSync(root)) continue;
    const assets = path.join(root, '@deepseek-ai', 'dsh-web-frontend', 'dist', 'assets');
    if (!fs.existsSync(assets)) continue;
    let files: string[];
    try { files = fs.readdirSync(assets); } catch { continue; }
    for (const name of files) {
      if (!/^index-.*\.css$/.test(name)) continue;
      const file = path.join(assets, name);
      let text: string;
      try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
      // 已修过（幂等重放）或上游改了结构 —— 都不动。
      if (!text.includes(KERNEL_TAG_TONE_BROKEN)) continue;
      try {
        fs.writeFileSync(file, text.split(KERNEL_TAG_TONE_BROKEN).join(KERNEL_TAG_TONE_FIXED), 'utf8');
        ctx.log('boot', '内核标签反色修正: 已应用到 ' + file);
      } catch (err) {
        ctx.log('boot', '内核标签反色修正失败(' + name + '): ' + (err as Error).message);
      }
    }
  }
}

// 虎鲸之链皮肤设置栏贴底的问题**不在这里修**。
//
// 曾经想过把基础规则 `justify-content:safe flex-end` 就地改成 `flex-start`，
// 核对皮肤源码后否掉了：那是 docked 布局的**设计行为**（作者还专门提供了
// centered 布局的覆盖规则），改基础规则等于推翻作者设计、并破坏 docked 观感。
//
// 正确做法是改设置项 `centerSettings` 的默认值（作者实现好了两种布局），
// 落在精简版的播种流程里：见 lite-skins.ts 的 applyOrcaCenterSettingsDefault。
// 只对 lite 生效，full 不动。

// ---------------------------------------------------------------------------
// Issue #439：旧会话未知 Agent Preset（如 5.x 遗留的 anchored-standard）恢复兼容
//
// 背景：EAC 5.x（0.1.x 内核）随包通过 .agent-presets 目录分发 anchored-standard 等
// 社区预设并设为默认，老用户的历史会话日志与设置中普遍记录了该预设 ID。升级至 6.x
// （0.2.x 注册制内核 @deepseek-ai/dsh-agent-preset-registry）后，内核不再扫描
// .agent-presets 目录：
//   1. 若用户残留 selectedDefault='anchored-standard'，defaultId 会指向未注册预设，
//      导致新建会话或默认回退直接抛 `Unknown agent preset`；
//   2. ApiSessionAgentController.resumeObserved 与 fork 严格调用 composeAgent(recordedPreset)，
//      不像 SessionSkillCatalog.scopeFor 那样对未知历史预设降级回退，导致旧对话无法打开、
//      无法切换模型（而显式 createSession / agentPresets.select 指定未知预设的 API 报错契约
//      必须原样保留，不能在 resolve/retain 底层一刀切吞错）。
// ---------------------------------------------------------------------------

export const LEGACY_PRESET_DEFAULT_MARKER = 'dsh-desktop:legacy-preset-default-v1';
export const LEGACY_PRESET_RESUME_MARKER = 'dsh-desktop:legacy-preset-resume-v1';

const PRESET_REGISTRY_DEFAULT_ANCHOR = [
  '\t\tget defaultId() {',
  '\t\t\treturn this.config.selectedDefault.get() ?? this.config.default;',
  '\t\t}',
].join('\n');

const PRESET_REGISTRY_DEFAULT_REPLACEMENT = [
  '\t\tget defaultId() {',
  `\t\t\t/* ${LEGACY_PRESET_DEFAULT_MARKER} */`,
  '\t\t\tconst selected = this.config.selectedDefault.get();',
  '\t\t\tif (selected !== void 0 && (this.definitions.size === 0 || this.definitions.has(selected))) return selected;',
  '\t\t\treturn this.config.default;',
  '\t\t}',
].join('\n');

const SESSION_COMPOSE_HEAD_ANCHOR = [
  '\tasync composeAgent(presetId) {',
  '\t\tconst presets = this.ctx.get("agentPresets");',
].join('\n');

const SESSION_COMPOSE_OBSERVED_HELPER = [
  `\t/* ${LEGACY_PRESET_RESUME_MARKER} */`,
  '\tasync composeObservedAgent(presetId, sessionId) {',
  '\t\ttry {',
  '\t\t\treturn await this.composeAgent(presetId);',
  '\t\t} catch (error) {',
  '\t\t\tif (presetId === void 0 || remoteErrorOf(error)?.code !== "agent-preset/not-found") throw error;',
  '\t\t\tconst log = typeof this.ctx.logger === "function" ? this.ctx.logger("api-session") : this.ctx.logger;',
  '\t\t\tlog?.warn?.(`api-session: session "${sessionId}" recorded unknown agent preset "${presetId}", falling back to default preset`);',
  '\t\t\treturn await this.composeAgent(void 0);',
  '\t\t}',
  '\t}',
].join('\n');

const SESSION_RESUME_ANCHOR = '\t\tconst composition = await this.composeAgent(this.presetForObservation(observation));';
const SESSION_RESUME_REPLACEMENT = '\t\tconst composition = await this.composeObservedAgent(this.presetForObservation(observation), sessionId);';

const SESSION_FORK_ANCHOR = '\t\t\tconst composition = await this.agents.composeAgent(this.agents.presetForObservation(source));';
const SESSION_FORK_REPLACEMENT = '\t\t\tconst composition = await this.agents.composeObservedAgent(this.agents.presetForObservation(source), source.header.id);';

export function patchLegacyAgentPresetRegistrySource(source: string): string | undefined {
  if (source.includes(LEGACY_PRESET_DEFAULT_MARKER)) return source;
  if (source.split(PRESET_REGISTRY_DEFAULT_ANCHOR).length !== 2) return undefined;
  return source.replace(PRESET_REGISTRY_DEFAULT_ANCHOR, () => PRESET_REGISTRY_DEFAULT_REPLACEMENT);
}

export function patchLegacySessionPresetResumeSource(source: string): string | undefined {
  if (source.includes(LEGACY_PRESET_RESUME_MARKER)) return source;
  if (
    source.split(SESSION_COMPOSE_HEAD_ANCHOR).length !== 2
    || source.split(SESSION_RESUME_ANCHOR).length !== 2
    || source.split(SESSION_FORK_ANCHOR).length !== 2
  ) {
    return undefined;
  }
  return source
    .replace(SESSION_COMPOSE_HEAD_ANCHOR, () => `${SESSION_COMPOSE_OBSERVED_HELPER}\n${SESSION_COMPOSE_HEAD_ANCHOR}`)
    .replace(SESSION_RESUME_ANCHOR, () => SESSION_RESUME_REPLACEMENT)
    .replace(SESSION_FORK_ANCHOR, () => SESSION_FORK_REPLACEMENT);
}

export function applyLegacyAgentPresetCompatToNodeModules(
  nmRoot: string,
  log: (msg: string) => void = () => {},
): number {
  let changed = 0;
  const targets: Array<{
    rel: string;
    patch: (src: string) => string | undefined;
    label: string;
  }> = [
    {
      rel: path.join('@deepseek-ai', 'dsh-agent-preset-registry', 'lib', 'index.js'),
      patch: patchLegacyAgentPresetRegistrySource,
      label: 'agent-preset-registry defaultId 自愈',
    },
    {
      rel: path.join('@deepseek-ai', 'dsh-api-session-controller', 'lib', 'index.js'),
      patch: patchLegacySessionPresetResumeSource,
      label: 'api-session-controller 旧会话未知预设恢复回退',
    },
  ];
  for (const item of targets) {
    const file = path.join(nmRoot, item.rel);
    if (!fs.existsSync(file)) continue;
    let original: string;
    try {
      original = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const next = item.patch(original);
    if (next === undefined) {
      log(`跳过 ${item.label}（锚点未匹配: ${file}）`);
      continue;
    }
    if (next === original) continue;
    writeFileAtomic(file, next);
    changed += 1;
    log(`已应用 ${item.label}: ${file}`);
  }
  return changed;
}

export function assertLegacyAgentPresetCompatApplied(nmRoot: string): void {
  const registryFile = path.join(nmRoot, '@deepseek-ai', 'dsh-agent-preset-registry', 'lib', 'index.js');
  const controllerFile = path.join(nmRoot, '@deepseek-ai', 'dsh-api-session-controller', 'lib', 'index.js');
  const hasRegistry = fs.existsSync(registryFile);
  const hasController = fs.existsSync(controllerFile);
  // 0.1.x 目录扫描内核不存在 dsh-agent-preset-registry，直接放行；
  // 只要任一 0.2.x 目标包在位，就必须分别断言两端补丁 marker 同时落盘，杜绝半生效状态。
  if (!hasRegistry && !hasController) return;
  if (!hasRegistry) {
    throw new Error(`[legacy-preset-compat] missing ${registryFile} while ${controllerFile} exists`);
  }
  if (!hasController) {
    throw new Error(`[legacy-preset-compat] missing ${controllerFile} while ${registryFile} exists`);
  }
  const registryContent = fs.readFileSync(registryFile, 'utf8');
  if (!registryContent.includes(LEGACY_PRESET_DEFAULT_MARKER)) {
    throw new Error(`[legacy-preset-compat] missing marker ${LEGACY_PRESET_DEFAULT_MARKER} in ${registryFile}`);
  }
  const controllerContent = fs.readFileSync(controllerFile, 'utf8');
  if (!controllerContent.includes(LEGACY_PRESET_RESUME_MARKER)) {
    throw new Error(`[legacy-preset-compat] missing marker ${LEGACY_PRESET_RESUME_MARKER} in ${controllerFile}`);
  }
}

export function applyLegacyAgentPresetCompatFix(): void {
  for (const root of runtimePatchRoots()) {
    if (!root || !fs.existsSync(root)) continue;
    try {
      applyLegacyAgentPresetCompatToNodeModules(root, (m) => ctx.log('boot', m));
    } catch (err) {
      ctx.log('boot', '旧会话预设兼容补丁失败(' + root + '): ' + (err as Error).message);
    }
  }
}
