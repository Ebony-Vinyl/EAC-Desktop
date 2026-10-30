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

## Windows 便携包 CI 修复（2026-10-25）

[`f19b9e3a` 的 CI](https://github.com/Ebony-Vinyl/EAC-Desktop/actions/runs/40174110852) 中，Linux x64/arm64 全部成功；Windows x64/arm64 均已通过测试、资源装配和 NSIS 构建，在 `Build portable package` 失败。新内核 Inspector 的 Issues Markdown 最长 ZIP 路径为 186 字符，超过既有 154 字符门槛；原错误文案误写为 150，本次一并修正显示值，判断阈值不变。

便携打包仅在 `.staging-portable-*` 临时树内，将 `lib/devtools/models/issues_manager/descriptions/` 缩为 `lib/devtools/i/`。236 个 Markdown 文件保留原字节，同步唯一加载 URL、`resource-manifest.json` 路径及变更 chunk 的字节数和 SHA256；保留页面与 Worker 的根地址解析逻辑。目标目录冲突或上游 URL 锚点漂移会在移动前报错，重复执行不再修改。源安装树、staged-resources 和 NSIS 资源不受变换影响。

- 新增 3 项真实 Inspector 产物回归通过：768 个资源的路径、字节数与摘要，全部说明文档的页面/Worker 加载地址，幂等性，以及目标冲突和引用漂移拒绝。
- 本次 `npm test` 共 806 项：762 通过、44 跳过、0 失败，约 146 秒，未启用发行跳过开关。
- 完整 lite staged 资源在隔离目录中，分别配合 x64/arm64 PE 占位夹具执行真实便携脚本；两个 ZIP 均为 46255 条目，最长路径从 186 降至 153，既有门槛和严格文件清单通过。x64 全包解压、逐文件摘要及 Inspector 全部 768 个资源的清单校验通过，打包输入未改动。两次使用同一份完整 staged 资源，仅验证资源装配和归档，不作为真实 ARM 构建或壳运行证据。

本轮证据位于忽略目录 `dsh-desktop/.verify/pr491-conflicts/`：`ci-f19-failed.log`、`ci-portable-full-test.log` 与 `ci-portable-full.log`。实际安装、真实壳启动、旧数据升级及回退尚未完成，V5 仍为 **partial**；最新跨平台构建结果以修复提交的 Actions 为准。

## 再次同步主线（2026-10-26）

将 `main@1858ce3d` 合入共享 `beta`，保留 #494 外链/登录授权页修复和 #495 模型选择器对比度修复，以及既有 `0.2.1-rc.2` 适配。补丁导出冲突保留双方 API；装配清单冲突按实际并集更新为 15 个随包插件。

- 新版模型设置产物仍匹配主线对比度补丁；真实产物回归检查控件、弹层、选项与选中项样式、重复应用及原生图片输入控件共存，并将 marker 加入安装树门禁。
- 外链插件补齐 manifest、分发与历史台账，使用项目生成器重建 registry 和 lock，共 16 个登记项；退役 Core Bridge 仍不装配，实际随包 15 个。修正来源引用为 `SOURCES.json#C119`，保持 EAC 自研、禁用自动更新的既有策略。
- 外链插件 6 项 smoke 通过，覆盖外链、同源地址、登录尝试去重、account 流和桥缺失回退；新版官方 account 契约仍提供 `watch`、`attempt.id/phase/authorizeUrl`。新增隔离 profile 复制后的真实 Host 导入用例通过；未进行真实账号登录。
- `npm test`：809 项，765 通过、44 跳过、0 失败，约 161 秒；未设置发行跳过开关。补丁重放两次成功，第二次没有新增对比度改写。
- 干净装配通过（15 个随包插件、643 个生产依赖包）。启动冒烟发现主线 profile 顶层依赖 `full-composition.js` 未装配，已补齐清单、必需文件校验与回归断言；相关 31 项测试通过。随后重新装配及 `verify-staged-runtime.mjs` 通过（44 个必需文件、9 个退役路径），隔离 DSH_HOME 的 sidecar 启动、鉴权重定向 303、页面 HTTP 200、停止/退出及端口关闭通过。没有模型请求或用户会话操作。
- 装配后的外链 Host 真实导入通过；插件 Host/Client、身份元数据、补丁脚本及模型设置产物共五组源树/staged SHA256 一致，对比度 marker 存在。
- 分类器补齐本轮插件台账与 `tauri-shell/distro.mjs` 的路径；PowerShell 7 与 Windows PowerShell 5.1 回归通过，分类结果为 `ready`。Skill 自检保留两个环境警告：所选 Python 缺少 PyYAML，且当前工作流未通过 paths 过滤覆盖 Skill 路径。

本轮日志位于忽略目录 `dsh-desktop/.verify/pr491-conflicts/main-1026-*.log`。上一版 `21e43dce` 的 [Windows/Linux x64/arm64 CI](https://github.com/Ebony-Vinyl/EAC-Desktop/actions/runs/40178269881) 已全部成功；本轮结果以新的 beta 提交为准。实际安装、真实模型请求和旧数据升级/回退仍未验收，V5 保持 **partial**。

## 装配校验测试夹具修复（2026-10-26）

`e5a939e6` 的 CI 在 Linux x64/arm64 和 Windows x64 的自动测试阶段各有 5 项失败；均由 `ci-runtime-scripts.test.ts` 的装配夹具缺少新必需文件 `full-composition.js` 引起，尚未进入安装包构建。上一节 809 项全量结果早于最后的装配校验器修改；之后只复跑的 31 项专项没有覆盖该夹具，不能作为最终提交的全量通过证据。

本次在夹具中补齐该文件，并将必需文件数量断言从 43 更新为 44；新增缺失该文件时必须拒绝的回归。生产装配及校验要求保持不变。修正前本地重现相同 5 项失败，修正后该文件 8 项测试全部通过。

最终代码重新执行完整 `npm test`：810 项，766 通过、44 跳过、0 失败，约 149 秒；未设置发行跳过开关。日志为忽略目录下的 `ci-1026-fixture-before.log` 和 `ci-1026-fixture-full.log`。本次仅修改测试夹具与验收记录，沿用同一生产代码的干净装配和隔离启动证据；跨平台构建以修复提交的 CI 为准。

## 安装版界面与插件管理回归（2026-10-28）

用户实测 Windows 安装版：安装超过五分钟、首启数分钟，默认玻璃壁纸与皮肤叠加导致错位，插件页无法读取插件，切换鲸鱼娘后设置入口不可见。本轮按用户确认的策略改为新装 Lite 默认原生界面，保留皮肤包及手动启用能力。

根因及修复：

- 随包皮肤播种直接写入 profile patch，但同步流程随后把播种前读取的旧文本写回，丢失禁用行。将播种移到读取 patch 之前，五款皮肤均默认关闭，只补缺失的编辑行，不重复 insert；不重写 profile/home 的现有用户选择，畸形 YAML 保持原文件并报告错误。
- 旧播种逻辑会在每次启动时恢复默认虎鲸并修改 home 层，推翻皮肤管理器的选择。取消该强制恢复逻辑，覆盖原生/鲸鱼娘/虎鲸选择、带引号与 CRLF 配置、幂等与用户 home 不变的回归。
- `ds-harness-remote@0.5.2` 的 vendored Gateway 包装器只转发三个参数，丢失 0.2.1 的鉴权 Peer，使插件页报 `gateway/internal: Cannot read properties of undefined (reading 'signal')`。仅修正 vendored 插件的本地转发，保留原 Peer；回归同时验证连接取消仍会拒绝调用，未修改内核鉴权。
- wallpaper-engine 新装默认禁用，桌面插件管理接口与行模型允许用户手动启停；其余核心插件锁定保持既有语义。
- 鲸鱼娘昼夜皮肤将侧栏页脚固定为旧版高度，新内核账户菜单被挤到窗口底部外。在现有设置兼容插件中按皮肤专属属性解除固定 flex basis，让实际内容决定高度；源文件与生成的 lib 同步更新，既有用户安装的皮肤也能得到修复。

运行验收使用重新装配的 Windows x64 Lite 资源、全新隔离 DSH_HOME/APPDATA/USERPROFILE 与 Edge headless，无模型请求或真实用户数据操作：

- 默认无 wallpaper 玻璃属性、无 liang 皮肤属性，五款皮肤的最终 profile patch 均 disabled。
- 官方插件页实际完成加载，出现内置插件配置和实验性插件列表；桌面接口启用/停用 wallpaper 均成功。
- 原生、鲸鱼娘昼夜、深海女仆工坊三种状态均在 1280×800 和 1280×600 下验证设置菜单可点击、弹层可见。昼夜皮肤账户入口由修复前 y=778、底部=810，恢复为 y=746、底部=778（窗口高 800）；600 高时底部=578。
- 两款鲸鱼娘分别完成真实服务重启，皮肤选择保留；最终切回原生成功。页面异常为零；重启期间旧 WebSocket 的短暂断开不计为页面异常。
- sidecar 关闭、鉴权重定向 303、UI HTTP 200、退出及端口关闭通过；资源闭包校验通过（44 必需文件、9 退役路径、643 生产包）；设置兼容插件自身 smoke 通过，专项测试 39/39。最终完整 `npm test` 共 814 项，770 通过、44 跳过、0 失败，约 165 秒，未设置发行跳过开关。

性能证据仅限本机：修改前全新数据目录首次观测服务就绪约 46.6 秒，同一资源树热缓存后约 16 秒；本轮最终隔离测试为 8.046 秒。磁盘缓存、插件状态与机器环境不同，不能将差值当作安装包性能改进幅度。未测量真实 NSIS 安装、WebView2 引导下载及用户设备首启，用户报告的安装超过五分钟仍待新版安装包复测，V5 保持 **partial**。没有为加速削弱完整性校验或裁剪未经验证的运行资源。

证据位于忽略目录 `dsh-desktop/.verify/pr491-ui-startup/`，包含 `before.log`、`stack2.log`、`final-ui.log`、`stage.log`、`targeted.log`、`full-test-final.log` 及界面截图。实际账户登录、模型请求、微信/远程网络功能与旧数据升级/回退沿用未验收状态；合并 main 仍需完成安装版验收。


## 安装版第二轮反馈与修复（2026-10-28）

用户补充：安装版安装 18 分 33 秒，首次启动 1 分 6 秒，后续十几秒；`file-changes` 和 `unified-market` 未切换皮肤就显示启动失败；从「设置 → 皮肤管理」将鲸鱼娘昼夜工坊切到虎鲸链路出现图层重叠。

本轮修复范围：

- `unified-market` 注册的两条 HTTP 路由未随卸载注销；`file-changes` 若中途注册失败，前面已注册的路由无法回收。改用 Cordis generator 逐条登记 disposer，市场重载时同时复位退出标记。真实 Cordis 回归覆盖重复加载/卸载、中途注册冲突、失败清理与重试。全新隔离目录没有复现用户的首启失败，不能据此确认用户故障的唯一根因。
- 皮肤激活接口此前只写配置即返回，客户端固定 1.2 秒刷新。现在等待内核在独占队列中完成 profile reconcile 再返回；需要重启或激活失败则恢复原 patch 并返回错误。客户端收到成功才刷新。异步 HTTP 回归验证响应不会早于激活完成，激活错误会传回调用方。
- 旧版随包皮肤管理器首次复制后永不更新，修复代码无法送达既有安装。现在更新带 EAC 戳记的副本，并按两个旧入口文件的固定 SHA256 识别此前未打戳的内置副本；无戳记且不匹配旧内置字节的用户安装版本保留。已用上一提交的真实文件验证升级与幂等，回归覆盖受控更新和用户副本保留。空数组 profile patch 补默认行后保持合法 YAML。
- wallpaper 包登记为本地依赖与 bundle，使左侧官方「插件」页可发现。保持组件出厂关闭；旧配套 insert 转为编辑行前保存一次原 patch 备份（`.before-wallpaper-bundle.bak`），转换时保留配置和启停选择；用户取消选择 bundle 后不在下次同步中加回。官方页面区分包开关与详情的组件开关，设置内的「插件列表」仍是内核只读清单。清单中预设下的「插件管理工具」是供 Agent 使用的工具，不代表插件页面被关闭。
- 装配阶段删除 JS/CSS 调试映射及 Zod 自测目录，保留运行代码、运行时类型声明和皮肤资源。已装配树减少 11,643 个文件，当前约 58,721 个文件；资源闭包仍为 643 个生产包。该数字为装配树，不是最终安装器体积或用户设备安装计时。

本轮仍不将安装性能标为解决：未在用户设备测量新 NSIS 安装，也没有用户故障时的内核堆栈。用户报告的 18 分 33 秒和首启 66 秒必须用新 CI 安装包复测。真实 Tauri/WebView2、账号模型请求、旧数据升级回退与其他第三方插件兼容继续保留未验收；V5 为 **partial**，不据此合并 main。

验证日志与截图保存在忽略目录 `dsh-desktop/.verify/pr491-ui-startup/`；自动验收结果以下方最终记录为准。


最终运行验收（本轮 staged Windows x64 Lite + 临时 DSH_HOME + Edge）：真实点击「设置 → 皮肤管理」，按鲸鱼娘昼夜工坊 → 虎鲸链路 → 深海女仆工坊 → 鲸吟 → 官方顺序切换，由客户端自行刷新；每一步断言仅有当前皮肤的样式来源，最终原生无皮肤样式和属性。wallpaper 在官方插件详情中实际启用/关闭，启用后 inventory 返回 200；再通过包开关关闭并重启服务，仍可发现且保持关闭。`file-changes`、`unified-market` 在首启、切换后、重启后清单均正常；pageerror 为零，鉴权 303、UI 200、退出及端口关闭通过。服务重启期间旧 WebSocket 的连接失败单独记录，不算页面异常。截图为 `switch-day-night.png`、`switch-orca.png`、`wallpaper-enabled.png`。

完整自动测试：825 项，781 通过、44 跳过、0 失败；生产资源闭包校验通过（44 必需文件、9 退役路径、643 包）；插件台账生成与校验通过（16 项）。开发分类器补齐本次裁剪脚本的规则和回归，最终状态 ready；Skill 自检在 PowerShell 7 与 5.1 通过，保留其已有 CI paths 与可选 Python/PyYAML 校验警告。最后结果以 `full-verified.log`、`ui-verified.log`、`stage-final.log`、`classify-final.json`、`skill-final.json` 为准。

## 插件设置卡顿复测（2026-10-30）

用户使用新安装包在 VMware Workstation 中复测：安装约 7 分钟，首次启动约 1 分钟，皮肤切换重叠消失；进入插件设置仍卡顿，wallpaper 入口仍难以找到。首启时间与此前 66 秒接近，不能宣布首启性能显著改善。片头片库每次启动播放与入口显眼度按用户要求留给独立 PR。

本机隔离 staged 运行时复现：进入「设置 → 内置插件」默认打开统一市场，在线目录返回 6,815 条记录，旧实现将分类目录全部挂载，连同更新提示共 6,820 张卡片、89,088 个 DOM 节点。Edge 采用 4 倍 CPU 降速时，最长主线程任务为 31.708 秒；采样显示大量时间用于布局查询和设置滚动兼容插件的节点扫描。这是页面渲染阻塞，不应仅以下载目录耗时解释。

将精选目录改为每页 50 条；搜索、分类、已安装筛选和排序仍基于完整目录，条件改变回到第一页，跨分类分页保留每组总数。没有修改后台安装、更新或插件启停协议。回归执行真实客户端组件，验证 6,815 条记录均可翻页访问、不丢失跨分类记录，以及搜索末尾记录、分类与排序后的页码重置。

重新装配后使用相同 4 倍 CPU 降速与在线目录：原生界面仅 1,315 个 DOM 节点，最长任务 0.799 秒；鲸鱼娘昼夜界面为 1,414 个节点，最长任务 0.587 秒。该测量来自主机隔离 Edge，不能替代虚拟机真实 Tauri/WebView2 安装版性能验收。证据在忽略目录 `dsh-desktop/.verify/pr491-ui-startup/` 的 `settings-diagnose.log`、`settings-after.log` 和 `settings-native.png`、`settings-whale.png`。

虚拟机接入检查：VMware 控制台可读取画面，但主、副屏上的自动点击均未验证可靠；当前未配置共享文件夹，SSH 检查无响应，`vmrun` 查询因虚拟机加密要求密码。没有宣称已建立完整远程测试连接，也没有修改加密、网络、共享配置或恢复快照。wallpaper 仍沿用左侧「插件 → dsh-plugin-wallpaper-engine 详情 → 包含的组件」开关，组件启用后才注册设置中的 Wallpaper Engine 页面；虚拟机内该入口的实际状态仍待验证。

最终完整 `npm test`：827 项，783 通过、44 跳过、0 失败，约 174 秒，未设置发行跳过开关。插件台账校验通过（16 项），分类器 ready，装配通过（643 个生产包）；隔离运行时鉴权 303、UI 200、退出与端口关闭通过。运行时停止日志仍有未确认旧服务退出的提示，最终服务进程确已退出且端口关闭。V5 继续为 **partial**，本轮没有合并 main。

## 补回 Our Free Model 内置插件（2026-10-30）

用户报告 #487 提供的 Our Free Model 在测试安装包中缺失。核对发现 #486 先合入 main，随后 #487 的提交 `8dd0c805` 合入了已合并的中间分支 `fix/lock-drift-after-478`，没有再进入 main 或 beta；不是插件界面隐藏造成的。

补入 #487 的 2.5.2 随包文件，登记到当前 distro 装配清单、配套运行时注册表、分发清单、历史及来源台账，并重新生成 registry/lock。渠道包 `pack.js`、WASM 和许可文件一起入库；两级 vendor 忽略规则仅匹配各自根目录。插件复制清单补齐 `adapter/` 和图标，保留现有 `locale/` 支持。原 C116 已由开机动画使用，OFM 改记 C121；79 个随包文件中仅 identity 元数据的台账引用与 #487 不同，运行代码及渠道资源保持原字节。未合入该 PR 的无关打包预算或文档改动。

全量 `npm test`：828 项，784 通过、44 跳过、0 失败，约 166 秒。新增实际复制后导入 OFM host 与渠道包的回归，并核对 WASM、文案、图标及许可落位。台账与派生 registry 校验通过（17 项），生产资源装配通过（643 包）。

全新隔离数据目录、Windows x64 Lite staged sidecar + Edge 验证：鉴权 303、UI 200；`/api/our-free-model/summary` 返回 200，`channels.state=ready`；完成首次公告后可从「设置 → Our Free Model」打开模型、渠道及网关等设置，pageerror 为零，profile 中仅一条插件挂载行。停止日志仍有既有旧服务退出确认提示，最终 sidecar 正常退出、Web 端口关闭。证据在忽略目录 `.verify/pr491-ui-startup/` 的 `ofm-full.log`、`ofm-stage.log`、`ofm-runtime.log`、`ofm-settings.png`。

本轮未发送真实推理请求、登录账号或启用局域网转发；以上是装配后隔离运行验收，不能代替虚拟机中的真实安装/升级测试，V5 仍为 **partial**。需使用本次新增提交的 CI 安装包确认入口及实际模型调用后，再决定合并 main。
