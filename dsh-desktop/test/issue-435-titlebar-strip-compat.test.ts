import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(desktopRoot, '..');
const mainRs = readFileSync(join(repoRoot, 'tauri-shell', 'src', 'main.rs'), 'utf8');
const bridgeTs = readFileSync(join(repoRoot, 'tauri-shell', 'sidecar', 'bridge.ts'), 'utf8');
const bridgeJs = stripTypeScriptTypes(bridgeTs);

function extractTitlebarMarkerScript(): string {
  const body = mainRs.slice(mainRs.indexOf('fn windows_titlebar_marker_js()'));
  const literal = body.match(/format!\(\s*("(?:\\[\s\S]|[^"\\])*")/);
  assert.ok(literal, 'windows_titlebar_marker_js format string must stay parseable');
  const height = mainRs.match(/const TITLE_BAR_HEIGHT_PX: u32 = (\d+);/);
  const id = mainRs.match(/const TITLE_BAR_STYLE_ID: &str = "([^"]+)";/);
  assert.ok(height && id);
  return JSON.parse(literal[1]!.replace(/\\\r?\n/g, ''))
    .replaceAll('{height}', height[1]!)
    .replaceAll('{style_id}', id[1]!)
    .replaceAll('{{', '{')
    .replaceAll('}}', '}');
}

function createDomEnv(options?: {
  html?: string;
  windowLabel?: string;
  nativeWcoVisible?: boolean;
}) {
  const dom = new JSDOM(options?.html ?? '<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
    url: 'http://127.0.0.1:19000/',
    pretendToBeVisual: true,
  });
  const win = dom.window as any;
  Object.defineProperty(win.navigator, 'platform', { value: 'Win32', configurable: true });
  if (options?.windowLabel) {
    win.__DSH_WINDOW_LABEL__ = options.windowLabel;
  }
  if (options?.nativeWcoVisible !== undefined) {
    const visible = options.nativeWcoVisible;
    Object.defineProperty(win.navigator, 'windowControlsOverlay', {
      configurable: true,
      value: {
        visible,
        getTitlebarAreaRect: () => ({ x: 0, y: 0, width: visible ? 900 : 0, height: visible ? 40 : 0 }),
        addEventListener() {},
        removeEventListener() {},
      },
    });
  }
  win.__DSH_WS_RPC__ = () => ({
    onNotify() {},
    send() {},
    call: async (method: string) => {
      if (method === 'win.is-maximized') return { maximized: false };
      return {};
    },
  });
  return { dom, win };
}

test('Issue #435: windows_titlebar_marker_js publishes --dsh-title-bar-strip and panel clearance rules', () => {
  const { dom, win } = createDomEnv();
  const script = extractTitlebarMarkerScript();
  runInNewContext(script, win);

  const root = dom.window.document.documentElement;
  assert.equal(root.getAttribute('data-dsh-title-bar-height'), '36');
  assert.equal(root.style.getPropertyValue('--dsh-windows-titlebar-height'), '36px');
  assert.equal(root.style.getPropertyValue('--dsh-title-bar-height'), '36px');
  assert.equal(root.style.getPropertyValue('--dsh-title-bar-strip'), '36px');

  const fixStyle = dom.window.document.getElementById('__dsh_title_bar_fix__');
  assert.ok(fixStyle, '__dsh_title_bar_fix__ style tag must be injected');
  const css = fixStyle.textContent ?? '';
  assert.match(css, /\[data-dsh-panel-host\] \[class\$="_toggleCluster"\]/,
    'legacy dsh-better-sidebar toggleCluster must be cleared below the 36px bar');
  assert.match(css, /\[data-dsh-panel-host\]>\[class\$="_panel"\]/,
    'legacy dsh-better-sidebar right panel must reserve top strip clearance without matching _bottomPanel');
  assert.doesNotMatch(css, /_bottomPanel/,
    'bottom workbench panel must not acquire top titlebar padding');
  assert.match(css, /\[data-dsh-dock-fallback\]\[style\*="top: 8px"\]/,
    'unanchored blank-session dock fallback must be shifted below the 36px bar');
});

test('Issue #435: bridge exposes Window Controls Overlay geometry when WebView2 native WCO is inactive', async () => {
  const { dom, win } = createDomEnv({ nativeWcoVisible: false });
  win.innerWidth = 1440;

  runInNewContext(bridgeJs, {
    window: win,
    document: win.document,
    navigator: win.navigator,
    Event: win.Event,
    CustomEvent: win.CustomEvent,
    MutationObserver: win.MutationObserver,
    HTMLElement: win.HTMLElement,
    Element: win.Element,
    Node: win.Node,
    setInterval() {},
    setTimeout: win.setTimeout.bind(win),
    clearTimeout: win.clearTimeout.bind(win),
  });

  // document-start 阶段（早于 DOMContentLoaded）就必须可读到 36px 安全内边距
  const wco = win.navigator.windowControlsOverlay;
  assert.ok(wco, 'navigator.windowControlsOverlay must be exposed for plugins reading WCO');
  assert.equal(wco.visible, true, 'active main window must report visible overlay at document-start');

  const rect = wco.getTitlebarAreaRect();
  assert.equal(rect.y, 0);
  assert.equal(rect.height, 36);
  assert.equal(Math.round(rect.y + rect.height), 36, 'dsh-better-sidebar viewport-inset computeInset() must read 36px');
  assert.ok(rect.width > 1000 && rect.width < 1440, `unexpected titlebar width: ${rect.width}`);

  if (dom.window.document.readyState === 'loading') {
    await new Promise<void>((resolve) => {
      dom.window.document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
    });
  }
  assert.ok(dom.window.document.getElementById('__dsh_desktop_chrome__'), 'desktop chrome bar must mount on DOM ready');
  assert.equal(dom.window.document.documentElement.style.getPropertyValue('--dsh-title-bar-strip'), '36px');

  const receivedEvents: Array<{ target: unknown; currentTarget: unknown; visible: boolean; height: number; eventHeight: number }> = [];
  const onGeometry = (ev: any) => {
    receivedEvents.push({
      target: ev?.target,
      currentTarget: ev?.currentTarget,
      visible: Boolean(ev?.visible),
      height: ev?.target?.getTitlebarAreaRect?.().height ?? -1,
      eventHeight: ev?.titlebarAreaRect?.height ?? -1,
    });
  };
  wco.addEventListener('geometrychange', onGeometry);

  win.dispatchEvent(new win.Event('resize'));
  assert.equal(receivedEvents.length, 1, 'window resize must notify WCO subscribers');
  assert.equal(receivedEvents[0]!.target, wco, 'geometrychange event.target must point to navigator.windowControlsOverlay');
  assert.equal(receivedEvents[0]!.currentTarget, wco);
  assert.equal(receivedEvents[0]!.visible, true);
  assert.equal(receivedEvents[0]!.height, 36);
  assert.equal(receivedEvents[0]!.eventHeight, 36);

  // 1) 进出原生 DOM fullscreenchange（窗口尺寸不变）必须派发 geometrychange 且 e.target.getTitlebarAreaRect() 实时折叠为 0
  let fsElement: unknown = dom.window.document.documentElement;
  Object.defineProperty(dom.window.document, 'fullscreenElement', {
    configurable: true,
    get: () => fsElement,
  });
  dom.window.document.dispatchEvent(new win.Event('fullscreenchange'));
  assert.equal(receivedEvents.length, 2, 'entering fullscreenchange without resize must dispatch geometrychange');
  assert.equal(receivedEvents[1]!.target, wco);
  assert.equal(receivedEvents[1]!.visible, false);
  assert.equal(receivedEvents[1]!.height, 0);

  fsElement = null;
  dom.window.document.dispatchEvent(new win.Event('fullscreenchange'));
  assert.equal(receivedEvents.length, 3, 'exiting fullscreenchange without resize must dispatch geometrychange');
  assert.equal(receivedEvents[2]!.visible, true);
  assert.equal(receivedEvents[2]!.height, 36);

  // 2) 壳层 data-fullscreen 属性翻转（窗口尺寸不变）也必须异步触发 MutationObserver 派发 geometrychange
  dom.window.document.documentElement.setAttribute('data-fullscreen', '');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(wco.visible, false, 'fullscreen window must collapse titlebar overlay inset to 0');
  assert.equal(wco.getTitlebarAreaRect().height, 0);
  assert.equal(receivedEvents.length, 4, 'setting data-fullscreen must notify WCO subscribers');
  assert.equal(receivedEvents[3]!.target, wco);
  assert.equal(receivedEvents[3]!.height, 0);

  dom.window.document.documentElement.removeAttribute('data-fullscreen');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(wco.visible, true);
  assert.equal(wco.getTitlebarAreaRect().height, 36);
  assert.equal(receivedEvents.length, 5, 'removing data-fullscreen must notify WCO subscribers');
  assert.equal(receivedEvents[4]!.height, 36);

  wco.removeEventListener('geometrychange', onGeometry);
});

test('Issue #435: WCO shim stays inactive on shell recovery pages, child windows, and real native WCO', () => {
  // 1) 壳恢复页（html.eac-shell）不向宿主插件宣称 WCO 可见
  const shellEnv = createDomEnv({
    html: '<!doctype html><html class="eac-shell"><head></head><body><div>loading</div></body></html>',
    nativeWcoVisible: false,
  });
  runInNewContext(bridgeJs, {
    window: shellEnv.win,
    document: shellEnv.win.document,
    navigator: shellEnv.win.navigator,
    Event: shellEnv.win.Event,
    MutationObserver: shellEnv.win.MutationObserver,
    setInterval() {},
    setTimeout() {},
  });
  assert.equal(shellEnv.win.navigator.windowControlsOverlay.visible, false);
  assert.equal(shellEnv.win.navigator.windowControlsOverlay.getTitlebarAreaRect().height, 0);

  // 2) client-update 子窗口不安装主窗 36px WCO
  const updateEnv = createDomEnv({ windowLabel: 'client-update', nativeWcoVisible: false });
  runInNewContext(bridgeJs, {
    window: updateEnv.win,
    document: updateEnv.win.document,
    navigator: updateEnv.win.navigator,
    Event: updateEnv.win.Event,
    MutationObserver: updateEnv.win.MutationObserver,
    setInterval() {},
    setTimeout() {},
  });
  assert.equal(updateEnv.win.navigator.windowControlsOverlay.visible, false);

  // 3) 若未来宿主已激活原生 WCO（height=40, visible=true），桥绝不覆盖原生实现
  const nativeEnv = createDomEnv({ nativeWcoVisible: true });
  runInNewContext(bridgeJs, {
    window: nativeEnv.win,
    document: nativeEnv.win.document,
    navigator: nativeEnv.win.navigator,
    Event: nativeEnv.win.Event,
    MutationObserver: nativeEnv.win.MutationObserver,
    setInterval() {},
    setTimeout() {},
  });
  assert.equal(nativeEnv.win.navigator.windowControlsOverlay.getTitlebarAreaRect().height, 40);
});
