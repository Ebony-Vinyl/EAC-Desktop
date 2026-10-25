# beta 内核升级：0.2.0-rc.2 → 0.2.1-rc.2

日期：2026-10-23。依赖接线、核心补丁兼容、装配与新 profile 启动已验证；存在下述插件和分发验收缺口，尚不构成可发布版本。

## 版本与来源

- 官方 tag：`dsh-v0.2.1-rc.2`，commit `687f282e8625c6b8d11ff58211a90524be2e4317`。
- EAC 产品版本仍为 `6.1.0`。
- Node 要求仍为 `^22.19.0 || >=24.0.0`；本机使用 Node `24.21.0`。
- 官方源码构建使用 `pnpm@11.28.5`。客户端运行时继续使用独立安全锁 `pnpm@11.28.2`、`npm@11.21.0`，不与源码构建工具混用。
- 保留旧 tag 的 commit 钉，支持按明确 tag 回构旧内核。

本机源码构建在 `pnpm install` 下载 `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` 时超时，未完成源码复现。本次没有改写上游锁文件，也没有改变获取脚本的源码构建机制。

本地验证使用官方 npm registry 已发布的精确版本：按该 tag 的 `scripts/release/families.ts` 发布集合枚举 352 个非 private 包，逐包校验 `dist.integrity` 及 tarball 内的包名与版本。缓存位于忽略目录 `dsh-desktop/vendor/kernel/0.2.1-rc.2/`，同目录 `registry-provenance.json` 记录来源与摘要。**这些证据不能证明本机已重现官方源码构建；CI 源码构建结果见下文 CI 记录。**

## 适配结果

| 范围 | 处理与保留的行为 |
| --- | --- |
| 依赖与版本钉 | 更新获取脚本、35 个直接内核依赖、352 个内核 overrides、锁文件与构建工作流；306 个安装闭包 tarball 锁条目已核对 SHA512，8 项非内核安全 overrides 保留 |
| 已移除包 | 仅在目标缓存缺失时清理 `dsh-experimental-schedule-bundle`、`dsh-invariants`、`dsh-subagent-in-process-driver`；其他缺失继续报错，旧缓存存在时保留 |
| 主题与字体 | 写入收敛补丁迁到多 role API，保留 `text/code/terminal`、批量字号调整、在途 adopt 防护；快速写入合并，拒绝或断连后回读持久状态 |
| 配置重载 | 沿用上游事务式 `recompose`，保留 requiredIds、preflight、失败归因与恢复；旧 reconcile-gate 和配置编辑短路补丁退役，避免绕过新事务 |
| 设置导航与模型输入 | 上游已提供导航滚动和 text/image 多选控件，不再注入旧实现；验证最后一项不可取消、移除 image 时清理专属元字段、其他模型字段保留 |
| Agent preset 菜单 | 第三方预设继续分组；分组消费经过 developerTools 过滤的 options；设置页沿用官方卡片 |
| submenu | 按 0.2.1 bundle 的实际变量迁移悬停、延迟关闭、滚动和两行标签；整组唯一锚点命中后才写入，避免旧压缩变量导致 ReferenceError |
| bash 受控覆盖 | 基于官方 `dsh-tool-bash@0.2.1-rc.2` 重建，仅保留 optional-escalation 一行兼容差异；保留 workingDirectory 服务、owner、cwd 输出与 presentationMeta；验证相对目录解析和无 agent 调用 |
| 服务面扫描 | 识别 `client.browser.js` 中的 client remote；排除 `client.node.js`，不让 Node client 冒充 Host |
| 固定皮肤 | 真实内核 CSS 与固定皮肤的 Edge 测试通过后，为 `host-profile.json` 添加精确 `0.2.1-rc.2 → eac-dsh-adapter@1` 映射；manager/default 固定工件未改动 |
| 对话删除 | 独立维护 0.2.1 补丁，接通 sidebar slot、client、Remote 描述符、Host、WorkspaceRegistry 与 JSONL 后端；保留新版原生 archive/unarchive，删除前等待原生 AgentLoop teardown 和持久化 handle.close |

补丁事实源仍是 `scripts/patch-deps.ts`，TypeScript 构建产生运行用 JavaScript；staging 重放同一脚本并回填受控 bash 文件。未改变用户 profile、sessions、skills 或凭据的既有布局。

## 验证

第一阶段完整测试曾有 3 项失败：client remote 扫描、主题补丁、旧 reconcile-gate 断言。第二阶段分别修复扫描、移植主题补丁，并以实际事务行为测试替代已退役补丁的 marker 要求。没有放宽服务检查、鉴权或事务错误处理。

| 检查 | 第二阶段结果 |
| --- | --- |
| 干净安装 | `node scripts/npm-ci-with-kernel.mjs --ignore-scripts --no-audit --no-fund --fetch-retries=1 --fetch-timeout=30000` 通过，安装 776 包；随后 build、patch-deps 均通过，bash 重装前后 SHA256 一致 |
| 新 UI/bash 行为 | 新增 7 项全部通过：submenu 实际回调、模型输入、预设过滤、bash cwd；另有主题与配置重载各 6 项行为测试，包含失败恢复 |
| `npm test` | 共 761 项，717 通过、0 失败、44 跳过，约 210 秒；跳过不计为通过 |
| Edge 浏览器契约 | `shell-ui-compat.test.ts` 9/9 通过，使用真实 0.2.1 CSS、固定皮肤与 bridge；覆盖标题栏、明暗主题、按钮、设置滚动与通知竞争 |
| 装配 | 从干净 staging 执行 `node tauri-shell/stage-resources.mjs --target=win32` 通过；同步最新 host profile 后又执行增量装配 |
| 载荷验证 | `verify-staged-runtime.mjs` 通过：43 个必需文件、9 个退役路径、641 个包的完整性清单 |
| 隔离启动 | `minimal-boot-smoke.mjs` 通过：临时 DSH_HOME，token 303 → 鉴权 UI 200 → stop/shutdown → 服务端口已关闭 |
| 实际页面 | Edge 打开隔离启动的真实 URL，主界面与预览说明正常渲染，未捕获 pageerror；未配置密钥、未发送模型请求 |
| 重放与一致性 | 源安装树和 staged 树再次执行 patch-deps 后，各 1150 个内核 JS/CSS 文件摘要保持不变；关键补丁文件及 bash 与源树一致，精确皮肤映射已装入载荷 |

第二阶段日志保存在忽略目录 `dsh-desktop/.verify/kernel-021-compat/`：`clean-install.log`、`build.log`、`patch-deps.log`、`full-test.log`、`browser-compat.log`、`stage.log`、`stage-refresh.log`、`verify-stage.log`、`boot-smoke.log`、`browser-smoke.log`、`check-replay.log`。实际页面截图为同目录 `actual-ui.png`。第一阶段记录仍保留于 `.verify/kernel-021-easy/`。

## 第三阶段：对话删除适配

事实源为 `dsh-desktop/scripts/patch-session-manage-021.ts`，由既有入口按精确内核版本分流；生成的 JavaScript 随 staging 携带，postinstall、装配及启动重放同一补丁。8 个目标全部完成唯一锚点预检后才写入，锚点漂移直接报错。

删除复用原生 `workspace/session-activity` 检查 turn、子代理、jobs 和 schedules，已归档会话也检查。先持久归档阻止新的 Agent 写入，再 flush、复查活动、等待完整生命周期关闭。关闭前失败恢复原来的归档/置顶状态；磁盘删除失败则保留归档门控并报告失败，供显式重试。

JSONL 删除使用后端配置的存储 root、原生路径查找与跨进程写锁，不从 DSH_HOME 拼接旧路径；拒绝越界与会话目录符号链接。历史删除后保留空目录和 `session.lock`，避免移除仍可能被其他进程持有的锁文件。成功后清理 workspace 成员及缓存，发送原生 `api-session/removed`。Gateway 鉴权与资源解析逻辑未改动。

菜单优先沿用外部 `window.__dshSessionManager.deleteSession` 的确认流程；没有该插件时由内置确认框调用新 workspaces 命令。取消不调用删除接口，Host 错误保留原生错误码并显示失败提示。

| 检查 | 第三阶段结果 |
| --- | --- |
| 安装与补丁 | `npm ci` 安装 776 包成功；包装脚本恢复 manifest 时出现一次 Windows `UNKNOWN` 写入错误，已恢复相对依赖路径；随后 postinstall 的 build 与两类补丁均通过 |
| 定向回归 | 删除专项 11 项通过，覆盖真实官方产物转换、幂等、活动拒绝、关闭顺序、失败恢复、路径边界、锁获取拒绝、Client 错误透传、菜单取消及外部 manager 委托；装配闭包及更新准备合计 31 项通过 |
| `npm test` | 最终共 772 项，728 通过、0 失败、44 跳过，约 173 秒；首轮一项更新准备测试因临时目录清理 `ENOTEMPTY` 失败，该项定向复跑及完整复跑均通过 |
| 干净装配 | `stage-resources.mjs --target=win32` 与 `verify-staged-runtime.mjs` 通过：43 个必需文件、9 个退役路径、641 个包；新增运行脚本已包含 |
| 实际 Gateway | 隔离 profile 中创建临时会话，通过同源新 Remote 删除 live 会话，列表与刷新后均不存在，兄弟会话保留，重复删除返回 `session/not-found`；原生归档/恢复通过；无模型请求 |
| Edge 菜单实测 | 临时会话的真实菜单显示“删除对话”；取消保留会话与落盘历史，确认后历史文件被删除且目录仅保留稳定锁文件；兄弟会话历史字节不变，未鉴权删除被拒绝，归档/恢复与刷新正常；无 pageerror，退出后端口关闭 |
| 重放与一致性 | 源安装树和 staged 树重放删除补丁均修改 0 个文件；8 个目标与生成脚本的 SHA256 在两树间一致 |

第三阶段证据位于忽略目录 `dsh-desktop/.verify/session-delete-021/`，包括 `install.log`、`postinstall.log`、`targeted-final.log`、`full-test-final.log`、`stage.log`、`verify-stage.log`、`browser-smoke.log`、`browser-menu.log` 与 `replay.log`。截图为 `after-delete.png`。菜单测试在停止服务后，使用原生格式编码器为临时会话加入一组已结束的 turn 事件，再重启并经原生 rename 恢复会话、刷新投影；没有模型请求。全部页面测试使用临时 DSH_HOME，不操作用户会话。

## 尚未完成的兼容与发布门槛

1. 外置插件及推荐功能包仍需按新 `activity/usage` 扩展位、Agent Team、子代理、PTC/SDK 和凭据读取规则逐项验收。随包源码未发现对旧 composer stats 槽的调用，不代表第三方插件已通过验证；外部会话管理插件的设置页与批量操作也未完成实机验收。
2. 尚未验证真实账号登录后的模型对话、旧用户数据副本升级与回退，以及真实 Tauri 窗口运行。当前页面验证不等于真实模型请求成功。
3. `c475718d` 的 Windows/Linux x64/arm64 四组 CI 已完成自动测试、装配与安装包构建；实际安装、旧数据升级及回退仍未完成，分发验收为 **partial**。本轮合并主线后的构建需以新提交的 CI 为准；macOS 未覆盖。

代码通过 `beta` 分支提交进行 CI 验证。安装包工作流保留 `workflow_call`，增加 `beta` push 与手动触发，在现有 Windows/Linux x64/arm64 矩阵中运行自动测试、装配校验和安装包构建。CI 结果以对应提交的 Actions 记录为准；构建验证不代表已发布或完成上述实机验收。

## CI 首轮及修正（2026-10-24）

- [首轮 beta CI](https://github.com/Ebony-Vinyl/EAC-Desktop/actions/runs/40068004384) 四组均完成官方源码准备与依赖安装，但在自动测试步骤失败，未进入安装包构建。Linux 各 1 项失败，Windows 各 10 项失败。
- 同步工作流契约测试：只允许 beta push、workflow_dispatch 和 workflow_call；确认 npm test 无条件执行、失败不可忽略，且位于装配与打包之前。
- 两份新内核源码 fixture 固定为 LF，避免 Windows Git 检出转为 CRLF 后破坏真实补丁锚点；不改变生产补丁的严格匹配。
- Windows runner 的 TEMP 使用 8.3 别名，便携测试曾把短路径与更新器的规范路径混用。测试先以 realpath 取得临时根，再创建隔离目录；保留清理边界检查与更新器全部断言，不修改产品更新器实现。
- 已用真实 Windows 8.3 临时路径复现三个便携测试失败，修正后 3/3 通过；工作流及主题测试 11/11 通过；core.autocrlf=true 下两个 fixture 的实际 Git 检出均保持 LF，主题补丁成功匹配。
- 本次修正后的跨平台 CI 及安装包结果仍以最新 beta 提交的 Actions 为准，不以定向测试代替分发验收。

## 主线合并与冲突解决（2026-10-25）

将 `main@29458f39` 合入共享 `beta`，保留双方历史。依赖冲突保留 `0.2.1-rc.2` 全套内核钉版和主线新增的 `@shaderfrog/glsl-parser`、`jpeg-js`；锁文件经 npm 生成，相对合并前 beta 仅增加两个包。设置导航补丁在上游已提供滚动时返回成功，保留上游行为。

全量回归暴露并修复了主线分发遗漏：

- 开机动画、微信渠道、远程访问进入两档装配与配套插件清单，配置沿用随包 patch 的桌面默认值；已有用户配置和启停选择继续优先。
- 微信 Host 原有产物引用 monorepo 外部 `../../core`，现以钉定源码 `5f7d69a8` 内联 core 和 `qrcode@1.5.4`。远程插件补齐 `85fb53f` 的 `dist`，Host 内联 `qrcode@1.5.4`、`werift@0.24.4`，Client 保留上游字节。构建使用 `esbuild@0.25.12`、`platform=node`、`format=esm`、`target=node24`，以 `createRequire(import.meta.url)` 提供 CommonJS 兼容；宿主 `@deepseek-ai/*` 和可选 `@roamhq/wrtc` 不内联。第三方许可随包提供。
- 两个已在主线随包的视觉核心补齐 `.sync` 与来源台账；通过项目生成器重建 registry、lock 并执行完整 `plugin-sync validate`，共 15 个登记项。装配实物为 14 个插件；退役的 Core Bridge 继续不随包。
- 便携测试同步辅助脚本和短产物名。解压说明与脚本在压缩前纳入 `eac-release-files.json` 及受控顶层项，保持 ZIP 严格文件清单、逐文件摘要和整包 SHA256 校验；不忽略额外条目。

三个新插件均通过隔离 profile 复制后的真实 Host 导入验证；内核包由宿主提供，插件自身依赖随包闭合。双 PE 架构便携装配、完整清单及重复输出拒绝验证通过。

| 检查 | 合并后的最终结果 |
| --- | --- |
| `npm test` | 803 项：759 通过、44 跳过、0 失败，约 162 秒；未设置发行跳过开关 |
| 台账校验 | 项目生成器重建 registry 和 lock；`plugin-sync validate` 通过，15 个登记项 |
| 干净装配 | `stage-resources.mjs --target=win32` 与 `verify-staged-runtime.mjs` 通过：43 个必需文件、9 个退役路径、643 个依赖包、14 个随包插件 |
| staged 导入 | 三个新插件真实 Host 导入成功，入口 SHA256 与源树一致；壁纸的两个新增依赖实物均存在 |
| 删除补丁重放 | staged 树修改 0 个文件，原生归档/恢复保留 |

构建复现时，在钉定的微信源码目录使用 esbuild 构建 `packages/bundle/src/host.ts`，将 `@dsh-wechat/core` alias 指向同目录 `packages/core/src/index.ts`；远程 Host 使用钉定提交的 `packages/plugin/dist/index.js` 作为输入，将上述纯 JavaScript 依赖内联。两者均保留第三方许可，生成产物经 `copyPluginPackage` 的隔离导入用例验收。

本轮本地日志位于忽略目录 `dsh-desktop/.verify/pr491-conflicts/`。第一次完整复跑 803 项中仅临时目录清理出现 Windows `ENOTEMPTY`，该用例单独复跑通过；没有放宽或跳过产品校验。

[上一轮 beta CI](https://github.com/Ebony-Vinyl/EAC-Desktop/actions/runs/40071916108)（`c475718d`）四组均成功。该结果早于本轮主线合并，不能替代新提交的 CI。

官方变更说明：[0.2.1-rc.1](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.1)、[0.2.1-rc.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.2)。
