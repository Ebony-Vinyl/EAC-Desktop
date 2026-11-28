# ADR 0004: EAC 安装环境隔离（dsh-dpx 采用）

日期：2026-09-27（2026-09-28 修订：改为直接采用 dsh-dpx）

状态：已接受，分阶段实施

## 背景

EAC 直接使用宿主 `%USERPROFILE%\.dsh` 时，旧版本 profile 的插件、`node_modules` 和 patch 会被新内核继续读取。实测表现为旧插件 pending、插件加载失败和白屏。

隔离这件事本身不是新问题：环境根、路径变量绑定、机器级注册表、创建锁、损坏检测都已经是 `dsh-dpx` 的既有能力。EAC 自己再实现一套，会立刻产生第二个事实源——两边对「环境根在哪、哪些变量要清、注册表损坏怎么办」各说各话，而这正是最容易被忽略、也最难排查的一类漂移。

## 决策

**EAC 采用 `dsh-dpx`（固定提交 `95f18221640ef36cc10e83dbfdf7c48d2744044c`，submodule 于 `third_party/dsh-dpx`）作为环境隔离的唯一实现**，只通过它的 JS API 调用：

```js
const record = await dpx.createEnvironment({
  name: 'eac-beta',              // dpx 环境名规则：/^[A-Za-z][A-Za-z0-9-]{0,63}$/
  storageRoot: '<产品数据根>/dpx',
  home: '<产品数据根>/DSH/DPX',   // 机器级注册表（DPX_HOME）
  desktop: false,                 // 不用 dpx 的桌面启动器
  publishDiscovery: false,        // 不写 HKCU 发现键
});
const paths = dpx.pathsFor(record.root);
const runtime = dpx.runtimeEnvironment(paths, inherited, { name: record.name, registryHome: home });
```

分工：

- **L1 Rust 壳**：只传两个变量 —— 产品数据根 `DSH_EAC_DATA_ROOT` 与发布通道 `DSH_EAC_CHANNEL`。壳里不写 dpx 的路径策略。
- **L2 sidecar**（`lib/desktop/environment.ts`）：调上面的 API，把 dpx 返回的 runtime 应用到进程环境。**不复制** dpx 的注册表、锁、清单与变量治理逻辑。
- **L3 dsh 内核**：零修改。

### 路径布局

```text
<产品数据根>                                Windows 安装版: %LOCALAPPDATA%\Deepseek Harness EAC
                                            Windows 便携版: <便携目录>\data（ADR 0013）
├── dpx\                                    ← dpx storageRoot
│   └── dsh-environments\
│       └── eac-beta\                       ← 环境根（dpx 的 DPXEnvironment）
│           ├── .dpx-environment.json       ← dpx 清单（kind: DPXEnvironment）
│           ├── dsh-home\                   ← DSH profile / sessions / skills / 配置
│           ├── home\  appdata\  localappdata\  tmp\  xdg-*\  npm-prefix\  workspace\
└── DSH\DPX\registry.json                   ← 机器级注册表（DPX_HOME）
```

便携版的产品数据根选择、旧数据导入与换路径搬迁见 [ADR 0013](0013-portable-data-root.md)。

非 Windows 在产品数据根下使用**同样布局**（基目录换成 `$XDG_DATA_HOME`，注册表换成 `$XDG_STATE_HOME/dsh-dpx`）。

### 关键语义

- **同一通道升级复用环境根**；不同通道（`eac-beta` / `eac-rc`）是不同环境根，互不干扰。
- **应用 runtime 变量时必须同时删除被清理的继承变量**。`runtimeEnvironment()` 是刻意设计成「不含」`NODE_OPTIONS`/`NODE_PATH`、各类代理、`NPM_CONFIG_PREFIX`/`NPM_CONFIG_CACHE` 的全量结果；只赋值不删除，隔离就是假的（父进程遗留变量会继续生效）。
- **fail closed**：dpx 初始化失败（注册表损坏、非空未注册目录、模块缺失、已注册到别处）时 sidecar 记日志并退场，走既有 `/died` 恢复链。**绝不回退宿主 `~/.dsh`**。
- **不迁移宿主旧数据**：宿主旧 `.dsh` 只做存在性检测和日志提示，默认不迁移、不删除、不覆盖。
- 路径必须支持空格与中文（`产品数据根` 与用户目录都可能含非 ASCII）：一律走 `path` 拼接，不手写分隔符，不留 `-`/`"` 之类需要 shell 转义的中间态。
- 显式 `DSH_HOME` 的开发/测试启动仍保持兼容（不注入 `DSH_EAC_DATA_ROOT` 即不进隔离模式）；正式 Tauri 启动始终注入隔离根。

## dpx 的理念，以及我们为什么要收紧两处（2026-09-29）

采用 dpx 不只是"用它的函数"，也接受它的**隔离模型**。把两者的边界写清楚，避免后来者误以为 EAC 期望了 dpx 并不提供的保证。

### dpx 的理念：「收容默认解析」，不是「写入沙箱」

dpx 自己的 README 就是这么写的（*隔离的边界：收容「默认解析」，不是写入沙箱*）：

> 只要调用方不显式指定绝对路径，各类工具的默认读写都会落在 `<环境根>` 下。

机制是**环境变量重定向**（`HOME`/`USERPROFILE`/`APPDATA`/`LOCALAPPDATA`/`TEMP`/XDG 三件套/`DSH_HOME` 全部指向环境根），**不是文件系统边界**。dpx 明确列出三个不在保证范围内的逃逸口，我们原样接受，不假装它们不存在：

| 逃逸口 | 机制 | 表现 |
| --- | --- | --- |
| 显式绝对路径 | 命令行参数优先于环境变量 | `npm install -g --prefix C:\Users\...` 直接写宿主 |
| `PATH` 是**前置**而非替换 | `PATH = [环境 npm-prefix, 继承 PATH]` | 环境内没装的工具静默回落宿主同名二进制 |
| 无写入拦截 | 不挂文件过滤驱动 | 有写权限的进程仍可写宿主任意绝对路径 |

结论（dpx 原文）：**需要真正的文件系统边界时，请在本机沙箱／容器层面实现**；dpx 只负责环境身份、受控布局与默认路径收容。

另两条 dpx 理念也对齐了：

- **「DPX 注册由 DPX 管」**（ROADMAP）：注册表/清单的写权归 dpx 独占，**不要求用户手改 registry**。所以 EAC 的 `environment.remove` 只转发意图，不自己重写注册表。
- **消费而非定义协议**：dpx 声明自己是 `dsh-distribution` 的**实现范例**而非标准来源，并如实标注只实现了 7 个协议面中的少数几个。这一点反过来支持了 ADR 0004 的原始判断——**隔离能力不该在 EAC 里再实现一套**。

### 收紧一：runtime 必须「替换」而不是「赋值」

`applyRuntimeEnvironment` 逐键删除不在 dpx 结果里的继承变量：

```ts
for (const key of Object.keys(target)) {
  if (!(key in runtime)) delete target[key];
}
```

**为什么这是必要的**：`dpx.runtimeEnvironment(paths, inherited)` 按设计**不含** `NODE_OPTIONS` / `NODE_PATH` / 各类代理 / `NPM_CONFIG_PREFIX` / `NPM_CONFIG_CACHE`。它的契约是"给我继承环境，我来决定保留什么"，**替换动作是调用方的责任**。若只把它返回的键逐个赋值而不删除，父进程遗留的 `NODE_OPTIONS=--require evil.js` 仍会被内核加载——**隔离就是假的**。

这一点 dpx 的 README 没有强调（它描述的是"默认解析落在环境内"），属于采用方必须自己补上的语义。回归测试：`eac-environment-isolation.test.ts` 的「环境变量清理」用例。

### 收紧二：失败语义是 fail closed，而不是"报错可重试"

| | dpx（通用 CLI 环境管理器） | EAC（双击启动的桌面产品） |
| --- | --- | --- |
| 失败时 | 打印错误并退出；用户可读报错、换个路径再试 | **绝不回退宿主 `~/.dsh`**，sidecar `exit(2)` → 壳导航 `/died`（带自愈面板） |
| 理由 | 交互式使用，报错本身就是交付物 | GUI 一旦静默回退，就重演"旧 profile 污染 → 插件 pending / 白屏"，且用户看不到线索 |

### 明确不采用的部分

dpx 自带桌面启动器（`installDesktopLauncher` / `launchSpec` / `dpx run` / 内置 WebView）。**EAC 一个都不用**——EAC 有自己的 L1 Tauri 壳。我们只取它的**环境管理面**（创建 / 路径 / 环境变量 / 诊断 / 移除）；内核启动仍走安装树 `require.resolve('@deepseek-ai/dsh/lib/bin.js')`。回归测试：`eac-kernel-source.test.ts`（禁止 `dpx run` 等 7 项）。

### 分发面

打包 stage 装配 dpx 的**JS API + package 元数据 + 许可证**，并校验 submodule 提交与工作树干净（`git rev-parse HEAD` + `git status --porcelain`）。不带 `.git`、不带上游 desktop EXE 启动器、不带 tests。EAC 不用 `dpx run` 启动内核——内核仍按现有安装目录随包启动。

stage 装配的三类前置条件各自 fail fast，并给出可执行修复命令：

| 前置条件 | 失败表现 | 修复提示 |
| --- | --- | --- |
| submodule 缺失 / 未初始化 | `缺少 third_party/dsh-dpx` | `git submodule update --init --recursive third_party/dsh-dpx` |
| 提交漂移 | `dsh-dpx 提交不匹配` | `git -C third_party/dsh-dpx checkout <pin>` |
| 工作树脏 | `dsh-dpx 工作树脏` | 还原/清理该 submodule |
| payload 闭包缺文件 | `payload 闭包不完整` | 重新 checkout 到 pin |
| WebView2Loader.dll（win32） | `前置检查失败` | `cd tauri-shell && cargo fetch --locked` |

CI（`ci.yml` 的 `source-and-unit`/`staged-runtime` 与 `staged-runtime-artifact.yml`）的 checkout 均改为 `submodules: recursive`，并在测试/装配前执行 `node tauri-shell/check-dpx-pin.mjs`。**不取 submodule 会让隔离测试整片 skip 成假绿**，因此这一步是门禁而非可选优化。

## 生产依赖装配（2026-09-28 修订，P0）

原实现把 `npm ci --omit=dev` 放在 staged 树里执行。**该路径必然失败**，与网络无关：

- `dsh-desktop/package-lock.json` 中 280 个 `file:vendor/kernel/*.tgz` 条目里，**234 个的 integrity 与磁盘上的真实 tarball 不一致**。内核 tarball 由 `scripts/fetch-kernel.js` 在构建期重打，其字节依赖打包环境（实测同一源码用 pnpm 11.7.0 与 12.4.2 得到不同 sha512），因此 lockfile 的 integrity 只在「CI 跑过 fetch-kernel 并同步 integrity」之后才与磁盘一致。本地/离线检出必然 EINTEGRITY。
- npm 在 EINTEGRITY 回滚时对已写入的 `node_modules` 做 `rmdir`，Windows 上撞句柄/只读位报 EPERM，留下半截坏树（`bundle-manifest.json` 缺失）。
- 启动链路从不执行 `npm install`（AGENTS.md 关键陷阱），所以没有自愈路径。

**决策：装配阶段不再联网安装**。生产 `node_modules` 改为从**已安装好的 `dsh-desktop/node_modules` 离线复制**（`tauri-shell/stage-node-modules.mjs`）：

- 完全离线、可重复：同一源树 + 同一 lock 得到同一 staged 树；
- 不依赖 npm 的 integrity，改为显式校验：lock 中所有**非 optional** 包必须在源树存在（跨平台 optional 变体如 `@img/sharp-darwin-*` 允许缺席），复制后逐包核对文件数；
- 排除 `.bin`/`.cache`/`.package-lock.json`，并在复制前清空目标（Tauri 增量资源复制不会删已消失文件）；
- 异平台原生包护栏（`darwin`/`linux` token + arch token 同时出现即拒绝），防止把构建机专属原生包带进发布包；
- 源树缺失时 fail fast，提示先在 `dsh-desktop/` 下 `npm ci` 生成源树（首次需要网络），之后装配完全离线。

`withAbsolutizedKernelManifests`（stage-kernel-manifest.mjs）的唯一用途是给 `npm ci` 解析相对 `file:` 依赖，改为离线复制后不再被 stage 调用。

## 影响

- 新增 L2 模块 `lib/desktop/environment.ts`（薄适配器）与隔离回归测试。
- Rust sidecar 启动契约新增 `DSH_EAC_DATA_ROOT` / `DSH_EAC_CHANNEL`。
- 打包资源携带 `dpx/`（JS API）与 `environment-policy.json`。
- 新增 submodule `third_party/dsh-dpx`（提交固定，打包时校验）。
- 新增 `tauri-shell/stage-node-modules.mjs`（离线生产依赖装配）与 `tauri-shell/check-dpx-pin.mjs`（submodule 门禁）。
- sidecar 新增 `environment.status` / `environment.remove` / `environment.repair` 三个 RPC，bridge 暴露 `dshDesktop.environment`；`boot.state` 附带隔离身份。

## 运维闭环（2026-09-28 实施，P1）

损坏环境不再只留一行日志。边界不变——**治理逻辑仍属 dsh-dpx**，EAC 只做两件事：把 dpx 的只读诊断翻译成可显示状态，把用户的 remove 意图原样转给 dpx 的既有 API。

- `environment.status`：调 `readRegistryReport` + `environmentManifestReport`，返回产品数据根/storageRoot/注册表路径/期望环境根、`registryReadable`、`manifestPresent`、`registered`、`problems[]`（含 `describeDamage` 文案）、`removable`、以及 `health` 单一结论字段。
- `environment.remove`：`dryRun` 出计划（`environmentRemovalPlan`），`purge:false` 只摘注册表记录并保留环境根数据，`purge:true` 连根删除（dpx 用 `maxRetries` 抗 Windows 瞬时句柄占用）。
- `environment.repair`：语义是「幂等重新确保环境」（`createEnvironment`），**不重写注册表**——重写注册表属于 dpx，不属于 EAC。注册表损坏时它如实失败并提示改用 `remove --purge`。

安全约束：

- **只有已登记的环境可移除**；未注册目录（哪怕非空）在创建、计划、执行三个阶段都被拒绝接管，内容原样保留。
- **不迁移**旧 `.dsh`、**不复制凭据**；宿主旧 profile 只做存在性提示。
- 摘记录后该目录变成「非空且未注册」，dpx 刻意拒绝静默重新认领（`Refusing to adopt non-empty environment directory`）——这是正确的 fail-closed 语义，用户的出路是显式 purge。

## /died 页自愈（2026-09-28 实施，形态 1）

**问题**：环境 fail-closed 时 sidecar 已 `exit(2)`，bridge 与它的 `environment.*` RPC 一起消失 —— `/died` 页拿不到任何诊断，用户只看到「服务已停止」，不知道环境坏了、坏在哪、怎么修。实测（损坏注册表）会让人彻底卡住。

**形态选择**：给 L1 壳开一条**不依赖 sidecar 存活**的通道，而不是让 sidecar 降级常驻（后者与「fail closed 就退场」的既有语义冲突，且要改管道/心跳逻辑）。

- `dsh-desktop/scripts/environment-diagnose.mjs`：一次性 CLI，只调 `lib/desktop/environment.ts` 适配层（`status`/`plan`/`remove`/`repair`），成功与失败**都输出单行 JSON**。
- L1 新增 `diagnose_environment` / `repair_environment` 两个 command：只 spawn 脚本 + 转发 JSON，**不含业务逻辑**。**必须注入 `DSH_RESOURCE_ROOT`**，否则打包态下适配层退化成开发态相对路径查找、找不到 `<resources>/dpx`，自愈在正式包里必然失效（实测踩中，已加回归）。
- `/died` 页新增环境面板：显示隔离根、`problems[].text`（dpx 的中文描述）、已登记状态。

**安全约束**：

- 「清理并重建」按钮**只在 `removable=true`** 时出现；点击需 `window.confirm` 二次确认；无任何自动执行路径。
- 注册表损坏时 dpx 拒绝删除（不可信注册表上不做破坏性操作）→ `removable=false` → 按钮隐藏，页面改为给出**人工出路提示**（手工删/改名该目录后重启）。这是刻意的：EAC 不绕过 dpx 的注册表保护去强删。

### 壳层页面调 L1 命令的三个前提（2026-09-30 实测踩全）

`/died` 页要能调 `diagnose_environment` / `repair_environment`，必须同时满足三件事。少任一件，页面只显示一个「unavailable」，**没有任何线索**指出是哪一层没过。

| # | 前提 | 缺了会怎样 | 落点 |
| --- | --- | --- | --- |
| 1 | 页面拿得到 `invoke` | 本壳**刻意不开** `withGlobalTauri`，所以 `window.__TAURI__` 恒为 `undefined` | 壳注入 `window.dshShell.invoke`（薄包装 `__TAURI_INTERNALS__.invoke`，后者由 Tauri **无条件**注入） |
| 2 | 命令在 build 期被声明 | Tauri v2 的自定义 command **默认被 ACL 拒绝**（报 `Command X not allowed by ACL`，**连既有的 `shell_ping` 也一样**） | `build.rs` 的 `AppManifest::commands(&[...])` → 自动生成 `allow-<cmd>` / `deny-<cmd>` 权限 |
| 3 | capability 授权且 **origin 匹配** | 只加 capability 仍被拒：我们的页面由 `http://127.0.0.1:19873` 提供，**是外部 HTTP origin，不属于 Tauri 的 local 范围** | `capabilities/default.json` 必须 `"local": false` + `"remote": { "urls": ["http://127.0.0.1:(1987[3-9]\|1988[0-9]\|1989[0-8])/*"] }` |

**第 3 点的端口段不能写成通配**（2026-09-30 review 修正）：初版用了 `http://127.0.0.1:*/*`，那**把 L1 命令面一并授权给了内核 Web UI** —— 内核 UI 也在同一个 `main` 窗口里（只是动态端口，实测 58809 之类），通配端口等于放弃 origin 隔离。但也不能写死 `19873`：壳桥端口被占时会**向上回退 25 个候选**（`WS_PORT..WS_PORT+24`），写死会在回退时让自愈失效。故 scope 取**端口段正则**，覆盖 `[19873, 19898]` 而排除内核动态端口。回归锁定：`capability_remote_scope_stays_narrow`。

> 由此也可确认：`window.dshShell` 对内核页面**也存在**（同一窗口注入），真正的边界是 **ACL 的 origin 匹配**，不是"注入给谁"。若要进一步收紧，应改为按 URL 注入。

**授权面（2026-09-30 review 决策：保留四个命令）**：capability 授权了 4 个命令，但**只有 2 个是自愈面板实际需要的**（`diagnose_environment` / `repair_environment`；页面上的"重新启动"走的是 WS 桥 `window.dshDesktop._call('boot.start')`，不经 Tauri command）。另外两个是 HEAD 既有的注册意图、**当前零前端调用者**：

| 命令 | 实际调用者 | 备注 |
| --- | --- | --- |
| `diagnose_environment` / `repair_environment` | `/died` 面板 | 自愈所需 |
| `shell_ping` | 无 | 只回 pong，风险低 |
| `sidecar_call` | 无 | **无方法白名单**，可转发 sidecar 的 16 个 RPC（含 `boot.stop` / `files.revert` / `plugins.set-removed`） |

**决策：保留**（维持 HEAD 意图不擅自删），来源面已由端口段正则收窄到壳桥端口段。如果要最小化，需先确认无人依赖 `sidecar_call`，再**同时**改 `build.rs` 的 `commands` 清单与 capability 的 `permissions`（两处不同步会导致 ACL 拒绝或死配置；`every_invoked_command_is_declared_for_acl` 会双向校验）。


**易错点**：

- 权限标识符用**连字符**（`allow-diagnose-environment`），命令名用**下划线**（`diagnose_environment`）—— 由 `tauri-build` 自动 slugify。
- `remote.urls` 是 [URLPattern](https://urlpattern.spec.whatwg.org/) 语法；`http://localhost:*/*` **不匹配** `127.0.0.1`（不同 origin），必须写实际 IP。
- `tauri-shell/permissions/autogenerated/` 是构建产物（每轮由 `build.rs` 重建；实测删除后 `cargo check` 仍成功并原样再生成），已加入 `.gitignore`；**源码是 `build.rs` + `capabilities/default.json`**。
- 调试此类问题的唯一可靠办法：给 WebView2 传 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>`，再用 CDP 在**真实窗口**里读 `window.dshShell` 与面板状态 —— 用浏览器渲染 `http://127.0.0.1:19873/died` 看不到真实结果（浏览器里没有 `__TAURI_INTERNALS__`）。

回归锁定（`cargo test`）：`every_invoked_command_is_declared_for_acl`（三处一致性：`invoke_handler` ⊆ `build.rs` 声明 ⊆ capability 授权）、`died_page_uses_shell_invoke_bridge_not_global_tauri`、`shell_pages_do_not_leak_line_continuation_backslashes`。

## 未纳入本次实施

- 宿主旧 `.dsh` 的显式迁移入口未实现（当前策略是只检测、不迁移）。
- 注册表损坏 + 目录残留的**全自动**修复未实现（需绕过 dpx 保护，边界待定）；当前给人工指引。
- `environment.*` 尚无内置设置页 UI 面板消费（RPC 与 `bridge.environment` 已就绪）。
- dpx 的桌面启动器（`installDesktopLauncher` 等）刻意未采用——EAC 有自己的 L1 壳。
