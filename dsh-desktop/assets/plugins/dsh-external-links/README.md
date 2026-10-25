# dsh-external-links

主窗里的**外链**改走系统浏览器，并让 DeepSeek 登录授权页在发起登录时自动打开一次。

## 为什么需要它

桌面壳是 Tauri + wry + WebView2。wry 只有在 webview 装了 `new_window_req_handler`
时才会把 `NewWindowRequested` 交出去；**没装时它对事件直接 `SetHandled(true)`**，
既不建窗也不外跳（`wry-0.55.1/src/webview2/mod.rs`）。壳的主窗没有装这条 handler
（`tauri-shell/src/main.rs` 只给侧栏浏览器的 guest webview 设了 `on_new_window`），
于是主窗里所有新窗请求都被静默吞掉：

| 入口 | 实现 | 现象 |
| --- | --- | --- |
| 账号菜单「意见反馈」 | `window.open(问卷 URL, "_blank")` | 点了没反应 |
| 账号设置页「打开」/「更多账号信息」 | `<a target="_blank">` | 点了没反应 |
| 对话里点外链 | `window.open(url, "_blank")` | 点了没反应 |
| 侧栏「登录」 | 官方 Desktop 由 Electron main 把 `authorizeUrl` 交给系统浏览器；Tauri 壳没有这一层 | 弹窗停在「等待登录」，浏览器不打开 |

## 做什么

1. **外链门**：`window.open(跨源 http(s))` 与 `<a target="_blank">` 的跨源 http(s)
   地址改由 `dshDesktop.openExternal` 执行（壳里是 `ShellExecuteW`）。
   - 同源地址（内嵌预览、皮肤资产、文档 PDF viewer）**不劫持**，保持原生行为；
   - `window.open()` 无参形态（终端 xterm 的弹窗）**不劫持**；
   - 桥不可用时**回退**到原生调用，插件不会让本来能用的路径失效。
2. **登录门**：订阅 `ctx.remote.account.watch`，`attempt.phase === "waiting-browser"`
   时按 `attempt.id` 去重打开 `attempt.authorizeUrl`。同一次尝试只开一个页；
   重新登录（新 id）会再开一次。打不开时静默，弹窗里的「复制登录链接」仍可用。

## 契约

- 纯客户端插件：`lib/index.js` 是 no-op 的 host 半边（loader 需要 `name/inject/apply`）。
- 客户端 bundle 形如 `dsh-viewport-lock`：`factory` 返回 `{ inject, apply }`，
  `inject = []`（不阻塞任何服务，外链门无条件安装；account 服务用
  `ctx.inject([...])` 延迟接入）。
- 卸载时还原 `window.open`、注销 click 监听、`dispose()` account 流。

## 测试

```powershell
node tests/smoke.mjs
```

在 `node:vm` 沙箱里跑真实的 `lib/client.js`：假 `window/document/location/dshDesktop`，
断言外链接管、同源与无参不劫持、登录授权页按 attempt 去重打开、卸载后还原。

## 维护

EAC 原研（`assets/SOURCES.json#C116`），不参与内置插件自动更新。
随包口径见 `tauri-shell/distro.mjs` 的 `BASE_PLUGIN_DIRS` 与
`dsh-desktop/lib/desktop/companion-sync.ts` 的 `COMPANION_PLUGINS`（两处必须一致，
`dsh-desktop/test/minimal-core-boundary.test.ts` 会断言）。
