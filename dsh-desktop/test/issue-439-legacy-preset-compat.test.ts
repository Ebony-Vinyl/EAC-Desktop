import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const desktopRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  LEGACY_PRESET_DEFAULT_MARKER,
  LEGACY_PRESET_RESUME_MARKER,
  patchLegacyAgentPresetRegistrySource,
  patchLegacySessionPresetResumeSource,
  applyLegacyAgentPresetCompatToNodeModules,
  assertLegacyAgentPresetCompatApplied,
} = require('../lib/desktop/runtime-patches.js') as {
  LEGACY_PRESET_DEFAULT_MARKER: string;
  LEGACY_PRESET_RESUME_MARKER: string;
  patchLegacyAgentPresetRegistrySource(source: string): string | undefined;
  patchLegacySessionPresetResumeSource(source: string): string | undefined;
  applyLegacyAgentPresetCompatToNodeModules(nmRoot: string, log?: (msg: string) => void): number;
  assertLegacyAgentPresetCompatApplied(nmRoot: string): void;
};

// 逐字节对齐 @deepseek-ai/dsh-agent-preset-registry 0.2.1-rc.2 / 0.2.2-rc.1 产物形态
const REGISTRY_FIXTURE = [
  'class AgentPresetRegistry {',
  '\tconstructor(config, definitions) {',
  '\t\tthis.config = config;',
  '\t\tthis.definitions = definitions;',
  '\t}',
  '\t\t/** Default preset for a subsequently created session. */',
  '\t\tget defaultId() {',
  '\t\t\treturn this.config.selectedDefault.get() ?? this.config.default;',
  '\t\t}',
  '\tasync resolve(id) {',
  '\t\tconst wanted = id ?? this.defaultId;',
  '\t\tconst record = this.definitions.get(wanted);',
  '\t\tif (record === void 0) {',
  '\t\t\tconst err = new Error(`Unknown agent preset: ${wanted}`);',
  '\t\t\terr.code = "agent-preset/not-found";',
  '\t\t\tthrow err;',
  '\t\t}',
  '\t\tif (record.broken) {',
  '\t\t\tconst err = new Error(record.broken);',
  '\t\t\terr.code = "agent-preset/invalid";',
  '\t\t\tthrow err;',
  '\t\t}',
  '\t\treturn { id: wanted };',
  '\t}',
  '\tasync mount(agentCtx, id) {',
  '\t\tagentCtx.mountedPreset = id;',
  '\t}',
  '}',
  'module.exports = { AgentPresetRegistry };',
].join('\n');

// 逐字节对齐 @deepseek-ai/dsh-api-session-controller 0.2.1-rc.2 与 0.2.2-rc.1 产物形态
function buildControllerFixture(variant: '021' | '022'): string {
  const setupBlock = variant === '021'
    ? [
        '\t\tif (presets === void 0) return { setup: (_agentCtx, agent) => {',
        '\t\t\tthis.installSelection(agent);',
        '\t\t} };',
        '\t\tconst resolvedId = (await presets.resolve(presetId)).id;',
        '\t\treturn {',
        '\t\t\tagentPreset: resolvedId,',
        '\t\t\tsetup: async (agentCtx, agent) => {',
        '\t\t\t\tthis.installSelection(agent);',
        '\t\t\t\tawait presets.mount(agentCtx, resolvedId);',
        '\t\t\t}',
        '\t\t};',
      ].join('\n')
    : [
        '\t\tif (presets === void 0) return { setup: (agentCtx) => {',
        '\t\t\tinstallModelSelection(agentCtx);',
        '\t\t} };',
        '\t\tconst resolvedId = (await presets.resolve(presetId)).id;',
        '\t\treturn {',
        '\t\t\tagentPreset: resolvedId,',
        '\t\t\tsetup: async (agentCtx) => {',
        '\t\t\t\tinstallModelSelection(agentCtx);',
        '\t\t\t\tawait presets.mount(agentCtx, resolvedId);',
        '\t\t\t}',
        '\t\t};',
      ].join('\n');

  return [
    'function remoteErrorOf(err) { return err && typeof err.code === "string" ? err : void 0; }',
    'function installModelSelection() {}',
    'class ApiSessionAgentController {',
    '\tconstructor(ctx) { this.ctx = ctx; }',
    '\tinstallSelection() {}',
    '\tagentOptions() { return {}; }',
    '\tpresetForObservation(obs) { return obs.agentPreset; }',
    '\tasync createSession(request) {',
    '\t\tconst composition = await this.composeAgent(request.agentPreset);',
    '\t\tconst agentCtx = {};',
    '\t\tawait composition.setup(agentCtx, {});',
    '\t\treturn { agentPreset: composition.agentPreset, mounted: agentCtx.mountedPreset };',
    '\t}',
    '\tasync composeAgent(presetId) {',
    '\t\tconst presets = this.ctx.get("agentPresets");',
    setupBlock,
    '\t}',
    '\tasync resumeObserved(sessionId, observation) {',
    '\t\tconst composition = await this.composeAgent(this.presetForObservation(observation));',
    '\t\tconst agentCtx = {};',
    '\t\tawait composition.setup(agentCtx, {});',
    '\t\treturn { sessionId, agentPreset: composition.agentPreset, mounted: agentCtx.mountedPreset };',
    '\t}',
    '}',
    'class SessionCommands {',
    '\tconstructor(agents) { this.agents = agents; }',
    '\tasync fork(source) {',
    '\t\t\tconst composition = await this.agents.composeAgent(this.agents.presetForObservation(source));',
    '\t\t\treturn composition.agentPreset;',
    '\t}',
    '}',
    'module.exports = { ApiSessionAgentController, SessionCommands };',
  ].join('\n');
}

function evalCjsModule(code: string): any {
  const mod = { exports: {} as any };
  const fn = new Function('module', 'exports', code);
  fn(mod, mod.exports);
  return mod.exports;
}

test('Issue #439: AgentPresetRegistry.defaultId self-heals stale selectedDefault (e.g. anchored-standard)', async () => {
  const patched = patchLegacyAgentPresetRegistrySource(REGISTRY_FIXTURE);
  assert.ok(patched, 'registry anchor must match');
  assert.match(patched, new RegExp(LEGACY_PRESET_DEFAULT_MARKER));
  assert.equal(patchLegacyAgentPresetRegistrySource(patched), patched, 'patch must be idempotent');
  assert.equal(patchLegacyAgentPresetRegistrySource('class Broken {}'), undefined, 'drifted source must return undefined');

  const { AgentPresetRegistry } = evalCjsModule(patched);
  const definitions = new Map<string, { broken?: string }>([
    ['standard', {}],
    ['minimal', {}],
  ]);

  let currentSelected: string | undefined = 'anchored-standard';
  const registry = new AgentPresetRegistry(
    {
      default: 'standard',
      selectedDefault: { get: () => currentSelected },
    },
    definitions,
  );

  assert.equal(registry.defaultId, 'standard', 'unregistered legacy selectedDefault must fall back to built-in default');
  assert.deepEqual(await registry.resolve(undefined), { id: 'standard' });

  currentSelected = 'minimal';
  assert.equal(registry.defaultId, 'minimal', 'valid user-selected default preset must still win');

  // 当 selectedDefault 与 config.default 均不在 definitions 中时，绝不得落到 Map 插入序第一个插件预设，
  // 必须返回内核自身的 config.default 并让 resolve() 按内核原生契约抛 agent-preset/not-found。
  const missingBothDefinitions = new Map<string, { broken?: string }>([
    ['alpha-plugin-preset', {}],
    ['beta-plugin-preset', {}],
  ]);
  const missingBothRegistry = new AgentPresetRegistry(
    {
      default: 'standard',
      selectedDefault: { get: () => 'anchored-standard' },
    },
    missingBothDefinitions,
  );
  assert.equal(
    missingBothRegistry.defaultId,
    'standard',
    'must not pick definitions.keys().next().value based on plugin registration order',
  );
  await assert.rejects(
    () => missingBothRegistry.resolve(undefined),
    (err: any) => err?.code === 'agent-preset/not-found' && /standard/.test(err?.message ?? ''),
  );
});

test('Issue #439: resumeObserved and fork fall back on unknown legacy presets across 0.2.1 and 0.2.2 while preserving explicit createSession errors', async () => {
  const patchedRegistry = patchLegacyAgentPresetRegistrySource(REGISTRY_FIXTURE)!;
  const { AgentPresetRegistry } = evalCjsModule(patchedRegistry);

  for (const variant of ['021', '022'] as const) {
    const rawController = buildControllerFixture(variant);
    const patchedController = patchLegacySessionPresetResumeSource(rawController);
    assert.ok(patchedController, `${variant} controller anchors must match`);
    assert.match(patchedController, new RegExp(LEGACY_PRESET_RESUME_MARKER));
    assert.equal(patchLegacySessionPresetResumeSource(patchedController), patchedController, 'controller patch must be idempotent');

    // 部分锚点缺失时必须原子放弃，绝不半改
    assert.equal(
      patchLegacySessionPresetResumeSource(rawController.replace('this.agents.presetForObservation(source)', 'changed()')),
      undefined,
    );

    const { ApiSessionAgentController, SessionCommands } = evalCjsModule(patchedController);
    const warnings: string[] = [];
    const definitions = new Map<string, { broken?: string }>([
      ['standard', {}],
      ['minimal', {}],
      ['broken-preset', { broken: 'missing plugin dependency' }],
    ]);
    const registry = new AgentPresetRegistry(
      {
        default: 'standard',
        selectedDefault: { get: () => 'anchored-standard' },
      },
      definitions,
    );
    // 真实 Cordis 4.x 内核中 this.ctx.logger 为对象（非函数），必须验证对象形态不抛 TypeError
    const ctx = {
      get: (service: string) => (service === 'agentPresets' ? registry : undefined),
      logger: { warn: (msg: string) => warnings.push(msg) },
    };
    const controller = new ApiSessionAgentController(ctx);
    const commands = new SessionCommands(controller);

    // 1) 历史会话记录了 anchored-standard 或任意其他旧预设名 → 安全回退至 standard
    const resumedAnchored = await controller.resumeObserved('session-old-1', { agentPreset: 'anchored-standard' });
    assert.deepEqual(resumedAnchored, {
      sessionId: 'session-old-1',
      agentPreset: 'standard',
      mounted: 'standard',
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /anchored-standard/);

    const resumedCustom = await controller.resumeObserved('session-old-2', { agentPreset: 'router-custom-v5' });
    assert.equal(resumedCustom.mounted, 'standard');

    // 2) Fork 历史旧会话 → 同样安全回退至 standard
    const forkedPreset = await commands.fork({ header: { id: 'session-old-1' }, agentPreset: 'anchored-standard' });
    assert.equal(forkedPreset, 'standard');

    // 3) 新建会话：未显式传 agentPreset 时走自愈后的 defaultId（standard）；显式传入不存在预设则保留报错契约
    const createdDefault = await controller.createSession({});
    assert.deepEqual(createdDefault, { agentPreset: 'standard', mounted: 'standard' });
    await assert.rejects(
      () => controller.createSession({ agentPreset: 'anchored-standard' }),
      (err: any) => err?.code === 'agent-preset/not-found',
    );

    // 4) 已注册但内部激活损坏（agent-preset/invalid）或非 RemoteError 网络异常 → 不得被误判为未知旧预设吞掉
    await assert.rejects(
      () => controller.resumeObserved('session-broken', { agentPreset: 'broken-preset' }),
      (err: any) => err?.code === 'agent-preset/invalid',
    );
    const origResolve = registry.resolve.bind(registry);
    registry.resolve = async () => {
      throw new Error('transient network failure');
    };
    await assert.rejects(
      () => controller.resumeObserved('session-net-err', { agentPreset: 'anchored-standard' }),
      /transient network failure/,
    );
    registry.resolve = origResolve;
  }
});

test('Issue #439: applyLegacyAgentPresetCompatToNodeModules and assertLegacyAgentPresetCompatApplied enforce both markers', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eac-439-test-'));
  try {
    const regDir = path.join(tmp, '@deepseek-ai', 'dsh-agent-preset-registry', 'lib');
    const ctrlDir = path.join(tmp, '@deepseek-ai', 'dsh-api-session-controller', 'lib');
    fs.mkdirSync(regDir, { recursive: true });
    fs.mkdirSync(ctrlDir, { recursive: true });
    const regFile = path.join(regDir, 'index.js');
    const ctrlFile = path.join(ctrlDir, 'index.js');
    fs.writeFileSync(regFile, REGISTRY_FIXTURE, 'utf8');
    fs.writeFileSync(ctrlFile, buildControllerFixture('021'), 'utf8');

    const logs: string[] = [];
    assert.equal(applyLegacyAgentPresetCompatToNodeModules(tmp, (m) => logs.push(m)), 2);
    assert.equal(logs.length, 2);
    assert.equal(applyLegacyAgentPresetCompatToNodeModules(tmp), 0, 'second run must be a no-op');
    assert.doesNotThrow(() => assertLegacyAgentPresetCompatApplied(tmp));

    // 只命中一处 marker（半生效状态）必须被构建期断言拒绝
    const patchedReg = fs.readFileSync(regFile, 'utf8');
    const patchedCtrl = fs.readFileSync(ctrlFile, 'utf8');

    fs.writeFileSync(regFile, REGISTRY_FIXTURE, 'utf8');
    assert.throws(
      () => assertLegacyAgentPresetCompatApplied(tmp),
      new RegExp(LEGACY_PRESET_DEFAULT_MARKER),
    );
    fs.writeFileSync(regFile, patchedReg, 'utf8');

    fs.writeFileSync(ctrlFile, buildControllerFixture('021'), 'utf8');
    assert.throws(
      () => assertLegacyAgentPresetCompatApplied(tmp),
      new RegExp(LEGACY_PRESET_RESUME_MARKER),
    );
    fs.writeFileSync(ctrlFile, patchedCtrl, 'utf8');
    assert.doesNotThrow(() => assertLegacyAgentPresetCompatApplied(tmp));

    const companionSrc = fs.readFileSync(path.join(desktopRoot, 'lib', 'desktop', 'companion-sync.ts'), 'utf8');
    assert.match(companionSrc, /applyLegacyAgentPresetCompatFix\(\)/);
    assert.match(companionSrc, /usesDeclarativePresetRegistry/);

    const stageSrc = fs.readFileSync(path.join(desktopRoot, '..', 'tauri-shell', 'stage-resources.mjs'), 'utf8');
    assert.match(stageSrc, /assertLegacyAgentPresetCompatApplied/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
