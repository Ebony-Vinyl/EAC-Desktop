# 内核适配方案：EAC-Desktop 6.1.0 → dsh 0.2.2-rc.1

本文是这次内核升级的**改动地图与适配方案**：改了哪些文件、每个落点解决什么差异、判据是什么。升级结果与验收数据见 [KERNEL-UPGRADE-022-NOTES.md](KERNEL-UPGRADE-022-NOTES.md)。

- 上游 tag：`dsh-v0.2.2-rc.1`，commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`
- 产品版本不变：`6.1.0`
- 内核最低 Node：`>=24.9.0`（原 `^22.19.0 || >=24.0.0`）

---

## 1. 0.2.2 带来的六类结构性差异

适配工作量的来源只有这几条，其余都是版本号跟随。

| # | 差异 | 影响面 | 对应方案 |
| --- | --- | --- | --- |
| 1 | `@deepseek-ai/dsh-host-apiproxy` 停止发布，Host 面拆成 `dsh-api-session-controller` / `dsh-api-workspace-controller` / `dsh-api-workspace-files` | 会话删除与归档恢复的整条 Host RPC 链路 | 新写 0.2.2 世代补丁（§4） |
| 2 | 工具执行器插件化：`ctx.tools.setExecutor`，`ctx.tools.execute` 只收批次入参 | 任何直接调 `ctx.tools` 的组合与测试 | 装 `dsh-tool-executor-native`，改批次契约（§7） |
| 3 | `reconcileProfilePatches` 收尾从 `Promise.all` 改为 `Promise.allSettled` | 配置重载错误语义 | 按世代分叉断言（§8） |
| 4 | 设置弹窗 panel 从 flex 改 grid | 面板宽度/拖拽补丁锚点 | 新增 grid 世代守卫（§5） |
| 5 | 主 bundle 压缩变量换代（`p`/`Ne`/`_e`） | 二级菜单四项补丁锚点 | 世代候选表 + 唯一性校验（§6） |
| 6 | 设置左栏 `_navList` 自带 `min-height:0` + `overflow-y:auto` | 左栏滚动补丁 | 探测命中即退役（§5.2） |

其余跟随项：Cordis Core 4.1.0 / Loader 1.1.0 / Include 1.1.0（vendor family 全升版）、Agent 在 pre-step 前固定本步模型、`agent/request` 不再改路由、Session API 新增快照与事件流、Session Projection 注册 API 异步化、PTC 改 birpc（SSH 协议 2→3）、官方组合包改由 `@deepseek-ai/dsh-official-bundles` 导出。这些面本仓库未直接调用，随上游版本走。

---

## 2. 内核缓存与依赖接线

### 2.1 为什么不走源码构建

`scripts/fetch-kernel.ts` 的源码链路要 `pnpm install` + `build:official` 双家族打包，本机下载 `cdn.sheetjs.com` 超时。改用**按 tag 枚举发布集合 → registry 下载已发布 tgz → 校验**：

1. 取 tag 源码，按 `scripts/release/families.ts` 规则枚举：`packages/*/*/package.json` + `apps/*/package.json` = dsh family，`vendor/*/package.json` = vendor family；
2. 过滤 private，得 **382 个目标包**（dsh 373 + vendor 9），registry 上 382/382 存在精确版本；
3. 逐包下载 tgz，校验 `dist.integrity` 的 sha512 与 tarball 内 `name`/`version`；
4. 落 `dsh-desktop/vendor/kernel/0.2.2-rc.1/`（382 个 tgz，忽略目录）+ `registry-provenance.json`（version / tag / commit / source / generatedAt / packages[name,version,dir,integrity]）。

网络判据：`registry.npmjs.org` 直连可通但约 190 KB/s，`raw.githubusercontent.com` 直连被 reset。走 `http://127.0.0.1:7890` 时到 registry 达 8.99 MB/s，故取源码走代理、下载走直连。

### 2.2 版本钉

| 文件 | 改动 |
| --- | --- |
| `dsh-desktop/scripts/fetch-kernel.ts` | `DEFAULT_TAG = 'dsh-v0.2.2-rc.1'`；`KERNEL_TAG_COMMITS` 增 `'dsh-v0.2.2-rc.1': '66491b05…'`（旧 tag 的 commit 钉保留，支持回构） |
| `dsh-desktop/package.json` | 35 个直接内核依赖改指 `file:vendor/kernel/0.2.2-rc.1/*.tgz`；`overrides` 经 `gen-kernel-overrides` 重算：382 内核 + 8 非内核安全钉 = 390 项 |
| `dsh-desktop/package-lock.json` | 由 `npm install` 生成；`0.2.2-rc.1` 出现 2110 处，`0.2.1-rc.2` 0 处 |
| `.github/workflows/staged-runtime-artifact.yml` | `KERNEL_VERSION = '0.2.2-rc.1'`（`NODE_VERSION` 仍是 `24`，setup-node 取最新 24.x，满足 ≥24.9；`PNPM_VERSION` 11.28.5） |

安装闭包反推时注意：旧 lock 里 306 个 tarball 锁条目中有 7 个 vendor family 包（cordis / group / include / loader / timer / cosmokit / schemastery），它们跟着 vendor family 一起升版，**不能**只改 35 个直接依赖。

### 2.3 npm 安装的两个坑

- `HTTP(S)_PROXY` 环境变量不被 `npm install` 可靠采纳，必须显式 `--proxy=http://127.0.0.1:7890 --https-proxy=…`。用环境变量那次卡在 `@deepseek-ai/libreoffice-kit-win32-x64`（190 MB，非 optional）二十分钟；显式代理后 6 分钟装完。
- 解包偶发不完整：本次出现过 `@modelcontextprotocol/client@2.2.0/dist/index.mjs` 与 `zod@4.6.5/v4/classic/external.js` 缺失（只剩 `.map`），表现是 MCP 测试与 `plugin-route-lifecycle.test.ts` 起不来。判定方法：文件缺失但 `package.json` 版本正确、`dist` 里只有同名 `.map`。修法是删掉这两个包目录后重装，不要手写补丁文件。
- `dsh-desktop/.npmrc` 的 `legacy-peer-deps=true` 必须随行：内核包互相声明 peer，全新解析会组合爆炸。

---

## 3. 补丁总览

补丁事实源是 TypeScript / CommonJS 脚本，`tsc` 就地产出同名 `.js`（`dsh-desktop/.gitignore` 已列产物）。装配时在 staged 树上按同一路径重放。

| 脚本 | 职责 |
| --- | --- |
| `dsh-desktop/scripts/patch-deps.ts` | 内核产物与主 bundle 的锚点补丁：picker 退出码、设置弹窗宽度、主题写入收敛、settings 写入重试、模型下拉对比度、可选升级字段、agent-preset 菜单、submenu、http-cache-semantics |
| `dsh-desktop/scripts/patch-session-manage.js` | 按 `dsh-workspace` 版本分流：`0.2.2-rc.1` → `patch-session-manage-022.js`，`0.2.1-rc.2` → 021，其余走 0.2.0 世代 |
| `dsh-desktop/scripts/patch-session-manage-022.js` | 0.2.2 世代会话删除链路（§4） |

所有补丁遵守同一条规则：**锚点不完整就不写入任何改动**（`node --check` 通不过的分支直接返回 `false`），宁可跳过也不留半截补丁。上游已官方化的面报告「已退役」，不再注入。

---

## 4. 会话删除链路（0.2.2 结构）

### 4.1 结构侦察结论

官方 0.2.2 产物里 `dsh-api-workspace-controller/lib/index.js` **没有** `deleteSession`（也没有 `remove`），删除能力必须自建。上游只提供事件链条：

- `dsh-session` 的 `SessionStore.detachEntered(entry)` 在 `announcement !== 'pending'` 时 `emitDisposed` → 派发 `session/disposed`；
- `dsh-api-session-controller` 监听 `ctx.on('session/disposed')` 并 `ctx.emit('api-session/removed', session.id)`；
- `api-session/removed` 在 `dsh-api-remotes/lib/types/remote-events.js` 已声明为可转发事件。

`dsh-workspace` 的 `WorkspaceRegistry`（`static inject = ['storageDomain','sessionPersistence']`）提供 `enqueueOperation` / `requireState` / `setState` / `archiveSession` / `unarchiveSession` / `sessionKnown`，是删除的落点。

### 4.2 九个文件、九个落点

补丁 MARKER：`dsh-desktop:session-delete-022-v1`；文件清单比 021 多一个（`dsh-session`）。

| 文件 | 落点与内容 |
| --- | --- |
| `dsh-agent-loop/lib/index.js` | 类字段 `__eacSessionDisposers = new Map()`；`async createAgent(ownerCtx, options)` 前插 `disposeSession(id)`；`this.ownership.track(dispose)` 包一层自清除的 `untrack` 并登记 disposer —— 删除时需要定点释放某个 Agent，而不是 dispose 整个 loop |
| `dsh-session-persistence-jsonl/lib/index.js` | `flush()` 后插 `deleteSession(id)`：`claimWrite` + `acquireLease` → `realpath` 越界校验 → 逐项 `rm`（保留 `LEASE_FILENAME`）→ `coldLogMemo.delete` |
| `dsh-session/lib/index.js` | `detachEntered(entry)` 前插 `remove(id)`：`store.get` → `detachEntered` → `true`，借此触发上游 `session/disposed` |
| `dsh-workspace/lib/index.js` | `unarchiveSession(sessionId)` 前插 `deleteSession(sessionId)`：`enqueueOperation` 内先取 persistence / sessions / agentLoop → 未知会话抛 `WorkspaceUnknownSessionError`、live 但 loop 无 disposer 抛错 → `checkActivity` 走 `ctx.waterfall('workspace/session-activity')` → 先写归档门（`setState` 加入 `archivedSessionIds`、移出 `pinned`）→ `flush` → `disposeSession` → `persistence.deleteSession` → 失败且未删数据时回滚 `setState`（`AggregateError` 包装）→ 成功后清 `entities.detachSession` / `headers` / `sessionPaths` / `missingSessionPaths` / `invalidSessionPaths` → 再清 archived+pinned → `this.ctx.emit('api-session/removed', sessionId)` → 返回 `{ deleted: true }` |
| `dsh-api-workspace-controller/lib/index.js` | 复制 `_unarchiveSession_decorators` 的 `__esDecorate` 块生成 `_deleteSession_decorators`（`[Remote('deleteSession')]`）；`unarchiveSession(request)` 前插 `async deleteSession(request)`，把 `WorkspaceUnknownSessionError` 映射为 `RemoteError('session/not-found')`、`WorkspaceActiveSessionError` 映射为 `RemoteError('workspace/session-active')` |
| `dsh-api-workspace-controller/lib/typert.host.js` | zod 懒 getter `_eac_workspace_delete_result$schema = z.object({ 'deleted': z.literal(true).readonly() })`；`'workspace/unarchiveSession': {` 前插 `remoteEntry(false)` |
| `dsh-api-remotes/lib/client.js` | 同上但用 `zod.z.*` 形态，并插 `"workspace/unarchiveSession": {` 前的 `remoteEntry(true)`（双引号版） |
| `dsh-api-workspace-controller/lib/client.js` | 两处：`this.remote.deleteSession({ sessionId })` 的命令方法；`this.model.deleteSession` 失败时 `throw Object.assign(new Error(result.error.message), { rpcError: result.error })` —— `rpcError` 是界面与测试判定错误码的依据，不能丢 |
| `dsh-client-ui-workspace/lib/client.js` | `uiWorkspace.deleteSession`（成功后 `clearMain`）；`deleteInjected`（`confirm` → 删除 → 失败 `alert`）；菜单 `register('delete', 700, ['workspace/deleteSession'], …)`；内联 locale 补 `menu.deleteSession` / `confirm.deleteSession` / `error.deleteSession`（中英） |

上游原生 archive/unarchive 保持不动；删除只在它们旁边新增能力。

### 4.3 菜单形状变化

0.2.1 的会话菜单是 React 组件（`ArchiveSessionMenuItem` 一类），0.2.2 改成数据式注册：`registerSessionMenus(ctx, actions)` 里 `register(id, order, endpoints, resolve)` + `ctx.contextMenus.register`。所以删除项走 `resolve` 返回菜单项对象（`{ id, label, separatorBefore, run }`），权限不足时返回空数组。

---

## 5. 设置面板

### 5.1 panel 宽度与拖拽（flex → grid）

功能仍未官方化：panel 宽固定 `800px`、`overflow:hidden`。补丁目标不变（宽跟随主窗、可拖拽），锚点守卫扩到两世代：

- flex 世代：块内含 `display:flex;position:relative;`；
- grid 世代（0.2.2）：块内含 `display:grid` + `position:relative` + `grid-template:`；
- 两世代都要求块内含 `max-width:`，确保命中的是设置弹窗本体。

替换动作相同：`width:800px` → `width:min(75vw,1280px)`；`overflow:hidden` → `overflow:auto;resize:horizontal;min-width:640px`。

全屏态面板（`width:100%`、`max-width:none`、`grid-template` 不同、没有 `width:800px`）不命中，保持原样。

### 5.2 左栏滚动（退役）

0.2.2 的 `_navList` 已自带 `min-height:0` + `overflow-y:auto`，补丁目的达成。判定改为世代无关的正则（`.X_navList{[^{}]*overflow-y:auto[^{}]*}`），命中即报「已由上游提供滚动」并返回成功，不再依赖 `_nav` 的旧属性序。

---

## 6. 二级菜单（submenu）

0.2.2 主 bundle 四项改动的落点：

1. 容器：`role:"menu"` 到 `submenu.map(` 之间整段重建 —— 悬停保持、延迟关闭（400 ms）、`maxHeight:calc(100dvh - 96px)`、`overflowY:auto`、`minWidth:320`；
2. 一级菜单项：`onMouseLeave` 延迟 600 ms 关闭、`onMouseEnter` 清定时器；
3. 菜单根：`onPointerLeave` 延迟 300 ms（二级菜单是 body portal，跨过去不能立即收起）；
4. 子项两行布局：`button` 加 `alignItems:flex-start;flexShrink:0`，`itemLabel` 加 `whiteSpace:normal;overflow:visible` + CSS 自定义属性 `--dsh-desktop-submenu-label` 作幂等标记。

第 4 项的锚点每代都变，改成**世代候选表**（新→旧：0.2.2 `p`/`Ne`/`_e` → 0.2.0 `l`/`Ee`/`he` → 0.1.2 `d`/`Pe`/`fe` → rc.2 `f`/`Re`/`he`），要求按钮锚点与标签锚点在 bundle 内**各自唯一命中**才写入，避免同形代码被误伤。

---

## 7. 工具执行器插件化

0.2.2 把执行器拆成插件（`dsh-tool-executor-native`、`dsh-tool-executor-ptc`），由 `ctx.tools.setExecutor(executor)` 装配。最小组合（只有 SystemPrompt + ToolRuntime）调 `ctx.tools.execute` 会抛 `ToolExecutorUnavailableError`。

同时 `ctx.tools.execute` 的入参换成批次：

```js
// 0.2.2
const { results } = await ctx.tools.execute({
  signal,
  calls: [{ id, name, arguments: JSON.stringify({ … }) }],  // arguments 是 JSON 字符串
});
const result = results[0].result;                            // 按调用顺序的 settlement

// 0.2.1 及更早
await ctx.tools.execute({ signal, callId, name, arguments: { … } });
```

产品侧由 app-boot 组合自行装配执行器，无需补丁；测试组合需要显式加载 `dsh-tool-executor-native`（旧内核没有这个包，允许缺席），并按批次契约取结果。

---

## 8. 配置重载的错误语义

0.2.2 的 `reconcileProfilePatches` 收尾从 `Promise.all` 换成 `await Promise.allSettled(previousFibers.map(fiber => fiber.await()))`：某个健康 fiber 的 dispose 失败**不再中止重载**，也不进 `warnings`（只有 `inactiveEntries` 的失败会）。这是上游行为，本仓库不改。

补丁侧只做世代分叉：0.2.1 断言「disposal 失败 → 重载拒绝」，0.2.2 断言「disposal 失败 → 重载完成、`updated === 1`、返回空 warnings」。

---

## 9. 契约与元数据

| 文件 | 改动 |
| --- | --- |
| `dsh-desktop/assets/skins/@dsh-external_dsh-client-ui-skin-deep-whale-day-night/package.json` | 主题 peer 追加已验收的精确版本 `0.2.2-rc.1`（`>=0.1.0-rc.5 <0.2.0 || 0.2.1-rc.2 || 0.2.2-rc.1`）；不放宽范围、不授予豁免。其余随包皮肤 peer 为 `>=0.1.0-rc.6` 或空，天然满足 |
| `tauri-shell/host-profile.json` | `dshAdapters` 追加 `{"dshRange": "0.2.2-rc.1", "mapping": "eac-dsh-adapter@1"}` |
| `docs/archive/upgrade-test-441.js` | 内核版本断言改为 `0.2.2-rc.1` |
| `tauri-shell/stage-resources.mjs` | `SCRIPTS` 清单加 `patch-session-manage-022.js`（staged 树重放补丁时 `require` 要能找到）；受控 bash 覆盖的基线注释改 `0.2.2-rc.1`，差异仍只有 optional-escalation 一行 |
| `docs/README-MAINTENANCE.md` | 内核行改 `0.2.2-rc.1`（标注 Node ≥24.9）、构建工具链行标注 Node 24（≥24.9） |

---

## 10. 测试的世代分叉

原则：**按世代各自断言，不用放宽断言换绿灯**。

| 文件 | 处理 |
| --- | --- |
| `test/session-delete-021.test.ts` | 通用行为用例原样跑当前安装树；两条按 0.2.1 客户端/菜单形状写死的用例（React 组件抽取、命令服务 `rpcError`）加 `需要 0.2.1-rc.2 内核` 守卫 |
| `test/session-delete-022.test.ts`（新） | 三条 0.2.2 形状用例：命令服务转发与 `rpcError` 保留、`deleteInjected` 先确认再删除并汇报失败、`register('delete', 700, …)` 仅在权限允许时出现并转发 id |
| `test/dependency-security-runtime.test.ts` | 组合里加载 `dsh-tool-executor-native`（旧内核缺席则跳过），`ctx.tools.execute` 按批次契约调用 |
| `test/kernel-recompose-021.test.ts` | 保留 0.2.1 的 disposal 致命断言（守卫），新增 0.2.2 的 settled 断言 |

---

## 11. 验收分级与现状

| 级别 | 内容 | 结果 |
| --- | --- | --- |
| V1 定向 | 每个补丁 `node --check`、`patch-deps` / `patch-session-manage` 全锚点命中或按上游退役 | 通过 |
| V2 全量 | `836` 用例 / `788` 通过 / `0` 失败 / `48` 跳过（Node 24.18.0） | 通过 |
| V2 附加 | `plugin-kernel-compat.mjs`：17 个随包插件 / 服务端 76 文件 / 具名导入 1 处，未发现导入内核不存在的导出 | 通过 |
| V4 运行时 | `minimal-boot-smoke.mjs`：`303=303 ui=200 retired-rpc=2 orphan-web=false` | 通过（无界面） |
| V5 装配 | `stage-resources.mjs`：675 包离线装配、裁剪 12805 个调试文件、bundle manifest 675 包 | 通过 |
| V5 校验 | `verify-staged-runtime.mjs`：`required=44 retired=9 packages=675` | 通过 |
| V4 GUI | 安装版中文路径、浮窗、托盘、退出零孤儿 | 未做 |
| V5 分发 | NSIS 安装包、便携 zip、真实安装/升级/故障注入、CI 首轮 | 未做 |

---

## 12. 环境注意

- **不能用本机 PATH 上的 Node 26 跑测试**：项目测试用 `stripTypeScriptTypes(…, { mode: 'transform' })`，Node 26 只接受 `mode: 'strip'`，会统一报 `ERR_INVALID_ARG_VALUE`。跑测试前把 `dsh-desktop/vendor/node` 放到 PATH 首位。
- 随包 Node 由 `scripts/fetch-node.ts` 复制 `process.execPath`；本次用 `24.18.0`，满足内核 `>=24.9.0`。
- 隔离环境的 `HOME` 被收容到 `eac-beta\home`，`cargo` 找不到宿主机 registry，装配的 WebView2Loader.dll 前置检查会失败。装配时显式给 `CARGO_HOME` / `RUSTUP_HOME` 指向宿主机 rustup。
- 内核变更后装配**不能**加 `--skip-npm`（该开关只允许在内核不变时复用上次依赖树）。
