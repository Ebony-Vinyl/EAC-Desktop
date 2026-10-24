import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 内核服务面漂移门禁。M0 把内核钉版升到 0.1.7-rc.2 时，上游移除了
// `settingsScope` cordis 服务（0.1.3 由 ui-settings 域提供，rc2 换成
// `settingsSchema`/`configForms`），而 Task 3.3 接回的 dsh-compact /
// dsh-easy-setup 仍 inject 它 —— 两入口永不激活，web boot 直接给出
// "entries did not activate" 失败屏（此前冒烟只断言服务端 200，从未在
// 真实浏览器渲染过，故未暴露）。本测试保证：随包插件 inject 的每个服务都必须
// 仍由当前内核（node_modules @deepseek-ai/*）或 EAC 自有插件提供；内核再升级
// 时先跑本门禁，防同类静默失活。
//
// M3/#416 修复（本文件）：门禁必须**按半分离**判定 —— client 半（浏览器
// bundle）与 host 半（Node 侧入口）各自只认本半的服务面：
//   · 旧实现把 `super(ctx, "x")`、client runner 的服务目录、插件 SERVICE_NAME
//     混成一个并集，于是 host 面服务（settings / tools / webServer /
//     sessionProjections 等仅 host 半有的服务）会给 client inject 兜底 ——
//     客户端入口实际永不激活，门禁却全绿（漏报）；
//   · 旧实现只扫 lib/client.js，host 半的静态 inject（dsh-compact/index.js 的
//     `inject = ['settings']` 与 `ctx.inject?.(['webServer', …])`、loader/皮肤
//     host 的 `ctx.inject(["settings"])`）完全不在扫描面；
//   · 插件自有的 client 注入常量（loader 的 `CLIENT_INJECT = […]`）也没被采集。
// `remote` / `remote.*` 是宿主注入契约（内核 host 半的 RPC 代理面），不在两半
// Service 表内，保留为显式白名单（见 isContractInject）。

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts: string[]): string => readFileSync(join(root, ...parts), 'utf8');

test('default host entrypoints have their runtime peer packages in the install closure', async () => {
  // legacy-peer-deps intentionally skips peer installation; these real imports
  // catch missing peers that otherwise leave standard sessions waiting for PTC.
  for (const name of [
    'dsh-ptc-runtime-node',
    'dsh-deepseek-account-platform',
    'dsh-llm-deepseek-api-key',
    'dsh-llm-deepseek-account',
    'dsh-api-account-controller',
  ]) {
    await assert.doesNotReject(import(`@deepseek-ai/${name}`), `${name} must import with the shipped dependencies`);
  }
});

type Half = 'client' | 'host';
interface Surfaces { client: Set<string>; host: Set<string> }
interface InjectEntry { owner: string; rel: string; half: Half; injects: string[] }

// ---------------------------------------------------------------------------
// 采集规则（单一事实源：本文件即门禁）
// ---------------------------------------------------------------------------

/** cordis 服务名：小写起头的标识符，可带 `.` 分段（`remote.pluginInventory`）。 */
const SERVICE_SUPER_RE = /super\(\s*[A-Za-z_$][\w$]*\s*,\s*["']([a-z][\w]*(?:\.[\w]+)*)["']\s*\)/g;
const SERVICE_PROVIDE_RE = /(?:reflect\.)?provide\(\s*["']([a-z][\w]*(?:\.[\w]+)*)["']/g;
/** client runner 的 client 服务目录（生成数据：key/summary 对）。 */
const SERVICE_CATALOG_RE = /key:\s*["']([a-z][\w]*(?:\.[\w]+)*)["'],\s*\n\s*summary:/g;
/** 插件自有服务名常量（loader 的 `SERVICE_NAME = "uiSkinLoader"`）。 */
const SERVICE_NAME_CONST_RE = /SERVICE_NAME\s*=\s*["']([A-Za-z][\w.]*)["']/g;

/** 静态 inject 清单的三种形态：
 *  · `inject: […]` / `export const inject = […]` / `static inject = […]`；
 *  · `CLIENT_INJECT = […]` 等 SCREAMING_SNAKE 常量（loader 客户端）；
 *  · `ctx.inject([…], cb)` / `ctx.inject?.([…], cb)`（loader / 皮肤 host 半）。 */
const INJECT_LIST_RES: RegExp[] = [
  /\binject\s*[:=]\s*\[([^\]]*)\]/g,
  /\b[A-Z][A-Z0-9_]*INJECT\s*[:=]\s*\[([^\]]*)\]/g,
  /\.inject(?:\?\.)?\(\s*\[([^\]]*)\]/g,
];

/** `remote` / `remote.*` 宿主注入契约（显式白名单；`remotely` 之类不放过）。 */
const REMOTE_INJECT_RE = /^remote(?:\.[A-Za-z][\w]*)+$/;
function isContractInject(name: string): boolean {
  return name === 'remote' || REMOTE_INJECT_RE.test(name);
}

/** 0.2.1 的浏览器条件入口为 client.browser.js；Node client 入口不参与两半扫描。 */
const halfOf = (rel: string): Half => (/client(?:\.browser)?\.js$/.test(rel) ? 'client' : 'host');

function matches(text: string, re: RegExp): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(re)) if (m[1]) out.push(m[1]);
  return out;
}

function injectNamesOf(text: string): string[] {
  const out: string[] = [];
  for (const re of INJECT_LIST_RES) {
    for (const m of text.matchAll(re)) {
      for (const name of (m[1] || '').matchAll(/["']([^"']+)["']/g)) if (name[1]) out.push(name[1]);
    }
  }
  return out;
}

/** 消费方 inject 必须由**同一半**的服务面提供；remote.* 走契约白名单。 */
function unmetInjects(entry: InjectEntry, kernel: Surfaces, bundled: Surfaces): string[] {
  return entry.injects
    .filter((name) => !isContractInject(name))
    .filter((name) => !kernel[entry.half].has(name) && !bundled[entry.half].has(name))
    .map((name) => `${entry.owner} ${entry.rel} [${entry.half}] inject "${name}" 无 ${entry.half} 半提供方`);
}

// ---------------------------------------------------------------------------
// 内核服务面（node_modules/@deepseek-ai）
// ---------------------------------------------------------------------------

function collectKernelSurfaces(): Surfaces {
  const out: Surfaces = { client: new Set(['timer']), host: new Set(['timer']) };
  const base = join(root, 'dsh-desktop', 'node_modules', '@deepseek-ai');
  for (const pkg of readdirSync(base)) {
    const libDir = join(base, pkg, 'lib');
    if (!existsSync(libDir)) continue;
    for (const file of readdirSync(libDir)) {
      if (!file.endsWith('.js')) continue;
      if (/client\.node\.js$/.test(file)) continue;
      const rel = `${pkg}/lib/${file}`;
      const half = halfOf(rel);
      const text = readFileSync(join(libDir, file), 'utf8');
      // cordis Service 子类在构造器里声明服务名：super(<ctx>, "name")。宿主包的
      // 变量名不一定叫 ctx（dsh-settings 是 `super(ownerContext, "settings")`），
      // 所以不锁变量名，只锁「小写起头的服务名」以免收进 pdf 引擎的异常类名。
      for (const name of matches(text, SERVICE_SUPER_RE)) out[half].add(name);
      for (const name of matches(text, SERVICE_PROVIDE_RE)) out[half].add(name);
      // client runner 的 client 服务目录（key/summary 对）住在浏览器 bundle 里，
      // 只算 client 半 —— host 面不得由它背书。
      if (pkg === 'dsh-cordis-client-runner' && half === 'client') {
        for (const name of matches(text, SERVICE_CATALOG_RE)) out[half].add(name);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 随包插件服务面（assets/plugins）
// ---------------------------------------------------------------------------

function bundledPluginFiles(): { owner: string; rel: string; path: string }[] {
  const out: { owner: string; rel: string; path: string }[] = [];
  const pluginsDir = join(root, 'dsh-desktop', 'assets', 'plugins');
  for (const owner of readdirSync(pluginsDir)) {
    // 已发布入口：<dir>/lib/*.js（client.js = client 半，index.js/host.js = host 半）
    // 与 <dir>/*.js（dsh-eac-core-bridge 的宿主入口在包根）。src/ 是开发副本，
    // 不参与发布装载，不收进扫描面以免把未发布的代码当成契约。
    for (const sub of ['lib', '']) {
      const dir = join(pluginsDir, owner, sub);
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.js')) continue;
        out.push({ owner, rel: sub ? `${sub}/${file}` : file, path: join(dir, file) });
      }
    }
  }
  return out;
}

function collectBundledPluginSurfaces(files = bundledPluginFiles()): { surfaces: Surfaces; entries: InjectEntry[] } {
  const surfaces: Surfaces = { client: new Set(), host: new Set() };
  const entries: InjectEntry[] = [];
  for (const f of files) {
    const text = readFileSync(f.path, 'utf8');
    const half = halfOf(f.rel);
    for (const name of matches(text, SERVICE_NAME_CONST_RE)) surfaces[half].add(name);
    for (const name of matches(text, SERVICE_PROVIDE_RE)) surfaces[half].add(name);
    entries.push({ owner: f.owner, rel: f.rel, half, injects: injectNamesOf(text) });
  }
  return { surfaces, entries };
}

const kernel = collectKernelSurfaces();
const bundled = collectBundledPluginSurfaces();
const pluginSurfaces = bundled.surfaces;
const pluginEntries = bundled.entries;

// ---------------------------------------------------------------------------
// 1. 服务面本身
// ---------------------------------------------------------------------------

test('内核服务面覆盖 rc2 已知面，且 client/host 两半分离（settingsScope 已不在）', () => {
  // client 半（浏览器 bundle）：随包插件的 client inject 只能靠这些名字。
  for (const name of ['slots', 'locale', 'theme', 'configForms', 'settingsSchema', 'sessions', 'workspaces', 'remote']) {
    assert.ok(kernel.client.has(name), `client 半应提供服务 ${name}`);
  }
  // host 半（Node 入口）：host 侧 inject（settings / typert / webServer …）靠这些名字。
  for (const name of ['settings', 'tools', 'webServer', 'sessionProjections', 'typert']) {
    assert.ok(kernel.host.has(name), `host 半应提供服务 ${name}`);
  }
  // 两半不得互相兜底：以下名字由 host 半提供（随包插件里正靠它们做 host inject），
  // client 半若也认，host 面就能替 client inject 背书 —— 那正是旧门禁的漏报来源。
  for (const name of ['settings', 'tools', 'webServer', 'sessionProjections']) {
    assert.ok(!kernel.client.has(name), `host 半独有的 ${name} 不得出现在 client 面`);
  }
  // 反向：client 独有的服务不得被 host 面认下。
  for (const name of ['slots', 'configForms', 'uiRenderer']) {
    assert.ok(!kernel.host.has(name), `client 半独有的 ${name} 不得出现在 host 面`);
  }
  assert.ok(!kernel.host.has('remote'), 'Node client 条件入口不得被当成 host 服务提供方');
  for (const half of ['client', 'host'] as const) {
    assert.ok(!kernel[half].has('settingsScope'), `0.1.7-rc.2 已移除 settingsScope，${half} 面不得再收录`);
  }
});

test('门禁半分离：host 面服务不得为 client inject 兜底（旧并集判定会漏报）', () => {
  // 旧判定 = client/host 并集：host 独有服务在里面，于是 client inject 被静默放行。
  const legacyUnion = new Set([...kernel.client, ...kernel.host, ...pluginSurfaces.client, ...pluginSurfaces.host]);
  for (const name of ['webServer', 'settings']) {
    assert.ok(legacyUnion.has(name), `夹具前提：${name} 在旧并集面里（这就是漏报通道）`);
    assert.ok(!kernel.client.has(name), `夹具前提：${name} 只有 host 半提供`);
  }
  // 合成夹具：client 入口 inject 了 host 独有的服务 —— 新判定必须报出来。
  const probe: InjectEntry = {
    owner: '<fixture>',
    rel: 'lib/client.js',
    half: 'client',
    injects: ['slots', 'webServer', 'settings', 'remote', 'remote.pluginInventory'],
  };
  assert.deepEqual(unmetInjects(probe, kernel, pluginSurfaces), [
    '<fixture> lib/client.js [client] inject "webServer" 无 client 半提供方',
    '<fixture> lib/client.js [client] inject "settings" 无 client 半提供方',
  ], 'slots（client 面）与 remote/remote.*（显式契约）放行，host 独有服务必须报出来');
  // 反向夹具：host 入口 inject 了 client 独有服务同样必须报出来。
  const hostProbe: InjectEntry = { owner: '<fixture>', rel: 'lib/index.js', half: 'host', injects: ['configForms'] };
  assert.deepEqual(unmetInjects(hostProbe, kernel, pluginSurfaces), [
    '<fixture> lib/index.js [host] inject "configForms" 无 host 半提供方',
  ]);
});

test('host 半静态 inject 进入扫描面（dsh-compact/index.js）', () => {
  const byRel = new Map(pluginEntries.map((e) => [`${e.owner}/${e.rel}`, e]));
  const compact = byRel.get('dsh-compact/lib/index.js');
  assert.ok(compact, 'dsh-compact 的 host 半（lib/index.js）必须在扫描面');
  assert.equal(compact.half, 'host');
  for (const name of ['settings', 'webServer', 'agents', 'agentPresets']) {
    assert.ok(compact.injects.includes(name), `host 半 inject 必须采到 ${name}（inject=[…] 与 ctx.inject?.(…) 两种形态）`);
  }
});

// ---------------------------------------------------------------------------
// 2. 随包插件 inject（真实树）
// ---------------------------------------------------------------------------

test('随包插件 inject 只消费本半（client/host）的服务面', () => {
  assert.ok(pluginEntries.length >= 20, `随包插件入口扫描面不得为空（实际 ${pluginEntries.length}）`);
  assert.ok(pluginEntries.some((e) => e.half === 'client' && e.injects.length > 0), 'client 半必须有被扫描到的 inject');
  const hostWithInject = pluginEntries.filter((e) => e.half === 'host' && e.injects.length > 0);
  assert.ok(hostWithInject.length > 0, 'host 半必须有被扫描到的 inject（否则 host 门禁形同虚设）');
  const failures = pluginEntries.flatMap((e) => unmetInjects(e, kernel, pluginSurfaces));
  assert.deepEqual(failures, []);
});

test('回归钉死：dsh-compact / dsh-easy-setup 不再引用已移除的 settingsScope', () => {
  for (const dir of ['dsh-compact', 'dsh-easy-setup']) {
    const text = read('dsh-desktop', 'assets', 'plugins', dir, 'lib', 'client.js');
    assert.doesNotMatch(text, /ctx\.settingsScope/, `${dir} 不得再调用 ctx.settingsScope`);
    assert.doesNotMatch(text, /["']settingsScope["']/, `${dir} 的 inject 清单不得再含 settingsScope`);
  }
});

test('dsh-compact 经 configForms 读写设置（与 rc2 ConfigFormController 同构面）', () => {
  const text = read('dsh-desktop', 'assets', 'plugins', 'dsh-compact', 'lib', 'client.js');
  assert.match(text, /ctx\.configForms\.get\(NS\)/);
  assert.match(text, /inject:\s*\['slots',\s*'configForms'\]/);
});
