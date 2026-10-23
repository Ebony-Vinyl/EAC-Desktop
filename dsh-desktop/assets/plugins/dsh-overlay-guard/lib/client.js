// dsh-overlay-guard — 浏览器半边。
//
// 三处「透明元素叠在对话区上」的缺陷，全部用稳定契约（data-* / 结构后缀）
// 选择，不依赖构建哈希：
//
//   1) 右侧边栏 fullscreen：SidebarPanel 在 fullscreen 下把 width 与
//      --dsh-sidebar-width 内联写成 100vw，而面板本体没有背景，主内容区的
//      对话文字会从其背后透出。这里隐藏切换按钮、清洗持久化状态、并给
//      fullscreen 面板加宽度兜底与底色兜底。
//   2) 弹层遮罩：MenuSurface 的 translucent 材质在壁纸主题下拿不到不透明
//      底色，菜单文字与背后对话叠在一起。
//   3) 标题栏压叠：会话标题栏是 auto + minmax(0,1fr) 的 grid，leading /
//      actions / utilities 都是 flex:none；聊天区被挤窄时不收缩也不裁剪，
//      溢出叠到相邻区域。
//
// 幂等：重复加载只保留一个 style 节点、一次 localStorage 清洗。
// 诊断：目标不存在时不报错（上游可能已修好），仅在控制台留一条 debug 记录。
window.__ModuleLoader__.load({
  id: 'dsh-overlay-guard',
  factory: () => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const PLUGIN_ID = 'dsh-overlay-guard'
    const STYLE_ID = 'dsh-overlay-guard/styles.css'
    const STATE_KEY = '__dshOverlayGuardV1'
    const PERSIST_PREFIX = 'dsh.sidebar-right.v1.'

    // 46vw 是 push 模式的常见宽度；面板真实宽度由 layout store 计算，不持久化
    // 在 sidebar-right 里，这里只能用可覆盖的兜底值。
    const FALLBACK_WIDTH = 'min(46vw, 920px)'

    const STYLE_TEXT = [
      // 1) 右侧栏 fullscreen 切换按钮
      '[data-sidebar-right-mode] {',
      '  display: none !important;',
      '}',
      // 1b) fullscreen 面板宽度兜底（内联 width:100vw 没有 !important，可被覆盖）
      '[data-sidebar-right-panel="fullscreen"] {',
      `  width: var(--dsh-overlay-guard-width, ${FALLBACK_WIDTH}) !important;`,
      `  --dsh-sidebar-width: var(--dsh-overlay-guard-width, ${FALLBACK_WIDTH}) !important;`,
      '  background-color: var(--dsh-overlay-guard-fill, var(--dsw-alias-bg-layer-1, #1e1f26)) !important;',
      '}',
      // 2) 弹层 translucent 遮罩
      '[data-menu-material="translucent"] {',
      '  background-color: var(--dsh-overlay-guard-menu, rgba(22, 23, 28, 0.92)) !important;',
      '}',
      'body:not([data-ds-dark-theme]) [data-menu-material="translucent"] {',
      '  background-color: var(--dsh-overlay-guard-menu, rgba(250, 250, 252, 0.95)) !important;',
      '}',
      // 3) 标题栏溢出压叠：grid 两列都允许收缩到 0；四组子容器允许收缩并裁剪。
      //    只加 overflow 不够 —— auto 列不收缩时，第二列被压到 0，corner 仍会溢出。
      '[class*="_header"] {',
      '  grid-template-columns: minmax(0, auto) minmax(0, 1fr) !important;',
      '}',
      '[class*="_headerLeading"],',
      '[class*="_headerActions"],',
      '[class*="_headerUtilities"],',
      '[class*="_headerCorner"] {',
      '  min-width: 0 !important;',
      '  flex-shrink: 1 !important;',
      '  overflow: hidden !important;',
      '}',
      // 3b) 右侧栏内部容器也不许把内容顶出面板边界。
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
      //    统一处理而不是逐个救火：用 :is() 一次覆盖顶栏三组容器，
      //    并把 flex-shrink 归零，避免文字被压扁而不是截断。
      ':is([class*="_headerActions"], [class*="_headerUtilities"], [class*="_headerCorner"]) [class*="_trigger"] {',
      '  min-width: 0 !important;',
      '  white-space: nowrap !important;',
      '}',
      ':is([class*="_headerActions"], [class*="_headerUtilities"], [class*="_headerCorner"]) [class*="_triggerLabel"],',
      ':is([class*="_headerActions"], [class*="_headerUtilities"], [class*="_headerCorner"]) [class*="_count"],',
      ':is([class*="_headerActions"], [class*="_headerUtilities"], [class*="_headerCorner"]) [class*="_label"] {',
      '  white-space: nowrap !important;',
      '  overflow: hidden !important;',
      '  text-overflow: ellipsis !important;',
      '  min-width: 0 !important;',
      '  flex-shrink: 0 !important;',
      '}',
    ].join('\n')

    /**
     * 把持久化布局里的 layout.mode:"fullscreen" 改回 "push"。
     * 只改这一个枚举字段，不触碰 nodes/tabs/sizes —— sidebar-right 的
     * validateReferences 只校验引用完整性，改枚举不会破坏它。
     * @returns {number} 被修正的 storage key 数量。
     */
    function clearPersistedFullscreen() {
      if (typeof localStorage === 'undefined') return 0
      let changed = 0
      const keys = []
      try {
        for (let i = 0; i < localStorage.length; i += 1) {
          const key = localStorage.key(i)
          if (key && key.indexOf(PERSIST_PREFIX) === 0) keys.push(key)
        }
      } catch {
        return 0
      }
      for (const key of keys) {
        let raw
        try {
          raw = localStorage.getItem(key)
        } catch {
          continue
        }
        if (!raw) continue
        let data
        try {
          data = JSON.parse(raw)
        } catch {
          continue
        }
        const bySession = data && data.bySession
        if (!bySession || typeof bySession !== 'object') continue
        let touched = false
        for (const sid of Object.keys(bySession)) {
          const entry = bySession[sid]
          if (entry && entry.layout && entry.layout.mode === 'fullscreen') {
            entry.layout.mode = 'push'
            touched = true
          }
        }
        if (touched) {
          try {
            localStorage.setItem(key, JSON.stringify(data))
            changed += 1
          } catch {
            // 写入失败时保留原样，CSS 兜底仍然生效。
          }
        }
      }
      return changed
    }

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
      const fixed = clearPersistedFullscreen()

      // 目标缺失（上游已修）不报错，只留一条可检索的 debug 记录。
      if (typeof console !== 'undefined' && typeof console.debug === 'function') {
        const hasSidebar = document.querySelector('[data-sidebar-right-panel]') !== null
        const hasMenu = document.querySelector('[data-menu-material]') !== null
        console.debug(`[${PLUGIN_ID}] installed; persisted-fullscreen-fixed=${fixed}; sidebar=${hasSidebar}; menu=${hasMenu}`)
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
