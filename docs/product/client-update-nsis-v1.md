# NSIS 完整包更新适配与验证边界

日期：2026-10-18。实现与边界见[功能说明](../development/client-update-implementation.md)。

sidecar 已接入准备、独立helper和共享健康监督。Windows x64隔离完整产品Setup正常6.1.0→6.1.1、原会话、正常退出与冷启动通过；只读修复提示入口已验证。正式发行运行树、arm64和长路径仍需独立验收。

安装器保留 currentUser。PREINSTALL 先校验路径，再以独占 CreateFileW 检查目标路径的应用文件。仍被占用时返回错误码 2，不终止进程。installerHooks 在 utils.nsh 装载后替换 CheckIfAppIsRunning，覆盖当前 Tauri 模板中安装与卸载共用的强杀路径。UPDATE 跳过历史 Electron 接管；旧 Electron 卸载调用携带 /UPDATE，失败或安装目录未知时保留登记。POSTINSTALL 写入 product、version、installKind、scope、arch，并保留既有 profile.txt。

update-nsis.ts 验证 minisign、大小、SHA256、PE 产品版本、目标形态、currentUser 身份与版本递增。签名安装包复制到原安装目录之外的同级事务目录 `.eac-update-<transactionId>/installer.exe` 并 fsync。数据保存、Host maintenance/root disposal、原 Web origin 和用户备份沿用 portable 的准备链路；NSIS 不执行 ZIP 展开，也不使用便携目录交换。

update-helper-process.ts 共用复制 Node/runtime 模块、文件 hash 清单、认证 ACK、提交和取消的传输协议；update-nsis-helper.ts 保留独立的安装计划、校验和执行。独立 helper 收到提交前不修改程序文件。提交后捕获原进程树，并在所有 owner 正常退出后持有 OS 安装锁，备份旧程序及冷态 WebView/guest 数据，重新验证安装包，执行固定的 `/S /UPDATE /D=原安装目录`。NSIS 从 /D= 起消费余下命令行，因此只对 argv0 加引号，最后的路径按其规则传入；没有 shell 或 cmd.exe 介入。

安装器返回 0 且安装 marker 版本匹配后，helper 才启动原目录的新壳。原生启动门槛根据固定 installKind 选择已复制的 helper，不执行清单提供的脚本路径。新壳必须持有正确事务 token、匹配原生版本，并确认 helper 存活且仍持有安装锁。无 token 的第二次启动不能穿过正在执行的事务；尚未开始安装的孤立 prepared 事务可取消并正常启动旧版。

UpdateRestart 对 NSIS 与 portable 使用相同的数据备份校验、实际 boot/HTTP 探针、会话摘要、原 Web origin 和 UI 恢复回执。helper 检查候选 shell PID、存活的 sidecar/kernel、版本、target、DataBinding、HTTP/data/UI 标记与 HMAC，随后提交并发布认证接受回执。接受前不放开 Host；只有接受后才记录更新完成。

安装或健康失败保留 signed installer、nsis-plan.json、helper-result.json、previous-program 及用户数据备份。健康失败通过认证 stop-request/boot-stopped 等待候选进程正常退出，不强杀以制造成功。NSIS 不提供原子程序树回滚，也不自动恢复旧用户快照。安装已经开始而事务未提交时，启动门槛返回 update-nsis-repair-required；当前源码已增加原生只读修复材料入口：核验已复制 helper、事务、版本和所有者后显示尚未完成、版本/安全错误代码与材料目录；确认只打开该目录，不自动执行安装器。真实 debug 壳 + 协议 fixture 的可见 UI 已验证，不能把它当作完整修复/自动重试通过。

## 验证范围

已有编译NSIS fixture验证文件锁、同名其他目录保护、profile/identity、签名/元数据、独立worker/健康/失败材料；隔离完整产品A/B Setup完成正常安装与冷启动。测试运行树早于后续Linux增量，测试公钥和隔离登记不属于正式发行包。只读修复提示已做真实原生UI验证，但不证明用户实际修复或自动重试。正式发行前仍需按最新HANDOFF完成发行构建和平台验收。
