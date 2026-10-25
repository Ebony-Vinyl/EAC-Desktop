/**
 * dsh-external-links — 客户端半边：外链改走系统浏览器 + 登录授权页自动打开。
 *
 * 背景（桌面壳 Tauri / wry 0.55 · WebView2）：
 *   wry 只有在 webview 设置了 new_window_req_handler 时才会把
 *   `NewWindowRequested` 交出去；未设置时它对事件直接 `SetHandled(true)`，
 *   **既不建窗也不外跳** —— 也就是主窗里的 `window.open(...)` 与
 *   `<a target="_blank">` 全部被静默吞掉（wry webview2/mod.rs 的
 *   `else { args.SetHandled(true)? }` 分支）。桌面壳的主窗没有这条 handler
 *   （tauri-shell/src/main.rs 只给侧栏浏览器 guest 设了 on_new_window），于是：
 *     · 账号菜单「意见反馈」——`window.open(问卷 URL)` 无反应；
 *     · 账号设置页「打开」/「更多账号信息」——`<a target="_blank">` 无反应；
 *     · 侧栏「登录」——官方 Desktop 由 Electron main 负责把 authorizeUrl 交给
 *       系统浏览器，Tauri 壳没有这一层，弹窗只会停在「等待登录」。
 *
 * 本插件把这两件事收进内核页面本身（随任意客户端加载，不依赖壳内垫片）：
 *   1. 外链门：`window.open(url, ...)` 与 `<a target=_blank>` 的 http(s) **跨源**
 *      地址交给 `dshDesktop.openExternal`（桥在，壳执行 ShellExecuteW）。
 *      同源地址（内嵌预览、皮肤资产、文档 PDF viewer）保持原生行为不劫持；
 *      `window.open()` 无参形态（终端 xterm 的弹出窗）也不劫持。
 *   2. 登录门：订阅 account 流，attempt 进入 `waiting-browser` 时按 attempt.id
 *      去重打开一次 authorizeUrl —— 等价于官方 Electron main 的职责。
 *      打不开（桥缺失 / 宿主拒绝）时静默，弹窗里的「复制登录链接」仍然可用。
 *
 * 契约：client bundle 的 factory 返回 { inject, apply }，浏览器端 cordis runner
 * 会调用 apply(ctx)（同 dsh-viewport-lock 的最小形状）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-external-links',
  factory: function (require) {
    var inject = [];

    /** 幂等标记：插件热重载 / 重放时不重复包装 window.open。 */
    var GLOBAL_KEY = '__dshEacExternalLinks';
    /** waiting-browser 已打开过的 attempt.id（同一次尝试只开一个浏览器页）。 */
    var OPENED_ATTEMPTS = '__dshEacExternalLinksOpened';
    /** 只允许这两种协议进系统浏览器（与壳层 open_external 的放行纪律一致）。 */
    var WEB_PROTOCOLS = { 'http:': true, 'https:': true };

    function desktopBridge() {
      try {
        var bridge = globalThis.dshDesktop;
        return bridge && typeof bridge.openExternal === 'function' ? bridge : null;
      } catch (_error) {
        return null;
      }
    }

    /** 应用自身的 origin（同源地址不是「外链」，不劫持）。 */
    function appOrigin() {
      try {
        return new URL(String(location.href)).origin;
      } catch (_error) {
        return null;
      }
    }

    function isExternalWebUrl(value) {
      var url;
      try {
        url = new URL(String(value), location.href);
      } catch (_error) {
        return false;
      }
      if (WEB_PROTOCOLS[url.protocol] !== true) return false;
      var own = appOrigin();
      return own === null || url.origin !== own;
    }

    /**
     * 交给壳层打开。返回 false 表示桥不可用 —— 调用方回退到原生行为，
     * 绝不因为插件存在而让本来能工作的路径失效。
     */
    function openInSystemBrowser(url) {
      var bridge = desktopBridge();
      if (bridge === null) return false;
      var pending;
      try {
        pending = bridge.openExternal(url);
      } catch (_error) {
        return false;
      }
      if (pending && typeof pending.catch === 'function') pending.catch(function () {});
      return true;
    }

    // ---- 1. window.open 门 ----
    function installWindowOpenGate() {
      var nativeOpen = window.open;
      if (typeof nativeOpen !== 'function') return function () {};
      var gated = function (url, target, features) {
        // 无参 / 非字符串：终端 xterm 等用窗口句柄写内容，必须保持原生。
        if (typeof url === 'string' && url !== '' && isExternalWebUrl(url) && openInSystemBrowser(url)) return null;
        return nativeOpen.apply(window, arguments);
      };
      window.open = gated;
      return function () {
        if (window.open === gated) window.open = nativeOpen;
      };
    }

    // ---- 2. <a target=_blank> 门 ----
    // 账号设置页「打开」（授权链接）与「更多账号信息」是原生锚点，不经过
    // window.open。捕获阶段拦一次，避免内核的链接组件再走一遍导航。
    function installAnchorGate() {
      var onClick = function (event) {
        if (!event || event.defaultPrevented) return;
        if (event.button !== undefined && event.button !== 0) return;
        // 带修饰键的点击是「新窗口/新标签」的用户意图，但不是我们能提供的
        // 语义 —— 仍然走系统浏览器，但不要在这里吞掉别的逻辑。
        var node = event.target;
        var anchor = node && typeof node.closest === 'function' ? node.closest('a[href]') : null;
        if (!anchor) return;
        var target = String(anchor.getAttribute('target') || '').toLowerCase();
        if (target !== '_blank' && target !== '_new') return;
        var href = anchor.getAttribute('href');
        if (!href || href.charAt(0) === '#') return;
        if (!isExternalWebUrl(href)) return;
        if (!openInSystemBrowser(anchor.href)) return;
        event.preventDefault();
        event.stopPropagation();
      };
      document.addEventListener('click', onClick, true);
      return function () {
        document.removeEventListener('click', onClick, true);
      };
    }

    // ---- 3. 登录授权页自动打开 ----
    // ctx.remote.account.watch 推的是完整 AccountView，attempt 里带 authorizeUrl。
    // 每一帧都要 accept()（流控回执），否则后续帧不再下发。
    function installSignInOpener(ctx) {
      var stream;
      try {
        stream = ctx.remote.$stream({
          name: 'account',
          open: function (signal) {
            return ctx.remote.account.watch(signal);
          },
          ended: function () {
            return new Error('account stream ended');
          },
        });
      } catch (_error) {
        // 宿主没有 account 面（非 Desktop 组合）：外链门继续有效。
        return function () {};
      }

      var opened = globalThis[OPENED_ATTEMPTS] || (globalThis[OPENED_ATTEMPTS] = Object.create(null));
      var openAttempt = function (attempt) {
        if (!attempt || attempt.phase !== 'waiting-browser') return;
        var url = attempt.authorizeUrl;
        if (typeof url !== 'string' || url === '') return;
        var key = String(attempt.id || url);
        if (opened[key] === true) return;
        opened[key] = true;
        if (!openInSystemBrowser(url)) delete opened[key];
      };

      (async function () {
        try {
          for await (var frame of stream) {
            try {
              openAttempt(frame && frame.value && frame.value.attempt);
            } finally {
              if (frame && typeof frame.accept === 'function') frame.accept();
            }
          }
        } catch (_error) {
          // 流断开（重连 / 宿主退出）：下次插件加载会重新订阅。
        }
      })();

      return function () {
        try {
          stream.dispose();
        } catch (_error) {}
      };
    }

    function apply(ctx) {
      if (typeof window === 'undefined' || typeof document === 'undefined') return;

      ctx.effect(function () {
        if (globalThis[GLOBAL_KEY] === true) return function () {};
        globalThis[GLOBAL_KEY] = true;
        var disposers = [installWindowOpenGate(), installAnchorGate()];
        return function () {
          globalThis[GLOBAL_KEY] = false;
          for (var i = 0; i < disposers.length; i += 1) {
            try {
              disposers[i]();
            } catch (_error) {}
          }
        };
      }, 'external-links: system browser gate');

      ctx.inject(['remote', 'remote.account'], function (scope) {
        scope.effect(function () {
          return installSignInOpener(scope);
        }, 'external-links: sign-in authorize page');
      });
    }

    var module = { exports: {} };
    module.exports = {
      inject: inject,
      apply: apply,
      __internals: {
        isExternalWebUrl: isExternalWebUrl,
        openInSystemBrowser: openInSystemBrowser,
        installWindowOpenGate: installWindowOpenGate,
        installAnchorGate: installAnchorGate,
      },
    };
    return module.exports;
  },
});
