# 内置更新接续开发 HANDOFF

日期：2026-10-18。适用于本分支当前 Git 源码，不再以早期 dirty overlay ZIP 为开发入口。原始需求是 stable、四源、Windows portable/NSIS、Linux AppImage/deb/RPM、x64/arm64、保存后正常退出、原数据保留。主人允许按正常更新流程收尾，不要求扩大极端矩阵；6.0.1 不回移 updater，首版 6.1.0，测试 B 为6.1.1，基础产物 EAC-Lite。

## 1. 接收状态

先阅读[详细功能开发说明](../development/client-update-implementation.md)和[ADR0011](../adr/0011-client-full-update-boundary.md)。Linux 载荷修复 c61ca45 已在历史，不重复应用 repair-only.patch。维护者会另行提供原始平台报告、截图、日志和机器环境定位；这些材料不随本 PR 入库。

| 形态 | 当前结论 | 后续重点 |
| --- | --- | --- |
| Windows x64 portable | 完整6.1.0→6.1.1、数据/退出/冷启动通过 | 发布构建/签名与远端源复核；不为抹去旧失败重复测试 |
| Windows x64 NSIS | 隔离完整 Setup 正常更新通过，native 修复入口已测 | 正式发行运行树复核；长安装路径仍有限制，arm64未测 |
| Arch Linux x86_64 AppImage | 2026-10-17 Wayland/niri 正常流 PASS，原会话/草稿/偏好/工作区/端口、退出/冷启动通过 | 不外推 Debian/Fedora/openSUSE/aarch64 或完整 native glibc兼容性 |
| deb/apt、RPM/dnf、RPM/zypper | 代码接通与授权/安装协议测试通过 | **未实机验证，不得按可发行PASS处理** |
| 正式源/签名 | 生成工具/逻辑已实现；Linux本地签名源实测 | trustedKeys为空，Gitee/geoUrl为空；正式服务未上线 |

本轮交付任务以文档和分批本地提交完成为结束条件；不表示下表全部矩阵已验收。接续开发者只对维护者分配的后续项负责。

## 2. 剩余任务的优先顺序

### P0：若要宣称 deb/RPM 自动更新可用，必须补实机

在已有授权的专用测试VM/系统安装验证，不能在 Arch 上强装/转换包代替：

- Debian/Ubuntu x86_64：AppImage＋deb/apt。
- Fedora/RHEL 家族 x86_64：AppImage＋RPM/dnf。
- openSUSE x86_64：AppImage＋RPM/zypper。

每台只证明本机发行版与架构。ARM64须在真实目标架构单列验证，包括Windows arm64；没有环境写NOT_TESTED，不由x64替代。不用手动运行B/包管理器冒充自动更新。

每种原生包的最小正常验收：

1. 核对HEAD/submodule和已有工具，不复用Windows依赖/Node；使用已知兼容的Node24执行TS/更新专项/Rust，保存命令与退出码。缺工具记录BLOCKED，安装环境变更先按维护者授权执行。
2. 在隔离构建目录准备完整6.1.0 A、6.1.1 B，同步所有版本点；同identifier/系统包名/架构/格式。只在隔离A/B注入测试公钥，私钥不入仓库/报告。单平台清单可用--allow-partial，不称完整发布矩阵。
3. staging和安装后资源闭包必须通过，检查Linux Node执行权限、全部helper模块和root-owned安装代码；c61ca45已修复nested musl/pnpm泄漏。完整原生glibc基线需在规定发行构建机另验，不以Arch通过保证通用兼容。
4. 设置独立产品数据、registry、WebView/config/guest/工作区；**DSH_EAC_DPX_REGISTRY_HOME与DPX_HOME同时指向本轮registry**，数据通道beta可用于验证旧环境保留，不改HOME。先让A通过正常dpx登记，再用UI建立会话/草稿/偏好/假凭据。不要先塞数据造成未登记根拒绝认领。
5. 初次安装A可用系统安装器；A内选择本地signed stable.json。检查→下载/验签→保存安装，观察真实pkexec窗口。可做一次正常拒绝授权：不得开始安装，旧应用/原数据仍可用；随后重试。
6. root ready应早于旧应用退出；owners正常退出和冷备份应早于grant系统安装。确认包管理器exit0、已装6.1.1、B由普通用户helper自动启动；不能root启动GUI，不保存密码，不强杀安装器。
7. 记录linux-plan committed、helper-result ok、认证健康/接受、原DataBinding/origin和原会话/草稿/配置；正常退出后owners消失，从原入口冷启动复验，最后正常退出。会话可正常追加，用旧前缀/摘要说明而非伪造raw hash不变。

关注的代码：update-linux-root.ts、update-linux-helper.ts、update-linux.ts、update-restart.ts、update_startup.rs、server.ts。包归属/版本字段、root ownership、包管理器链接路径、桌面认证agent是需要真实系统确认的接缝。系统安装失败保留数据/材料，不承诺apt/dnf/zypper自动回滚；不要为通过而绕过root独立验签或健康gate。

### P0：正式提供自动更新前，补发行闭环

- 维护者选定并保管正式私钥，仅将批准公钥写入client-update-defaults.json。当前空trustedKeys会拒绝正式清单，不能保留fixture key顶替。
- 规定构建机产出需支持的实际格式/架构，检查Lite命名、内部产品identity、资源闭包、签名和安装后正常更新。NSIS现有测试树不直接成为正式发行包。
- 使用create-update-manifest.mjs默认完整矩阵生成/签署清单；如阶段性只发布部分平台，须先由维护者明确发布范围，不能用--allow-partial掩盖缺包。
- 上传包及签名、核对size/hash/URL/版本/架构后最后公开stable清单。artifact workflow上传CI附件不等于正式发布。推送、PR、发布均需对应授权。
- 用实际GitHub资产和controlled HTTPS custom测试正常远端流；Gitee配置为空时必须显示未配置且不发请求。Gitee/地区服务的地址、隐私策略和默认源由维护者决定，不能猜地址。确认手动源持久化、release过滤与HTTPS重定向策略。

### P1：按用户问题决定是否扩展

较长Windows安装路径、完整native glibc跨发行版兼容、特定发行版授权agent问题，按实际故障补修复。断电/磁盘损坏、强制包数据库恢复、差分、预发布、6.0.1原地patch不属于当前正常流程的追加前提。

## 3. 交付证据与禁止事项

后续执行结果写到 `reports/client-update-linux/<run-id>/`（Windows可用相应独立目录）：

- result.json、SUMMARY.md：平台/架构/格式、代码commit、scope、逐项PASS/FAIL/BLOCKED/NOT_TESTED、限制；不将未测平台汇总PASS。
- 环境与实际命令、cwd、起止和退出码；构建/staging/资源闭包/安装日志；修复前后patch和复验结果。
- 脱敏事务摘要、认证回执核验结果、原数据比较、进程退出、B和冷启动原会话的可见截图；HTTP200/PID存活/单测不是完整验收。

不导出私钥、token、cookie、真实凭据、完整handoff/root-request；不覆盖日常安装/真实用户数据，不为测试调用付费模型。旧失败与最终成功分别保留，不能重写历史结果。工具故障与产品故障分开记录；取消不等于已开始的系统安装回滚。

## 4. 原证据如何使用

维护者私下提供的Windows r11/r13与Linux `20261016T053922Z-x86_64`报告是当前结论依据，运行树/测试密钥均为隔离fixture。Linux result.json的PASS仅适用于Arch x86_64 AppImage，本地源的PASS不证明远端四源。其修复提交已合入，不必重放整次验收来抹去历史。

早期01～04 overlay/源码清单只用于还原旧dirty基线；Git分批提交后不再要求对新HEAD运行旧清单并忽略失败。verify-update-handoff.mjs仍可用于原快照核对，当前开发以实际Git HEAD/差异及构建为准。私有材料哪些该传、哪些绝不能传，由维护者的PRIVATE-HANDOFF-INVENTORY清单给出。
