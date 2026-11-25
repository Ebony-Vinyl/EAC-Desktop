// dsh-overlay-guard — 浏览器半边。
//
// 三处「透明/溢出叠在对话区上」的缺陷，全部用稳定契约（data-* 属性、结构锚点）
// 选择，不依赖构建哈希，也**绝不读写任何持久化状态**：
//
//   1) 右侧边栏 fullscreen：SidebarPanel 在 fullscreen 下把 width 与
//      --dsh-sidebar-width 内联写成 100vw，而面板本体没有背景，主内容区的
//      对话文字从背后透出。缺的只是底色，所以这里只补底色 ——
//      全屏仍然是全屏，不降级、不禁用、不改用户偏好。
//   2) 弹层遮罩：MenuSurface 的 translucent 材质在壁纸主题下拿不到不透明
//      底色，菜单文字与背后对话叠在一起。
//   3) 标题栏压叠 / 顶栏文字竖排：会话标题栏是 auto + minmax(0,1fr) 的 grid，
//      leading / actions / utilities / corner 都是 flex:none；聊天区被挤窄时
//      既不收缩也不裁剪。所有标题栏规则都用
//      `header:has(> [data-conversation-header-leading])` 锚定在会话标题栏内，
//      不会波及其它插件的 header 元素。
//
// 为什么不沿用「隐藏全屏按钮 + 清洗 localStorage」：
//   layout.mode 是用户自己的布局偏好（fullscreen 也是产品的正常功能），
//   插件改写后不可还原、卸载也不恢复，用户还无法区分是自己设的还是插件改的。
//   缺陷出在渲染（没有底色），修渲染即可，不需要动数据，也不需要禁用入口。
//
// 幂等：重复加载只保留一个 style 节点。
// 诊断：目标不存在时不报错（上游可能已修好），仅留一条 debug 记录。

window.__ModuleLoader__.load({
  id: 'dsh-overlay-guard',
  factory: () => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const PLUGIN_ID = 'dsh-overlay-guard'
    const STYLE_ID = 'dsh-overlay-guard/styles.css'
    const STATE_KEY = '__dshOverlayGuardV1'

    // 会话标题栏的结构锚点：只有真正的会话 header 才同时满足
    // 「header 元素」+「直接子节点带 data-conversation-header-leading」。
    // 内核在 ConversationRoot 里就是这么渲染的（data-conversation-header-leading /
    // data-conversation-header-corner 是比 CSS Module 后缀更稳的契约）。
    const HEADER_SCOPE = 'header:has(> [data-conversation-header-leading])'

    // 顶栏里的三组动作容器。内核没有给它们 data-*，只能退回到
    // CSS Module 的类名后缀；但整个选择器已被 HEADER_SCOPE 限定在会话标题栏内，
    // 不会再命中其它插件的 header。
    const HEADER_SLOTS =
      ':is([class*="_headerActions"], [class*="_headerUtilities"], [data-conversation-header-corner])'

    const STYLE_TEXT = [
      // 1) fullscreen 面板：只补底色。
      //    两个限定缺一不可：
      //      - panel="fullscreen"：只在全屏态补，push 态本来就有底色；
      //      - [data-sidebar-right-open]：面板是**常驻**元素，收起时只是子节点
      //        translateX + visibility:hidden 移出视口；不加这个限定，收起状态会在
      //        中间栏右缘画出一条空色块。
      //    宽度与 --dsh-sidebar-width 保持内核写入的 100vw（全屏本来就是全屏）。
      '[data-sidebar-right-panel="fullscreen"][data-sidebar-right-open] {',
      '  background-color: var(--dsh-overlay-guard-fill, var(--dsw-alias-bg-layer-1, #1e1f26)) !important;',
      '}',
      // 2) 弹层 translucent 遮罩：data-* 本身已是最小作用域，无需再限定。
      '[data-menu-material="translucent"] {',
      '  background-color: var(--dsh-overlay-guard-menu, rgba(22, 23, 28, 0.92)) !important;',
      '}',
      'body:not([data-ds-dark-theme]) [data-menu-material="translucent"] {',
      '  background-color: var(--dsh-overlay-guard-menu, rgba(250, 250, 252, 0.95)) !important;',
      '}',
      // 3) 会话标题栏：grid 两列都允许收缩到 0。
      //    只加 overflow 不够 —— auto 列不收缩时，第二列被压到 0，corner 仍会溢出。
      `${HEADER_SCOPE} {`,
      '  grid-template-columns: minmax(0, auto) minmax(0, 1fr) !important;',
      '}',
      `${HEADER_SCOPE} > [data-conversation-header-leading],`,
      `${HEADER_SCOPE} [data-conversation-header-corner],`,
      `${HEADER_SCOPE} [class*="_headerActions"],`,
      `${HEADER_SCOPE} [class*="_headerUtilities"] {`,
      '  min-width: 0 !important;',
      '  overflow: hidden !important;',
      '}',
      // 3b) 右侧栏内部容器也不许把内容顶出面板边界（data-* 已限定作用域）。
      '[data-sidebar-right-panel] [data-dockkit-host],',
      '[data-sidebar-right-panel] [data-dockkit-pane] {',
      '  min-width: 0 !important;',
      '}',
      // 4) 顶栏文字控件：聊天区被挤窄时逐字竖排。
      //    已知三处同构缺陷，都是 inline-flex 且没有 white-space:nowrap：
      //      - 智能体团队  .bl0tdG_trigger > .bl0tdG_triggerLabel
      //      - 后台任务    .MCnNHW_trigger > .MCnNHW_count
      //      - 预设标签    .fZTkxG_label —— 自身已带 nowrap+ellipsis，但缺
      //                    flex-shrink:0，在 flex 行里被压成 2px 宽的一条竖线
      //    （这条只有量实际尺寸才能发现，光读 CSS 看不出来）
      `${HEADER_SCOPE} ${HEADER_SLOTS} [class*="_trigger"] {`,
      '  min-width: 0 !important;',
      '  white-space: nowrap !important;',
      '}',
      `${HEADER_SCOPE} ${HEADER_SLOTS} [class*="_triggerLabel"],`,
      `${HEADER_SCOPE} ${HEADER_SLOTS} [class*="_count"],`,
      `${HEADER_SCOPE} ${HEADER_SLOTS} [class*="_label"] {`,
      '  white-space: nowrap !important;',
      '  overflow: hidden !important;',
      '  text-overflow: ellipsis !important;',
      '  min-width: 0 !important;',
      // 关键：被压扁（2px 宽）与按 ellipsis 截断是两种完全不同的渲染结果
      '  flex-shrink: 0 !important;',
      '}',
    ].join('\n')

    function ensureStyle() {
      if (typeof document === 'undefined') return null
      let tag = document.getElementById(STYLE_ID)
      if (tag === null) {
        tag = document.createElement('style')
        tag.id = STYLE_ID
        tag.setAttribute('data-dsh-plugin', PLUGIN_ID)
        tag.textContent = STYLE_TEXT
        ;(document.head || document.documentElement).appendChild(tag)
      } else if (tag.textContent !== STYLE_TEXT) {
        tag.textContent = STYLE_TEXT
      }
      return tag
    }

    function install() {
      if (typeof document === 'undefined') return () => {}
      const style = ensureStyle()

      // 目标缺失（上游已修）不报错，只留一条可检索的 debug 记录。
      if (typeof console !== 'undefined' && typeof console.debug === 'function') {
        const hasSidebar = document.querySelector('[data-sidebar-right-panel]') !== null
        const hasFullscreen = document.querySelector('[data-sidebar-right-panel="fullscreen"]') !== null
        const hasMenu = document.querySelector('[data-menu-material]') !== null
        const hasHeader = document.querySelector('[data-conversation-header-leading]') !== null
        console.debug(
          `[${PLUGIN_ID}] installed; sidebar=${hasSidebar}; fullscreen=${hasFullscreen}; menu=${hasMenu}; header=${hasHeader}`,
        )
      }

      let disposed = false
      const dispose = () => {
        if (disposed) return
        disposed = true
        if (style && style.parentNode) style.parentNode.removeChild(style)
        if (window[STATE_KEY] && window[STATE_KEY].dispose === dispose) {
          delete window[STATE_KEY]
        }
      }
      window[STATE_KEY] = { dispose, version: 1 }
      return dispose
    }

    exports.apply = install
    exports.inject = []
    return module.exports
  },
})
