# AppImage 完整镜像事务 v1

日期：2026-10-18。当前状态见[功能说明](../development/client-update-implementation.md)。

本模块服务于 6.1.0 及之后的 EAC-Lite 自动更新。AppImage 仍在原路径更新；EAC-Pack 与产品数据不进入镜像交换。

## 当前实现

- `update-appimage.ts` 验证完整下载包的签名、大小、SHA256、ELF64/AI type 2 与目标架构；准备时再验证复制后的镜像。
- 原镜像、候选镜像和事务目录必须为普通路径。事务目录固定在原镜像父目录下 `.eac-update-<uuid>`，验证设备相同；候选完整复制、设置执行位并 fsync 后才允许交换。
- Linux 原镜像和父目录须归当前用户所有，父目录不可由组或其他用户写入；不可写或属其他用户时明确失败，尚不支持提权更新 AppImage。系统安装包的提权流程由 deb/RPM adapter 另行负责。
- 数据边界同时覆盖原镜像、事务目录、恢复指针和锁文件，拒绝与 DataBinding 或受保护数据根重叠。
- 锁复用 `withPortableLock` 的互斥上下文。Windows 保持 FileShare.None；Linux 使用固定 `/usr/bin/flock` 加独占非阻塞锁，由私有 stdin 保持生命周期；命令不经 shell，系统缺少 flock 时明确失败。
- `captureLinuxProcessOwners` 只读解析 /proc/PID/stat，以父子关系收集归属，并排除 helper 子树；不按进程名查找或结束进程。解析进程名中的空格、括号和换行，并将 starttime 保留为十进制字符串。无权读取明确指定的根进程时失败。

## 持久状态与执行边界

状态为 prepared → moving-current → current-moved → moving-candidate → health → committed。每次改变文件路径前先持久化意图；Linux 在 rename 后同步相关父目录。原镜像保存为 previous.AppImage，候选失败后保留 rejected.AppImage。恢复指针按原镜像文件名分别生成，修改文件前必须核对指针所属事务。

`installAppImage` 要求调用方提供原进程退出确认、候选健康验证和候选停止确认三个回调。原进程仍运行时不会交换；健康失败后仅在停止确认通过时恢复旧镜像。无法确认候选停止、文件变为未知内容或指针归属变化时保留两份镜像与日志，不覆盖未知文件。文件层不会把回调本身当作可信运行证据；外置 update-appimage-helper.ts 以复制的 Node 和独立模块执行这些回调：先校验接管请求与完整包，ACK 后等待提交，等待原进程树正常退出并完成冷态浏览器备份，再执行镜像交换。

正常提交后保留旧镜像供诊断，不在事务中删除；恢复指针在健康提交或完成恢复后清除。回滚已经提交的事务会被拒绝。重复恢复已经回退的事务保持旧镜像。

## 验证与未完成项

Arch Linux x86_64、Wayland/niri的完整AppImage6.1.0→6.1.1正常自动更新通过：原会话/回复/草稿/主题/字号/工作区、DataBinding/origin、正常退出与冷启动均验证。本地测试清单与包独立验签，不能作为正式发布包。

文件事务/helper/gate/proc/锁等有逻辑和条件回归；不将Windows镜像头fixture当作Linux可执行镜像。其他发行版、aarch64、跨发行版完整native glibc兼容性未由该主机证明。deb/RPM已接入系统授权/安装/重启，但仍需对应发行版实机，见[HANDOFF](2026-10-18-client-update-HANDOFF.md)。
