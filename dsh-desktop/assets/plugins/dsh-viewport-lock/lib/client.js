/**
 * dsh-viewport-lock — browser half: 视口钳制（文档级滚动根治）。
 *
 * 背景（老毛病：hero 输入卡底部被裁 + 窗口出现横/纵双滚动条）：
 *   - 内核视口链 html,body,#root{height:100%} 本身干净，但 html/body 无任何
 *     overflow 钳制；hero 态 scrollBody 用 justify-content:center 居中内容，
 *     内容高于视口时溢出会沿包含链一路漏到文档层，出现文档级滚动条，
 *     且 flex 居中溢出的上/下两端都可能滚不到（经典 flexbox centering 陷阱）。
 *   - 旧修复（壳 sidecar bridge 注入的 CSS）锚定 CSS Modules 哈希类
 *     （.wSkVaW_* 等），内核前端更新换哈希即静默失效；且只在桌面壳 WebView
 *     注入 —— 浏览器打开、手机端、垫片未生效的桌面会话全部裸奔。
 *
 * 根治思路：把修复放进内核页面本身（本插件随任意客户端加载），且只锚定
 * 稳定契约（data-* 属性与元素 id，非构建哈希）：
 *   1. 文档级滚动钳制 —— html/body overflow:hidden。内核全部滚动面
 *      （会话流 scrollBody、侧边栏、设置页、弹层内部）都是内部滚动容器，
 *      文档滚动条从来不是任何功能的载体；钳死文档层不影响任何交互，
 *      仅消灭「文档被撑出滚动条」这一整类症状。打印场景除外（print 媒体
 *      下还原，避免打印被裁）。
 *   2. hero 居中兜底 —— 与壳垫片同语义、改锚稳定契约
 *      [data-phase="hero"] [data-conversation-scroll]（滚动容器自带属性，
 *      非哈希）：放得下时 margin-block:auto 依旧视觉居中，放不下时从顶
 *      排布、scrollBody 自身可滚，输入卡永远可达。
 *   3. active 输入区透明裁切 —— composerSeat 是 scrollBody 内的 sticky
 *      元素，原生流已经为其保留高度，但滚动中的消息会从透明输入区后方
 *      透出。保持 seat 完全透明，按 viewArea 底边与 seat 顶边的实时距离
 *      裁掉越界消息；同时将 seat 高度写入 scroll-padding-bottom。不叠加
 *      第二份 padding，避免底部双倍空白。
 *
 * 契约：client bundle 的 factory 返回 { inject, apply }，浏览器端 cordis
 * runner 会调用 apply(ctx)（同 dsh-file-drop-eac 的最小形状）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-viewport-lock',
  factory: function (require) {
    var inject = [];

    var CSS = [
      // 1) 文档级滚动钳制：app 外壳永不出滚动条（内核所有滚动面均为内部容器）。
      'html, body{overflow:hidden!important;height:100%!important}',
      // 2) hero 居中兜底（稳定契约；与壳垫片同语义）：内容高于视口时从顶排布
      //    且 scrollBody 自身可滚，flex 居中溢出导致的「上/下都滚不到」消失。
      'html [data-phase="hero"] [data-conversation-scroll]{justify-content:flex-start!important}',
      'html [data-phase="hero"] [data-conversation-scroll] > *{margin-block:auto!important}',
      // 3) active 输入区安全面：动态 scroll-padding 负责程序化滚动落点；
      //    消息视图只裁掉进入透明 sticky 输入区范围的像素，背景保持可见。
      'html [data-phase="active"] [data-conversation-scroll]{scroll-padding-bottom:var(--dsh-composer-safe-height,0px)}',
      'html [data-dsh-composer-clip]{clip-path:inset(0 0 var(--dsh-composer-clip-bottom,0px) 0)}',
      // Fixed popovers use viewport coordinates. A transform containing block
      // on the sticky seat makes even hidden popovers enlarge the scroll range.
      'html [data-composer-seat]{will-change:auto!important}',
      // Native caret reveal honors ancestor scroll-padding. The focused editor
      // already sits inside the reserved sticky area; counting it twice scrolls
      // the conversation on every keystroke. Keep the reserve for navigation.
      'html [data-conversation-scroll]:has([data-composer-seat] [data-composer-input]:focus,[data-composer-seat] textarea:focus){scroll-padding-bottom:0px!important}',
      // 4) 打印还原：overflow 钳制只服务屏幕 app 外壳，打印需要文档流。
      '@media print{html, body{overflow:visible!important;height:auto!important}}',
    ].join('');

    var STYLE_ID = 'dsh-viewport-lock';
    var SCROLL_SELECTOR = '[data-conversation-scroll]';
    var SEAT_SELECTOR = '[data-composer-seat]';
    var SESSION_VIEW_SELECTOR = '[data-slot="conversation.session"] > :first-child';
    var SAFE_HEIGHT_PROPERTY = '--dsh-composer-safe-height';
    var CLIP_ATTRIBUTE = 'data-dsh-composer-clip';
    var CLIP_BOTTOM_PROPERTY = '--dsh-composer-clip-bottom';

    function injectStyle() {
      if (typeof document === 'undefined') return;
      var existing = document.getElementById(STYLE_ID);
      if (existing) {
        existing.textContent = CSS;
        // 被皮肤/热重载移除后补挂（同 font-custom 的兜底策略）。
        if (!document.head.contains(existing)) document.head.appendChild(existing);
        return;
      }
      var tag = document.createElement('style');
      tag.id = STYLE_ID;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    function composerHeight(seat) {
      if (!seat || typeof seat.getBoundingClientRect !== 'function') return 0;
      var value = Number(seat.getBoundingClientRect().height);
      return Number.isFinite(value) && value > 0 ? Math.ceil(value) : 0;
    }

    function installComposerSafeArea() {
      if (typeof document === 'undefined') return function () {};
      var bindings = new Map();
      var managedScrolls = new Set();
      var managedViews = new Set();
      var scrollListeners = new Set();
      var disposed = false;
      var frame = 0;
      var ResizeObserverCtor = window.ResizeObserver;
      var MutationObserverCtor = window.MutationObserver;
      var requestFrame = typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame.bind(window)
        : function (callback) { callback(); return 0; };
      var cancelFrame = typeof window.cancelAnimationFrame === 'function'
        ? window.cancelAnimationFrame.bind(window)
        : function () {};

      function clearBinding(seat) {
        var binding = bindings.get(seat);
        if (!binding) return;
        if (binding.resizeObserver) binding.resizeObserver.disconnect();
        bindings.delete(seat);
      }

      function ensureScrollListener(scroll) {
        if (scrollListeners.has(scroll)) return;
        scroll.addEventListener('scroll', scheduleSync, { passive: true });
        scrollListeners.add(scroll);
      }

      function clearView(view) {
        view.style.removeProperty(CLIP_BOTTOM_PROPERTY);
        view.removeAttribute(CLIP_ATTRIBUTE);
      }

      function syncBindings() {
        frame = 0;
        if (disposed) return;
        var seen = new Set();
        var surfaces = new Map();
        var seats = document.querySelectorAll(SEAT_SELECTOR);
        for (var i = 0; i < seats.length; i += 1) {
          var seat = seats[i];
          var scroll = typeof seat.closest === 'function' ? seat.closest(SCROLL_SELECTOR) : null;
          if (!scroll || !scroll.style) continue;
          seen.add(seat);

          var binding = bindings.get(seat);
          if (!binding || binding.scroll !== scroll) {
            if (binding) clearBinding(seat);
            binding = { seat: seat, scroll: scroll, resizeObserver: null };
            if (typeof ResizeObserverCtor === 'function') {
              binding.resizeObserver = new ResizeObserverCtor(scheduleSync);
              binding.resizeObserver.observe(seat);
            }
            bindings.set(seat, binding);
          }
          var height = composerHeight(seat);
          var rect = seat.getBoundingClientRect();
          var surface = surfaces.get(scroll);
          if (!surface) {
            surface = {
              height: 0,
              seatTop: Number.POSITIVE_INFINITY,
              view: scroll.querySelector(SESSION_VIEW_SELECTOR),
            };
            surfaces.set(scroll, surface);
          }
          if (height > surface.height) surface.height = height;
          if (Number.isFinite(rect.top) && rect.top < surface.seatTop) surface.seatTop = rect.top;
        }

        var stale = [];
        bindings.forEach(function (_binding, seat) {
          if (!seen.has(seat)) stale.push(seat);
        });
        for (var j = 0; j < stale.length; j += 1) clearBinding(stale[j]);

        managedScrolls.forEach(function (scroll) {
          if (surfaces.has(scroll)) return;
          scroll.style.removeProperty(SAFE_HEIGHT_PROPERTY);
          if (scrollListeners.has(scroll)) {
            scroll.removeEventListener('scroll', scheduleSync);
            scrollListeners.delete(scroll);
          }
        });
        var activeViews = new Set();
        surfaces.forEach(function (surface, scroll) {
          if (surface.height > 0) {
            scroll.style.setProperty(SAFE_HEIGHT_PROPERTY, surface.height + 'px');
          } else {
            scroll.style.removeProperty(SAFE_HEIGHT_PROPERTY);
          }
          ensureScrollListener(scroll);

          var view = surface.view;
          if (!view || !view.style || !Number.isFinite(surface.seatTop)) return;
          var viewRect = view.getBoundingClientRect();
          var clipBottom = Math.max(
            0,
            Math.min(
              Math.ceil(Math.max(0, viewRect.height)),
              Math.ceil(viewRect.bottom - surface.seatTop),
            ),
          );
          view.setAttribute(CLIP_ATTRIBUTE, '');
          view.style.setProperty(CLIP_BOTTOM_PROPERTY, clipBottom + 'px');
          activeViews.add(view);
        });
        managedViews.forEach(function (view) {
          if (!activeViews.has(view)) clearView(view);
        });
        managedViews = activeViews;
        managedScrolls = new Set(surfaces.keys());
      }

      function scheduleSync() {
        if (disposed || frame) return;
        frame = requestFrame(syncBindings);
      }

      var mutationObserver = null;
      if (typeof MutationObserverCtor === 'function' && document.documentElement) {
        mutationObserver = new MutationObserverCtor(scheduleSync);
        mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
      }
      window.addEventListener('resize', scheduleSync);
      syncBindings();

      return function () {
        disposed = true;
        if (frame) cancelFrame(frame);
        if (mutationObserver) mutationObserver.disconnect();
        window.removeEventListener('resize', scheduleSync);
        scrollListeners.forEach(function (scroll) {
          scroll.removeEventListener('scroll', scheduleSync);
        });
        scrollListeners.clear();
        managedScrolls.forEach(function (scroll) {
          scroll.style.removeProperty(SAFE_HEIGHT_PROPERTY);
        });
        managedViews.forEach(clearView);
        var seats = Array.from(bindings.keys());
        for (var i = 0; i < seats.length; i += 1) clearBinding(seats[i]);
        managedScrolls.clear();
        managedViews.clear();
      };
    }

    function apply() {
      injectStyle();
      var disposeSafeArea = installComposerSafeArea();
      // 首挂时机竞态兜底：apply 可能在 body 就绪前执行，readyState 变化后补一次；幂等。
      var onReady = injectStyle;
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onReady, { once: true });
      }
      return function () {
        disposeSafeArea();
        document.removeEventListener('DOMContentLoaded', onReady);
        var style = document.getElementById(STYLE_ID);
        if (style) style.remove();
      };
    }

    var module = { exports: {} };
    module.exports = {
      inject: inject,
      apply: apply,
      __internals: {
        CSS: CSS,
        composerHeight: composerHeight,
        installComposerSafeArea: installComposerSafeArea,
      },
    };
    return module.exports;
  },
});
