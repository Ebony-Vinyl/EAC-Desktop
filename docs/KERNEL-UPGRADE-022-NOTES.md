# beta 内核升级：0.2.1-rc.2 → 0.2.2-rc.1

日期：2026-11-10。依赖接线、补丁适配、全量测试与装配已在本机验证；安装版 GUI 与打包产物验收见文末的验证分级。逐文件改动与适配方案见 [KERNEL-UPGRADE-022-ADAPTATION.md](KERNEL-UPGRADE-022-ADAPTATION.md)。

## 版本与来源

- 官方 tag：`dsh-v0.2.2-rc.1`，commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`（轻量 tag，无 peel 对象）。
- EAC 产品版本仍为 `6.1.0`。
- **Node 最低要求提高到 `>=24.9.0`**（内核根 `package.json` 的 `engines.node`，此前为 `^22.19.0 || >=24.0.0`）。官方源码构建使用 `pnpm@11.28.5`。
- 保留旧 tag 的 commit 钉（`scripts/fetch-kernel.ts` 的 `KERNEL_TAG_COMMITS`），支持按明确 tag 回构旧内核。

本地验证使用官方 npm registry 已发布的精确版本：按该 tag 的 `scripts/release/families.ts` 规则枚举发布集合，得到 **382 个非 private 包**（dsh family 373 个、全部 `0.2.2-rc.1`；vendor family 9 个），逐包校验 `dist.integrity` 与 tarball 内的包名、版本，registry 上 382/382 存在精确版本。

vendor family 版本：`@deepseek-ai/cordis@4.1.0`、`cosmokit@1.9.0`、`cordis-plugin-group@1.1.0`、`cordis-plugin-hmr@1.1.0`、`cordis-plugin-include@1.1.0`、`cordis-plugin-loader@1.1.0`、`cordis-plugin-logger-console@1.1.0`、`schemastery@3.19.0`、`cordis-plugin-timer@1.2.0`。

缓存位于忽略目录 `dsh-desktop/vendor/kernel/0.2.2-rc.1/`（382 个 tgz，同目录 `registry-provenance.json` 记录来源与摘要）。本机仍不从源码复现官方构建：`scripts/fetch-kernel.ts` 的源码构建链路依赖 `pnpm install` + `build:official` 双家族打包，本机下载 `cdn.sheetjs.com` 超时；`DEFAULT_TAG` 与 tag 提交钉已指向新版本，源码构建机制本身未改动。

## 适配结果

| 范围 | 处理与保留的行为 |
| --- | --- |
| 依赖与版本钉 | 35 个直接内核依赖改指向 `vendor/kernel/0.2.2-rc.1/*.tgz`；`gen-kernel-overrides` 重算 382 个内核 overrides，加 8 项非内核安全钉共 390 项；`staged-runtime-artifact.yml` 的 `KERNEL_VERSION` 改为 `0.2.2-rc.1` |
| Host API 拆分 | `@deepseek-ai/dsh-host-apiproxy` 在 0.2.2 不再发布，Host 面拆成 `dsh-api-session-controller` / `dsh-api-workspace-controller` / `dsh-api-workspace-files`；会话删除链路改由 `scripts/patch-session-manage-022.js` 承担（见下节） |
| 设置弹窗 | panel 从 flex 布局改成 grid 布局（`grid-template` 两列三行 + `display:grid`），宽度仍固定 800px、仍 `overflow:hidden`；锚点守卫接受 flex 与 grid 两世代，替换动作一致：宽改 `min(75vw,1280px)`、`overflow:auto` + `resize:horizontal` + `min-width:640px`。全屏态面板（宽 100%、`grid-template` 不同、无 800px 宽）不命中 |
| 设置左栏 | 上游 `_navList` 已自带 `min-height:0` + `overflow-y:auto`，注入式滚动补丁不再执行，探测命中即报告「已由上游提供滚动」 |
| submenu | 主 bundle 压缩变量换代（`p`/`Ne`/`_e`）：悬停保持、延迟关闭、滚动与宽度锚点在容器段命中；两行标签改为按世代候选表匹配，要求按钮与标签两个锚点在 bundle 内各自唯一命中才写入 |
| 配置重载 | 沿用上游事务式 `recompose`；0.2.2 收尾的 fiber 等待改用 `Promise.allSettled`，健康 fiber 的 dispose 失败不再中止重载、也不进 warnings（只有 `inactiveEntries` 的失败会），按世代记录两种语义 |
| 工具执行器 | 执行器插件化：`ctx.tools.setExecutor`（`dsh-tool-executor-native` / `dsh-tool-executor-ptc`），最小组合缺执行器时 `ctx.tools.execute` 抛 `TOOL_EXECUTOR_UNAVAILABLE`；`ctx.tools.execute` 只收批次入参（`calls` + JSON 字符串 `arguments`），返回按调用顺序的 settlement |
| Agent / 会话 | Agent 在 pre-step 前固定本步模型、`agent/request` 不再允许改路由、Session API 新增独立快照与事件流接口、Session Projection 注册 API 异步化、PTC 改用 birpc（SSH 协议 2→3）：这些面本仓库未直接调用，随上游版本走 |
| bash 受控覆盖 | 基于官方 `dsh-tool-bash@0.2.2-rc.1`，仍只有 optional-escalation 一行兼容差异（`defaultMode === "danger-full-access"` 时不提供升级目标） |
| 固定皮肤 | `deep-whale-day-night` 的主题 peer 只补入已验收的精确版本 `0.2.2-rc.1`，不放宽范围、不授予豁免；其余随包皮肤 peer 为 `>=0.1.0-rc.6` 或空，天然满足 |
| 装配与契约 | `host-profile.json` 追加精确 `{"dshRange": "0.2.2-rc.1", "mapping": "eac-dsh-adapter@1"}`；`docs/archive/upgrade-test-441.js` 的内核版本断言改为 `0.2.2-rc.1` |

补丁事实源仍是 `scripts/patch-deps.ts` 与 `scripts/patch-session-manage*.js`（TypeScript 构建产生运行用 JavaScript），staging 重放同一脚本并回填受控 bash 文件。未改变用户 profile、sessions、skills 或凭据的既有布局。

## 会话删除链路（0.2.2 结构）

`patch-session-manage.js` 按 `dsh-workspace` 的版本分流：`0.2.2-rc.1` 走 `patch-session-manage-022.js`，`0.2.1-rc.2` 走 `patch-session-manage-021.js`，更早版本走 0.2.0 世代逻辑。0.2.2 分支覆盖 9 个文件：

| 落点 | 内容 |
| --- | --- |
| `dsh-agent-loop` | `__eacSessionDisposers` 登记每个 Agent 的 dispose，供会话删除时定点释放 |
| `dsh-session-persistence-jsonl` | `deleteSession(id)`：写锁 + lease + realpath 越界校验后逐项删除，保留 `LEASE_FILENAME`，清 coldLogMemo |
| `dsh-session` | `remove(id)`：`store.get` → `detachEntered`，触发上游 `session/disposed` |
| `dsh-workspace` | `deleteSession(sessionId)`：`enqueueOperation` 内校验未知/活跃会话，先写归档门再 `flush` + dispose + 删盘，失败按是否已删数据回滚，成功后清 entities/headers/sessionPaths/missingSessionPaths/invalidSessionPaths，并 `emit("api-session/removed")` |
| `dsh-api-workspace-controller/lib/index.js` | `@Remote("deleteSession")` Host 方法，把 `WorkspaceUnknownSessionError` 映射为 `session/not-found`、`WorkspaceActiveSessionError` 映射为 `workspace/session-active` |
| `.../lib/typert.host.js`、`dsh-api-remotes/lib/client.js` | `workspace/deleteSession` 的 zod 返回 schema（`{ deleted: true }`）与 remote 条目 |
| `.../lib/client.js` | 命令服务 `deleteSession`，失败时保留 `rpcError` 供界面与测试判定错误码 |
| `dsh-client-ui-workspace/lib/client.js` | `uiWorkspace.deleteSession`、`deleteInjected` 动作（确认 → 删除 → 失败提示）与 `register("delete", 700, ["workspace/deleteSession"])` 菜单项，中文与英文内联 locale |

上游原生 archive/unarchive 保留不动。

## 验证

全量测试在本机 Node `24.18.0`（`dsh-desktop/vendor/node`）跑：**836 个用例，788 通过，0 失败，48 跳过**。

| 检查 | 结果 |
| --- | --- |
| 依赖安装 | `npm install` 从 registry 装 382 个内核 tgz + 传递依赖（需显式 `--proxy`/`--https-proxy`，`HTTP(S)_PROXY` 环境变量不被可靠采纳）；`package-lock.json` 内 `0.2.2-rc.1` 2110 处、`0.2.1-rc.2` 0 处 |
| 构建 | `npm run build`（`tsc -p tsconfig.json`）通过 |
| 补丁 | `patch-deps` 与 `patch-session-manage` 全部锚点命中或按上游已实现退役；被改内核文件 `node --check` 通过 |
| 插件兼容门禁 | `plugin-kernel-compat.mjs`：17 个随包插件 / 服务端源码 76 文件 / 具名导入 1 处，未发现导入内核不存在的导出 |
| 会话删除 | `session-delete-021.test.ts` + `session-delete-022.test.ts`：11 通过 / 3 跳过（0.2.1 与 0.2.2 的客户端形状各由对应用例覆盖） |
| 依赖安全 | MCP HTTP/stdio 与 issuer 绑定用例在实际内核上通过（执行器插件化后按批次契约调用） |
| 装配 | `stage-resources.mjs --target=win32 --distro=lite` 通过：离线装配 675 个包、裁剪 12805 个调试映射与自测文件、bundle manifest 与 WebView2Loader.dll 就位；装配树内 `@deepseek-ai` 334 个包，除 `libreoffice-kit` / `node-addon-system` 外全部 `0.2.2-rc.1`，无 `0.2.1-rc.2` 残留 |
| 装配校验 | `verify-staged-runtime.mjs`：PASS required=44 retired=9 packages=675 |
| 启动冒烟 | `minimal-boot-smoke.mjs`：PASS 303=303 ui=200 retired-rpc=2 orphan-web=false |

**本机 PATH 上的 Node `26.13.0` 不能用来跑本仓库测试**：项目测试用 `stripTypeScriptTypes(..., { mode: 'transform' })`，Node 26 只接受 `mode: 'strip'`，会统一报 `ERR_INVALID_ARG_VALUE`，与内核无关。跑测试前把随包 Node 放到 PATH 首位。随包运行时需 ≥24.9（内核 `engines`）。

## 尚未完成的发布门槛

| 项 | 现状 |
| --- | --- |
| V4 运行时 | 装配产物的无界面启动冒烟已通过；安装版 GUI 的中文路径、浮窗、托盘、退出零孤儿仍需复验 |
| V5 分发 | 装配与装配校验已通过；NSIS 安装包、便携 zip、真实安装/升级/故障注入未做 |
| CI | `staged-runtime-artifact.yml` 的 `NODE_VERSION` 为 `24`（setup-node 取最新 24.x，满足 ≥24.9）；首轮 CI 结果待跑 |

## 装配环境注意

- 隔离环境的 `HOME` 被收容到 `eac-beta\home`，`cargo` 默认找不到宿主机 registry。装配前显式给出 `CARGO_HOME` / `RUSTUP_HOME` 指向宿主机 rustup（WebView2Loader.dll 前置检查按 `process.env.CARGO_HOME` 定位）。
- 随包 Node 由 `scripts/fetch-node.ts` 复制当前 `process.execPath`；本次装配用 `24.18.0`，满足内核 `>=24.9.0`。
