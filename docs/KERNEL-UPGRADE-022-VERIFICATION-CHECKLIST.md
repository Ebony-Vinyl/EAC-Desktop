# 0.2.2-rc.1 后续验证清单

对象：EAC-Desktop 6.1.0 + dsh 0.2.2-rc.1（分支 `feat/dsh-0.2.2-rc1`，提交 `a795bbc1`）。
分级口径见 [EAC-Desktop-开发说明.md](../../EAC-Desktop-开发说明.md) §9；改动地图见 [KERNEL-UPGRADE-022-ADAPTATION.md](KERNEL-UPGRADE-022-ADAPTATION.md)。

**铁律**：跑不了的验证必须写明原因与残余风险，不能记成「已通过」；自动化跑完但环境/事务项没做的，V5 结论只能是 `partial` 并列 `unverifiedChecks`。

## 现状总览

| 级别 | 内容 | 状态 |
| --- | --- | --- |
| V1 定向 | 补丁锚点、`node --check`、定向用例 | 通过 |
| V2 全量 | `836 / 788 通过 / 0 失败 / 48 跳过`（Node 24.18.0） | 通过 |
| V2 附加 | `plugin-kernel-compat.mjs`（服务端 76 文件） | 通过（客户端 bundle 未覆盖，见 §6） |
| V3 壳契约 | `check-dpx-pin` / `cargo fetch`+`cargo check --locked` / `--bridge-test` | 通过（2026-11-11） |
| V3 壳契约 | sidecar 启停与退出清理（`/api`、web 端口就绪随 V4 验） | 通过（shutdown 后无残留） |
| V4 运行时 | `minimal-boot-smoke`（无界面） | 通过 |
| V4 运行时 | `e2e-v4.js`（安装版 + CDP） | **未跑**（需独占实例；脚本 `verify-k022/tools/run-c1.ps1` 就绪） |
| V4 运行时 | 隔离实例 + 手工 16 项 + 客户端 console 采集 | **partial**（通过 8 / 部分 1 / 未覆盖 3 / 未做 3 / 未验证 1，见 §3.3.1、§6） |
| V5 装配 | `stage-resources` + `verify-staged-runtime` | 通过（`required=44 retired=9 packages=675`） |
| V5 分发 | NSIS、便携 zip、真实安装/升级/故障注入 | **未做** |
| CI | `staged-runtime-artifact` 首轮 | **未跑** |

## 0. 前置

```bash
# 本机测试与装配必须用 Node 24：项目测试传 stripTypeScriptTypes mode:'transform'，
# Node 26 只接受 'strip'，会整片报 ERR_INVALID_ARG_VALUE。
export PATH="/h/Agent/Deepseek Harness EAC v6.0.1/dsh-desktop/vendor/node:$PATH"

# 隔离环境 HOME 在 eac-beta\\home，cargo 会找不到宿主机 registry。
export CARGO_HOME=/c/Users/asus/.cargo RUSTUP_HOME=/c/Users/asus/.rustup
```

- 内核已变更，装配**不能**加 `--skip-npm`。
- npm 需要网络时显式加 `--proxy=http://127.0.0.1:7890 --https-proxy=http://127.0.0.1:7890`（环境变量不被可靠采纳）。

## 1. 已完成的验证（留证，复查时可重跑）

| 命令 | 判据 | 结果 |
| --- | --- | --- |
| `cd dsh-desktop && npm test` | 0 fail | 836 / 788 / 0 / 48 |
| `node dsh-desktop/scripts/plugin-kernel-compat.mjs` | 无缺失导出 | 17 插件 / 76 文件 / 1 具名导入 / 跳过 102 客户端文件 |
| `node tauri-shell/stage-resources.mjs --target=win32 --distro=lite` | EXIT=0 且 bundle manifest 生成 | 675 包 / 裁剪 12805 / EXIT=0 |
| `node dsh-desktop/scripts/verify-staged-runtime.mjs` | PASS | required=44 retired=9 packages=675 |
| `node dsh-desktop/scripts/minimal-boot-smoke.mjs` | PASS 且 orphan-web=false | 303=303 ui=200 retired-rpc=2 orphan-web=false |

复核（2026-11-11，Node 24.18.0）：`minimal-boot-smoke` 重跑仍 `303=303 ui=200 retired-rpc=2 orphan-web=false`；`verify-staged-runtime` 仍 `required=44 retired=9 packages=675`。

`boot.stop` 时 stderr 稳定出现 `[service] 未确认旧服务进程退出（PID …）` 与 `[dsh] 进程退出 code=1`：那是 `dsh-desktop/lib/desktop/proc.ts:68` `killTreeAndWait` 的软杀→硬杀两级路径 —— 软杀后 1.2 s 内未确认退出即打印该行（`proc.ts:208`），随后 `/f` 硬杀并确认退出，进程以 code=1 结束属被强杀。判据看 `orphan-web=false` 与 sidecar 退出码 0，这两行不是失败信号。

## 2. V3 壳契约（必做，虽然本次没改 Rust）

内核换代后 sidecar 与内核的握手、RPC 面都要在真实壳里成立；这几步不需要 GPU/桌面，先跑。

- [x] `node tauri-shell/check-dpx-pin.mjs` —— `[dpx-pin] OK：dsh-dpx 停在固定提交 95f1822…，工作树干净`
- [x] `cd tauri-shell && cargo fetch --locked` —— 锁文件可解，无报错
- [x] `cargo check --locked` —— 壳侧编译通过（含 sidecar 资源嵌入）：`Finished dev profile in 8m 04s`，仅 4 条 linux 专用函数 unused 警告
- [x] `cargo run -- --bridge-test` —— bridge parity 5/5 通过，退出码 0
- [x] sidecar 启停：`ping` / `shell.info` / `profile.name` / `updates.status` / `client-update.settings` 均按契约返回，`shutdown` 后日志 `cleanup-start` → `cleanup-complete`，进程表无残留 `node.exe`
- [x] 记录：`cargo 1.98.1` / `rustc 1.98.1`（stable-x86_64-pc-windows-msvc）；末段 `[bridge] 5/5 checks passed`

`/api` 与 web 端口就绪只能在真实启动路径（V4）里验，不在本节。

判据：任一项非 0 退出即阻断 V4/V5，先修再继续。

## 3. V4 运行时

### 3.0 `e2e-v4.js` 的设置命名空间断言

设置面在 0.2.2 由 `dsh-api-settings-controller` 承载（`dsh-host-apiproxy` 已停发，Host 面拆成 `dsh-api-*`）。

`dsh-desktop/scripts/e2e-v4.js:303-310` 读 `@deepseek-ai/dsh-api-settings-controller/lib/index.js`，断言含 `settings.describe`（落点 :398 `settings.describe({ redactSecrets: true }).map(namespaceView)`）且不含 `WEB_SETTINGS_NAMESPACES`；读不到文件时 `check` 判失败，不把「包不存在」当作通过。

- [x] `node --check dsh-desktop/scripts/e2e-v4.js` 通过；把装配闭包 `tauri-shell/staged-resources/dsh-desktop/node_modules` 当作 `junctionNm` 跑同一段逻辑，结果 `describe=true whitelist=false`
- [x] 同一闭包里 `dsh-workspace/lib/index.js` 含 `dsh-desktop patch (session manage)`（022 补丁插入注释沿用同一标记），该断言随之成立
- [x] 真实 home 取证：`<home>\profiles\node_modules\@deepseek-ai\dsh-api-settings-controller` 是指向安装闭包的链接（本机 6.0.1 实例实测），链接目标内 `settings.describe` 在 `:397`、无 `WEB_SETTINGS_NAMESPACES`，与 0.2.2 闭包的 `:398` 同构 —— 断言依赖的是「安装闭包里有这个包」，不随内核换代改变
- [ ] 真实 exe 跑（§3.2）

### 3.1 构建安装版

- [ ] `cd tauri-shell && npx -y @tauri-apps/cli@2 build --verbose`
- [ ] 产物：`tauri-shell/target/release/bundle/nsis/*-setup.exe`，记录文件名与体积
- [ ] 安装到**含中文与前空格的路径**（例：`D:\测试 目录\EAC`）

### 3.2 自动化 E2E（CDP 驱动真实渲染进程）

- [ ] `node dsh-desktop/scripts/e2e-v4.js --exe "<安装后的 exe>" --mode fresh --tag k022-fresh` —— 空 `DSH_HOME`/`APPDATA` 冷启动：profile 初始化、配套插件同步、首次向导、Web UI 就绪、`window.dshDesktop` 存在、插件市场 API 可达
- [ ] `... --mode upgrade --tag k022-upgrade` —— 复制既有 `~/.dsh` 数据后启动，升级路径不崩
- [ ] 两条都必须 0 failed；失败项逐条记录判定依据

> **2026-11-11 本轮未跑**：e2e 要独占单实例锁，必须先退出隔离实例，而执行验证的 agent 本身就住在该实例里（shell→sidecar→内核→agent），退出即中断本轮。现成编排脚本：[verify-k022/tools/run-c1.ps1](../../verify-k022/tools/run-c1.ps1)（清场 → fresh → upgrade → 重启实例，日志落 `verify-k022\logs\c1-*.log`）。

### 3.3 手工验收（自动化覆盖不到的可见行为）

每项记「通过 / 失败 + 现象」，失败要带截图或日志。

| # | 项 | 判据 |
| --- | --- | --- |
| 1 | 中文路径启动 | 装到含中文/空格路径后能启动，WEB UI 200，插件与皮肤加载 |
| 2 | 浮窗 | 主窗 ↔ 浮窗切换正常，位置与尺寸记忆生效 |
| 3 | 托盘 | 图标出现；菜单项齐全；最小化到托盘；退出后托盘图标消失 |
| 4 | 退出零孤儿 | 退出 10 秒内任务管理器无 `dsh`/`node`/`sidecar` 残留，端口释放 |
| 5 | 设置弹窗宽度 | 面板宽随主窗变化（上限 1280px），1440 宽窗下明显宽于 800px |
| 6 | 设置弹窗拖拽 | 右下角可横向拉伸，最小 640px，拉伸后左栏与内容区不变形 |
| 7 | 设置左栏滚动 | 窗口变矮时左栏可滚到底，底部不留白、不遮盖 |
| 8 | submenu 两行标签 | 二级菜单项标签完整显示（不裁切、不省略号） |
| 9 | submenu 悬停保持 | 鼠标从一级移入二级菜单不消失；离开 600ms 后收起 |
| 10 | submenu 长列表 | 菜单项多时内部可滚，不超出窗口（`calc(100dvh - 96px)`） |
| 11 | 皮肤 | 13 款逐一切换，深/浅色正常，无白屏与控制台报错 |
| 12 | 内置插件界面 | 17 个随包插件各自打开设置/面板，控制台无红错（重点：eac-core-bridge、easy-setup、unified-market、plugin-shield、wechat、file-changes、compact） |
| 13 | 会话删除 | 空闲会话可删；运行中会话被拒并提示 `workspace/session-active`；删后列表与磁盘目录同步消失 |
| 14 | 归档/恢复 | 归档后从归档视图恢复，槽位与顺序保持 |
| 15 | 模型下拉 | 设置 → 模型，下拉选项文字与底色对比正常（可读） |
| 16 | 可选升级字段 | agent 模式/工具配置里 pwsh / fs / bash 的升级选项存在且可保存 |

#### 3.3.1 本轮实测（2026-11-11，隔离实例 6.1.0 + 0.2.2-rc.1，headless Edge + CDP）

| # | 项 | 结论 | 关键实测 |
| --- | --- | --- | --- |
| 1 | 中文路径启动 | 通过 | exe 与 `DSH_HOME` 均在含中文/空格路径下，Web UI 200，皮肤与插件加载正常 |
| 2 | 浮窗 | 未做 | agent 无桌面输入通道；WebView2 内无窗口句柄可驱动 |
| 3 | 托盘 | 未做 | 同上（壳层 Win32 资源） |
| 4 | 退出零孤儿 | 未做 | 归 e2e C 段（`chrome:menu quit`）覆盖，即 §3.2 |
| 5 | 设置弹窗宽度 | 通过 | 视口 1416 → 面板 1062px；`min-width:640px`、`max-width:1368px`（与本节「上限 1280px」口径不符，见 §8 风险） |
| 6 | 设置弹窗拖拽 | 通过 | 1062→980 跟手；再拉到 640 后不再缩小；内容不塌 |
| 7 | 设置左栏滚动 | 通过 | 视口 328 高：`scrollHeight 436 > clientHeight 236`，滚到 max 后末项与容器底齐平、`gapBelow=0` |
| 8/9/10 | submenu 三项 | 未覆盖 | 本安装形态下设置左栏是单行 `navCell`，没有二级 submenu，无法复现 |
| 11 | 皮肤 | 通过（lite 范围） | lite 只随 4 款（官方默认/鲸鱼娘昼夜/深海女仆/鲸吟/虎鲸链路），逐一切换触发整页重载，无白屏、无 console 报错 |
| 12 | 内置插件 | 通过（lite 范围） | 插件页 16 个可查看项逐个打开 0 报错；微信/插件保护/一键迁移/Our Free Model/内置插件设置页正常渲染。lite 只随 15 个插件，本节点名的 eac-core-bridge 等多数无独立面板 |
| 13 | 会话删除 | 通过（用户自测） | 空闲会话可删、列表与磁盘目录同步消失；运行中会话删不掉（被拒），符合判据。踩坑：对「当前正在查看的那一行」右键不弹菜单（切走即恢复）；对运行中会话点删除会让 headless 标签页 renderer 无响应，属测试驱动方式的限制 |
| 14 | 归档/恢复 | 部分 | 三档归档视图切换正常；归档/恢复动作本轮未做（入口在会话右键菜单，菜单可用；为不动既有归档数据未执行） |
| 15 | 模型下拉 | 通过 | `rgb(231,236,247)` on `rgb(8,15,39)`，对比度 16.01:1；本机仅 1 个可选模型 |
| 16 | 可选升级字段 | 未验证 | 设置 10 页、16 个插件面板、`dsh-agent-preset`/`dsh-tool-pwsh`/`dsh-tool-fs` 均无 pwsh/fs/bash「升级选项」，需给出确切入口再验 |

证据与逐条复现细节见 [0.2.2-rc.1-隔离验证交接.md](../../verify-k022/0.2.2-rc.1-隔离验证交接.md) §R2。

### 3.4 单实例与共享数据目录（验证必须串行）

三个机制决定了不同版本的 EAC **不能并行验证**，也不能在同一台机器上随意来回切：

| 机制 | 事实 | 后果 |
| --- | --- | --- |
| 单实例锁 | `tauri-shell/tauri.conf.json:5` 的 `identifier` 固定为 `com.deepseek.dsh.desktop.tauri`，`main.rs:5034` 用 `tauri_plugin_single_instance` 注册 | 任何版本（含便携版）已在运行时，再启动另一个版本会被并入已有实例：新进程只把参数转发、聚焦旧窗口后退出。**自动化会被静默吞掉**——exe 启动了却打开的是旧窗口，`e2e-v4` 变成假失败 |
| 共享 DSH_HOME | 默认 `~/.dsh`（`environment.ts:193` 支持 `DSH_HOME` 覆盖），profile / sessions / settings / skills 全共享 | 新版启动会改写 profile（随包插件登记、皮肤落位、patch 行、内核闭包 junction）。改完后旧版本再启动读到的已经是新 profile |
| 固定 web 端口 + 旧进程等待 | 端口走 `stable-port` 的 `chooseStableWebPort`；`proc.ts:207` 对旧服务进程轮询到超时后报「未确认旧服务进程退出」并停止后续操作 | 旧实例占着端口时，新实例要么换端口要么卡在等待 |

编排要求：

- [ ] 跑 `e2e-v4` 或手工验收前**清场**：`tasklist | findstr dsh-eac-shell` 应为空；被占用就先退出所有版本
- [ ] `e2e-v4` 已把 `DSH_HOME` / `APPDATA` / `LOCALAPPDATA` 指向临时目录（脚本 131–178 行），但单实例锁是 OS 级、不随这些变量变化 → 隔离数据目录**不能**替代清场
- [ ] 手工验收会写真实 `DSH_HOME`：先备份 `~/.dsh` 并记录 `profiles`/`sessions` 哈希，收工后对比，确认没有意外改写
- [ ] 升级验证只做正向序列（旧版 → 新版）。新版写入 profile 后再回退旧版不在支持范围；要回退必须先还原备份
- [ ] 需要两个版本同时开时，用另一个 Windows 用户账户（锁按登录会话）或临时改 `identifier` 构建测试版——后者会改变产物，不能当发布验证
- [ ] 双版本行为本身也要断言：旧版运行中启动新版 → 应聚焦旧窗口且不崩（不应出现两个窗口抢端口）

## 4. V5 分发

- [ ] 用最终代码重跑 `stage-resources.mjs`（不带 `--skip-npm`）+ `verify-staged-runtime.mjs`
- [ ] NSIS 安装包构建（§3.1 同一命令），`name-lite-installers.mjs` 命名规则正确
- [x] 便携包：`node make-portable.mjs` → `v6.1.0-lite-x64.zip`（319.1 MB / 334 620 319 B，40499 条目，SHA256 `6F08FFC4…`）+ `SHA256SUMS.txt`；解包到 `verify-k022\app\`（39863 文件）后内核 `0.2.2-rc.1`、产品 `6.1.0`
- [ ] NSIS 安装包：`tauri build` 的 bundle 阶段报 `timeout: global`（拉 NSIS 工具超时），`*-setup.exe` 未产出
- [ ] 全新用户安装：空 `DSH_HOME`/`APPDATA` → 向导可走完 → 首条消息可发
- [ ] 升级安装：6.0.1 → 6.1.0(0.2.2)，profile 与插件保留、用户配置不丢、**数据目录哈希不变**（安装前备份 `~/.dsh`，见 §3.4）
- [ ] 卸载：不留残留目录与注册项（除用户数据，按既有策略）
- [ ] 故障注入：安装中锁定文件、断网、进程被 kill 后重试 → 可恢复且不写坏状态
- [ ] 更新链路：`create-update-manifest.mjs` / `sim-client-update.js` / `check-manifest-drift.mjs` 全部 0 失败
- [ ] 便携整树交换：改动的字符串长度不能破 `installer-nsh-lengths.test.ts`（V2 已覆盖，安装时复验一次）
- [ ] **full 档未覆盖**：本机只能产 lite。仓库 `src/dsh-desktop/assets/` 没有 `full-pack/`（6.0.1 安装版那里是 936 MB，含 `composition.json` + `profile-closure.json` + `profile-seed/`，seed 内 62 deps / 64 bundles、含 `eac-plugin-suite@0.2.4`），落位由 `src/dsh-desktop/lib/desktop/full-composition.ts:21`（读 composition.json）与 `:88`/`:314`（用 profile-seed 建 profile）完成。要产 full 档必须带上这套载荷（composition.json 记 `packCommit ee159871e953f52dfe95d6259678bacf5ffe3272` / `coreCommit c8668db65f25dd10a78fd31501877d6e2f087ef0` / `dpxCommit 95f18221640ef36cc10e83dbfdf7c48d2744044c`）；只跑 `stage-resources.mjs` 默认仍是 lite（`profile.txt` 标记见 `stage-resources.mjs:407`，`make-portable.mjs:77-90` 据此命名）
- [ ] Linux/macOS：本次不做，登记为 `unverified`（分支只跑 win32 装配与安装）

## 5. CI 首轮

- [ ] 推送后看 `staged-runtime-artifact`：`NODE_VERSION=24`（setup-node 取最新 24.x，满足 ≥24.9）、`PNPM_VERSION=11.28.5`、`KERNEL_VERSION=0.2.2-rc.1`
- [ ] 产物可下载并解包，内核版本为 0.2.2-rc.1
- [ ] 若失败，按日志区分「工作流配置问题」与「内核/依赖问题」再修

## 6. 兼容性补测（客户端 bundle）

`plugin-kernel-compat.mjs` 跳过 102 个客户端 bundle 文件，所以「17 个插件 + 13 款皮肤的客户端代码是否用到了被移除的内核客户端 API」目前没有静态结论。

- [x] 在安装版里逐款启用皮肤、逐个打开插件面板，用 CDP 收集 `console.error` 与 `pageerror`（lite 包范围：4 款皮肤 / 16 个可查看插件）
- [x] 出现 `is not a function` / `undefined is not an object` 一类，记录包名与调用栈，回填到补丁或插件（本轮未出现）
- [x] 结论写进本节，不要只写「无异常」

**2026-11-11 隔离实例实测（CDP 事件流 + `console.error`/`onerror`/unhandledrejection 钩子，原始记录 `verify-k022\logs\console.jsonl`）**：

- 覆盖：4 款皮肤逐一切换（每次整页重载）、16 个插件面板逐个打开、设置 10 个页面切换、模型菜单、归档视图三档切换。
- 结果：**0 条 `console.error`、0 条 `pageerror`、0 条 unhandledrejection**。唯一 `log.error` 是浏览器侧 `GET /favicon.ico 404`（桌面 WebView 不请求该资源，属噪声）。
- 已发现的客户端异常（不是 `is not a function` 类）：`dsh-wechat-plugin: 客户端错误[mount]: 插件已加载，但设置页在 20 秒内没有渲染（看门狗触发）`，**每次页面加载后触发一次**（累计 6 条），而微信设置页实测可正常渲染（10 691 字内容、无报错）→ 判定为看门狗误报（以「加载后 20 s」判「设置页未渲染」，设置页是懒加载），登记为待修项。
- 限制：本轮用的是 lite 便携包（4 皮肤 / 15 插件），清单里「13 款皮肤 + 17 插件」的全量组合未覆盖。

## 7. 结果记录

| 日期 | 级别 | 命令/项 | 结论 | 备注 |
| --- | --- | --- | --- | --- |
| 2026-11-10 | V2 | `npm test` | 通过 | 836/788/0/48 |
| 2026-11-10 | V5 | 装配 + verify | 通过 | 675 包、44 必需文件 |
| 2026-11-10 | V4 | `minimal-boot-smoke` | 通过 | 303=303 |
| 2026-11-11 | V3 | `check-dpx-pin` / `cargo fetch`+`cargo check --locked` / `cargo run -- --bridge-test` | 通过 | dpx-pin OK；cargo 1.98.1 / rustc 1.98.1；bridge 5/5、EXIT=0、shutdown 后无残留 |
| 2026-11-11 | V4 | `e2e-v4.js` 断言修复（§3.0） | 完成 | `node --check` + 装配闭包模拟 `describe=true` |
| 2026-11-11 | V4 | `minimal-boot-smoke` 复核 | 通过 | 303=303 ui=200 orphan-web=false；`boot.stop` 的两级停止日志不算失败 |
| 2026-11-11 | V4 | 隔离实例启动（B 阶段） | 通过 | 便携 exe PID 21832；内核 0.2.2-rc.1 / 产品 6.1.0；Web UI 58792 带 token 200；数据落 `eac-stable\dsh-home`；`profiles\node_modules` 仅别名层；`run\dsh-home` 为空 |
| 2026-11-11 | V4 | 手工 16 项（隔离实例，CDP 驱动 + 用户自测） | **partial** | 通过 8 项（1/5/6/7/11/12/13/15；13 会话删除由用户自测：空闲可删、运行中删不掉）、部分 1 项（14 归档视图可切、恢复动作未做）、未覆盖 3 项（8/9/10 submenu 形态不存在）、未做 3 项（2 浮窗/3 托盘/4 退出零孤儿，agent 无桌面输入通道）、未验证 1 项（16 无可定位入口） |
| 2026-11-11 | V4 | C3 客户端 console 采集 | 通过 | CDP 事件流覆盖 4 皮肤切换 + 16 插件面板 + 设置 10 页；0 console.error / 0 pageerror；唯一 404 为 favicon.ico；另见 wechat 看门狗误报（§6） |
| 2026-11-11 | V4 | D1 6.0.1 home 快照比对 | 通过（有噪声差异） | `before=50796 now=50797 added=1 changed=6`；差异 mtime 全在 13:56–14:02 与 17:19–17:20（6.0.1 与上一轮 agent 会话），本轮 17:32 之后无写入 |
|  | V4 | `e2e-v4 fresh/upgrade` | **未跑** | 需独占单实例锁，执行即中断住在该实例里的 agent；脚本 [run-c1.ps1](../../verify-k022/tools/run-c1.ps1) 已就绪 |
| 2026-11-11 | V5 | `make-portable` + 解包到 `verify-k022\app\` | 通过 | 319.1 MB / 39863 文件 / 内核 0.2.2-rc.1；抽样 md5 与 `staged-resources` 一致 |
|  | V5 | NSIS 安装包 / 安装升级 / 故障注入 |  |  |
|  | CI | 首轮 |  |  |

## 8. 残余风险登记

1. **`e2e-v4.js` 有两条断言依赖装配闭包的具体文件名**：`dsh-workspace/lib/index.js` 的补丁标记、`dsh-api-settings-controller/lib/index.js` 的 `settings.describe`。内核再重组 Host 面时它们会先失效，V4 首条失败项优先查这里。
2. **客户端 bundle 未静态核验**（102 文件）——只有 GUI 实测能覆盖。
3. **Linux/macOS 未验证**：分支只跑 win32 装配，别声称跨平台可用。
4. **便携整树交换、安装器断电恢复**：本机故障注入只能模拟常见路径，不能覆盖真实断电。
5. **单实例锁与共享 DSH_HOME**：不同版本无法并行、且共用同一 profile；并行验证结论不可信，回退旧版需还原备份（§3.4）。
6. **会话删除已通过（用户自测）**，但有两个观察项值得记：① 对「当前正在查看的那一行」右键不弹会话菜单（切到别的会话后恢复）——若后续要做 UI 自动化验收，需先切换选中项；② 对运行中会话点「删除对话」后，headless 浏览器的该标签页 renderer 无响应（`Runtime.evaluate`/`Page.enable` >90 s 超时），桌面端行为正常，属测试驱动方式的限制。
7. **设置面板 max-width 实测 1368px**（视口-48），与本清单 §3.3 #5 写的「上限 1280px」不一致；1440 宽窗下 1062px 仍满足「明显宽于 800」，但上限口径需确认。
8. **wechat 插件看门狗误报**：每次页面加载后 20 s 报一次「设置页没有渲染」，实际可渲染；会污染 `dsh-web.log` 与错误上报。
9. **CI 首轮尚未跑**：两条工作流的 `KERNEL_VERSION` 都已指向 `0.2.2-rc.1`（`release-6.1.0.yml:50`、`staged-runtime-artifact.yml:15`），但分支未推送，Actions 一次没跑过，首轮结论只能看远端日志。
10. **full 档行为零覆盖**：本轮所有 GUI 验收都在 lite 便携包上做。判断档位的权威口径不是 `profile.txt`（`stage-resources.mjs:405` 注释：该标记不能用来判断是否装了 EAC-Pack），而是 **profile 里有没有 `eac-plugin-suite`**（`src/dsh-desktop/lib/desktop/lite-skins.ts` 的 `isLiteProfile`）。因此 lite 上「设置页没有整合包那一页」是档位差异，不是升级回归；反过来，full 档的整合包页、`eac-plugin-suite` 的安装/更新链路本轮一次都没跑过，发安装版前必须有带 `full-pack` 载荷的构建来补验。
