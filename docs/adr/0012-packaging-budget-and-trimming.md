# ADR 0012：打包体积与裁剪预算

日期：2026-10-18
状态：已接受（2026-10-18 审核修订）。取代 6.0.1 的「随包但未接线的固定版 WebView2」方案。
实施状态：本文规定待实现的裁剪、门禁和验收要求；文档修订不代表代码已完成或新产物已通过验收。

## 计数批注

6.0.1 基线来自 **2026-10-18 对 `EAC-Release-v6.0.1-20261007/lite` 产物的实测**。
ZIP 内容的压缩后字节取中央目录 `CompressedLength`，原始字节取 `Length`；
另行统计的当前源树数据会明确标注，不能与旧产物直接等同。
历史表中的 MB 按 MiB（1024² 字节）、GB 按 GiB（1024³ 字节）解释；门禁使用 §4 的整数字节阈值。
扩展名统计只表示裁剪候选，不证明文件可以删除。原稿的「约 193 MB / 17124 文件」
未计入运行资产和 TypeScript 依赖闭包的保留要求，**撤回该预测**。
**任何后续版本必须重新实测，不得沿用历史数字当验收结论。**

## 背景

### 6.0.1 lite 实测规模

| 指标 | 值 |
| --- | --- |
| portable.zip | 536.7 MB |
| Setup.exe | 482.8 MB |
| 解压后原始体积 | 1371.4 MB |
| 文件数 | 35424 |

按顶层目录拆：

| 顶层 | 文件数 | 原始 | 压缩后 | 占 zip |
| --- | ---: | ---: | ---: | ---: |
| `dsh-desktop/` | 35132 | 689.7 MB | 230.4 MB | 42.9% |
| `webview2/` | 257 | 668.7 MB | 294.7 MB | **54.9%** |
| 其余（壳/`dpx`/`sidecar`/皮肤管理器） | 35 | 12.9 MB | 3.9 MB | 0.7% |

`dsh-desktop/` 内部：

| 子目录 | 文件数 | 原始 | 压缩后 |
| --- | ---: | ---: | ---: |
| `node_modules/` | 32320 | 550.0 MB | 168.8 MB |
| `vendor/` | 2694 | 137.7 MB | 60.9 MB |

`vendor/` 明细：`node.exe` 88.2 MB（压缩 33.0）、`kernel/` 19.9 MB（327 个 tgz）、
`pnpm/` 17.8 MB、`npm/` 11.7 MB。

`node_modules/` 前六名：

| 包 | 原始 | 压缩后 |
| --- | ---: | ---: |
| `@deepseek-ai/libreoffice-kit-win32-x64` | 182.0 MB | 65.6 MB |
| `@typescript/typescript-win32-x64` | 27.1 MB | 9.3 MB |
| `node-pty` | 26.8 MB | 7.3 MB |
| `sherpa-onnx-win-x64` | 22.4 MB | 8.3 MB |
| `@img/sharp-win32-x64` | 18.5 MB | 7.9 MB |
| `pnpm` | 17.8 MB | 4.4 MB |

### 问题一：294.7 MB 的 WebView2 随了包，但从未被使用

6.0.1 的配置是：

```json
"webviewInstallMode": { "type": "skip" },
"resources": { ..., "staged-resources/webview2/": "webview2/" }
```

`skip` 表示安装器不处理 WebView2；固定版运行时（`Microsoft.WebView2.FixedVersionRuntime.154.0.4258.53.x64`，
cab 293.7 MB，解压 668.7 MB）被手工拷进 `staged-resources/webview2/` 并映射为资源。

但没有任何代码指向它：

- wry 0.55.1（`src/webview2/mod.rs:343`）调用
  `CreateCoreWebView2EnvironmentWithOptions(PCWSTR::null(), ...)` ——
  第一个参数 `browserExecutableFolder` 传 `null`，语义是「用系统已安装的运行时」。
- 全仓 `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER` / `fixedRuntime` / `browserExecutableFolder` /
  `CoreWebView2EnvironmentOptions` / `msedgewebview2` 均 **0 命中**。
- `installer-hooks.nsh` 无任何 WebView2 相关环境变量或注册表写入。
- 未使用 Tauri 的 `FixedRuntime` 模式（该模式会把路径传进 `browserExecutableFolder`）。

**结论：这 294.7 MB 是死重。** 它是 `stage-resources.mjs` 里嵌在
`if (fullPack 存在)` 块内的 `cpSync(runtime, staged/webview2)` 顺带拷进 full staged 的，
`make-lite-staged.mjs` 的 `LITE_RESOURCE_DIRS` 又保留了 `'webview2'`，于是跟着进了 lite。

### 问题二：近半数文件命中裁剪候选扩展名，但不能按扩展名全删

按扩展名统计（全包，`.ts` 等项包含相应声明文件）：

| 扩展名 | 文件数 | 原始 | 压缩后 |
| --- | ---: | ---: | ---: |
| `.ts` | 8772 | 48.0 MB | 10.1 MB |
| `.map` | 4746 | 47.5 MB | 10.3 MB |
| `.md` | 1504 | 11.6 MB | 4.4 MB |
| `.mts` | 1185 | 4.7 MB | 1.0 MB |
| `.cts` | 166 | 1.6 MB | 0.3 MB |
| **合计** | **16373** | **113.4 MB** | **26.0 MB** |

这些文件占压缩后体积 4.8%，占**文件数 46.2%**。当前源树的 `node_modules/`
有 16162 / 32405 个文件命中这五类扩展名，统计口径与旧 ZIP 不同。
减少逐文件写入有望缩短安装时间，但磁盘、杀毒扫描、解压和运行时安装也会影响耗时；
不能仅凭文件数断言主因或线性提速。

审核已确认两类不能直接删除的内容：

- **Markdown 运行资产**：`@deepseek-ai/dsh-skill-office/lib/index.js:55-62` 在技能注册时
  读取三个 Office 技能的 `SKILL.md`；`dsh-sandbox-windows-acl/lib/types-Cl_DXjhk.js:1101`
  读取诊断技能正文；`dsh-skill-badge/lib/index.js:40` 在调用时读取 `assets/dsh-badge.md`。
  它们通过文件系统读取，不会因检查 `exports` 就自动受到保护。
- **TypeScript 入口依赖**：`eventsource-parser/src/index.ts:1-2` 继续导出
  `errors.ts`、`parse.ts`；`src/stream.ts:1` 也导入 `parse.ts`。只保留 `exports`
  直接指向的入口，会让启用 `source` 条件的消费者加载失败；普通默认导入走 `dist`，
  不能据此断言默认启动已坏。`zod` 的 `./v4/locales/*` 导出还需要展开通配符。

因此，以上 16373 个文件是**候选统计，不是删除清单**。原有 dev-only 与扩展名分类
有交集，新的删除数必须在应用保留规则后重新统计；互斥历史分类见决策 §4。

### 问题三：win32 分支没有平台裁剪

`stage-resources.mjs` 有 `if (targetPlatform === 'linux')`（`:562`）与
`if (targetPlatform === 'darwin')`（`:580`）两个裁剪块，各自 `rmSync` 掉不可达的
跨平台 payload 并调用 `pruneLinuxPayloads` / `pruneDarwinPayloads`。

**`win32` 分支只有 `WebView2Loader.dll` 前置检查（`:124`）和装配（`:659`），
没有任何裁剪。**

由于交叉编译被显式禁止（`--target` 必须等于 `process.platform`，见 `:43-46`），
这三个分支各自只在本机平台运行时生效。因此 Windows 产物里若存在 macOS/Linux
专属 payload，没有任何代码会剔除它。

**实测后果**（2026-10-18，win32/x64 源树）：

| 包 | 保留 `win32-x64` | 应剔除的异平台 prebuilds |
| --- | ---: | ---: |
| 合计 | 9 文件 / 12.24 MB | **48 文件 / 15.92 MB** |

其中 `node-pty/prebuilds/win32-arm64` 单目录 **11.22 MB / 6 文件** ——
在 x64 机器上永远不会被加载，却随 Windows 产物一起发出。
另有 `bare-fs` / `bare-path` / `bare-url` 各 12 个异平台目录（含 android、ios、
darwin、linux）。

**注意 `assertNoUnexpectedNativePlatform` 挡不住这一类。** 它（`stage-node-modules.mjs:170`）
按**包名**里的平台 token 判定，而 `prebuilds/` 是**包内子目录**，包名里没有平台词。
实测 `assertNoUnexpectedNativePlatform(nm, 'win32', 'x64')` 返回 PASS —— 这 48 个
异平台 prebuilds 全部漏网。

### 问题三之二：`pruneNonDarwinPrebuilds` 硬编码 `darwin-arm64`

`stage-platform-prune.mjs:125`：

```js
if (platformDir.isDirectory() && platformDir.name !== 'darwin-arm64') {
```

对比同文件的 `pruneNonLinuxPrebuilds:57`，它用的是 `linux-${arch}`（参数化）。
darwin 版本写死了 arm64，**在 darwin-x64 上会把该保留的 prebuilds 删掉、
把 arm64 的留下**。

这条目前不影响 Windows 产物（darwin 分支只在 macOS 上跑），但它是同一类缺陷：
平台裁剪按字面量而非按 target 推导。补 win32 分支时必须同时修掉它。

### 问题四：打包脚本按旧假设硬编码，与当前代码不一致

`make-lite-staged.mjs` 与 `make-portable-lite.mjs` 位于任务根
（`EAC-Full-Build-20261004/`，**不在 EAC-Desktop 仓库内**），仍停留在 6.0.1 的形态：

| 位置 | 硬编码 | 当前实际 | 后果 |
| --- | --- | --- | --- |
| `make-lite-staged.mjs:130` | `LITE_RESOURCE_DIRS` 含 `'webview2'`（5 项） | `tauri.conf.json` 只有 4 项 | 键集断言失败 |
| `make-lite-staged.mjs:334` | `if (builtin !== 9)` | `BUILTIN_PLUGIN_DIRS` 10 项 | 断言失败 |
| `make-lite-staged.mjs:336` | 必需 `webview2/msedgewebview2.exe` | 不再装配该目录 | fail |
| `make-portable-lite.mjs:135,175` | 必需 + 门禁 G8f `webview2/msedgewebview2.exe` | 同上 | fail |

实测 `node make-lite-staged.mjs --dry-run` 当前第一步即失败：
`FAIL: 来源 staged-resources 不存在`。

## 决策

### 1. 默认使用系统 WebView2，禁止携带未接线的副本

默认产物不内置固定版运行时。`webviewInstallMode` 的安装器行为与便携版启动必须分别处理：

| 取值 | 安装器行为 | 尚未安装系统运行时时能否离线安装 | 便携版直接启动 |
| --- | --- | --- | --- |
| `downloadBootstrapper`（当前，默认） | 下载并运行引导器 | 否 | 不执行引导器，依赖系统运行时 |
| `embedBootstrapper` | 内嵌引导器，再联网下载运行时 | 否 | 不执行引导器，依赖系统运行时 |
| `offlineInstaller` | 内嵌并运行离线安装器 | 是 | 不执行安装器，仍依赖系统运行时 |
| `fixedRuntime` | 通过 Tauri 配置使用随包固定版 | 是，前提是资源完整且接线有效 | 必须单独验证运行时路径和资源均有效 |
| `skip` + 手工拷固定版目录（禁止） | 不处理运行时，目录也未接线 | 否，复制文件不等于安装或接线 | 仍依赖系统运行时 |

- **安装版**：默认使用 `downloadBootstrapper`。已安装兼容系统运行时的机器不必重复下载；
  缺少运行时且断网时，应报告安装失败原因。离线安装产物可用 `offlineInstaller`。
- **便携版**：默认要求系统已安装兼容 WebView2，并在随包使用说明中写明此前提及官方安装入口。
  缺少运行时的机器必须出现可操作的提示；提示不能依赖尚未创建成功的 WebView。
  仅设置 `downloadBootstrapper` 不满足此要求。当前尚无便携版补装流程，必须补齐缺失提示
  并在干净环境验证，才能把便携版首次启动验收标记为通过。
- **离线便携版**：已有系统运行时可直接使用；没有系统运行时则须先离线安装运行时，
  或另行交付经验证的 `fixedRuntime` 产物，不能承诺默认 ZIP 在所有机器上离线可用。
- **固定版例外**：必须使用 Tauri 的 `fixedRuntime` 模式，校验锁定版本与
  `msedgewebview2.exe` 的 SHA-256，并验证实际创建 WebView 时使用的是随包目录。
  安装树、便携解压树都要测，不能只证明资源存在。
- 引导器、离线安装器和固定版运行时的增量体积随版本、架构和压缩方式变化。
  SDK 中约 1.8 / 127 / 180 MB 的说明不能替代实测；6.0.1 固定版实际占 ZIP 294.7 MB。
  `fixedRuntime` 不自动豁免 §4 预算，超限时须以实测数据修订该产物的明确预算再出包。

### 2. 按用途裁剪，先保留运行资产与模块依赖闭包

本节的用途与扩展名裁剪只作用于 **staged 的 `dsh-desktop/node_modules`**，绝不修改源树、Pack 源仓库，
也不套用到 `assets/plugins`、`vendor/` 或 Full 的其他资源树。平台资源仍按产物目标裁剪；
Pack 为三平台保留的资源及与 Lite 重复供给的插件，不因本规范从源仓库删除。

在 `stage-node-modules.mjs` 的 `includeSource()` 中实现以下顺序，
与既有 `devOnlyPaths` / `EXCLUDED_TOP_LEVEL` 配合：

1. **建立保留集合，保留规则优先于新增扩展名排除规则。** 包括运行资源、模块入口及其
   依赖闭包、`verify-staged-runtime.mjs` 的 `REQUIRED_FILES`、必要的许可证与署名文件。
   若必需项与 dev-only 排除冲突，必须报告并修正依赖分类，不能静默丢弃。
2. **Markdown 不得全删。** 保留 `SKILL.md`、技能引用的 Markdown 资源和文件系统读取的
   运行资产，至少覆盖背景中 Office、ACL、Badge 三个包。未确认用途的 Markdown 先保留；
   只有经过核对的文档路径才可列入排除清单，并记录包版本、路径规则和删除依据。
3. **TypeScript 保留完整闭包。** 检查 `exports`（所有条件、数组、子路径和通配符）以及
   `main` / `module` / `browser`，将模式展开到实际文件，再保留入口继续导入、导出的文件
   及所需资源。源码中的 `.js` 引用按该包的源码解析规则核对，不能直接断言对应 `.ts` 无用。
   动态路径或源码映射无法可靠分析时，先保留该包对应的完整源码目录。
   「保留 13 个直接入口」不再是合法实现或验收口径。
4. **声明文件与 sourcemap 是候选。** `.d.ts` / `.d.mts` / `.d.cts` 不作为普通 JS 模块
   执行，但可能被随包编译器或其他工具读取；先保护这类资产和必需项，再排除已确认不用的
   声明文件及 `.map`。真实 `.ts` / `.mts` / `.cts` 仅在闭包与资源保留规则之外排除。
5. **输出可核对的报告。** 按规则记录删除路径、文件数、原始字节数，以及保留项和理由；
   统计必须互斥，未知用途文件记为保留，不能为凑预算改判为可删。

`REQUIRED_FILES` 只是最小运行文件清单，不涵盖全部技能和动态资源。
`exports` 也不列出所有文件系统读取路径，两者不能替代运行资产清单。
保留清单应记录包版本、路径或受控目录规则，并由独立的注册、调用和加载检查验证。

既有逐包文件数检查继续保留，但它与复制共用 `includeSource`，错误规则会使两边同时少算；
**文件数一致不能证明没有误删**。必须另设不从该过滤器推导预期值的功能检查（见「验证」）。

`vendor/kernel/` 的 tarball 继续随包，不在本次扩展名裁剪范围内；是否移除留给后续任务。

### 3. 平台裁剪必须三平台对称

`stage-resources.mjs` 必须为 `win32` 补齐与 `linux` / `darwin` 等价的裁剪块：
删除目标平台不可达的 `.node` / `prebuilds/` / 平台专属包。

`.node` 按二进制格式（ELF / Mach-O / PE）及目标架构判定；不能仅凭扩展名
判断它是否属于目标。当前 `prebuilds/` 使用 `platform-arch` 命名，按
`${targetPlatform}-${arch}` 保留（例如 `win32-x64`、`linux-x64`、`darwin-arm64`），
删除已确认属于其他目标的目录；遇到未知命名或格式时报告并核对，不猜测后直接删除。
三平台各自在本机执行装配与验收，不据此开放交叉打包。

**同时修掉 `pruneNonDarwinPrebuilds:125` 的 `'darwin-arm64'` 字面量**，
改为 `darwin-${arch}`，与 `pruneNonLinuxPrebuilds:57` 的写法对齐。

**新增平台专属大包时必须同时补齐三平台分支**，否则该包会在另外两个平台的产物里
白占体积。

**`assertNoUnexpectedNativePlatform` 不能替代本决策** —— 它只看包名里的平台 token，
对包内 `prebuilds/` 子目录无效（实测 48 个异平台 prebuilds 全部漏网）。
两者是互补关系，不是替代关系。

### 4. 体积与文件数双预算

两个门禁必须同时满足，任一超限即拒绝出包。默认 Lite / Full 的阈值保持不变：

| 门禁 | lite | full |
| --- | ---: | ---: |
| portable.zip 实际文件大小 | ≤ 260 MiB（272629760 字节） | ≤ 1.1 GiB（向下取整为 1181116006 字节） |
| 最终运行树普通文件数 | ≤ 20000 | ≤ 40000 |

预算按产品、目标平台、架构分别执行，不能用 Windows 的实测替代 macOS/Linux 验收。
固定版运行时等另行定义的产物若超出默认预算，应先记录实测依据并修订其明确阈值；
没有单独预算时仍执行上表，不允许自动跳过。

**计量与覆盖要求：**

- ZIP 大小使用最终文件的实际字节数，不以条目 `CompressedLength` 之和代替；
  后者只用于体积归因，不包含全部 ZIP 开销。
- 文件数统计所有普通文件，包含便携标记等隐藏文件，不计目录。ZIP 同时统计非目录
  文件条目，并与解压树核对；拒绝重复条目及未定义的符号链接或 reparse point，避免口径绕过。
- 安装版对安装后应用载荷树执行同一文件数预算，排除安装器自身生成的卸载器和安装日志；
  须记录这些排除项。Setup 的压缩格式与 ZIP 不同，必须另行记录实际字节数，
  **上表的压缩大小预算仅针对 portable.zip**，不得当作 Setup 的大小结论。
- 新增**仓库内公共预算检查器**，供仓库内 `tauri-shell/make-portable.mjs`、任务根
  `make-portable-lite.mjs`、Full 出包入口及安装包验收共同调用。预算值与计量逻辑只维护一份，
  任务根脚本不得复制实现或只打印警告。公共检查器及调用接入均属于待实现项。
- 出包报告须列出 Lite/Full、平台、架构、形态、实际字节数、文件数、阈值和通过状态。
  无入口覆盖证据或未执行检查视为未验收；超限不得发布或生成成功标记。

基线对照（6.0.1 lite）：536.7 MB / 35424 文件，两项均超。
2026-10-18 当前源树的历史扫描按以下四类互斥切分，加总为全量；
其中按扩展名和直接入口划分的候选项，**尚未应用本次修订的完整保留规则**：

| 历史扫描分类 | 文件数 | 原始 | 修订后的含义 |
| --- | ---: | ---: | --- |
| dev-only 包（`package-lock.json` 标 `dev: true`） | 2571 | 70.0 MB | 既有 staging 排除，必需项冲突须检查 |
| 扩展名候选（dev-only 包外，旧扫描未识别为直接入口） | 15424 | 100.7 MB | 含运行资产、间接依赖及通配符目标，不能整体删除 |
| 旧扫描识别的 TypeScript 直接入口 | 13 | ~0 MB | 不完整的入口统计，不是完整保留集合 |
| 其余文件 | 14397 | 392.3 MB | 旧扫描未列为候选 |
| **合计** | **32405** | **563.0 MB** | 源树统计，不是新产物实测 |

旧稿据此得到的「可删 17995 文件 / 170.7 MB」以及「约 193 MB / 17124 文件」
均不再作为安全删除量或产物预测。§2 的保留规则落地后，需重新生成互斥统计和真实压缩结果，
才可判断是否达标。**预算不足时保留功能，继续找有证据的优化项，不能误删资产凑数。**

`d00ff202` 的 dev-only 排除只在 staging 生效，源树仍有对应文件；它不是本次新增收益。
WebView2 的历史 ZIP 占用 294.7 MB 与异平台 prebuilds 的源树占用 15.92 MB
继续作为问题证据，不能直接折算为当前版本已经实现的收益。
声明文件是否保留也按实际工具读取需求判断，不再以「有类型导出即可全删」作结论。

### 5. 打包脚本必须从配置派生，不得硬编码

任务根的编排脚本（`make-lite-staged.mjs` / `make-portable-lite.mjs` /
`bundle-lite.mjs`）**不得**再硬编码以下任何一项：

- `tauri.conf.json` 的 `bundle.resources` → 读取目标配置合并后的实际资源映射，
  校验来源与目标路径，不再断言固定项数
- 随包内置插件数 → 从 `BUILTIN_PLUGIN_DIRS` 的权威清单读取，不得写字面量
- Lite / Full 资源目录 → 从实际映射与明确的产品排除规则派生；额外或缺失的资源
  必须报告，不能只取交集而把错误静默忽略
- WebView2 必需项 → 按实际模式校验：系统运行时方案不要求随包固定版目录；
  `fixedRuntime` 则要求完整运行时与有效路径

硬编码的代价已经在本次暴露：代码把 WebView2 去掉、把 builtin 从 9 改到 10 之后，
四个断言全部失效，构建链第一步就断，而且**没有任何测试会提前发现**
（这些脚本在仓库外，`npm test` 覆盖不到）。

**因此：`tauri-shell/` 内新增任何影响产物形态的配置项时，必须同步检查任务根脚本。**
把这条写进 `references/updates-and-packaging.md`。

## 实施清单

以下均为待实现或待验收工作，不因本文修订标记为完成：

1. **先建立保留清单与独立检查**：列出技能正文、文件系统读取资源、模块依赖闭包、
   必需声明文件和许可证；覆盖 Markdown 资产、间接 `.ts` 导入和通配符导出。
   无法准确分析的源码目录先整体保留。
2. **`stage-node-modules.mjs` 增加用途裁剪**：先执行第 1 步的保留规则，再应用已确认的
   排除规则，输出互斥统计及路径报告；保留现有复制完整性自检。
3. **补齐平台裁剪**：增加 `pruneNonWindowsPrebuilds(dir, arch)` 及 Windows payload
   裁剪，接入 `stage-resources.mjs`；同时把 Darwin 的架构字面量改为参数。
4. **更新所有编排入口**：修复任务根旧资源、插件数和 WebView2 必需项断言；
   同时核对仓库内便携脚本、Full 与安装版链路，全部从有效配置派生。
5. **补齐便携版缺少 WebView2 的提示与说明**，验证提示无需成功创建 WebView。
6. **实现仓库内公共预算检查器并接入全部入口**：Lite / Full、仓库内及任务根便携
   打包、安装包验收；增加恰好达标、超限失败、隐藏文件计数和入口遗漏检查。
   自动化证明超限时不会进入发布或标记成功的步骤，不能只有一条脚本调用记录。
7. **从最终产物验证并重新实测**：执行下表检查，记录每个产品、平台、架构与形态的
   结果。在本文追加有版本标识的新实测记录，保留 6.0.1 历史基线，不能覆写旧数据。

第 2 步依赖第 1 步；第 3、4、5、6 步可与前两步并行准备。
第 7 步必须在相关实现与入口接入完成后执行。任何未测试目标明确记为未验收，不能推定通过。

## 验证

`verify-staged-runtime.mjs` 的必需文件与捆绑清单检查继续运行，但不能代替功能验收。
同一个过滤器产生的复制结果与预期文件数会一起出错；验证预期必须有独立来源。

| 检查 | 范围与通过条件 |
| --- | --- |
| 用途裁剪 | 只在 staged `dsh-desktop/node_modules` 检查已批准的排除路径不再存在，保留清单中的文件及目录完整；不要求整个 staged 树的 `.md/.ts/.d.ts` 归零 |
| 技能运行资产 | 从 staged 及最终运行树实际注册三个 Office 技能、ACL 诊断技能，并读取正文；调用 Badge provider 的 `get()`，不能只检查列表 |
| TypeScript 闭包 | 在适用源码加载方式下验证 `eventsource-parser` 的 `source` 入口及内部依赖，验证 Zod 通配符匹配项与依赖；同时验证普通默认导入。源码加载器若是测试工具，应记录与产品运行时的区别 |
| 误删回归 | 在独立测试夹具中删除 Office 技能正文或 `eventsource-parser/src/parse.ts`，功能检查必须失败；只测试过滤器输出不够 |
| 平台裁剪 | 每个平台本机核对 `prebuilds/` 的 `${targetPlatform}-${arch}` 保留项及实际原生模块可加载；未知项有核对记录。不能把 Windows 白名单用于 macOS/Linux |
| 插件状态 | 使用隔离的新 profile 真实启动内核，按随包插件身份核对实际安装、启用与激活结果；按默认配置列明预期未激活项。不得把内核全部插件总数直接与 `BUILTIN_PLUGIN_DIRS.length` 相等作判断 |
| 预算与入口 | 每个 Lite / Full 入口调用同一检查器；实际 ZIP 字节、非目录条目数、解压树和安装载荷树文件数按 §4 核对。记录 Setup 大小，并证明超限会阻止发布 |
| 最终运行树 | 分别安装 Setup、解压 portable.zip 后启动与调用相关功能；检查最终文件内容，不只检查 staged 或 `target/release` |
| WebView2 条件 | 干净 Windows 环境分别覆盖已装/未装系统运行时与联网/断网；安装版验证安装成功或明确失败，默认便携版缺失时给出 §1 的提示。离线安装器或固定版例外另行验证 |

缺失运行时的默认便携版只能标记为“正确提示前置条件未满足”，不能标记为“应用启动成功”。
所有干净环境验收应隔离用户已有 profile、插件缓存与 overlay，避免从源树或旧环境补齐缺失文件。

**最终运行树验收是硬要求**：Tauri 增量资源复制可能留下上一轮中间物，
而安装树、解压树与构建输出并不相同。先清理可重建的旧副本，再从实际出包结果验证。

顺序固定为：源树只读试算并核对保留项 → staged 的独立功能检查 →
实际产物安装/解压后复查 → 预算与安装耗时报告。前一步失败就修正裁剪规则，
不能把“体积达标”当作功能完整的证据。

## 后果

### 正面

- 移除未接线的 WebView2 副本，减少已确认无用的文件；实际收益以新产物为准
- 减少逐文件写入，预期改善安装耗时；同环境记录安装前后耗时，不承诺线性提速
- 三平台分别验证原生载荷，减少异平台二进制混入
- Lite / Full 的入口使用同一预算口径，避免只约束本地某条脚本

### 代价

- 默认安装版在缺少系统 WebView2 时需要联网；离线安装器会增加包体积。
  默认便携版依赖已安装的系统运行时，需要缺失提示和使用说明
- 源码闭包与运行资产保留会减少可裁剪量，当前无法保证新产物达到旧稿预测值
- staged 树与源树内容不同，需要路径报告、独立功能检查和最终运行树验证辅助排障

### 未决

- **安全裁剪后的体积与文件数**：尚未出新包，必须按修订后的规则实测；
  默认预算仍生效，超限时继续优化或依据实测修订规范，不能静默放行。
- **`libreoffice-kit`（历史压缩后 65.6 MB）是否随包**：需要先确认缺失时相关
  skill 的行为。在结论出来前保持随包，不得为了体积擅自移除。
- **`vendor/kernel/`（历史 19.9 MB，327 个 tgz）能否删除**：需评估离线重装与
  修复链路是否依赖它；当前保持随包，不纳入本次裁剪。
- **`node_modules/pnpm` 与 `vendor/pnpm` 重复**：运行时包管理器从 `vendor/pnpm`
  取，dev-only 的副本已由既有规则排除，无需重复计为本次收益。

## 参考

- 实测数据来源：`EAC-Release-v6.0.1-20261007/lite/ARTIFACT-AUDIT-lite.json` 与 zip 中央目录
- WebView2 取值语义：`tauri-utils-2.10.0/src/config.rs` 的 `WebviewInstallMode`
- wry 环境创建：`wry-0.55.1/src/webview2/mod.rs:343`
- 固定版运行时锁：`EAC-Full-Build-20261004/downloads/webview2/runtime-lock.json`
- 分发边界：`docs/adr/0008-plugin-distribution-boundary.md`
- 打包操作说明：`.agents/skills/deepseek-harness-eac-dev/references/updates-and-packaging.md`
