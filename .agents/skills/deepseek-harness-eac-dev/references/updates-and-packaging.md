# 更新、安装与打包规范

## 三类更新

1. EAC 客户端更新。
2. DSH Agent overlay 更新。
3. 内置或市场插件更新。

三者不得共用模糊状态或相互覆盖目录。

## 客户端

- 安装版通过 NSIS Setup 完成替换。
- 便携版按完整目录树 staging、交换和重启。
- 下载支持校验、断点恢复和镜像回退。
- 安装失败保留旧程序、更新文件和诊断日志。
- 旧 Electron 版本接管不得删除用户数据。

### 便携整树事务

修改便携版目录树交换时必须考虑：

- helper 接管成功后主程序才退出。
- 壳 PID 超时仍存活时中止，不触碰安装树。
- staging 内容、目标版本、磁盘空间和固定顶层项先校验。
- 使用唯一事务目录和持久 journal 记录每一步。
- 交换顺序固定，失败按 journal 逆序恢复。
- helper 被杀、断电或系统重启后，下一次启动能识别并恢复未完成事务。
- last-good 只在新 sidecar、`boot.start` 和 Web 探针确认健康后清理。
- 回滚失败时保留新旧树、journal 和日志。
- `%APPDATA%`、`DSH_HOME`、profile、会话和下载缓存不参与程序树交换。
- 未知顶层文件、reparse point 和符号链接采用明确的保留、拒绝或隔离策略。

## Agent

- 更新安装到 overlay/staging。
- 新版本未确认健康前保留 previousAgent。
- 启动失败支持回退。
- npm registry 和镜像切换必须有超时和明确错误。

## 插件

- 更新前执行兼容门槛、冲突检查和 guard 快照。
- staging 验证通过后再替换内置覆盖层。
- 更新失败清理 staging，但保留当前可用版本。

## 打包

- `stage-resources.mjs` 是 Tauri 资源装配入口。
- 新增运行文件必须进入资源清单和完整性测试。
- 同步版本号到产品配置和发布产物命名。
- NSIS 与便携包都要验证真实目录结构。
- 不能只验证 `target/release`，必须验证安装后或解压后的运行树。
- **体积与裁剪预算见 [ADR 0011](../../../../docs/adr/0012-packaging-budget-and-trimming.md)**：
  lite ZIP ≤ 260 MiB / ≤ 20000 文件，full ZIP ≤ 1.1 GiB / ≤ 40000 文件。
  文件数按普通文件计、不计目录；安装载荷树也执行文件数预算，Setup 大小另行记录。
  改产物形态前先读该 ADR；新规则尚待实现，不能把文档更新视为产物验收通过。

### 体积红线

- **默认使用系统 WebView2，禁止携带未接线的副本。** 安装版默认
  `downloadBootstrapper`，也可用 `embedBootstrapper` 或离线安装器 `offlineInstaller`。
  这些安装器行为不会在便携版直接启动时执行：默认便携版要求系统已安装兼容运行时，
  必须提供使用说明和不依赖 WebView 的缺失提示。固定版例外须配置 `fixedRuntime`，
  验证安装树及便携树实际使用随包运行时，并实测体积；不自动豁免预算。
- **平台裁剪三平台分别验收。** 当前 Windows 装配缺少对称的裁剪分支，
  历史源树含 48 个异平台 prebuilds（15.92 MB）。各平台保留实际目标的
  `${targetPlatform}-${arch}`，核对二进制格式与架构；未知项先报告核对，不猜测删除。
- **`assertNoUnexpectedNativePlatform` 只看包名**，对包内 `prebuilds/` 子目录无效，
  不能替代平台裁剪或原生模块加载验证。
- **裁剪先保护运行资产。** `.md` 不得全删，必须保留技能正文、引用资源及其他
  文件系统读取的资产。声明文件、sourcemap 也先检查必需项和随包工具的读取需求；
  只删除已确认无用的路径，未知用途先保留。
- **TypeScript 保留完整依赖闭包。** 解析所有导出条件及通配符，并保留入口的内部
  导入、导出及资源；无法准确分析时保留对应源码目录，不能只保留旧扫描的 13 个入口。
- **用途与扩展名裁剪仅作用于 staged `dsh-desktop/node_modules`。** 不修改源依赖树、
  Pack 源仓库，也不把该规则套到插件资产或 `vendor/`；平台资源另按目标裁剪。
  三平台资源与 Lite 重复供给不能据此从 Pack 源仓库删除。
- **复制计数通过不等于功能完整。** 独立验证 Office / ACL 技能注册及正文读取、Badge
  调用和 TypeScript 入口加载，并用误删夹具证明检查能报错。不能要求整个 staged 树
  的 Markdown 归零，也不能用内核插件总数等于随包目录数代替逐插件状态核对。
- **预算检查必须共用仓库内实现。** 仓库内便携入口、任务根 Lite 脚本、Full 及安装包
  验收都要接入；超限阻止发布，缺少某个入口的检查记录即未验收。
  字节阈值和最终运行树计量详见 ADR §4；旧稿 193 MB / 17124 文件的预测已撤回。

### 编排脚本必须从配置派生

任务根的 `make-lite-staged.mjs` / `make-portable-lite.mjs` / `bundle-lite.mjs`
**在仓库外，`npm test` 覆盖不到**，因此更容易腐化。它们不得硬编码：

- 合并目标配置后的实际资源映射，不断言固定项数
- 随包内置插件数（从 `BUILTIN_PLUGIN_DIRS` 权威清单读取）
- 从资源映射及产品排除规则派生的目录清单，差异必须报告，不能只取交集
- WebView2 模式对应的资源要求，系统运行时方案不强制存在固定版目录

硬编码的代价已经发生过一次：代码把 WebView2 去掉、builtin 从 9 改到 10 之后，
四处断言全部失效，构建链第一步就断，而没有任何测试能提前发现。

**规则：`tauri-shell/` 内新增任何影响产物形态的配置项时，必须同步检查任务根脚本。**

## 关键文件

- EAC 客户端更新核心：`dsh-desktop/client-updater.js`
- Tauri 客户端更新适配：`lib/desktop/client-update.ts`
- Agent 更新：`dsh-desktop/updater.js`
- 内置插件更新：`dsh-desktop/plugin-updater.js`
- Tauri 资源装配：`tauri-shell/stage-resources.mjs`
- 生产依赖装配与裁剪：`tauri-shell/stage-node-modules.mjs`
- 平台裁剪原语：`tauri-shell/stage-platform-prune.mjs`
- 便携包：`tauri-shell/make-portable.mjs`
- NSIS 钩子：`tauri-shell/installer-hooks.nsh`
- Tauri 配置：`tauri-shell/tauri.conf.json`
- 发布工作流：`.github/workflows/release-tauri.yml`
- 体积预算：`docs/adr/0012-packaging-budget-and-trimming.md`

## 测试组

- `client-updater-*.test.ts`
- `client-update-platform.test.ts`
- `updater-*.test.ts`
- `update-mirror-chain.test.ts`
- `plugin-updater.test.ts`
- `bundle-integrity.test.ts`
- `bundled-files.test.ts`
- `installer-*.test.ts`
- `verify-dist-fresh.test.ts`

便携更新不能只测成功路径。还要覆盖逐步骤失败、文件锁、进程残留、helper 中断、健康检查失败、重复恢复和用户数据哈希不变。
