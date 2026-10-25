# 参考项目与实现取舍

核验日期：2026-10-24。研究通过 GitHub 原仓 README、源码和公开发行元数据进行。
没有复制这些项目的业务代码；保留各自许可证，目录事实附固定来源与摘要。

| 项目 | 核验结果 | 在 EAC 启动器的应用 |
| --- | --- | --- |
| `ccch1mneyyy/dsh-TUI` | MIT；像素鲸、状态驱动界面、独立应用入口 | 像素字体、原创位图、运行状态、流畅且可减少的动效 |
| `Mai-with-u/MaiBot` | 社区工作台与深浅主题；有 OneKey 启动器 | 左侧导航、主题与工作台式布局 |
| `yyh-001/DSH-X` | MIT；多启动项、版本、整合包、日志与恢复 | 实例固定版本、端口隔离、导入导出、备份克隆 |
| `Ruler4396/dsh-launcher` | MIT；2026-09-29 已停更，强调生命周期和诊断 | 等待 HTTP 就绪、真实日志、进程归属 |
| `dsh-tauri/deepseek-harness-desktop` | Tauri2；另有 LICENSE.details 附加限制 | 仅研究架构，没有复制其实现或分发素材 |
| `look-back-lysj/deep-seek-harness-Unity` | 实际为 `@dsh-eac/market` 社区市场，并非 Unity 编辑器插件 | 固定提交目录、制品 SHA-256、撤回记录、真实安装入口 |
| `Ebony-Vinyl/EAC-Pack` | channel v13 / suite 0.2.1，明确记录官方内核不支持的 EAC 私桥组件 | 提供来源，避免把旧插件集合宣称为全部兼容 |
| `deepseek-ai/deepseek-harness` | MIT；官方 CLI `plugin --profile web add/remove` | 复用官方安装器、插件发现和准入机制 |

官方截至核验时的 GitHub 最新内核标签为 `dsh-v0.2.1-rc.3`，
npm `latest` 是 `0.2.1-rc.2`，`next` 是 `0.2.1-rc.3`。
因此界面读取实时 npm 版本和分发标签，不把预发布标成“最新稳定版”。

EAC Desktop GitHub 当前提供 `V6.0.1` Full/Lite 便携 ZIP 以及安装 EXE，
都有 GitHub 提供的 SHA-256。官方 Harness 仓库的内核 Release 没有
Desktop 附件；官方 Desktop 实际由 DeepSeek 下载站分发：
`https://download.deepseek.com/desktop/dsh-latest-windows-x64.exe`。
该地址来源为官方 `apps/desktop/publishing/README.md`，核验 HEAD 为 200。
启动器不能声称从 GitHub 下载不存在的官方 Desktop 附件。

插件与内核不是同一进程中可以任意混搭的 ABI。实现按实例绑定整个内核版本：
每个实例拥有独立 `DSH_HOME`、profile、端口和插件集合。一个实例内的插件
必须满足同一个内核；遇到冲突时创建/克隆另一个实例，分别绑定旧版/新版。
不自动改写其它实例，不自动升级正在运行的实例。

市场本地目录从固定提交
`8d2f53fd3b888149a0aa8c5d9708eb536ead771a` 的 `packages/market/data/index.json`
生成。原始目录 SHA-256、生成时间、来源 revision 保存在 `resources/catalog.json`。
保留该源的 62 条记录与 29 条固定安装入口，并增补公开发布的
`dshmarket` 和 `dsh-plugin-suite@0.2.1`：合计 64 条记录、31 条安装入口。
`dshmarket` 制品通过 npm SHA-512 核验后记录 SHA-256；EAC-Pack 使用 GitHub
Release 提供的 SHA-256。主分支的 `eac-plugin-suite@0.2.4` 仍标为 private，
不把它误写成可公开安装的发行版。未知运行兼容性保持未知。

素材：`public/eac-pixel.png` 为本次原创像素位图；
`public/fonts/Silkscreen-Regular.ttf` 来自 Google Fonts 的 Silkscreen，
许可证随 `public/fonts/OFL.txt` 分发。
