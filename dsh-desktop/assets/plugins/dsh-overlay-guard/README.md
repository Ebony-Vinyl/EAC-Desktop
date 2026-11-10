# dsh-overlay-guard

三处「透明元素叠在对话区上」的 UI 缺陷守卫。纯客户端插件（host 半边 no-op），只注入 CSS 并清洗一份 `localStorage` 状态，不改任何 `@deepseek-ai/*` 源码。

## 缺陷

### 1. 右侧边栏 fullscreen 覆盖对话区

`@deepseek-ai/dsh-client-ui-sidebar-right` 的 `SidebarPanel` 在 fullscreen 下：

```js
style: {
  width: fullscreen ? "100vw" : width,
  "--dsh-sidebar-width": fullscreen ? "100vw" : `${width}px`
}
```

而面板本体 `._6aOfsW_panel` 只有 `position:absolute; top:0; bottom:0; right:0`，**没有 background**。于是面板铺满视口、内容透明，主内容区的对话文字直接从背后透出。

fullscreen 状态持久化在 `dsh.sidebar-right.v1.<sessionId>`：

```json
{ "bySession": { "<sid>": { "layout": { "...": "...", "mode": "push" | "fullscreen" }, "minted": 3 } } }
```

只隐藏按钮无法阻止重启后恢复全屏，所以还要清洗持久化状态。

### 2. 弹层菜单没有遮罩

`MenuSurface`（`@deepseek-ai/dsh-client-ui-primitives`）用 `data-menu-material="translucent"` 标记材质，底色依赖主题 token。壁纸主题下该 token 拿不到不透明值，菜单文字与背后对话叠在一起。

### 3. 标题栏按钮压叠

会话标题栏：

```css
.uHSrHa_header{grid-template-columns:auto minmax(0,1fr)}
.uHSrHa_headerLeading{flex:none}
.uHSrHa_headerActions{flex:none}
.uHSrHa_headerUtilities{flex:none}
```

`flex:none` 且没有 `min-width:0` / `overflow`，聊天区被右侧栏挤窄时子项不收缩也不裁剪，直接溢出叠到相邻区域。

## 守卫

| 目标 | 选择器 | 依据 |
|------|--------|------|
| 全屏按钮 | `[data-sidebar-right-mode]` | 内核稳定 `data-*` |
| fullscreen 面板 | `[data-sidebar-right-panel="fullscreen"]` | 内核稳定 `data-*` |
| 菜单材质 | `[data-menu-material="translucent"]` | primitives 稳定 `data-*` |
| 标题栏 | `[class*="_headerActions"]` 等后缀 | CSS Module 后缀，不依赖 hash |

fullscreen 面板额外补 `background-color: var(--dsw-alias-bg-layer-1)` —— 即使有人通过命令面板 `pane.fullscreen.toggle` 重新进入全屏，面板也有底色、宽度也被压回正常。

所有色值都能用变量覆盖：

```css
:root{
  --dsh-overlay-guard-width: 44vw;
  --dsh-overlay-guard-fill: #1a1b21;
  --dsh-overlay-guard-menu: rgba(22,23,28,.92);
}
```

## 幂等与诊断

- 重复加载只保留一个 `<style id="dsh-overlay-guard/styles.css">`。
- `localStorage` 清洗只写回 `layout.mode` 一个枚举字段，不动 `nodes` / `tabs` / `sizes`。
- 目标缺失（上游已修）不报错，只在控制台留一条 `console.debug` 记录。

## 测试

```powershell
node --check lib/index.js
node --check lib/client.js
node tests/smoke.mjs
```

覆盖：注入、fullscreen 清洗（nodes/minted 保留）、已是 push 不改写、坏 JSON 不抛错、无关 key 不动、重复 apply 幂等、dispose 移除 style。

## 卸载

从 profile 的 `dsh.profile.bundles` 移除 `dsh-overlay-guard`，重启。没有改动任何 `@deepseek-ai/*` 文件。
