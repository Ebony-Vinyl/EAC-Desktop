# EAC 启动器

面向 DeepSeek Harness 的独立启动器，位于 EAC Desktop 仓库的 `launcher/`。
采用 Tauri 2 + React / TypeScript + Rust，与现有桌面端分别构建和分发。
本次没有提交、推送、创建 GitHub Release 或上传构建产物。

## 运行

```powershell
cd launcher
npm ci
npm run runtime:prepare
npm run tauri:dev
```

`runtime:prepare` 下载固定版本 Node 24.22.1，核对 Node 官方 SHA-256，
再安装 pnpm 11.7.0。打包时把完整运行时附带进安装包。首次下载需要联网。

浏览器联调使用同一个 Rust 引擎：

```powershell
node scripts/dev-connected.mjs
```

默认地址 `http://127.0.0.1:5178`，只监听本机。联调桥随机端口和令牌保存在
忽略目录 `.verify/preview.json`。它不是模拟后端。
测试时将 `EAC_LAUNCHER_HOME` 指向新建临时目录，避免使用日常数据。

## 当前能力

- 独立实例目录、端口和 `DSH_HOME`，固定绑定内核，不自动升级旧实例。
- 从 npm 安装精确内核版本，或验证并登记已有 DSH 目录。
- 通过官方 `dsh plugin --profile web add/remove` 管理实例插件。
- EAC 社区市场、DSH Market、EAC-Pack 与固定提交目录，保留撤回和禁止安装状态。
- GitHub EAC Full / Lite 发行文件，便携 ZIP 下载、SHA-256 和解压检查。
- 官方 Desktop 下载入口，以及已安装桌面 EXE 的登记。
- 真实进程、日志、认证 HTTP 就绪检查、启动与停止。
- 备份、恢复、克隆、描述文件导入导出、任务结果和深浅主题。
- GitHub 登录（设备流 + 细粒度/经典令牌、点赞、直接 Star）已完成开发并在真机验证；
  **当前版本按发布计划暂不开放**，界面显示「开发中」。开放时把
  `src/api.ts` 的 `GITHUB_LOGIN_ENABLED` 与 `src-tauri/src/social.rs` 的
  `LOGIN_ENABLED` 置回 `true` 即可，数据结构无需迁移。
- 个人中心：GitHub 公开资料、自定义头像、DSH 会话用量热力图、Token/缓存/推理
  统计、模型平均速度、按可编辑单价估算费用、连续使用天数与成就进度。
- 成就系统：29 项真实事件成就（启航 / 社交 / 工坊 / 坚持），含隐藏成就、稀有度、
  进度与解锁时间；安装、启动、备份、登录、Star、点赞、发布整合包等都会记录。
- 插件市场：日/周/月真实安装次数榜；大厅（144.126.133.165:4317）已部署新版接口，
  点赞/Star 随登录开放后立即可用。

插件兼容性按官方核心的准入规则检查；未声明或未实测保持未知。不同内核通过
不同实例并存；同一个进程里的插件不能分别使用两套内核。

GitHub 登录的 OAuth App 创建、权限范围、令牌存储和 Star 行为见
[`docs/GITHUB-LOGIN.md`](docs/GITHUB-LOGIN.md)。

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
  `EAC_GITHUB_CLIENT_ID` 会把它编译进程序（`option_env!`），运行时环境变量或登录
  窗口手填也可覆盖。仓库源码本身不内置 Client ID。
- `github.com` 无法直连的网络下，设备流与 GitHub 下载需要显式设置 `EAC_HTTPS_PROXY`
  （http/https 代理，如 `http://127.0.0.1:7890`）；未设置时引擎保持 DNS 固定 +
  私网校验，不读取系统代理。
- 全局插件下载榜需要部署新版 `pack-hall/server.mjs`；旧大厅或离线时明确回退到
  本机真实安装记录，不伪造全站数据。
- 个人中心只读取本机 DSH 会话日志中的 usage、模型与耗时字段，不读取或上传消息
  内容；使用自定义 `EAC_LAUNCHER_HOME` 时，默认只扫描该目录下的实例数据。
- 本地 Windows 验证结果见 `docs/ACCEPTANCE.md`；未验证平台与第三方业务按该清单验收。

## 构建与检查

```powershell
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --lib
npm run tauri:build -- --debug
```

当前 Rust 回归共 25 项，覆盖路径边界、实例生命周期、备份恢复、GitHub 参数校验、
成就状态机、会话用量解析与本地排行榜。浏览器联调使用真实 Rust 桥接；测试数据
放在忽略目录 `.verify/`。

`--debug` 是本地验收构建。正式分发应去掉该参数，并完成签名和目标系统验收；
以上构建命令均不上传产物。尚未添加会自动发布的 CI 工作流。

`scripts/sync-catalog.mjs` 从固定社区提交和公开发行元数据生成目录，
保留来源提交与摘要；目录同步不是插件安装。
视觉与开源参考记录位于 `docs/RESEARCH.md`。
