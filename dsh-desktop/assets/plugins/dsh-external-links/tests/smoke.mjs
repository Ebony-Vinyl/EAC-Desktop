#!/usr/bin/env node
// dsh-external-links 冒烟测试（零依赖，node tests/smoke.mjs）。
//
// 在 vm 沙箱里跑真实的 lib/client.js：假 window/document/location/dshDesktop，
// 断言「外链走系统浏览器」「同源与无参 window.open 不被劫持」「登录授权页按
// attempt.id 只开一次」。这是插件的可执行契约，也是壳层 WebView 之外唯一能
// 自动化复现该缺陷的层。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const clientPath = fileURLToPath(new URL('../lib/client.js', import.meta.url));
const source = readFileSync(clientPath, 'utf8');

/** 建一个最小浏览器环境，返回沙箱与观测点。 */
function createEnvironment() {
  const opened = [];
  const native = [];
  const listeners = new Map();
  let disposed = false;

  const sandbox = {
    console,
    URL,
    Error,
    Promise,
    Object,
    String,
    Array,
    location: { href: 'http://127.0.0.1:52628/' },
    document: {
      addEventListener(type, handler) {
        listeners.set(type, handler);
      },
      removeEventListener(type, handler) {
        if (listeners.get(type) === handler) listeners.delete(type);
      },
    },
    dshDesktop: {
      openExternal(url) {
        opened.push(url);
        return Promise.resolve();
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  // 原生 window.open：记录调用并返回一个标记对象。
  sandbox.open = function (...args) {
    native.push(args);
    return { native: true };
  };
  sandbox.__ModuleLoader__ = {
    load(definition) {
      sandbox.__exports = definition.factory(() => {
        throw new Error('dsh-external-links client must not require sibling modules');
      });
    },
  };

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: clientPath });

  return {
    sandbox,
    opened,
    native,
    listeners,
    get disposed() {
      return disposed;
    },
    markDisposed() {
      disposed = true;
    },
  };
}

/** 假 cordis ctx：effect 立即执行并记住 disposer，inject 同步回调。 */
function createCtx(sandbox, disposers) {
  const effect = (fn) => {
    disposers.push(fn());
  };
  const ctx = {
    effect,
    inject(_deps, callback) {
      callback({ effect });
    },
  };
  return ctx;
}

function clickEvent(anchor) {
  return {
    button: 0,
    defaultPrevented: false,
    target: { closest: (selector) => (selector === 'a[href]' ? anchor : null) },
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
  };
}

function anchor(href, target) {
  return {
    href,
    getAttribute(name) {
      if (name === 'target') return target;
      if (name === 'href') return href;
      return null;
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// ---- 1. window.open 门 ----
{
  const env = createEnvironment();
  const disposers = [];
  const exports = env.sandbox.__exports;
  assert.equal(exports.inject.length, 0, '插件不阻塞任何服务，window.open 门必须无条件安装');
  exports.apply(createCtx(env.sandbox, disposers));

  assert.equal(env.sandbox.open('https://example.com/feedback', '_blank'), null, '外链 window.open 必须被接管（返回 null）');
  assert.deepEqual(env.opened, ['https://example.com/feedback'], '外链必须交给 dshDesktop.openExternal');

  assert.equal(env.native.length, 0, '外链不应回落到原生 window.open');

  // 同源：内嵌预览 / 皮肤资产 / 文档 viewer，不能被劫持。
  const same = env.sandbox.open('/preview/report.pdf');
  assert.equal(same && same.native, true, '同源 window.open 必须保持原生行为');
  // 无参：终端 xterm 的流行用法。
  const blank = env.sandbox.open();
  assert.equal(blank && blank.native, true, 'window.open() 无参必须保持原生行为');
  assert.equal(env.opened.length, 1, '同源/无参调用不得进系统浏览器');

  for (const dispose of disposers) dispose();
  assert.equal(env.sandbox.open('https://example.com/after').native, true, '卸载后必须还原原生 window.open');
  console.log('ok 1 - window.open gate');
}

// ---- 2. <a target="_blank"> 门 ----
{
  const env = createEnvironment();
  const disposers = [];
  env.sandbox.__exports.apply(createCtx(env.sandbox, disposers));
  const handler = env.listeners.get('click');
  assert.equal(typeof handler, 'function', '必须注册捕获阶段的 click 监听');

  const external = clickEvent(anchor('https://platform.deepseek.com/dsh/authorize?state=1', '_blank'));
  handler(external);
  assert.equal(external.defaultPrevented, true, '外链锚点点击必须被接管');
  assert.deepEqual(env.opened, ['https://platform.deepseek.com/dsh/authorize?state=1']);

  const sameOrigin = clickEvent(anchor('http://127.0.0.1:52628/preview/x.pdf', '_blank'));
  handler(sameOrigin);
  assert.equal(sameOrigin.defaultPrevented, false, '同源锚点点击必须保持原生行为');

  const noTarget = clickEvent(anchor('https://example.com/in-place', ''));
  handler(noTarget);
  assert.equal(noTarget.defaultPrevented, false, '非 _blank 锚点（本页内导航）不得被接管');

  const hash = clickEvent(anchor('#section', '_blank'));
  handler(hash);
  assert.equal(hash.defaultPrevented, false, '纯锚点 href 不得被接管');

  assert.equal(env.opened.length, 1);
  for (const dispose of disposers) dispose();
  assert.equal(env.listeners.has('click'), false, '卸载后必须注销 click 监听');
  console.log('ok 2 - anchor target=_blank gate');
}

// ---- 3. 登录授权页自动打开 ----
{
  const env = createEnvironment();
  const disposers = [];
  const frames = [
    { value: { status: 'signed-out' }, accept() {} },
    {
      value: { status: 'signed-out', attempt: { id: 'attempt-1', phase: 'initializing' } },
      accept() {},
    },
    {
      value: {
        status: 'signed-out',
        attempt: { id: 'attempt-1', phase: 'waiting-browser', authorizeUrl: 'https://platform.deepseek.com/dsh/authorize?state=1' },
      },
      accept() {},
    },
    // 同一 attempt 的第二帧（状态重复推送）：不得重复开页。
    {
      value: {
        status: 'signed-out',
        attempt: { id: 'attempt-1', phase: 'waiting-browser', authorizeUrl: 'https://platform.deepseek.com/dsh/authorize?state=1' },
      },
      accept() {},
    },
    // 换了一次尝试：重新打开。
    {
      value: {
        status: 'signed-out',
        attempt: { id: 'attempt-2', phase: 'waiting-browser', authorizeUrl: 'https://platform.deepseek.com/dsh/authorize?state=2' },
      },
      accept() {},
    },
  ];
  let accepted = 0;
  for (const frame of frames) {
    const accept = frame.accept.bind(frame);
    frame.accept = () => {
      accepted += 1;
      accept();
    };
  }
  env.sandbox.remote = {
    $stream: () => (async function* () {
      for (const frame of frames) yield frame;
    })(),
    account: { watch: () => {} },
  };
  // ctx.remote 由插件从 scope 读取；把假 service 塞进 scope。
  const effect = (fn) => {
    disposers.push(fn());
  };
  const exports = env.sandbox.__exports;
  exports.apply({
    effect,
    inject(_deps, callback) {
      callback({ effect, remote: env.sandbox.remote });
    },
  });

  await flush();
  await flush();

  assert.deepEqual(
    env.opened,
    [
      'https://platform.deepseek.com/dsh/authorize?state=1',
      'https://platform.deepseek.com/dsh/authorize?state=2',
    ],
    '每个 waiting-browser attempt 只开一次，新 attempt 重新开',
  );
  assert.equal(accepted, frames.length, '每一帧都必须 accept()（流控回执）');

  for (const dispose of disposers) dispose();
  console.log('ok 3 - sign-in authorize page opener');
}

// ---- 4. 与 api-gateway 的流契约对齐（官方 account 插件同款形状） ----
// 官方 client 用 ctx.remote.$stream({ name: 'account', open: (signal) =>
// ctx.remote.account.watch(signal) }) + frame.accept()；这里锁住同样的接线，
// 避免宿主升级后「名字改了 / open 没接上」导致登录门静默失效。
{
  const env = createEnvironment();
  const disposers = [];
  let captured;
  const signal = { aborted: false };
  const watched = [];
  env.sandbox.remote = {
    $stream(options) {
      captured = options;
      return (async function* () {})();
    },
    account: {
      watch(received) {
        watched.push(received);
        return (async function* () {})();
      },
    },
  };
  const effect = (fn) => {
    disposers.push(fn());
  };
  env.sandbox.__exports.apply({
    effect,
    inject(_deps, callback) {
      callback({ effect, remote: env.sandbox.remote });
    },
  });

  assert.equal(captured?.name, 'account', '流名必须与宿主的 account 面一致');
  assert.equal(typeof captured?.open, 'function', '$stream.open 必须提供真实的 watch 迭代器');
  captured.open(signal);
  assert.equal(watched.at(-1), signal, 'open 必须把 signal 原样传给 remote.account.watch');

  for (const dispose of disposers) dispose();
  console.log('ok 4 - account stream contract');
}

// ---- 5. 桥缺失（纯浏览器 / 壳降级）：门必须完全惰性，绝不吞掉原生行为 ----
{
  const env = createEnvironment();
  const disposers = [];
  delete env.sandbox.dshDesktop;
  env.sandbox.__exports.apply(createCtx(env.sandbox, disposers));

  assert.equal(env.sandbox.open('https://example.com/x').native, true, '无桥时外链必须回落到原生 window.open');
  const handler = env.listeners.get('click');
  const event = clickEvent(anchor('https://example.com/x', '_blank'));
  handler(event);
  assert.equal(event.defaultPrevented, false, '无桥时锚点必须保持原生行为');
  assert.equal(env.opened.length, 0);

  for (const dispose of disposers) dispose();
  console.log('ok 5 - bridge-less fallback');
}

// ---- 6. 宿主没有 account 面 / 流建不起来：外链门仍然可用，且不抛错 ----
{
  const env = createEnvironment();
  const disposers = [];
  env.sandbox.remote = {
    $stream() {
      throw new Error('no account surface');
    },
    account: { watch() {} },
  };
  const effect = (fn) => {
    disposers.push(fn());
  };
  assert.doesNotThrow(() => {
    env.sandbox.__exports.apply({
      effect,
      inject(_deps, callback) {
        callback({ effect, remote: env.sandbox.remote });
      },
    });
  }, 'account 面缺失不得让插件加载失败');

  assert.equal(env.sandbox.open('https://example.com/feedback'), null, '外链门必须仍然生效');
  assert.deepEqual(env.opened, ['https://example.com/feedback']);

  for (const dispose of disposers) dispose();
  console.log('ok 6 - missing account surface tolerated');
}

console.log('\ndsh-external-links smoke: 6/6 passed');
