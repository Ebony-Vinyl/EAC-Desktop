# EAC 启动器

面向 DeepSeek Harness 的独立启动器，位于 EAC Desktop 仓库的 `launcher/`。
纯 Rust 单进程实现：eframe/egui 原生窗口，不依赖 WebView2、不启动本地 HTTP 服务、
不监听端口。所有操作直接调用本地 `Engine`，与之前的前端共用同一套数据目录。

## 运行

```powershell
cd launcher\src-tauri
cargo run --bin eac-launcher
```

默认 feature `gui` 编译原生窗口。也可以直接跑产物：

```powershell
src-tauri\target\debug\eac-launcher.exe
```

`EAC_LAUNCHER_HOME` 选择隔离数据目录（默认 `%LOCALAPPDATA%\EACLauncher`）；
测试时指向新建临时目录可避免使用日常数据。

### 内置运行时与目录

引擎在以下场景会用到一个随附的 Node 运行时（内核安装 / 本机扫描）：

```powershell
node launcher\scripts\prepare-runtime.mjs
```

从 Node 官方源下载并校验固定版本 Node + pnpm，写入 `launcher/runtime/`。
没有运行时也不影响已安装内核的启动，只会让「注册已有内核 / 本机发现」少一个来源。

目录由 `scripts/sync-catalog.mjs` 生成并提交到 `resources/catalog.json`（引擎
`include_str!` 内嵌）：

```powershell
node launcher\scripts\sync-catalog.mjs
```

## 界面

单窗口覆盖原前端的全部页面：总览、实例管理、插件市场、内核仓库、整合包、
发行版本、任务记录、个人中心、成就、偏好设置。对话框涵盖新建/配置/克隆实例、
注册/导入/导出、安装精确内核、按引用安装插件、整合包与便携桌面端安装、删除与恢复确认。

外观偏好（皮肤、大厅地址、捉虫模式）保存在
`%LOCALAPPDATA%\EACLauncher\gui-appearance.json`；主题与减少动态效果通过
`save_settings` 写回引擎。把 `.eacpack.json` 拖进窗口即可导入整合包清单。

## 当前能力

- 独立实例目录、端口和 `DSH_HOME`，固定绑定内核，不自动升级旧实例。
- 从 npm 安装精确内核版本，或验证并登记已有 DSH 目录。
- 通过官方 `dsh plugin --profile web add/remove` 管理实例插件。
- EAC 社区市场、DSH Market、EAC-Pack 与固定提交目录，保留撤回和禁止安装状态。
- GitHub EAC Full / Lite 发行文件，便携 ZIP 下载、SHA-256 和解压检查。
- 官方 Desktop 下载入口，以及已安装桌面 EXE 的登记。
- 真实进程、日志、认证 HTTP 就绪检查、启动与停止。
- 备份、恢复、克隆、描述文件导入导出、任务结果和深浅主题。
- 个人中心：GitHub 公开资料、DSH 会话用量热力图、Token/缓存/推理统计、模型平均速度。
- 成就系统：29 项真实事件成就（启航 / 社交 / 工坊 / 坚持），含隐藏成就、稀有度、
  进度与解锁时间；安装、启动、备份、Star、点赞、发布整合包等都会记录。

插件兼容性按官方核心的准入规则检查；未声明或未实测保持未知。不同内核通过
不同实例并存；同一个进程里的插件不能分别使用两套内核。

GitHub 登录（设备流 + 令牌、点赞、直接 Star）在 Rust 引擎中已完成开发并在真机验证，
但当前版本按发布计划**暂不开放**，界面显示「开发中」。开放时把
`src-tauri/src/social.rs` 的 `LOGIN_ENABLED` 置回 `true` 即可。

## 边界

- 原有 EAC / 官方桌面 EXE 可能自带全局单实例锁和私有路径策略。启动器不会改写
  已发布的二进制。独立 Harness 实例支持真正的并行运行；原有原生桌面实例需额外实机验证。
- 原生桌面端沿用自己的内核。需要指定核心版本时使用 Harness 实例。
- 外部登记的开发目录不是启动器托管的副本。版本、CLI 或依赖锁变动后会拒绝继续运行，
  应重新登记；发布使用的内核应通过精确版本安装到启动器托管目录。
- 导出是无凭据的安装描述文件，不包含会话和密钥。无法确认不可变来源的本地/Git/归档
  依赖会拒绝导出，不会悄悄替换成同名 npm 包；完整数据恢复使用实例备份。
- 下载尚未实现断点续传；任务可报告实际结果，安装仍需等待 npm/pnpm 完成。
- GitHub 浏览器设备流需要发布者或用户自备 OAuth App Client ID；发布构建时设置
  `EAC_GITHUB_CLIENT_ID` 会把它编译进程序（`option_env!`），运行时环境变量覆盖。
  仓库源码本身不内置 Client ID。
- `github.com` 无法直连的网络下，设备流与 GitHub 下载需要显式设置 `EAC_HTTPS_PROXY`
  （http/https 代理，如 `http://127.0.0.1:7890`）；未设置时引擎保持 DNS 固定 +
  私网校验，不读取系统代理。
- 全局插件下载榜与玩家大厅依赖外部 `pack-hall/server.mjs`；离线时明确回退到本机
  真实安装记录，不伪造全站数据。
- 个人中心只读取本机 DSH 会话日志中的 usage、模型与耗时字段，不读取或上传消息
  内容；使用自定义 `EAC_LAUNCHER_HOME` 时，默认只扫描该目录下的实例数据。

## 构建与检查

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo build --manifest-path src-tauri/Cargo.toml --release --bin eac-launcher
```

Rust 回归覆盖路径边界、实例生命周期、备份恢复、GitHub 参数校验、成就状态机、
会话用量解析与本地排行榜。以上命令均不上传产物，也没有会自动发布的 CI 工作流。

视觉与开源参考记录位于 `docs/RESEARCH.md`，验收清单见 `docs/ACCEPTANCE.md`。
