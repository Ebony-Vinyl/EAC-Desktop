# 内置完整包更新：实现与维护说明

更新日期：2026-10-18。面向接续开发者和代码审查者。实现首版为 **6.1.0**，正常更新验收使用 **6.1.0→6.1.1**。这是完整程序包更新；未安装 EAC-Pack 的基础产物仍叫 **EAC-Lite**。identifier、系统包名与数据目录不因 Lite 文件名改变。

## 1. 实现范围与实际完成度

已实现 stable 策略、GitHub/Gitee/local/custom 四源、独立源配置与地区默认策略、签名清单/完整包校验、保存和数据备份、portable/NSIS/AppImage/deb/RPM adapter、外置 helper、正常退出、自动重启、数据/HTTP/会话/UI 健康与完成状态。没有给 6.0.1 回移 updater，没有开发复杂旧版迁移工具、差分更新、预发布通道或正式发行服务。

“代码接通”“本机实测”“正式发布可用”必须分别判断：

| 范围 | 证据及结论 | 尚未覆盖 |
| --- | --- | --- |
| Windows x64 portable | 隔离完整产品 6.1.0→6.1.1、原会话可见、保存/绑定、正常退出和冷启动通过 | arm64、正式签名/正式远端源 |
| Windows x64 NSIS | 隔离完整产品 Setup 更新、退出0、认证健康/提交、会话与冷启动通过 | 当前正式发行构建、arm64、长安装路径；测试运行树早于后续 Linux 增量 |
| Arch Linux x86_64 AppImage | 2026-10-17，Wayland/niri 实机首次安装、内置更新、原会话/回复/草稿/主题/字号/工作区、原 origin、退出与冷启动通过 | 不能外推其他发行版、native glibc 基线或 aarch64 |
| deb/apt、RPM/dnf、RPM/zypper | adapter、系统授权 transport、root 校验、安装/重启和健康接缝已接通，有逻辑/协议 fixture 回归 | 对应发行版真实 pkexec、系统安装和 GUI A→B 尚未验证 |
| 四源与地区默认 | 逻辑回归、Linux 本地签名源与手动选择/冷启动持久化通过 | GitHub/Gitee/custom/地区服务真实端到端；Gitee/地区配置为空 |
| 正式发布 | 十目标签名清单生成、Lite 命名和现有 artifact 构建入口已有 | 正式公钥、签名包/清单上传与远端核验；defaults.trustedKeys 为空，不能作为正式更新服务 |

Linux 修复提交为 `c61ca45f581f0a70209c16e6e78e1eb385f842bd`（4 文件），已在本分支历史；后续不要重复 cherry-pick。接续入口见 [HANDOFF](../product/2026-10-18-client-update-HANDOFF.md)。原始证据由维护者私下交接，不把机器路径、日志、截图或测试身份固化进产品文档。

## 2. 调用链与模块边界

L1 原生壳负责窗口、调用来源约束、进程生命周期与启动前 gate；L2 sidecar 负责更新状态/数据/adapter/helper；DSH Host 通过已有 Agent/session/root 生命周期完成保存，不建立第二套内核运行时。未引入 updater 运行依赖，使用 Node 内建 crypto/fs/http 和已有系统安装工具。

正常流：

1. 官方 `updates.open` 打开原生更新页；只有 shell origin 能调用 `client-update.*`。内核 Web 页面保留公开 status/open/subscribe，不能任意安装或执行命令。
2. 读取独立源设置，选择 stable 且严格更新的同产品/OS/架构/形态；签名验证后才规范化清单。下载状态持续可读，长请求不阻塞取消。
3. 流式写入唯一事务 `.partial`，检查大小、SHA-256、完整包签名后 rename。切源/取消等待当前操作收敛；不跨来源混用临时包。**当前没有 HTTP Range 断点续传或自动镜像重试承诺**，失败后可重新检查/下载。
4. 用户点击保存安装：UI checkpoint→Host maintenance→会话/配置 flush、loader 等待→root disposal→正常退出回执；DataBinding 再核对，持久数据备份与保护根排重。
5. prepare 精确 adapter，复制 Node/helper 到安装树外，记录模块 hash 与认证 handoff。ACK 仅表示 helper 准备接管；sidecar 持久准备计划后才 commit。deb/RPM 在 ACK 前完成系统授权和 root 侧缓存验包。
6. helper 持 OS 锁，等待原 owners 正常退出，冷备份 WebView/guest，再交换/安装。原应用未退出则不得安装，不用强杀完成更新。
7. helper 自动启动候选，native、sidecar、Host 和 UI 确认版本/target/绑定/会话/文件/HTTP/UI；候选先持有维护与交互准入屏障。
8. helper 写认证 health-accepted、提交事务；候选记录完成状态、释放准入并清除健康环境。完成展示是 `idle`＋当前 version/completedTransactionId，不是单独 complete phase。冷启动保持版本与用户选择的源。

## 3. 文件清单与职责

下面逐项列出功能源码、接入点、测试与构建文件。同名 JS 由 TypeScript 原位编译，仅为生成物，不提交；未改上游内核源码来实现 updater。


### 3.1 更新与数据核心（新增）

| 文件 | 作用 |
| --- | --- |
| `dsh-desktop/lib/desktop/client-update.ts` | 统一状态、独立源配置、下载、取消、安装确认、准备计划和完成记录。 |
| `dsh-desktop/lib/desktop/update-sources.ts` | stable/四源/地区策略、本地路径/HTTPS、signed envelope 验证并保留原始 envelope。 |
| `dsh-desktop/lib/desktop/update-signature.ts` | minisign 公钥/双签名、完整包大小/SHA-256/BLAKE2b-512 预哈希 Ed25519 验证。 |
| `dsh-desktop/lib/desktop/update-data-binding.ts` | 读取/持久化数据环境身份，识别有效旧 eac-beta，拒绝非法绑定与未知数据认领。 |
| `dsh-desktop/lib/desktop/update-backup.ts` | 路径/链接边界、受保护根备份与摘要、临时文件/fsync/rename 持久 JSON。 |
| `dsh-desktop/lib/desktop/update-host.ts` | 内置 Host 控制服务，维护屏障、会话/配置保存、root disposal、退出与会话摘要。 |
| `dsh-desktop/lib/desktop/update-host-control.ts` | sidecar 侧 Host 客户端，认证 loopback、nonce、正常退出与保存回执验证。 |
| `dsh-desktop/lib/desktop/update-package.ts` | 完整文件 inventory、精确程序树、版本/target、固定顶层项与文件 hash。 |
| `dsh-desktop/lib/desktop/update-archive.ts` | ZIP 清单预检和解压，拒绝越界、链接、重复、包 identity 不符。 |
| `dsh-desktop/lib/desktop/update-portable-archive.ps1` | Windows ZIP 检查/解压固定执行入口，通过参数和环境传递操作。 |
| `dsh-desktop/lib/desktop/update-portable-lock.ts` | Windows 文件锁/Linux flock 互斥；私有 stdin 生命周期与锁身份检查。 |
| `dsh-desktop/lib/desktop/update-process-owners.ts` | 精确捕获后代和排除 helper 子树；Windows CIM、Linux /proc 解析。 |
| `dsh-desktop/lib/desktop/update-helper-process.ts` | 复制 Node/精确模块清单与 hash、认证 ACK/commit/cancel、回执 MAC/上下文。 |
| `dsh-desktop/lib/desktop/update-portable.ts` | 候选/旧树布局、逐项 intent journal、交换/逆序恢复、指针及未知文件冲突保护。 |
| `dsh-desktop/lib/desktop/update-portable-helper.ts` | 独立接管、冷备份、等待 owners、候选启动、健康提交/恢复与启动门禁。 |
| `dsh-desktop/lib/desktop/update-nsis.ts` | 安装身份/PE metadata、固定 Setup argv、退出码/版本/健康、持久计划与取消。 |
| `dsh-desktop/lib/desktop/update-nsis-helper.ts` | 独立接管、程序/浏览器备份、候选健康、启动门禁和只读修复信息。 |
| `dsh-desktop/lib/desktop/update-platform.ts` | 从 executable、marker、APPIMAGE、包归属识别 OS/架构/安装形态。 |
| `dsh-desktop/lib/desktop/update-linux.ts` | Linux 架构/发行版/包身份、固定管理器 argv、deb/RPM plan；AppImage 路径与旧环境清理。 |
| `dsh-desktop/lib/desktop/update-appimage.ts` | 候选完整复制、权限/hash/fsync、journal、previous/rejected、镜像交换和恢复。 |
| `dsh-desktop/lib/desktop/update-appimage-helper.ts` | 独立接管、launcher/native 后代绑定、正常退出/启动/健康与 gate。 |
| `dsh-desktop/lib/desktop/update-linux-root.ts` | pkexec 特权入口，root-owned 代码/安装内公钥、root 缓存包、grant 后固定系统安装与回执。 |
| `dsh-desktop/lib/desktop/update-linux-helper.ts` | 普通用户 helper，先授权后退出、root transport、冷备份、安装/普通用户重启和 gate。 |
| `dsh-desktop/lib/desktop/update-restart.ts` | 共享启动验收：native/sidecar/target/绑定、文件/会话、HTTP 登录、UI、完成准入和停止回执。 |


### 3.2 原生壳、sidecar 与环境（新增/修改）

| 文件 | 作用 |
| --- | --- |
| `dsh-desktop/lib/desktop/boot-server.ts` | 加载更新 Host 控制；传递认证/维护身份，sidecar 重启清除旧健康环境。 |
| `dsh-desktop/lib/desktop/environment.ts` | 新安装 stable、历史绑定优先；复用 storage/registry，不随发布通道迁移数据。 |
| `dsh-desktop/stable-port.ts` | 健康启动要求原端口/origin；占用时失败，避免换端口造成存储看似丢失。 |
| `tauri-shell/sidecar/server.ts` | 更新 RPC、保存/备份、adapter/helper、正常退出、健康准入和取消。 |
| `tauri-shell/sidecar/bridge.ts` | 官方 updates DTO 与 bridge 契约，不向内核 origin 暴露安装权限。 |
| `tauri-shell/src/main.rs` | 原生窗口/origin 白名单/异步 RPC、UI checkpoint、safe-exit/gate、NSIS 修复对话框。 |
| `tauri-shell/src/update_startup.rs` | 启动前恢复指针/helper 路径/版本检查、各 adapter gate、受控只读修复入口。 |
| `tauri-shell/src/client-update.html` | stable 更新页、源设置、进度/取消/保存安装/错误；Rust include_str! 编译输入。 |
| `tauri-shell/src/update-ui-checkpoint.js` | 真实 DSH UI 保存草稿/持久状态后以 nonce 回应保存请求。 |
| `tauri-shell/src/update-boot-ui.js` | 候选 UI 健康验收与交互准入，接受后开放业务。 |


### 3.3 构建、版本、安装、CI（新增/修改）

| 文件 | 作用 |
| --- | --- |
| `dsh-desktop/client-update-defaults.json` | 构建内公钥与源配置；正式 trustedKeys 为空，不把测试 key 上线。 |
| `dsh-desktop/package.json` | 产品版本 6.1.0，无新增 updater 运行依赖。 |
| `dsh-desktop/package-lock.json` | 同步顶层与根 package 版本。 |
| `dsh-desktop/.gitignore` | 排除原位生成更新 JS，TS 为事实源。 |
| `tauri-shell/Cargo.toml` | 原生版本 6.1.0，未升级 Tauri/WebView 栈。 |
| `tauri-shell/Cargo.lock` | 同步本产品 Cargo package 版本。 |
| `tauri-shell/tauri.conf.json` | 同步版本，保持 identifier/安装身份。 |
| `tauri-shell/installer-hooks.nsh` | 同产品 UPDATE 正常退出/文件锁检查，避免镜像名强杀/重复历史接管；输出安装身份。 |
| `tauri-shell/make-portable.mjs` | Lite/架构命名、完整 inventory、marker、安装 identity 和包 manifest。 |
| `tauri-shell/name-lite-installers.mjs` | 各安装格式 Lite 文件名与摘要，不改变内部产品 identity。 |
| `tauri-shell/create-update-manifest.mjs` | 十目标签名清单，默认要求齐全；隔离单目标测试才 --allow-partial。 |
| `tauri-shell/stage-resources.mjs` | 装配全部更新模块/Host/helper；含已提交 Linux pnpm 载荷过滤。 |
| `.github/workflows/staged-runtime-artifact.yml` | 现有矩阵 Lite 命名/上传 CI 附件，不是正式更新发布流水线。 |


### 3.4 Linux 实机修复（已在 c61ca45，不重复提交）

| 文件 | 作用 |
| --- | --- |
| `tauri-shell/stage-platform-prune.mjs` | 递归清理 nested musl/异平台载荷，保留目标 glibc 兜底。 |
| `tauri-shell/audit-linux-bundle.mjs` | 补齐 musl 后缀与实际平台包审计。 |
| `dsh-desktop/test/linux-bundle-audit.test.ts` | Linux 载荷新增回归，修复前用例失败、修复后回归55/55。 |


### 3.5 测试与维护工具（新增/修改）

| 文件 | 作用 |
| --- | --- |
| `dsh-desktop/test/client-full-update.test.ts` | stable/四源/签名/配置/下载、数据绑定与安装交接。 |
| `dsh-desktop/test/update-preparation.test.ts` | Host 维护、保存/退出/备份、取消和失败阻断。 |
| `dsh-desktop/test/update-portable.test.ts` | ZIP/整树/journal/恢复、独立 helper、健康和数据保护。 |
| `dsh-desktop/test/installer-update-safety.test.ts` | 真实编译 NSIS fixture、锁/目录边界、worker/失败材料/健康。 |
| `dsh-desktop/test/update-linux.test.ts` | 包身份/发行版/argv、root 信任/权限、授权 transport 和 deb/RPM 顺序。 |
| `dsh-desktop/test/update-appimage.test.ts` | 镜像事务/helper、运行身份、gate/环境清理、Linux 条件项。 |
| `dsh-desktop/test/client-update-ui.test.ts` | 已有浏览器下更新页进度、取消与异步状态。 |
| `dsh-desktop/test/native-update-relay.test.ts` | 真实壳长请求期间状态/取消与修复对话框；环境不足明确跳过。 |
| `dsh-desktop/test/update-manifest-generation.test.ts` | 十目标签名及包签名、矩阵/身份反例。 |
| `dsh-desktop/test/update-handoff.test.ts` | 漏 Rust include/源码、hash 和 LF 转换检查。 |
| `dsh-desktop/test/lite-artifact-names.test.ts` | Lite 多架构/格式命名与摘要。 |
| `dsh-desktop/test/bridge-preload-parity.test.ts` | 公开桥/private shell 能力和 DTO。 |
| `dsh-desktop/test/bundled-files.test.ts` | 更新/Host/helper 必须进入装配闭包。 |
| `dsh-desktop/test/ci-workflow.test.ts` | 矩阵、Lite 命名/上传契约。 |
| `dsh-desktop/test/eac-environment-isolation.test.ts` | stable 默认与环境隔离/绑定。 |
| `dsh-desktop/test/eac-environment-selfheal.test.ts` | 默认变更后的环境自检。 |
| `dsh-desktop/test/installer-nsh-pipe.test.ts` | UPDATE/正常退出/文件锁语义。 |
| `dsh-desktop/test/installer-official-ui.test.ts` | 既有 NSIS UI/钩子入口。 |
| `dsh-desktop/test/installer-takeover.test.ts` | 同产品更新不重复历史接管。 |
| `dsh-desktop/test/rpm-packaging.test.ts` | 包身份、命名和资源布局。 |
| `dsh-desktop/test/sidecar-mutation-gate.test.ts` | 准备/候选健康期间写入准入。 |
| `dsh-desktop/test/sidecar-platform.test.ts` | 平台 adapter 接入，不恢复 Electron updater。 |
| `dsh-desktop/test/sidecar-shutdown-safety.test.ts` | 保存、正常退出、取消与健康停止。 |
| `dsh-desktop/test/stable-port.test.ts` | 原端口保持与占用失败。 |
| `dsh-desktop/test/fixtures/nsis-repair-dialog-probe.ps1` | 隔离原生修复对话框测试 fixture，不是产品入口。 |
| `dsh-desktop/scripts/verify-update-handoff.mjs` | 历史 overlay 的 HEAD/hash/源码覆盖/Rust include 检查；提交后协作以 Git 为准。 |
| `.agents/skills/deepseek-harness-eac-dev/references/change-rules.psd1` | 更新代码/UI/fixture/证据路径影响分类。 |
| `.agents/skills/deepseek-harness-eac-dev/tests/run-tests.ps1` | 分类和计划契约的 PowerShell 双运行时回归。 |

## 4. 数据保留与安全边界

### 身份与来源

发布 stable 与运行数据环境分开。新安装默认 stable；已保存 eac-data-binding 或通过 dpx 身份核验的旧 eac-beta 继续沿用。不为稳定发布创建空环境、移动会话或改写 registry。显式环境变量仍有相应优先级，未知/非法身份拒绝更新。没有给 6.0.1 增加数据转换器，过渡以完整安装并复用数据为主。

DataBinding 覆盖实际环境、DSH_HOME、profile、registry、WebView、shell config、guest 与 Web origin 等，准备/helper/健康均比较同一身份。原端口被占则健康失败，不换端口冒充设置保留。隔离测试同时设置 DSH_EAC_DPX_REGISTRY_HOME 与 DPX_HOME；只设后者不能覆盖桌面绑定。

公钥只来自构建内 defaults，来源不能替换信任根。先验证 payload 原始字节签名，再解析产品/版本/target；包独立验签。拒绝降级、预发布、未知 key、错架构/形态/包 identity、越界及不可信链接。本地源不访问网络，远端与重定向保持 HTTPS。

### 保存、备份与停止

UI nonce 回应只是保存确认的一部分，不以关窗代替保存。Host 使用既有 Agent maintenance，flush sessions/config、等待 loader/root disposal 和正常退出；收到 shutdown 应答不等于已退出。sidecar 核验 nonce、进程和 MAC 回执，失败不进入程序替换。

备份记录根、文件摘要、链接目标与 workspace 保护范围。安装路径不能和 DSH_HOME、registry、WebView、guest、工作区及其他保护根重叠。持久用户数据不参与程序回退；**恢复旧程序不会把旧备份覆盖到更新后的用户数据**。浏览器存储在旧进程退出后冷备份。

健康检查比较文件、原前缀和逻辑 session digest，允许明确的生命周期追加及精确的派生版本对齐字段，不能为“hash一样”覆盖真实新数据。Linux 实机 settings 唯一变化为 pluginTreeAlignedVersion 6.1.0→6.1.1；用户设置、会话旧前缀和工作区保持。

### 进程、认证与特权层

helper 位于安装树外，复制 Node/精确模块并重验 hash。ACK/commit/cancel 与回执绑定 transactionId/token，MAC 防止无认证文件被接受；它不是同一用户完全被攻陷后的隔离沙箱。精确 owners/后代检查避免结束其他目录的同名程序。Windows 文件锁/Linux flock 防并发交换；失锁或 owners 未退出必须阻断。

deb/RPM root 入口只运行 root-owned、无组/other写权限的安装内代码与 Node；从安装内公钥独立验证原 envelope，拒绝请求自带 key/artifact。请求限定 UID、0600、无链接和大小，包复制至 root-owned 缓存后重验。pkexec 使用最小授权环境，不保存密码。只有收到私有 stdin grant 且原 owners 全退出才固定 argv 执行 apt/dnf/zypper，不执行来源 shell。root-controlled 包管理器链接可解析，实际文件/父目录仍须可信。普通用户 helper 重启 GUI，root 不启动产品 UI。

## 5. 事务与故障恢复

| 时机/形态 | 实现行为 | 恢复边界 |
| --- | --- | --- |
| 检查/下载/准备取消、验签失败 | 中止并等待任务，清理受控 partial；旧程序未替换，错误可重试 | 不提供 Range 续传；不清理历史恢复材料 |
| 保存/备份/绑定/helper ACK 失败 | 不 commit 安装、取消准备；原内核已退出时按原绑定恢复运行 | 不强杀活动任务，不用空 profile 隐藏失败 |
| portable 交换 | 每项 old-intent/old-saved/new-intent/new-installed 持久 journal；保留 old/new/failed-new 与指针 | 业务启动前外部 helper 检查；候选停止确认后逆序恢复程序，恢复失败保留并报错 |
| AppImage 交换 | 完整 candidate、权限/hash/fsync；current→previous、candidate→current，健康后 committed | 验证旧镜像身份、候选停止后恢复；不回滚数据。原镜像缺失且入口不能执行时，不承诺任意断电点都能自动自举 |
| NSIS 安装/候选失败 | 保留签名 Setup、plan、previous-program、冷备份、指针与结果；原生只读修复材料入口 | prepared 可取消；安装后需人工修复，不自动逆安装器、不自动重跑 Setup，不宣称原子回滚 |
| deb/RPM 授权拒绝 | root 未 ready 不允许 grant，不开始系统安装 | 真正发行版图形授权尚待实测 |
| deb/RPM 安装已开始 | systemInstallStarted 持久化；非0/版本不符写 failed，不强杀包管理器 | 不将取消冒充未安装；系统包管理事务，无通用自动回滚，保留数据/日志供修复 |
| 候选健康失败 | 不开放正常业务，写失败阶段，请求正常停止并核验 owners，再由 adapter 恢复或保留材料 | HTTP200/进程存活/空 UI 不算成功；未确认停止不能覆盖 |

portable/AppImage 事务是多个可恢复操作，不是覆盖程序和用户数据的一次文件系统原子提交。journal/fsync/旧材料提高恢复能力，但不表示已验证所有断电、磁盘损坏或包数据库损坏。按当前交付优先级，不扩大极端矩阵。

## 6. 验证结果与复验

结果来自不同平台/时点，不能相加或把 skip 计入通过：

| 执行范围 | 结果 | 边界 |
| --- | --- | --- |
| Windows 产品全量 | 729项：722 pass、7 skip、0 fail/cancel | 3项 npm 运行时随后补跑3/3，其余4项需 Linux |
| Windows Rust | 73/73 | 不能替代 Linux 条件编译 |
| 交接工具新增检查 | 2/2 | 独立于全量，捕获漏 Rust include HTML |
| Linux Node24 全量 | 734项：653 pass、81 skip、0 fail | 平台/环境门槛保留；Node26历史失败未抹去 |
| Linux Rust | 71/71 | --locked --offline，数量差异来自平台条件 |
| Linux 更新专项 | 108项：107 pass、1 skip | 不叠加至734 |
| Linux 载荷修复回归 | 55/55 | c61ca45 的 nested musl/pnpm |
| Linux 实际 AppDir | 32,459文件、12原生模块审计通过 | Arch native glibc 不证明跨发行版基线 |
| 2026-10-18 交付复核 | TypeScript build、58/58 | 装配/CI/命名、真实浏览器更新页、交接工具；未重复完整产品更新 |

已具备项目依赖与工具链时：

~~~sh
cd dsh-desktop
npm run build
node --test --test-concurrency=1 --test-timeout=120000 \
  test/client-full-update.test.ts test/update-preparation.test.ts \
  test/update-linux.test.ts test/update-appimage.test.ts \
  test/bundled-files.test.ts test/update-manifest-generation.test.ts
~~~

完整回归用直接 node --test，参数放文件前，不加 --test-force-exit 掩盖残留。Rust 在 tauri-shell 执行 cargo test --locked --offline。GUI/安装测试须有现成浏览器、原生壳和安装工具；缺失时明确 skip/BLOCKED，不为通过检查临时改测试。

分发还需 stage-resources、verify-staged-runtime、Linux bundle 审计、真实 A/B 构建和安装后目录；逻辑通过不能替代实机。测试 B 同步 package.json/lock、Cargo.toml/lock、tauri.conf.json 全部版本点，在独立构建注入测试 key，不改主工作区信任根。

## 7. 发布与后续维护

正式发布仍需维护者提供公钥/服务配置，在规定构建机构建对应包、签名并生成 stable.json，上传包/签名、核对远端资产后最后公开清单。artifact workflow 只构建/命名/上传 CI 附件，**不会自动发布可信更新服务**。空 Gitee 不请求，地区服务未配置不擅自引入服务。

本轮只做本地分批提交，推送/PR/发布由维护者决定。deb/RPM 和 arm64 不得在发行说明中标为已通过。后续验证顺序、验收证据和停机条件见最新 HANDOFF。历史审计、实施计划、原始报告/截图和机器路径私下交接；长期文档保留设计与可证明的范围。
