# dsh-overlay-guard

三处「透明/溢出元素叠在对话区上」的 UI 缺陷守卫。纯客户端插件（host 半边 no-op）：**只注入 CSS，不读写任何持久化状态，也不禁用任何功能入口**。

## 缺陷与修法

### 1. 右侧边栏 fullscreen 覆盖对话区

`@deepseek-ai/dsh-client-ui-sidebar-right` 的 `SidebarPanel` 在 fullscreen 下把宽度内联写成 `100vw`：

```js
style: {
  width: fullscreen ? "100vw" : width,
  "--dsh-sidebar-width": fullscreen ? "100vw" : `${width}px`
}
```

而面板本体只有 `position:absolute; top:0; bottom:0; right:0`，**没有 background**。面板铺满视口、内容透明，主内容区的对话文字就从背后透出来。

**缺的只是底色**，所以这里只补底色：全屏仍然是全屏，宽度、`--dsh-sidebar-width`、以及 `localStorage` 里的 `layout.mode` 都交给内核自己管。

```css
[data-sidebar-right-panel="fullscreen"][data-sidebar-right-open] {
  background-color: var(--dsh-overlay-guard-fill, var(--dsw-alias-bg-layer-1, #1e1f26)) !important;
}
```

两个限定缺一不可：

- `panel="fullscreen"` —— push 态本来就有底色，不该覆盖；
- `[data-sidebar-right-open]` —— 面板是**常驻**元素，收起时只是子节点 `translateX(var(--dsh-sidebar-width))` + `visibility: hidden` 移出视口。少这个限定，收起状态会在中间栏右缘画出一条空色块。

> 早期版本走的是「隐藏全屏按钮 + 把持久化的 `layout.mode` 从 `fullscreen` 改写成 `push`」。
> 那条路有不可逆的副作用：`layout.mode` 是用户自己的布局偏好（全屏是正常功能，不是脏数据），
> 插件改写后不可还原，卸载也不恢复，用户还无法区分这是自己设的还是插件改的。
> 缺陷在渲染层，修渲染就够了。

### 2. 弹层菜单没有遮罩

`MenuSurface`（`@deepseek-ai/dsh-client-ui-primitives`）用 `data-menu-material="translucent"` 标记材质，底色依赖主题 token。壁纸主题下该 token 拿不到不透明值，菜单文字与背后对话叠在一起。

`data-*` 本身已经是最小作用域，直接按属性补底色即可。

### 3. 标题栏压叠 / 顶栏文字竖排

会话标题栏是 `grid-template-columns: auto minmax(0,1fr)`，`leading / actions / utilities / corner` 都是 `flex:none` 且没有 `min-width: 0` / `overflow`。聊天区被右侧栏挤窄时子项既不收缩也不裁剪，直接溢出叠到相邻区域。

更隐蔽的一处：`.fZTkxG_label`（"标准模式"）自身已经写了 `nowrap + ellipsis + overflow:hidden`，看起来完全正确，但作为 flex 子项被压到 **2px 宽 × 22px 高**，渲染出来是一条竖线 —— 它缺的是 `flex-shrink: 0`。这类问题**只有量渲染后的盒子尺寸才看得出来**。

## 选择器契约

| 目标 | 选择器 | 依据 |
|------|--------|------|
| fullscreen 面板（展开时） | `[data-sidebar-right-panel="fullscreen"][data-sidebar-right-open]` | 内核稳定 `data-*` |
| 菜单材质 | `[data-menu-material="translucent"]` | primitives 稳定 `data-*`（菜单 Portal 到 `document.body`，不能加容器限定） |
| 会话标题栏 | `header:has(> [data-conversation-header-leading])` | 内核 `data-*` 结构锚点 |
| 顶栏动作容器 | `:is([class*="_headerActions"], …)`，**且被上面的 header 锚点限定** | 内核未提供 `data-*`，退回类名后缀 |

标题栏类规则全部以 `header:has(> [data-conversation-header-leading])` 开头，因此**只会命中真正的会话标题栏**，不会波及其它插件的 header 元素。`:has()` 需要 Chromium 105+（Electron 20+），这只客户端远高于该版本。

所有色值都能用变量覆盖：

```css
:root{
  --dsh-overlay-guard-fill: #1a1b21;          /* fullscreen 面板底色 */
  --dsh-overlay-guard-menu: rgba(22,23,28,.92); /* translucent 菜单底色 */
}
```

## 幂等与诊断

- 重复加载只保留一个 `<style id="dsh-overlay-guard/styles.css">`，内容变化时会就地刷新。
- 不读写 `localStorage` / `sessionStorage`：插件卸载即完全恢复原状。
- 目标缺失（上游已修）不报错，只在控制台留一条 `console.debug` 记录，列出 sidebar / fullscreen / menu / header 四个探测结果。

## 测试

```powershell
node --check lib/index.js
node --check lib/client.js
node tests/smoke.mjs
```

`tests/smoke.mjs` 用「访问即抛错」的 `localStorage` 替身，从这个角度保证插件永远不碰持久化状态；另外覆盖：注入与幂等、style 内容随版本刷新、fullscreen 规则只补底色不改宽度、不存在 `display:none` 的入口隐藏、标题栏规则必须以 `header:has(...)` 限定作用域、dispose 移除 style。

## 卸载

从 profile 的 `dsh.profile.bundles` 移除 `dsh-overlay-guard`，重启。没有改动任何 `@deepseek-ai/*` 文件，也没有留下一份被改写过的用户偏好。
