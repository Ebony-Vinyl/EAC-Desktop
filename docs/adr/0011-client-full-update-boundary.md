# ADR 0011：客户端完整包更新的内置边界

日期：2026-10-13；状态更新：2026-10-18。
状态：已实现正常更新链路；Windows x64 portable/NSIS 与 Arch Linux x86_64 AppImage 已实测，deb/RPM、arm64 和正式发行仍有验收缺口。
范围：stable、四源、完整包更新与原数据保留；当前实现与接续任务见 [功能说明](../development/client-update-implementation.md)及[HANDOFF](../product/2026-10-18-client-update-HANDOFF.md)。

在 ADR 0006 的最简本体中接回客户端更新入口。它是产品分发与数据保留能力，使用独立的更新配置与状态，不恢复旧 Electron updater 装配，也不接回 Agent overlay 或插件更新界面。

L2 的 client-update.ts 管理 stable 版本比较、多源策略、独立配置、下载事务与准备接口。update-sources.ts 统一四类来源并验证发布清单，update-signature.ts 使用现有 Node crypto 验证 minisign 格式与包身份，update-platform.ts 识别安装形态。没有引入新的运行依赖。

L1 只负责原生更新窗口、命令来源限制，以及安装 helper 交接与启动门槛。内核 Web 页面仍只获得官方 updates.status/open/subscribe；检查、来源配置和安装准备通过 shell origin 的 client-update.* 命令调用。内核与嵌入浏览器的 origin 不能调用这些命令。

更新发布通道固定 stable。运行数据环境身份独立记录在事务计划中，下载后的准备操作再次核对身份；发布版本不修改当前 DSH_HOME、profile 或环境通道。

正式公钥、Gitee 仓库和 geo-IP 服务保持产品配置的选定边界。未提供正式公钥时不能验证或安装清单；geo-IP 默认空值，避免把计划中的候选服务直接作为未经选定的运行服务。独立测试密钥只用于隔离夹具。

准备接口已接入原生 UI checkpoint、Host maintenance/持久化/root disposal、DataBinding 校验和受控备份。独立 helper 收到认证提交且原进程全部退出后才执行安装；新版须通过实际 boot、HTTP、会话摘要和 UI 健康确认。portable 使用持久 journal 与整树交换，NSIS 使用独立计划和受控 Setup，不将两者混为文件覆盖。

Windows x64 portable 和隔离完整产品 NSIS 的 6.1.0→6.1.1 正常更新、原会话与冷启动通过；Arch Linux x86_64 AppImage 在真实 Wayland 桌面完成相同正常流。测试签名和本机结果不能替代正式发布或全架构验收。deb/RPM 系统授权/安装/普通用户重启已接通，尚无对应发行版实机结论；arm64 和正式 key/远端源未验收。

内置更新从6.1.0起提供，不回移6.0.1；未集成EAC-Pack时产物称EAC-Lite，文件名不改变安装身份与数据目录。NSIS/系统包管理器失败保留数据和修复材料，不提供通用原子回滚；portable/AppImage恢复只处理程序，不回写旧用户数据。
