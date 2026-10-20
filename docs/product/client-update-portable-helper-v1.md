# portable 外部 helper 交接协议 v1

日期：2026-10-18。实现：`dsh-desktop/lib/desktop/update-portable-helper.ts`。

main.rs 在载入应用资源前执行启动恢复；sidecar 已接入安装与健康准入。Windows x64 完整产品6.1.0→6.1.1、正常退出与冷启动通过。完整范围及限制见[功能说明](../development/client-update-implementation.md)。

## 接管与所有权

L2 验证签名 ZIP、生成受控文件树和持久 journal。事务目录为安装目录的同卷兄弟目录 `.eac-update-<uuid>`；安装树中的 `.eac-update-recovery.json` 只定位这一固定目录。

helper 在事务目录的 helper/ 下复制当前 Node 可执行文件及所需模块，逐文件 hash 对账和 fsync。它不从即将被交换的安装树加载代码。handoff.json 保存包 identity、数据绑定、退出目标 PID 和一次性 token；files.json 记录复制闭包。

helper 先取得安装目录的操作系统文件锁，再重新检查 journal、签名包、ZIP 文件清单、待安装树 hash 和数据路径。检查通过后经私有 stdout 管道返回 transactionId、PID 和 token 的 ACK。父进程在 install 授权前可取消；EOF 使 helper 正常退出并释放锁。

收到 install 授权后，helper 等待指定旧壳和 sidecar PID 消失。超时返回 update-owner-exit-unconfirmed，安装树保持原样。确认退出后先冷备份 WebView 和 guest 数据，再交换程序树；普通失败回退不使用这份备份覆盖用户数据。

## 事务与恢复

固定顶层项来自 update-package.ts。每个动作先写 intent，再写 completed；目录记录旧目录身份，文件保留旧副本并以原子 rename 替换。主可执行文件最后替换。

更新前要求旧文件归属清单与当前文件一致。未知嵌套文件与用户空目录合并到新树；与新产品文件冲突时提前失败。未知顶层文件保持原位。journal 读取校验版本递增、target、完整顶层项、保留路径、文件 hash 和旧目录身份。

回退逆序执行，逐项验证旧目录身份与文件内容。恢复材料缺失或改变时保留 recovery-failed、pointer 和新旧树，不能清除 pointer 并报告成功。普通回退只处理程序文件。

FileShare.None 锁由独立 Windows PowerShell 文件句柄保持。helper 退出或被外部终止后，其私有 stdin 管道关闭，锁进程释放 OS 句柄。锁文件保留，避免删除锁文件造成并发竞争。

## 新版健康与停止协议

helper 启动固定的 dsh-eac-shell.exe，传入 DSH_EAC_UPDATE_TRANSACTION_DIR 和 DSH_EAC_UPDATE_HEALTH_TOKEN，沿用原数据绑定及获准的启动环境变量。

新版需生成 boot-health.json 的 HMAC 收据。payload 包含 schemaVersion、transactionId、实际 shellPid／sidecarPid／kernelPid、version、target、原 binding，以及实际探针得到的 httpReady、dataReadable。helper 验证身份、版本、绑定和进程存活；HTTP、数据 hash 对账、真实 persistence 会话日志读取，以及 WebView 原位偏好检查由 update-restart.ts 与私有 update-host 控制完成。健康期间 Agent admission 与主 UI 保持冻结；health-accepted 后才解除。

健康失败时，helper 写入认证的 stop-request.json。新版需要冻结业务、完成内核 root dispose、写入 boot-stopped.json 并自行正常退出。停止收据包含 shellPid、sidecarPid、kernelPid、owners、rootDisposed。helper 同时检查所有列出的 PID 已退出；未确认时保留 recovery-failed 并禁止程序回退。

健康通过后先持久化 committed、清除恢复 pointer，再写入 health-accepted.json 和 helper-result.json。原生启动应在健康接受前保持业务冻结。last-good 当前保留，清理策略尚未接入。接受健康后清除 sidecar 的临时更新启动环境变量；之后普通服务重启允许新对话变化，不重复将旧备份当作当前数据。

## 验证边界

独立helper的ACK/取消/锁/owners、签名包/候选树、防错身份、冷备份、失败候选恢复、认证健康、启动恢复均有回归。Windows x64完整产品正常更新和原会话冷启动已实测；历史故障恢复证据不等于所有断电/损坏矩阵已测。arm64仅有逻辑/命名覆盖，不能视为实机PASS。当前旧程序/last-good材料保留，自动空间清理策略未实现。NSIS与Linux采用独立adapter，不能套用portable回滚承诺。
