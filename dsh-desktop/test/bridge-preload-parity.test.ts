// bridge.ts（Tauri WebView2 桥）单侧表面契约。
//
// 背景：双壳时代 preload.js ↔ bridge.ts 键集一致性由本测试锁定（Bug #58 防
// 事故）；Electron 冻结壳已退役（批次 C），preload.ts 删除后窗口桥只剩
// bridge.ts——配套插件（dsh-better-sidebar 等）在此拿 window.dshDesktop。
// 本测试保留「防解析器写歪致空树假绿」的锚点断言，并把 dshDesktop 顶层表面
// 锁成必需清单，防止未来无意删掉配套插件依赖的方法。
//
// 允许的桥侧额外键：_call/_send/_onNotify/_onReady（桥内省，非 dshDesktop 面）。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bridge = readFileSync(join(root, '..', 'tauri-shell', 'sidecar', 'bridge.ts'), 'utf8');

// 从「赋值起点」做花括号配对，收集相对深度 1（顶层键）与 2（命名空间内键）。
// 跳过字符串/模板串/注释，避免内容里的冒号干扰。
function extractKeyTree(src, marker) {
  const start = src.indexOf(marker);
  assert.ok(start >= 0, `marker not found: ${marker}`);
  const braceStart = src.indexOf('{', start);
  assert.ok(braceStart > start, 'object literal not found after marker');
  let depth = 0;
  let paren = 0; // 括号深度：参数表里的 TS 类型注解（changes: unknown）不是键
  let i = braceStart;
  let quote = null; // 当前所处的字符串引号（' " `）
  let lastTop = null;
  const tree = {};
  const identRe = /[A-Za-z_$][\w$]*/y;
  while (i < src.length) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i += 2; continue; }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; i += 1; continue; }
    if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      i = nl < 0 ? src.length : nl + 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    if (c === '{') { depth += 1; i += 1; continue; }
    if (c === '}') {
      depth -= 1;
      if (depth === 0) break; // 对象结束
      i += 1;
      continue;
    }
    if (c === '(') { paren += 1; i += 1; continue; }
    if (c === ')') { paren -= 1; i += 1; continue; }
    // 键位置：标识符 + 可选空白 + ':'（跳过 "?." 与 "::" 等非键形态）。
    if (/[A-Za-z_$]/.test(c)) {
      identRe.lastIndex = i;
      const m = identRe.exec(src);
      if (m) {
        let j = m[0].length + i;
        while (j < src.length && /\s/.test(src[j])) j += 1;
        if (src[j] === ':' && src[j + 1] !== ':' && paren === 0) {
          const name = m[0];
          if (depth === 1) {
            tree[name] = [];
            lastTop = name;
          } else if (depth === 2 && lastTop) {
            tree[lastTop].push(name);
          }
        }
        i += m[0].length;
        continue;
      }
    }
    i += 1;
  }
  assert.ok(depth === 0, `unbalanced braces after ${marker}`);
  return tree;
}

const bridgeTree = extractKeyTree(bridge, '(window as any).dshDesktop =');

// v6 Task 3.3：原测试的必需键集是 v5 全量（21 键）。随 Task 3.1 接口收敛
//（ADR 0006 v5）与 Task 3.3 分阶段接回，键集变化；断言拆成两组：
//   A. 恒在组 —— 官方契约 + 壳最小控制面，任何阶段都不得缺失；
//   B. 已接回组 —— 随插件接回恢复的 EAC 面，锁定「接回的不得回退」；
// 未接回的能力（menu / floatWindow / pluginWizard / balance* / recovery 等）
// 显式列为「不得出现」，防止以接回为名把 v6 收敛成果整体回退。
// SYNC-007（2026-10-01，控制包 EAC-ISOLATION-SYNC-02）：官方真实契约是
// DshDesktopProductApi（ipc.ts:71-81）= protocolVersion/browser/keyboard/
// shortcuts/updates.{status,open,subscribe}——官方没有 locale()/plugins.*/
// updates.{check,install}/getPathForFile（全包 grep 零消费者），这四个
// 无主面已从桥上删除（locale→__DSH_LOCALE__、getPathForFile→
// __DSH_HOST_PATHS__.pathFor 取代），并入「不得出现」组锁定不得回归。
const ALWAYS_PRESENT = ['protocolVersion', 'updates', 'windowControls', 'boot',
  // SYNC-001：官方 DesktopKeyboardApi —— dsh-client-shortcuts 检测到
  // data-platform 即硬依赖 keyboard（client.js:1854-1855），缺一即 throw。
  'keyboard',
  // KERN-004：0.2.0 新增官方契约键 DshDesktopProductApi.deviceInfo
  // （ipc.ts:81），官方消费者 ui-settings-account client.js:4357 contactUs
  // 读取（缺失回退 navigator.userAgent）—— 账号页反馈问卷依赖。
  'deviceInfo'];
const RESTORED_BY_TASK_3_3 = ['pluginManager', 'guard', 'fileDrop',
  'getInfo', 'revertFiles', 'openPath', 'openExternal',
  // P1（ADR 0004 运维闭环）：安装环境诊断/移除面，锁住不得回退。
  'environment'];
// 依据 metaone01 2026-09-19 的裁决（按 ADR 0006）：
//  - balance 不作内置，转为推荐插件（Task 4 范围）；其 balance* RPC 面不接回；
//  - plugin-wizard 因后续会与其它插件管理功能冲突，明确不接入。
// 因此下面这些键为**终态契约**（不再是"待裁决"状态），不得回归。
// SYNC-007 追加：locale/plugins 为 v5 误认的「官方契约」，实为无主面，已删。
const STILL_RETIRED = ['menu', 'floatWindow', 'phoneBridge', 'pluginUpdates', 'imagePaste',
  'balancePrices', 'balanceModels', 'refreshBalance', 'restartService', 'copyText',
  'pluginWizard', 'recovery', 'rescue',
  // SYNC-007：官方无此二面（真实契约见 ALWAYS_PRESENT 注释），零消费者已删。
  'locale', 'plugins'];

test('bridge dshDesktop exposes the required namespaces（preload 退役后的单侧契约）', () => {
  // 基线锚点：防止解析器写歪导致解析出空树「假绿」。
  const tops = Object.keys(bridgeTree).filter((k) => !k.startsWith('_'));
  assert.ok(tops.length >= 10, `bridge tree parsed too few keys: ${tops.join(',')}`);
  for (const need of ALWAYS_PRESENT) {
    assert.ok(tops.includes(need), `bridge missing（恒在） ${need}`);
  }
  for (const need of RESTORED_BY_TASK_3_3) {
    assert.ok(tops.includes(need), `bridge missing（Task 3.3 已接回） ${need}`);
  }
  for (const dead of STILL_RETIRED) {
    assert.ok(!tops.includes(dead), `bridge 不得回退已收敛能力: ${dead}`);
  }
  assert.ok(bridgeTree.windowControls.length >= 5, 'windowControls subkeys parsed');
});

test('SYNC-007: masterless faces must not regress（官方无此面的键一律不得回桥）', async () => {
  // SYNC-007（2026-10-01，控制包 EAC-ISOLATION-SYNC-02）删除的四个无主面：
  // 官方 DshDesktopProductApi（内核 apps/desktop/src/ipc.ts:71-81）没有
  // locale()/plugins.*/updates.{check,install}/getPathForFile，0.1.7 与
  // 0.2.0 全包 grep 零消费者（v5 曾把前三者误当官方契约，ADR 0006 已勘误）。
  // 职责去向：locale → __DSH_LOCALE__（SYNC-002）；getPathForFile →
  // __DSH_HOST_PATHS__.pathFor（SYNC-003）；插件管理 → EAC 自有
  // pluginManager.*（Task 3.3 接回）；updates 只留官方 status/open/subscribe。
  // 静态键集：顶层与 updates 命名空间均不得再出现（连同上测 STILL_RETIRED）。
  assert.ok(!('locale' in bridgeTree), 'locale must stay removed（SYNC-007）');
  assert.ok(!('plugins' in bridgeTree), 'plugins must stay removed（SYNC-007）');
  assert.ok(!bridgeTree.updates.includes('check'), 'updates.check must stay removed（SYNC-007）');
  assert.ok(!bridgeTree.updates.includes('install'), 'updates.install must stay removed（SYNC-007）');

  // 运行时键面：等价 WebView2 注入序列，桥跑完后逐键验证不存在。
  const window: any = {
    addEventListener() {},
    __DSH_WS_RPC__: () => ({ onNotify() {}, send() {}, call: async () => ({}) }),
  };
  runInNewContext(stripTypeScriptTypes(bridge), {
    window,
    document: { readyState: 'loading', documentElement: { setAttribute() {} }, addEventListener() {} },
    navigator: { platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    setInterval() {},
    setTimeout() {},
  });
  const dsh = window.dshDesktop;
  assert.equal(dsh.locale, undefined,
    'dshDesktop.locale must stay removed（SYNC-007：语言面由 __DSH_LOCALE__ 承担）');
  assert.equal(dsh.plugins, undefined,
    'dshDesktop.plugins must stay removed（SYNC-007：插件管理由 EAC 自有 pluginManager.* 承担）');
  assert.equal(dsh.updates.check, undefined,
    'dshDesktop.updates.check must stay removed（SYNC-007：官方只有 status/open/subscribe）');
  assert.equal(dsh.updates.install, undefined,
    'dshDesktop.updates.install must stay removed（SYNC-007：同上）');
  assert.equal(dsh.getPathForFile, undefined,
    'dshDesktop.getPathForFile must stay removed（SYNC-007：路径面由 __DSH_HOST_PATHS__.pathFor 承担）');

  // 删除不造成能力真空：官方替代面必须同批在场且可用。
  assert.equal(typeof window.__DSH_LOCALE__?.read, 'function',
    '__DSH_LOCALE__.read must remain (replaces locale())');
  assert.equal(typeof window.__DSH_HOST_PATHS__?.pathFor, 'function',
    '__DSH_HOST_PATHS__.pathFor must remain (replaces getPathForFile)');
  // updates 面恰为官方三方法，open 接回受控壳页。
  assert.deepEqual(Object.keys(dsh.updates).sort(), ['open', 'status', 'subscribe']);
  assert.equal(await dsh.updates.open(), undefined);
});

test('KERN-004: deviceInfo returns the official 0.2.0 machine-description form', async () => {
  // 官方契约：DshDesktopProductApi.deviceInfo（0.2.0 ipc.ts:81）—— 反馈问卷的
  // 本地机器描述，`name=value` 字段以 '; ' 连接，且「no hostname, user name,
  // or serial number」（ipc.ts JSDoc）。官方消费者 ui-settings-account
  // client.js:4357 contactUs 调用一次拼 prefill_device_info，缺失回退
  // navigator.userAgent，reject 回退空串。官方主进程实现见 0.2.0
  // apps/desktop/src/device-info.ts（platform 无条件在首，来源不可用整段省略）。
  const run = (navigatorObj: Record<string, unknown>) => {
    const window: any = {
      addEventListener() {},
      __DSH_WS_RPC__: () => ({ onNotify() {}, send() {}, call: async () => ({}) }),
    };
    runInNewContext(stripTypeScriptTypes(bridge), {
      window,
      document: { readyState: 'loading', documentElement: { setAttribute() {} }, addEventListener() {} },
      navigator: navigatorObj,
      setInterval() {},
      setTimeout() {},
    });
    return window.dshDesktop;
  };

  // 1) 形态：Windows WebView2 UA → platform=os=app_arch 三字段，'; ' 连接，
  //    值域与官方 process.platform/process.arch 一致（win32/x64）。
  const win = run({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0' });
  assert.equal(typeof win.deviceInfo, 'function', 'dshDesktop.deviceInfo must be exposed（ipc.ts:81）');
  assert.equal(await win.deviceInfo(), 'platform=win32; os=10.0; app_arch=x64');

  // 2) UA-CH 优先：Windows-on-Arm 的 UA 兼容层仍标 Win64; x64，UA-CH 才是
  //    真实架构（x86+64 → x64 / arm+64 → arm64，官方 process.arch 值域）。
  //    注：hints 断言在 mock 外做 —— mock 内抛错会走桥的 reject 降级路径，
  //    把断言失败伪装成降级成功。
  let requestedHints: unknown = null;
  const uach = run({
    platform: 'Win32',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    userAgentData: { getHighEntropyValues: async (hints: unknown) => {
      requestedHints = hints;
      return { architecture: 'arm', bitness: '64' };
    } },
  });
  assert.equal(await uach.deviceInfo(), 'platform=win32; os=10.0; app_arch=arm64');
  // vm realm 数组原型与宿主不同 —— 先 JSON 归一再比（同 keyboard 测试先例）。
  assert.deepEqual(JSON.parse(JSON.stringify(requestedHints)), ['architecture', 'bitness'],
    'UA-CH must request exactly architecture+bitness');

  // 3) 降级：UA 不可观测的字段整段省略（官方 collect 语义），platform 恒在
  //    （官方 device-info.ts:11 无条件首字段），绝不 reject。
  const bare = run({ platform: 'Win32' });
  assert.equal(await bare.deviceInfo(), 'platform=win32');

  // 4) 隐私契约：任何路径都不得返回 hostname/用户名/序列号形态的持久标识
  //    （ipc.ts JSDoc「no hostname, user name, or serial number」；本实现
  //    纯由 UA/UA-CH 组装，无持久化来源）。
  for (const dsh of [win, uach, bare]) {
    const info = await dsh.deviceInfo();
    assert.ok(!/hostname|user(name)?=|serial|uuid|[0-9a-f]{8}-[0-9a-f]{4}/i.test(info),
      `deviceInfo must not carry persistent identifiers: ${info}`);
    assert.match(info, /^platform=(win32|darwin|linux)/, 'platform must lead the description');
  }
});

test('bridge keeps the introspection escape hatch for shell pages', () => {
  for (const k of ['_call', '_onReady']) {
    assert.ok(k in bridgeTree, `bridge introspection key missing: ${k}`);
  }
});

test('SYNC-001: data-platform marked and keyboard namespace locked to the official contract', () => {
  // 强耦合实测（dsh-client-shortcuts/lib/client.js）：
  //   :721-724  <html data-platform> 存在即 runtime='desktop'（否则 'web'）；
  //   :1854-1855  desktop 态 keyboard===undefined → throw "Desktop keyboard
  //   bridge unavailable"。两者必须同批在桥上就位，缺一官方 shortcuts 硬崩。
  assert.match(bridge, /setAttribute\(['"]data-platform['"]/,
    'bridge must mark <html data-platform>（官方 markDocumentPlatform 同语义）');
  // 官方 DesktopKeyboardApi（native.d.ts）只暴露 subscribe / closeWindow ——
  // 键集精确锁定，防止实现漂移出非契约面。
  assert.deepEqual([...bridgeTree.keyboard].sort(), ['closeWindow', 'subscribe'],
    `keyboard namespace drift: ${bridgeTree.keyboard.join(',')}`);
});

test('SYNC-001: keyboard bridge works on the official shortcuts probe path', async () => {
  // 等价 WebView2 注入序列：桥在 document-start 跑，页面上下文只提供最小 DOM。
  const attrs: Record<string, string> = {};
  const windowKeydowns: Array<(e: unknown) => void> = [];
  const calls: Array<{ method: string; params: any }> = [];
  const window: any = {
    addEventListener(type: string, fn: (e: unknown) => void) { if (type === 'keydown') windowKeydowns.push(fn); },
    removeEventListener(type: string, fn: (e: unknown) => void) {
      const i = windowKeydowns.indexOf(fn);
      if (i >= 0) windowKeydowns.splice(i, 1);
    },
    __DSH_WS_RPC__: () => ({
      onNotify() {},
      send() {},
      call: (method: string, params: any) => { calls.push({ method, params }); return Promise.resolve({ ok: true }); },
    }),
  };
  const document: any = {
    readyState: 'loading',
    documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v; } },
    addEventListener() {},
  };
  runInNewContext(stripTypeScriptTypes(bridge), {
    window,
    document,
    navigator: { platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    setInterval() {},
    setTimeout() {},
  });

  // data-platform：document-start 即标记，值域 'windows'（client.js detectEnvironment
  // 以 /win/i 归一化 → platform='windows'，与官方 shortcuts 期望一致）。
  assert.equal(attrs['data-platform'], 'windows');

  // subscribe：返回 disposer，首订即挂 keydown 捕获（官方 preload-app.ts:19-36
  // 的 ipcRenderer.on 形态）。
  assert.equal(typeof window.dshDesktop.keyboard.subscribe, 'function');
  assert.equal(typeof window.dshDesktop.keyboard.closeWindow, 'function');
  const received: any[] = [];
  const dispose = window.dshDesktop.keyboard.subscribe((input: unknown) => received.push(input));
  assert.equal(typeof dispose, 'function');
  assert.equal(windowKeydowns.length, 1, 'keydown capture must be armed on first subscribe');

  // 主文档按键 → kind='keyboard'（DesktopShortcutInput 官方形态，secondCode
  // 按官方主进程行为仅 chord 命中才出现，单键不含该键）。deepStrictEqual 会
  // 对 vm realm 的对象原型做引用比较 —— 先 JSON 归一到宿主 realm 再比。
  windowKeydowns[0]({ code: 'KeyK', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, repeat: false });
  assert.deepEqual(JSON.parse(JSON.stringify(received[0])), {
    revision: 'eac-shortcut-revision-0',
    kind: 'keyboard',
    frameName: '',
    code: 'KeyK',
    control: true,
    alt: false,
    shift: false,
    meta: false,
    repeat: false,
  });

  // iframe 分支：activeElement 命中官方匹配集（preload-app.ts:21-24）→
  // kind='iframe' + frameName=element.name。
  document.activeElement = {
    isConnected: true,
    matches: (sel: string) => sel === 'iframe[data-sidebar-browser-frame], iframe[data-html-preview]',
    name: 'preview-frame',
  };
  windowKeydowns[0]({ code: 'KeyW', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, repeat: false });
  assert.equal(received[1].kind, 'iframe');
  assert.equal(received[1].frameName, 'preview-frame');

  // webview 分支（preload-app.ts:27-30）：frameName 取 name 属性。
  document.activeElement = {
    isConnected: true,
    matches: (sel: string) => sel === 'webview[data-sidebar-browser-frame]',
    getAttribute: (k: string) => (k === 'name' ? 'browser-lease-1' : null),
  };
  windowKeydowns[0]({ code: 'Escape', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, repeat: true });
  assert.equal(received[2].kind, 'webview');
  assert.equal(received[2].frameName, 'browser-lease-1');
  assert.equal(received[2].repeat, true);

  // disposer：退订后不再投递，最后一个退订卸下捕获。
  dispose();
  assert.equal(windowKeydowns.length, 0, 'keydown capture must be released after last unsubscribe');

  // closeWindow：官方契约 Promise<void>；EAC 无修订校验，revision 透传
  // win.close 帧（L1 记录）。
  await window.dshDesktop.keyboard.closeWindow('rev-1');
  const close = calls.find((c) => c.method === 'win.close');
  assert.ok(close, 'closeWindow must route through win.close');
  assert.equal(close.params.revision, 'rev-1');
});

test('SYNC-002: __DSH_LOCALE__ bridge locked to the official LocaleBridge contract', async () => {
  // 官方 LocaleBridge（client-locale bootstrap.d.ts）只暴露 read/onChange，
  // 经 contextBridge.exposeInMainWorld('__DSH_LOCALE__', ...) 挂在 window 上、
  // 与 window.dshDesktop 同层并列（preload-app.ts:102-105）—— 键集精确锁定，
  // 防止实现漂移出非契约面。
  assert.match(bridge, /\(window as any\)\.__DSH_LOCALE__ = \{/,
    'bridge must expose window.__DSH_LOCALE__（官方 preload-app.ts:102-105 同名同层）');

  const calls: Array<{ method: string; params: any }> = [];
  let bootstrapReply: any = { languages: ['zh-CN'], preference: null };
  const window: any = {
    addEventListener() {},
    __DSH_WS_RPC__: () => ({
      onNotify() {},
      send(method: string, params: any) { calls.push({ method, params }); },
      call(method: string, params: any) {
        calls.push({ method, params });
        return Promise.resolve(bootstrapReply);
      },
    }),
  };
  runInNewContext(stripTypeScriptTypes(bridge), {
    window,
    document: { readyState: 'loading', documentElement: { setAttribute() {} }, addEventListener() {} },
    navigator: { platform: 'Win32', languages: ['en-US', 'en'], language: 'en-US' },
    setInterval() {},
  });

  const localeApi = window.__DSH_LOCALE__;
  assert.deepEqual(Object.keys(localeApi).sort(), ['onChange', 'read'],
    `LocaleBridge key drift: ${Object.keys(localeApi).join(',')}`);
  assert.equal(typeof localeApi.read, 'function');
  assert.equal(typeof localeApi.onChange, 'function');

  // read()：languages = L1 系统标签优先 + navigator.languages 补充（去重），
  // preference 透传。形态必须过 parseLocaleBootstrap（client.js:18-19）：
  // languages 为非空 string[]、preference 为 string|null（键必须存在）。
  const boot = await localeApi.read();
  assert.deepEqual(JSON.parse(JSON.stringify(boot)), {
    languages: ['zh-CN', 'en-US', 'en'],
    preference: null,
  });
  const bootstrapCall = calls.find((c) => c.method === 'locale.bootstrap');
  assert.ok(bootstrapCall, 'read() must route through locale.bootstrap');

  // read() 容错：壳回复缺 languages 字段 → 仍返回合法 LocaleBootstrap（不把
  // 壳侧畸形形态外泄给消费者）；preference 非字符串归一为 null。
  bootstrapReply = { preference: 'zh' };
  const boot2 = await localeApi.read();
  assert.ok(Array.isArray(boot2.languages) && boot2.languages.length >= 1,
    'languages must stay a non-empty string[] even when the shell reply lacks it');
  assert.ok(boot2.languages.every((s: unknown) => typeof s === 'string'));
  assert.equal(boot2.preference, 'zh');
  bootstrapReply = null;
  assert.equal((await localeApi.read()).preference, null);

  // onChange：官方 fire-and-forget（ipcRenderer.send 语义）→ send 帧（无 id、
  // 不等回复），载荷 {locale}。
  localeApi.onChange('zh');
  const changed = calls.find((c) => c.method === 'locale.changed');
  assert.ok(changed, 'onChange must route through locale.changed');
  // vm realm 对象原型与宿主不同，deepStrictEqual 做引用比较 —— 先 JSON 归一
  //（与上方 SYNC-001 测试同款处理）。
  assert.deepEqual(JSON.parse(JSON.stringify(changed.params)), { locale: 'zh' });
});

test('SYNC-003: __DSH_HOST_PATHS__ locked to the official HostPaths contract', async () => {
  // 官方 HostPathsBridge（preload-app.ts:78-83）只暴露 pathFor —— 拖放/粘贴/
  // 选取的有真实路径文件 → 绝对路径（composer 生成 @path 引用，消费者
  // client.js:18290），无真实路径（粘贴字节流）→ ''（上传兜底）。与
  // __DSH_LOCALE__ 同层挂在 window 上，键集精确锁定防实现漂移。
  assert.match(bridge, /\(window as any\)\.__DSH_HOST_PATHS__ = \{/,
    'bridge must expose window.__DSH_HOST_PATHS__（官方 preload-app.ts:78-83 同名同层）');
  // 官方契约声明锚点：pathFor 的语义注释（无路径返 ''）必须随实现存在。
  assert.match(bridge, /win\.host-paths/, 'bridge must consume the L1 staged-path frame');
  assert.match(bridge, /pathFor: function \(file: File\): string/,
    'pathFor must keep the official signature pathFor(file: File) => string');

  let notifyDispatch: (method: string, params: any) => void = () => {};
  const window: any = {
    addEventListener() {},
    __DSH_WS_RPC__: () => ({
      send() {},
      call: async () => ({}),
      onNotify(fn: (method: string, params: any) => void) { notifyDispatch = fn; },
    }),
  };
  runInNewContext(stripTypeScriptTypes(bridge), {
    window,
    document: { readyState: 'loading', documentElement: { setAttribute() {} }, addEventListener() {} },
    navigator: { platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    setInterval() {},
  });

  const hostPaths = window.__DSH_HOST_PATHS__;
  assert.deepEqual(Object.keys(hostPaths), ['pathFor'],
    `HostPaths key drift: ${Object.keys(hostPaths).join(',')}`);
  assert.equal(typeof hostPaths.pathFor, 'function');

  // 尚无 L1 暂存：任何 File 都必须返回 ''（不伪造路径）。
  assert.equal(hostPaths.pathFor({ name: 'notes.txt', size: 5 }), '');

  // L1 win.host-paths 暂存（真实枚举形态：path/name/size/isDir，main.rs
  // DragQueryFileW 产物）→ name+size 精确匹配返回真实绝对路径。
  notifyDispatch('win.host-paths', { files: [
    { path: 'C:\\proj\\notes.txt', name: 'notes.txt', size: 5, isDir: false },
    { path: 'C:\\proj\\assets', name: 'assets', size: 4096, isDir: true },
  ] });
  assert.equal(hostPaths.pathFor({ name: 'notes.txt', size: 5, type: 'text/plain' }),
    'C:\\proj\\notes.txt', 'name+size hit must answer the real absolute path');
  // 目录条目：isDir → 仅按 name 匹配（目录 size 无意义）。
  assert.equal(hostPaths.pathFor({ name: 'assets', size: 0, type: '' }), 'C:\\proj\\assets');

  // 官方语义核心：无真实路径的文件（new File(['x'],'a.txt') 形态，粘贴的
  // 字节流/截图）→ ''，绝不返回伪造路径。
  assert.equal(hostPaths.pathFor({ name: 'a.txt', size: 1 }), '');
  // 同名不同 size（不同文件）：不命中。
  assert.equal(hostPaths.pathFor({ name: 'notes.txt', size: 999 }), '');
  // 非 File 形态入参：一律 ''。
  assert.equal(hostPaths.pathFor(null), '');
  assert.equal(hostPaths.pathFor(undefined), '');
  assert.equal(hostPaths.pathFor({ size: 5 }), '');
  assert.equal(hostPaths.pathFor('C:\\proj\\notes.txt'), '');

  // 剪贴板变化：L1 推空表清场 → 同一 File 不再返回路径（字节流截图上板）。
  notifyDispatch('win.host-paths', { files: [] });
  assert.equal(hostPaths.pathFor({ name: 'notes.txt', size: 5 }), '');

  // 畸形帧不炸桥（后续合法帧照常生效）。
  notifyDispatch('win.host-paths', null);
  notifyDispatch('win.host-paths', {});
  notifyDispatch('win.host-paths', { files: [{ path: '', name: 'x.txt', size: 1 }] });
  notifyDispatch('win.maximized', { maximized: true });
  notifyDispatch('win.host-paths', { files: [
    { path: 'D:\\材料\\报告.md', name: '报告.md', size: 12, isDir: false },
  ] });
  assert.equal(hostPaths.pathFor({ name: '报告.md', size: 12 }), 'D:\\材料\\报告.md',
    'valid frames after malformed ones must still stage (unicode path intact)');
});

test('SYNC-004: __DSH_DIRECTORY_PICKER__ locked to the official DirectoryPicker contract', async () => {
  // 官方 DirectoryPickerBridge（preload-app.ts:75-77）只暴露 pick ——
  // ipcRenderer.invoke(DESKTOP_IPC.directoryPick) → Promise<string | null>。
  // 主进程（directory-picker.ts:12,24）弹原生目录选择对话框
  //（['openDirectory','createDirectory']）：用户选定 → 目录绝对路径字符串；
  // 取消 → null。与 __DSH_LOCALE__ 同层挂在 window 上，键集精确锁定防漂移。
  // 消费者 dsh-client-ui-directory-picker-native/lib/client.js:63：桥存在走
  // 原生分支，缺失回退 Web 浏览式选目录；禁用 <input webkitdirectory> 冒充。
  assert.match(bridge, /\(window as any\)\.__DSH_DIRECTORY_PICKER__ = \{/,
    'bridge must expose window.__DSH_DIRECTORY_PICKER__（官方 preload-app.ts:75-77 同名同层）');

  const calls: Array<{ method: string; params: any; timeout?: number }> = [];
  let pickReply: any = null;
  const window: any = {
    addEventListener() {},
    __DSH_WS_RPC__: () => ({
      onNotify() {},
      send() {},
      call(method: string, params: any, timeoutMs?: number) {
        calls.push({ method, params, timeout: timeoutMs });
        return Promise.resolve(pickReply);
      },
    }),
  };
  runInNewContext(stripTypeScriptTypes(bridge), {
    window,
    document: { readyState: 'loading', documentElement: { setAttribute() {} }, addEventListener() {} },
    navigator: { platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    setInterval() {},
  });

  const picker = window.__DSH_DIRECTORY_PICKER__;
  assert.deepEqual(Object.keys(picker), ['pick'],
    `DirectoryPicker key drift: ${Object.keys(picker).join(',')}`);
  assert.equal(typeof picker.pick, 'function');

  // pick() 返回 Promise（官方 ipcRenderer.invoke 形态；vm realm 的 Promise
  // 与宿主原型不同，instanceof 不可用 —— 用 thenable 鸭子判定），
  // 经 WS call('directory.pick')，载荷 {}。
  pickReply = 'D:\\材料\\工作区';
  const pending = picker.pick();
  assert.equal(typeof pending.then, 'function', 'pick() must return a Promise');
  const routed = calls.find((c) => c.method === 'directory.pick');
  assert.ok(routed, 'pick() must route through directory.pick');
  assert.deepEqual(JSON.parse(JSON.stringify(routed.params)), {});
  // 用户在原生对话框里浏览目录可远超 call 缺省 30s：pick() 必须放宽超时
  //（官方 invoke 无超时；这里放宽到分钟级安全阀），否则选目录被误判超时。
  assert.equal(typeof routed.timeout, 'number');
  assert.ok(routed.timeout! >= 60_000,
    `pick() must not inherit the 30s default call timeout (got ${routed.timeout}ms)`);

  // 用户选定 → 回包 result 即目录绝对路径，桥原样透传（中文路径保真）。
  assert.equal(await pending, 'D:\\材料\\工作区');

  // 用户取消 → 壳回 null，桥返 null（官方「取消」语义，消费者走 onCancel）。
  pickReply = null;
  assert.equal(await picker.pick(), null);
  pickReply = 'C:\\proj';
  assert.equal(await picker.pick(), 'C:\\proj');

  // 防御归一：非字符串（空串/数字/对象）一律归 null，不外泄畸形路径。
  pickReply = '';
  assert.equal(await picker.pick(), null);
  pickReply = 42;
  assert.equal(await picker.pick(), null);
  pickReply = { path: 'C:\\proj' };
  assert.equal(await picker.pick(), null);
});

test('rc.2 settings update consumer can initialize with the desktop bridge', async () => {
  const window: any = {
    addEventListener() {},
    __DSH_WS_RPC__: () => ({ onNotify() {}, send() {}, call: async () => ({}) }),
  };
  runInNewContext(stripTypeScriptTypes(bridge), {
    window,
    document: { readyState: 'loading', addEventListener() {} },
    setInterval() {},
  });

  // Exercise the pinned kernel's real consumer: browser-only smoke has no carrier
  // and cannot catch a missing status() that aborts the desktop settings plugin.
  const client = readFileSync(join(root, 'node_modules', '@deepseek-ai',
    'dsh-client-ui-settings-general', 'lib', 'client.js'), 'utf8');
  const marker = 'var DesktopUpdateSource = class';
  const start = client.indexOf(marker);
  const end = client.indexOf('//#endregion', start);
  assert.ok(start >= 0 && end > start, 'pinned update consumer must be present');
  const Consumer = runInNewContext(client.slice(start, end) + '\nDesktopUpdateSource;', {
    _deepseek_ai_dsh_client_store: {
      createSnapshotStore(initial: unknown) {
        let snapshot = initial;
        return { getSnapshot: () => snapshot, set: (next: unknown) => { snapshot = next; } };
      },
    },
  });
  const updates = window.dshDesktop.updates;
  const consumer = new Consumer(updates);
  // SYNC-005：status 改为经 WS call（真实更新态）→ 桥侧归一，比旧恒 idle 桩多
  // 一层微任务 —— 宏任务 setTimeout(0) 等回包链跑完再断言（open 拒绝锁定
  // 不变；check/install 无主面已由 SYNC-007 删除，见下方断言）。
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(consumer.store.getSnapshot().presentation.phase, 'idle');
  assert.equal(consumer.store.getSnapshot().failed, false);
  assert.equal(typeof updates.open, 'function');
  assert.equal(await updates.open(), undefined);
  assert.equal(updates.check, undefined,
    'updates.check must stay removed（SYNC-007：官方无此面，消费者仅用 status/subscribe/open）');
  consumer.dispose();
});

test('SYNC-005: shortcuts namespace locked to the official DesktopShortcutsApi contract', () => {
  // 官方 DesktopShortcutsApi（dsh-client-shortcuts persistence.d.ts:29-34）只有
  // get/edit/subscribe/recording 四个方法 —— 键集精确锁定，防止实现漂移出非
  // 契约面（sidecar 内省用的 shortcuts.state 不上桥面）。
  assert.match(bridge, /\bshortcuts: \{/, 'bridge must expose window.dshDesktop.shortcuts（官方 ipc.ts:75 同名同层）');
  assert.deepEqual([...bridgeTree.shortcuts].sort(), ['edit', 'get', 'recording', 'subscribe'],
    `shortcuts namespace drift: ${bridgeTree.shortcuts.join(',')}`);
  // updates 键面不漂移：真实 status/subscribe（SYNC-005）+ 受控更新页 open；
  // 无主面 check/install 已由 SYNC-007 删除（官方 updates 恰为三方法）。
  assert.deepEqual([...bridgeTree.updates].sort(), ['open', 'status', 'subscribe'],
    `updates namespace drift: ${bridgeTree.updates.join(',')}`);
  // updates.open uses the official three-method contract.
  assert.match(bridge, /open: function \(\) \{ return call\('updates.open'/,
    'updates.open must open the shell-owned update window');
});

test('SYNC-005: shortcuts bridge round-trips snapshots and links the keyboard revision', async () => {
  // 等价 WebView2 注入序列：notify 钩子全量捕获（桥会注册多个钩子），WS 回包
  // 按方法分发。
  const hooks: Array<(method: string, params: any) => void> = [];
  const windowKeydowns: Array<(e: unknown) => void> = [];
  const calls: Array<{ method: string; params: any }> = [];
  const snapA = { revision: 'rev-a', sequence: 2, document: { schemaVersion: 1, profiles: {} }, status: 'ready', error: null, usingDefaults: false };
  const snapB = { revision: 'rev-b', sequence: 3, document: { schemaVersion: 2, profiles: { 'desktop:windows': { 'a.b': { code: 'KeyM', modifiers: ['primary'] } } } }, status: 'ready', error: null, usingDefaults: false };
  const replies: Record<string, unknown> = {
    'shortcuts.get': snapA,
    'shortcuts.edit': { status: 'saved', snapshot: snapB },
    'updates.status': {},
  };
  const window: any = {
    addEventListener(type: string, fn: (e: unknown) => void) { if (type === 'keydown') windowKeydowns.push(fn); },
    removeEventListener() {},
    __DSH_WS_RPC__: () => ({
      onNotify(fn: (method: string, params: any) => void) { hooks.push(fn); },
      send() {},
      call: (method: string, params: any) => { calls.push({ method, params }); return Promise.resolve(replies[method]); },
    }),
  };
  const document: any = {
    readyState: 'loading',
    documentElement: { setAttribute() {} },
    addEventListener() {},
  };
  runInNewContext(stripTypeScriptTypes(bridge), {
    window,
    document,
    navigator: { platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    setInterval() {},
    setTimeout() {},
  });
  const dispatch = (method: string, params: any) => { for (const h of hooks) h(method, params); };
  const keydown = () => windowKeydowns[0]({ code: 'KeyK', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, repeat: false });
  const dsh = window.dshDesktop;
  const keyInputs: any[] = [];
  dsh.keyboard.subscribe((input: unknown) => keyInputs.push(input));

  // get：官方签名 get(definitions) → 快照回包；路由 'shortcuts.get' 载荷带
  // definitions；回包快照即当前 revision —— 随后的原生输入必须携带它
  //（installNativeKeyboard 丢弃 revision 不匹配的输入，client.js:896）。
  const definitions = [{ id: 'a.b', defaults: { 'desktop:windows': { code: 'KeyN', modifiers: ['primary'] } } }];
  assert.equal(typeof dsh.shortcuts.get, 'function');
  assert.equal(typeof dsh.shortcuts.edit, 'function');
  assert.equal(typeof dsh.shortcuts.subscribe, 'function');
  assert.equal(typeof dsh.shortcuts.recording, 'function');
  const got = await dsh.shortcuts.get(definitions);
  assert.deepEqual(JSON.parse(JSON.stringify(got)), snapA);
  const getCall = calls.find((c) => c.method === 'shortcuts.get');
  assert.ok(getCall, 'get must route through shortcuts.get');
  // vm realm 的对象原型与宿主不同（deepStrictEqual 做引用比较）—— 先 JSON 归一
  // 再比（与 SYNC-001 测试同款处理）。
  assert.deepEqual(JSON.parse(JSON.stringify(getCall.params)), { definitions });
  keydown();
  assert.equal(keyInputs[0].revision, 'rev-a', 'keyboard input must carry the synced snapshot revision');

  // edit：官方签名 edit(edit, revision) → ShortcutSaveResult；路由载荷带
  // edit + revision；回包快照联动 revision 递进。
  const edit = { type: 'set', id: 'a.b', binding: { code: 'KeyM', modifiers: ['primary'] } };
  const saved = await dsh.shortcuts.edit(edit, 'rev-a');
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), { status: 'saved', snapshot: snapB });
  const editCall = calls.find((c) => c.method === 'shortcuts.edit');
  assert.ok(editCall, 'edit must route through shortcuts.edit');
  assert.deepEqual(JSON.parse(JSON.stringify(editCall.params)), { edit, revision: 'rev-a' });
  keydown();
  assert.equal(keyInputs[1].revision, 'rev-b', 'keyboard input must follow the edit result snapshot');

  // recording：官方「录制态暂停物理键拦截」—— 门是页面层状态（物理捕获就在
  // 本桥），录制中不分发、结束恢复。
  await dsh.shortcuts.recording(true);
  keydown();
  assert.equal(keyInputs.length, 2, 'no native input while recording');
  await dsh.shortcuts.recording(false);
  keydown();
  assert.equal(keyInputs.length, 3, 'native input resumes after recording ends');

  // subscribe：'shortcuts.snapshot' 推送帧分发；sequence 门控丢弃乱序旧帧
  //（官方语义「clients discard out-of-order IPC replies」—— 当前序列已是
  // edit 回包的 3，seq 1/2 的旧帧一律不入）。
  const snapshots: any[] = [];
  const dispose = dsh.shortcuts.subscribe((snap: unknown) => snapshots.push(snap));
  assert.equal(typeof dispose, 'function');
  dispatch('shortcuts.snapshot', { revision: 'rev-stale', sequence: 1, document: { schemaVersion: 1, profiles: {} }, status: 'ready', error: null, usingDefaults: true });
  dispatch('shortcuts.snapshot', snapA);
  assert.equal(snapshots.length, 0, 'out-of-order snapshot (lower sequence) must be discarded');
  assert.equal(keyInputs[2].revision, 'rev-b', 'stale frame must not roll the keyboard revision back');
  const snapC = { revision: 'rev-c', sequence: 4, document: { schemaVersion: 1, profiles: {} }, status: 'ready', error: null, usingDefaults: true };
  dispatch('shortcuts.snapshot', snapC);
  assert.equal(snapshots.length, 1, 'fresh snapshot frame must reach subscribers');
  keydown();
  assert.equal(keyInputs[3].revision, 'rev-c', 'fresh frame must update the keyboard revision');
  dispose();
  dispatch('shortcuts.snapshot', snapB);
  assert.equal(snapshots.length, 1, 'disposer must unsubscribe');

  // closeWindow：SYNC-005 起 revision 对账（官方 keyboard.ts:97-102）—— 缓存
  // 快照与请求不符 → 不发关窗；匹配 → win.close 携带 revision。
  await dsh.keyboard.closeWindow('rev-mismatch');
  assert.ok(!calls.some((c) => c.method === 'win.close'), 'stale revision must not close the window');
  await dsh.keyboard.closeWindow('rev-c');
  const close = calls.find((c) => c.method === 'win.close');
  assert.ok(close, 'current revision must close the window');
  assert.equal(close.params.revision, 'rev-c');
});

test('SYNC-005: updates status/subscribe carry the real presentation stream', async () => {
  const hooks: Array<(method: string, params: any) => void> = [];
  const calls: Array<{ method: string; params: any }> = [];
  let statusReply: unknown = {};
  const window: any = {
    addEventListener() {},
    __DSH_WS_RPC__: () => ({
      onNotify(fn: (method: string, params: any) => void) { hooks.push(fn); },
      send() {},
      call: (method: string, params: any) => {
        calls.push({ method, params });
        if (method === 'updates.status') return Promise.resolve(statusReply);
        return Promise.resolve({ ok: true });
      },
    }),
  };
  const document: any = { readyState: 'loading', documentElement: { setAttribute() {} }, addEventListener() {} };
  runInNewContext(stripTypeScriptTypes(bridge), {
    window,
    document,
    navigator: { platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    setInterval() {},
  });
  const dispatch = (method: string, params: any) => { for (const h of hooks) h(method, params); };
  const updates = window.dshDesktop.updates;

  // status：空回包（旧壳/异常）→ 归一为官方 idle 形态，不外泄未知形态；
  // 真实回包（sidecar 依据 settings.pendingClientUpdate 映射的 ready 态）→
  // 原样透传（phase 封闭枚举内）。
  const idle = await updates.status();
  assert.deepEqual(JSON.parse(JSON.stringify(idle)), { phase: 'idle' });
  const statusCall = calls.find((c) => c.method === 'updates.status');
  assert.ok(statusCall, 'status must route through updates.status');
  statusReply = { phase: 'ready', version: '9.9.9' };
  assert.deepEqual(JSON.parse(JSON.stringify(await updates.status())), { phase: 'ready', version: '9.9.9' });
  statusReply = { phase: 'bogus' };
  assert.deepEqual(JSON.parse(JSON.stringify(await updates.status())), { phase: 'idle' },
    'unknown phase must be normalized to idle');

  // subscribe：0→1 交 sidecar 启动真实文件变化监听；presentation 推送帧分发；
  // 畸形 phase 归一；退订 1→0 停监听。
  const received: any[] = [];
  const dispose = updates.subscribe((presentation: unknown) => received.push(presentation));
  assert.equal(typeof dispose, 'function');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(calls.some((c) => c.method === 'updates.subscribe'), 'first subscriber must arm the sidecar watcher');
  dispatch('updates.presentation', { phase: 'available', version: '9.9.9' });
  dispatch('updates.presentation', { phase: 'nope' });
  assert.deepEqual(JSON.parse(JSON.stringify(received)), [
    { phase: 'available', version: '9.9.9' },
    { phase: 'idle' },
  ], 'presentation frames must stream to subscribers (bogus phase normalized)');
  dispose();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(calls.some((c) => c.method === 'updates.unsubscribe'), 'last unsubscribe must stop the sidecar watcher');

  // open opens the native update window without exposing install commands.
  assert.equal(await updates.open(), undefined);
  assert.ok(calls.some((c) => c.method === 'updates.open'));
});

// ---------------------------------------------------------------------------
// SYNC-006：dshDesktop.browser（官方 DesktopBrowserBridge）+ <webview> 宿主
// 元素适配。权威类型：dsh-client-ui-sidebar-browser/lib/types/types.d.ts:4-23
//（DesktopBrowserLeaseId / DesktopBrowserReservation / DesktopBrowserBridge）。
// 消费者：lib/client.js:1597-1613 —— desktop !== void 0 即 keepMounted:true 并
// 走 createElectronPage（<webview> 载体）；缺失走 web 载体 + keepMounted:false。
// L1 侧真实 guest（主窗内子 webview + 租约制）见 tauri-shell/src/main.rs。
// ---------------------------------------------------------------------------

test('SYNC-006: browser namespace locked to the official DesktopBrowserBridge contract', () => {
  // 官方 DesktopBrowserBridge（types.d.ts:16-23）只有 acquire / release /
  // onOpenRequested 三个方法 —— 键集精确锁定，防止实现漂移出非契约面。
  assert.match(bridge, /\bbrowser: \{/, 'bridge must expose window.dshDesktop.browser（官方 ipc.ts:73 同名同层）');
  assert.deepEqual([...bridgeTree.browser].sort(), ['acquire', 'onOpenRequested', 'release'],
    `browser namespace drift: ${bridgeTree.browser.join(',')}`);
  // acquire 必须建真实租约形态守门（畸形回包 reject，绝不降级伪造 Reservation）。
  assert.match(bridge, /invalid reservation from shell/,
    'acquire must reject malformed shell replies instead of faking a reservation');
});

test('SYNC-006: browser bridge round-trips real leases, disposer semantics, and the webview adapter', async () => {
  // 等价 WebView2 注入序列：notify 钩子全量捕获；send/call 全量记录。
  const hooks: Array<(method: string, params: any) => void> = [];
  const sends: Array<{ method: string; params: any }> = [];
  const calls: Array<{ method: string; params: any }> = [];
  let acquireReply: any = { lease: 'dsh-browser-lease-1-77', partition: 'browser-guest-0f1e2d3c4b5a6978' };
  const window: any = {
    addEventListener() {},
    __DSH_WS_RPC__: () => ({
      onNotify(fn: (method: string, params: any) => void) { hooks.push(fn); },
      send(method: string, params: any) { sends.push({ method, params }); },
      call(method: string, params: any) {
        calls.push({ method, params });
        if (method === 'browser.acquire') return Promise.resolve(acquireReply);
        return Promise.resolve({ ok: true, destroyed: true });
      },
    }),
  };
  // 最小 DOM：createElement 产出可编程元素（属性表 + 同步事件派发）。vm 无
  // MutationObserver → 挂载观测不启动；事件分派不依赖挂载态（真实挂载链路由
  // Tier1/Tier2 真实验证覆盖）。
  const makeElement = (): any => {
    const attrs: Record<string, string> = {};
    const listeners: Record<string, Array<(e: any) => void>> = {};
    return {
      nodeType: 1,
      connected: false,
      get isConnected() { return this.connected; },
      setAttribute(k: string, v: string) { attrs[k] = String(v); },
      getAttribute(k: string) { return k in attrs ? attrs[k] : null; },
      addEventListener(type: string, fn: (e: any) => void) { (listeners[type] || (listeners[type] = [])).push(fn); },
      removeEventListener(type: string, fn: (e: any) => void) {
        const arr = listeners[type] || [];
        const i = arr.indexOf(fn);
        if (i >= 0) arr.splice(i, 1);
      },
      dispatchEvent(e: any) {
        for (const fn of listeners[e.type] || []) fn(e);
        return true;
      },
      contains() { return false; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; },
    };
  };
  const document: any = {
    readyState: 'loading',
    documentElement: { setAttribute() {} },
    addEventListener() {},
    createElement() { return makeElement(); },
  };
  runInNewContext(stripTypeScriptTypes(bridge), {
    window,
    document,
    navigator: { platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    setInterval() {},
    setTimeout() {},
  });
  const dispatch = (method: string, params: any) => { for (const h of hooks) h(method, params); };
  const dsh = window.dshDesktop;

  // A. 键面与形态：官方 DesktopBrowserBridge 逐字段。
  assert.deepEqual(Object.keys(dsh.browser).sort(), ['acquire', 'onOpenRequested', 'release'],
    `runtime browser key drift: ${Object.keys(dsh.browser).join(',')}`);
  assert.equal(typeof dsh.browser.acquire, 'function');
  assert.equal(typeof dsh.browser.release, 'function');
  assert.equal(typeof dsh.browser.onOpenRequested, 'function');

  // B. 消费者判定等价断言（client.js:1597-1598 原文形态）：
  //    desktop !== void 0 ⇒ keepMounted:true + createElectronPage（不走 web 载体）。
  const carrier = window.dshDesktop;
  const desktop = carrier?.protocolVersion === 1 ? carrier.browser : void 0;
  assert.notEqual(desktop, undefined, 'consumer decision must select the desktop (<webview>) carrier');
  // 官方消费者源码锚点：pinned 内核确实以本判定决定 keepMounted 与载体。
  const consumer = readFileSync(join(root, 'node_modules', '@deepseek-ai',
    'dsh-client-ui-sidebar-browser', 'lib', 'client.js'), 'utf8');
  assert.match(consumer, /protocolVersion === 1 \? carrier\.browser : void 0/);
  assert.match(consumer, /keepMounted: desktop !== void 0/);

  // C. 页面世代：WS 就绪即报 browser.page-hello（L1 孤儿 guest 回收依据）。
  //    vm 侧锁通道存在性；真实时序由 Tier1/Tier2 真实验证覆盖。
  assert.match(bridge, /browser\.page-hello/, 'bridge must report page generation via browser.page-hello');

  // D. acquire：官方签名 acquire(workspace) → Promise<DesktopBrowserReservation>；
  //    路由 browser.acquire，载荷 {workspace, generation}（generation 非空）。
  const pending = dsh.browser.acquire('cwd:D:\\材料\\工作区');
  assert.equal(typeof pending.then, 'function', 'acquire() must return a Promise');
  const reservation = await pending;
  const acquireCall = calls.find((c) => c.method === 'browser.acquire');
  assert.ok(acquireCall, 'acquire must route through browser.acquire');
  assert.equal(acquireCall.params.workspace, 'cwd:D:\\材料\\工作区');
  assert.equal(typeof acquireCall.params.generation, 'string');
  assert.ok(acquireCall.params.generation.length >= 8, 'generation must be a non-trivial page token');
  // 回包 → 官方 Reservation 形态（lease/partition 双非空字符串，原样透传）。
  assert.deepEqual(JSON.parse(JSON.stringify(reservation)), {
    lease: 'dsh-browser-lease-1-77',
    partition: 'browser-guest-0f1e2d3c4b5a6978',
  });

  // E. 形态守门：壳回畸形（缺字段/空串/非串/null）→ reject，绝不伪造 Reservation。
  acquireReply = {};
  await assert.rejects(dsh.browser.acquire('cwd:x'), /invalid reservation from shell/);
  acquireReply = { lease: '', partition: 'p' };
  await assert.rejects(dsh.browser.acquire('cwd:x'), /invalid reservation from shell/);
  acquireReply = { lease: 'l', partition: 42 };
  await assert.rejects(dsh.browser.acquire('cwd:x'), /invalid reservation from shell/);
  acquireReply = null;
  await assert.rejects(dsh.browser.acquire('cwd:x'), /invalid reservation from shell/);

  // F. release：官方 Promise<void>（resolve 值必须为 undefined，不外泄回包）；
  //    路由 browser.release 载荷 {lease}。
  const released = await dsh.browser.release('dsh-browser-lease-1-77');
  assert.equal(released, undefined, 'release must resolve to void');
  const releaseCall = calls.find((c) => c.method === 'browser.release');
  assert.ok(releaseCall, 'release must route through browser.release');
  assert.equal(releaseCall.params.lease, 'dsh-browser-lease-1-77');

  // G. onOpenRequested：browser.open-requested 帧按 lease 投递 url；disposer
  //    退订；异租约不串投（官方 DesktopBrowserOpenRequest {lease, url}）。
  const gotUrls: string[] = [];
  const otherUrls: string[] = [];
  const disposeOpen = dsh.browser.onOpenRequested('dsh-browser-lease-1-77', (url: string) => gotUrls.push(url));
  assert.equal(typeof disposeOpen, 'function', 'onOpenRequested must return a disposer');
  dsh.browser.onOpenRequested('dsh-browser-lease-2-88', (url: string) => otherUrls.push(url));
  dispatch('browser.open-requested', { lease: 'dsh-browser-lease-1-77', url: 'https://example.com/a' });
  dispatch('browser.open-requested', { lease: 'dsh-browser-lease-2-88', url: 'https://example.com/b' });
  assert.deepEqual(gotUrls, ['https://example.com/a'], 'open-requested must reach only its own lease listeners');
  assert.deepEqual(otherUrls, ['https://example.com/b'], 'other leases must not receive cross-lease requests');
  disposeOpen();
  dispatch('browser.open-requested', { lease: 'dsh-browser-lease-1-77', url: 'https://example.com/c' });
  assert.deepEqual(gotUrls, ['https://example.com/a'], 'disposer must unsubscribe the listener');
  // 畸形帧不炸桥。
  dispatch('browser.open-requested', null);
  dispatch('browser.open-requested', { lease: '', url: 'https://x' });

  // H. <webview> 适配：createElement('webview') → Electron 同名 API 挂齐；
  //    未设 name（无租约）时命令拒绝（绝不伪造租约操作）。
  const el = document.createElement('webview');
  for (const fn of ['loadURL', 'goBack', 'goForward', 'reload', 'clearHistory', 'getURL', 'getTitle', 'isLoading', 'canGoBack', 'canGoForward']) {
    assert.equal(typeof el[fn], 'function', `webview adapter must provide ${fn}`);
  }
  assert.equal(el.canGoBack(), false, 'fresh adapter must report neutral history state');
  assert.equal(el.getURL(), 'about:blank', 'fresh adapter must report the bootstrap URL');
  assert.throws(() => el.loadURL('https://example.com'), /missing guest lease/,
    'commands without a lease (name attribute) must be refused');
  assert.ok(!calls.some((c) => c.method === 'browser.guest-load-url'),
    'lease-less loadURL must not reach L1');

  // I. 设 name=lease 后：loadURL/goBack 路由 L1；guest-event 帧更新缓存并派发
  //    Electron 同名事件；destroyed 帧派发 destroyed。
  const events: string[] = [];
  el.setAttribute('name', 'dsh-browser-lease-1-77');
  el.addEventListener('dom-ready', () => events.push('dom-ready'));
  el.addEventListener('did-navigate', () => events.push('did-navigate'));
  el.addEventListener('destroyed', () => events.push('destroyed'));
  const loadP = el.loadURL('https://example.com/');
  assert.equal(typeof loadP.then, 'function', 'loadURL must return a Promise (Electron 形态)');
  await loadP;
  const loadCall = calls.find((c) => c.method === 'browser.guest-load-url');
  assert.ok(loadCall, 'loadURL must route through browser.guest-load-url');
  assert.deepEqual(JSON.parse(JSON.stringify(loadCall.params)),
    { lease: 'dsh-browser-lease-1-77', url: 'https://example.com/' });
  el.goBack();
  const cmdCall = sends.find((s) => s.method === 'browser.guest-cmd');
  assert.ok(cmdCall, 'goBack must route through browser.guest-cmd (send 帧)');
  assert.deepEqual(JSON.parse(JSON.stringify(cmdCall.params)),
    { lease: 'dsh-browser-lease-1-77', cmd: 'goBack' });

  dispatch('browser.guest-event', { lease: 'dsh-browser-lease-1-77', event: 'dom-ready', url: 'about:blank' });
  dispatch('browser.guest-event', { lease: 'dsh-browser-lease-1-77', event: 'did-navigate', url: 'https://example.com/', loading: true, canGoBack: true });
  assert.deepEqual(events, ['dom-ready', 'did-navigate'], 'guest-event frames must dispatch the Electron event names');
  assert.equal(el.getURL(), 'https://example.com/', 'getURL must read the L1-pushed URL');
  assert.equal(el.isLoading(), true, 'isLoading must read the L1-pushed loading state');
  assert.equal(el.canGoBack(), true, 'canGoBack must read the L1-pushed history state');
  // 异租约事件不串扰本元素。
  dispatch('browser.guest-event', { lease: 'dsh-browser-lease-2-88', event: 'did-navigate', url: 'https://other.example/' });
  assert.equal(el.getURL(), 'https://example.com/', 'other leases must not mutate this element cache');

  dispatch('browser.guest-destroyed', { lease: 'dsh-browser-lease-1-77' });
  assert.ok(events.includes('destroyed'), 'guest-destroyed frame must dispatch the destroyed event');
});


test('update window cannot drive main window chrome or viewport repair',async()=>{
  const sent: string[]=[];const domReady: Array<()=>void>=[];let intervals=0;
  const window:any={__DSH_WINDOW_LABEL__:'client-update',addEventListener(){},__DSH_WS_RPC__:()=>({
    onNotify(){},send:(method:string)=>sent.push(method),call:async()=>({}),
  })};
  runInNewContext(stripTypeScriptTypes(bridge),{window,
    document:{readyState:'loading',documentElement:{setAttribute(){}},addEventListener:(event:string,fn:()=>void)=>{if(event==='DOMContentLoaded')domReady.push(fn);}},
    navigator:{platform:'Win32',userAgent:''},setInterval(){intervals++;},setTimeout(){},
  });
  for(const fn of domReady)fn();
  assert.equal(intervals,0);assert.ok(!sent.includes('win.viewport-beat'));
  assert.equal(typeof window.dshDesktop.updates.open,'function');
  assert.equal(typeof window.__DSH_DIRECTORY_PICKER__.pick,'function');
});
