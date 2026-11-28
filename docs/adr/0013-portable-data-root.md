# ADR 0013：便携版数据根（`<便携目录>\data`）

日期：2026-11-24

状态：已实现（P1–P4）；Windows x64 便携包待真实介质验收

相关：[ADR 0004](0004-eac-install-environment-isolation.md)（安装环境隔离）、[ADR 0011](0011-client-full-update-boundary.md)（完整包更新边界）

## 背景

便携包只在 exe 同级写入 `.dsh-portable` 标记，但该标记此前只被更新器用于选择资产（`update-platform.ts`）。数据根仍按安装版规则推导到 `%LOCALAPPDATA%\Deepseek Harness EAC`，于是便携版把 dpx 环境、插件、会话和 WebView2 缓存写进 C 盘，与「拷到 U 盘就能用」的预期不符（issue #477）。

直接目的：便携运行时，产品数据根 = `<便携目录>\data`；程序文件与用户数据分离，更新只交换程序，不触碰数据。

## 决策

### 1. 数据根与优先级

L1（Rust 壳）在 `main()` 最前面解析便携形态，只做读取、原生选择框与写环境变量：

| 优先级 | 来源 | 语义 |
| --- | --- | --- |
| 1 | `DSH_EAC_DATA_ROOT` | 显式注入，原样采用（测试/端到端/高级用户） |
| 2 | `<exe>\.dsh-portable-data.json` | 记录「继续使用旧位置」（旧版升级交接或用户选择） |
| 3 | `<exe>\data`（所有权记录匹配时） | 便携自有数据根 |
| 4 | 旧默认根 `%LOCALAPPDATA%\Deepseek Harness EAC` | 仅作为**导入来源**提示，不自动认领 |

便携形态同时把辅助目录收进同一数据根，否则 C 盘仍会留下缓存与配置：

- WebView2 profile → `<data>\webview`（`DSH_EAC_WEBVIEW_DATA_DIR`）
- 窗口状态 / 语言态 → `<data>\config`（`DSH_EAC_SHELL_CONFIG_DIR`）
- guest 浏览器 profile → `<data>\browser-guests`（`DSH_EAC_GUEST_DATA_DIR`）

三者只在便携模式写环境变量；安装版行为不变。

**通道判定（先定通道，再挑数据源）**：迁移时的期望通道按
「显式 `DSH_EAC_CHANNEL` › L1 注入的构建通道（`DSH_EAC_ENVIRONMENT_DEFAULT_CHANNEL`）› 目标数据根已有 `eac-data-binding.json`」
判定，**不由源数据的通道决定**。源数据的通道只用于挑选同通道的环境根：先找
`eac-<构建通道>`；找不到才退回「源绑定通道 / 唯一环境 / 最近使用的环境」。
反过来（先看源）会让 beta 便携版在导入旧 stable 数据时把整机通道改成 stable，
并写进 `eac-data-binding.json` 变成永久状态。

### 2. 所有权与旧数据

- 便携自有数据根写 `eac-data-owner.json`（`installKind=portable`、`dataRoot`、`installRoot`、环境信息）。
- 数据存在但所有权记录缺失/指向别处：**不静默认领**，弹窗让用户选「就地搬迁 / 新建空数据 / 退出」。新建只把旧 `dpx` 与 binding 改名为 `.stale-*`，不删除。
- 本机 C 盘存在旧产品数据且便携数据不存在：弹窗询问「复制导入 / 新建空数据 / 退出」。导入只复制、不移动、不改源数据。
- 由更新助手拉起的候选（存在 `DSH_EAC_UPDATE_TRANSACTION_DIR`）允许沿用旧数据根以保证升级连续，并写指针；这是唯一可信的「旧便携数据」证据。

### 3. 换路径搬迁（没有 dpx relocate API 时）

dpx 的 registry/环境清单和 `eac-data-binding.json` 都记录绝对路径，且 `createEnvironment` 在 root 不一致时 fail closed。因此：

1. 把旧 `<data>\dpx` 改名为 `<data>\dpx.stale-<时间戳>`（旧数据保留）；
2. 用 dpx 公开 API 在当前路径创建新环境；
3. 把旧环境内容（`dsh-home`、`home`、`appdata`、`localappdata`、`npm-*`、`workspace`、`xdg-*` 等，含未知插件数据）复制进新环境，排除 dpx 自己的清单/描述符/指南；
4. 重绑 `<dsh-home>\profiles\node_modules` 中指向旧程序树的宿主闭包 junction；
5. 写新的所有权记录。

全程不手写 dpx 注册表/环境清单；代价是搬迁需要一次数据复制。上游若提供 `relocateEnvironment()`，应替换为 O(1) 搬迁。

### 搬迁/重建失败后的可重试性

搬迁或重建在「隔离旧 `dpx` → 建新环境 → 复制内容」之间失败时，会留下半成品 `dpx/` 与更早的完整 `dpx.stale-*`。重试不能只看最新目录：

- 复制**开始前**在目标环境根写 `.eac-copy-state.json`（`state=in-progress`），复制成功后才改写 `state=complete`（附文件数/字节数）。标记文件属于环境根自己，不参与内容复制。
- 扫描 data 根下所有 `dpx` / `dpx.stale-*`，选**最近一个 `complete`（或无标记的原始数据）的环境**作为来源，`in-progress` 一律跳过；同一份数据里 stable/beta 并存时优先期望通道。
- 所有环境都是 `in-progress` 时 **fail closed**（`portable-relocate-source-incomplete`），不建新环境、不写所有权记录；旧数据原样留在 `dpx.stale-*`。
- 当前 `dpx` 已不存在（上次已隔离）时也能继续；
- 旧 `eac-data-binding.json` 移入来源 stale 容器，避免下一次启动读到旧 `storageRoot`。

**为什么不用「有 `.dpx-environment.json` 就是完整」**：清单由 `createEnvironment` 在建环境时就写好，复制 GB 级内容要几分钟；中断留下的现场清单齐全、内容却缺。按清单存在判定会把半成品当来源，重试后写出的环境「看起来已完成」但静默少文件（#528 评审 2/3）。历史数据（旧版本环境根）没有标记，按原始数据处理即可。

`/died` 页的环境诊断由 L1 直接 spawn，不经过 sidecar 的 `cmd.env`；因此 L1 必须把 `DSH_EAC_DPX_REGISTRY_HOME` 写进自身进程环境，否则诊断会读全局 `%LOCALAPPDATA%\DSH\DPX`，把正常便携环境误报成「未登记」。

启动选择框可用环境变量 `DSH_EAC_PORTABLE_CHOICE=import|relocate|new|exit` 跳过（仅本地验收/自动化使用；非法值仍走原生对话框）。

### 4. 更新链边界

`assertInstallBoundary()` 原本要求所有数据根都在安装树之外。改为按**交换面**判断（`assertExchangeBoundary`）：

- 拒绝数据根等于/包含安装树；
- 拒绝数据根与任一 `PORTABLE_ITEMS` 交换项重叠；
- 允许安装树内的非交换顶层目录（`data/`）作为数据根。

`preparePortable` 的整树遍历跳过该顶层目录（`treeFiles`/`treeEmptyDirectories` 的 `skipTopLevel`），避免哈希/复制 GB 级数据、避免用户 junction 触发 `update-package-tree-link`；`data/` 不进入 `preserved`，交换过程不 rename 它。

### 5. 宿主闭包 junction

宿主闭包（`<dsh-home>\profiles\node_modules`，指向程序树的 junction）的自愈实现归 `full-composition.repairHostClosure()`（#520 引入，`ensureDesktopProfileInit` 每次 boot 调用一次；覆盖缺失链接、悬空链接、指向别的安装闭包的链接，真实目录不动，并清理死链）。

便携迁移只负责**触发**：`prepareImport` / `prepareRelocate` 在复制完成后调用
`repairHostClosure(ensured.paths.dshHome, programRoot)`，因为复制出来的 `profiles\node_modules`
仍指向上一个程序树。本 PR 不再自带第二套 `replaceStale` 实现，避免与 #520 重复扫描与冲突。

## 布局

```text
<便携目录>\
├── dsh-eac-shell.exe / sidecar\ / dsh-desktop\ / dpx\ / ui-skin-manager\   ← 程序（交换面）
└── data\                                                                  ← 用户数据（不参与交换）
    ├── eac-data-owner.json
    ├── eac-data-binding.json
    ├── logs\  webview\  config\  browser-guests\  tmp\
    └── dpx\
        ├── registry\registry.json
        └── dsh-environments\eac-<channel>\
```

安装版仍为 `%LOCALAPPDATA%\Deepseek Harness EAC`。

## 替代方案

| 方案 | 不采用原因 |
| --- | --- |
| 数据根 = `<exe>\dpx\...`（issue 字面期望） | `dpx/` 本身是交换项：每次更新会把数据当程序文件复制/校验，边界检查也会拒绝 |
| 数据放在便携目录的兄弟目录 | 拷走文件夹不带数据；父目录可能不可写 |
| 直接移动 `data\` 换路径 | dpx registry/清单与 binding 的绝对路径会 fail closed；junction 也指向旧程序树 |
| 只改文档、保持 C 盘 | 与 issue 和便携版承诺冲突 |

## 风险与未覆盖项

- 换路径搬迁是复制式，需要约 2 倍数据空间；中断后旧数据在 `.stale-*`，可重试。
- 复制状态标记在环境根建好之后才写，中间有毫秒级窗口（建环境与写标记之间被杀）；这类残留在极端情况下仍可能被当原始数据。要彻底消除，需要在建环境之前先记录目标根，代价是给 dpx 加一层预登记。
- 导入（从 C 盘旧数据）中断后，未完成的环境根没有 `complete` 标记：下次启动 `data\` 已存在但无所有权记录，L1 只能给出「搬迁/新建」对话框，无法自动重新导入。当前行为是 fail closed（不复制半成品），用户需删除 `<data>` 后重来；后续可在 L1 增加「重新导入」分支。
- 内置更新备份仍要求额外空间（既有行为），小容量 U 盘可能失败。
- 同机安装版与便携版不能同时运行（单实例按 identifier）；安装版卸载会删除 C 盘公共数据，对自包含便携版无影响，但便携仍处于「沿用旧位置」模式时会受影响。
- WebView2 运行时安装、崩溃转储、事件日志等 OS 级写入不在「零 C 盘写入」承诺内。
- 尚未覆盖：真实 U 盘/只读介质、跨机器换路径、arm64、完整包原地更新 6.1.x→修复版的真实 GUI 健康检查。
