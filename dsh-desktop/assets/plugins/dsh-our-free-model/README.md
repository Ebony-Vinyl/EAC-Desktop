<div align="center">
  <img src="icon.svg" alt="Our Free Model — DeepSeek Harness 免费模型插件" width="120">

# dsh-our-free-model

**简体中文** | [English](README_EN.md)

  <img alt="许可证" src="https://img.shields.io/badge/license-MIT-263146?style=flat-square">
  <img alt="零依赖" src="https://img.shields.io/badge/dependencies-zero-4b6fff?style=flat-square">
  <img alt="无构建步骤" src="https://img.shields.io/badge/build%20step-none-7da1de?style=flat-square">
  <img alt="适配内核" src="https://img.shields.io/badge/dsh-0.1.5--0.1.7--rc.2-2f6f4f?style=flat-square">
  <img alt="状态" src="https://img.shields.io/badge/status-beta-f0a441?style=flat-square">
  <br>
  <a href="https://trendshift.io/repositories/261203"><img alt="GITHUB TRENDING 第 1 名，日榜仓库" src="docs/images/trendshift-daily-laurel-gold.svg" width="250" height="55"></a>
  <a href="https://trendshift.io/weekly?language=JavaScript"><img alt="Trendshift JavaScript 周榜第 1 名（2026-10-05 至 2026-10-11，更新中）" src="docs/images/trendshift-weekly-2026-10-11-first-gold.svg" width="250" height="55"></a>
  <br>
  <sub>Trendshift JavaScript 周榜第 1 · 2026-10-05 至 2026-10-11 · 更新中，截至 2026-10-11</sub>

</div>

<div align="center">

> 你只需在 dsh 里装上这个插件，无需登录、注册、填 API Key 或任何其它操作，
> 就能用上包括 DeepSeek V4.1 Flash、Kimi K3 在内的前沿模型——完全免费，不限量。
>
> *All you do is install this plugin in dsh: no login, no sign-up, no API key, nothing
> else. The frontier models are just there — DeepSeek V4.1 Flash, Kimi K3 and the rest.
> Free, with no usage cap.*
>
> 模型清单跟随上游刷新，可用性由**你自己这台机器的网络出口**实测得出，
> 思考强度下发的是真实预算而不是提示词，另附一个 OpenAI 兼容的本地转发端口。
>
> 纯插件挂载：不改内核、无构建步骤、零依赖。

</div>

---

## 交流群

<div align="center">
  <img src="docs/images/qq-group-qr.png" alt="AI 技术交流学习群二维码" width="300">
  <br>
  <b>QQ 群：386179533（AI 技术交流学习群）</b>
  <br>
  扫码加入群聊，一起交流插件使用心得、反馈问题与分享玩法。
</div>

---

## 亮点

- **开箱即用，无配置环节**——不需要账号、不需要 Key、不需要在后台申请配额。
- **上游来源公开透明**——免费车道来源为 [OpenCode 的 Zen 网关](https://opencode.ai)，Kilo 渠道来源为 [Kilo AI 的公共网关](https://kilo.ai)，均直连、不经任何第三方中转。请求由谁处理、数据发往何处，见「上游是哪些源」与「免责声明」。
- **清单跟随上游**——模型集合、上下文长度与能力在每次刷新时向上游重新拉取，插件内不保存静态快照。
- **选择器只广播可用的模型**——上游清单已声明但网关明确拒绝路由的模型（返回 `Model is unavailable`、或 404 找不到该 id）从下拉框移除，仅在设置页保留记录并注明拒因；网关自身故障（5xx）、配额限制（429）、超时与断网不属于对模型的判定，一律保持可达；被地区策略拦截的模型归入 region-limited 分组。整轮探测全部被拒时同样保留，选择器不会为空。
- **公告中心 + 实时推送**——仓库维护者在仓库中编辑 JSON 并推送后，所有已安装实例最迟在一个轮询周期内收到；正文为白名单约束下的 HTML，支持图文排版；`urgent` 级别触发全屏弹窗；可选系统级通知。
- **应用内升级**——设置页一键升级：下载 → SHA-256 校验 → 备份 → 原子替换 → 校验回读 → 热重载，任一步失败自动回滚至上一版本。
- **热重载**——升级与代码变更即时生效，无需重启应用；也可在设置页手动触发，或启用文件监视自动重载。
- **按响应体形状判定流式响应**——网关在高负载下会以 `application/json` 的 content-type 返回完整的 SSE 帧序列。插件按响应体形状判定，并将已嗅探的字节重新注入流，既不会导致整轮失败，也不会因 header 与实际内容不符而将可用模型判为不可用。
- **思考强度实际生效**——两类模型两种控制：声明了思考档位的模型（如 DeepSeek V4.1 Flash、GLM 5.3 Flash）给出它自己的档位菜单（Off / Low / High / Max 等），选中值按原值下发到上游 `reasoning_effort`，上游会校验该字段、集合外的取值直接 400；没有档位菜单的模型（MiMo V2.6 等）走预算阶梯——Light / Balanced / Deep 对应输出 token 预算 2 048 / 8 192 / 模型上限，思考不可关闭的模型三档整体翻倍为 4 096 / 16 384 / 模型上限，因为思考与正文共享同一输出额度。两者都逐次调用留痕，设置页每张模型卡均标注档位或该档实际下发的上限（详见「思考强度：档位菜单与预算阶梯」）。
- **不依赖浏览器界面**——插件仅将 llm 作为硬依赖，在没有 web server 的 composition（如 dsh-tui）中同样完成启动并输出模型；看板模块挂载在独立的 fiber 上，待 webServer 就绪后再注册路由，因此既不会阻塞模型车道，也不会因插件先于 web 服务加载而永久丢失设置页。
- **用量看板，数据全部留在本机**——Token 热力图、总量曲线（支持总计与单模型视图）、输出速度与首字延迟逐次采样。不上传任何数据。
- **OpenAI 兼容转发端口**——本机其它工具通过 base URL 与 Key 即可调用这些模型。
- **EAC 渠道（桌面端专属）**——在 DeepSeek Harness 桌面端与 DSHEAC AIO 桌面端中自动解锁一条协付通道，模型以 EAC 前缀显示（如 EAC DeepSeek V4.1 Flash）；凭据加密密封，由宿主指纹闸门把守；该渠道在服务器侧校验 GitHub 授权（登录并 star 本仓库）后才放行对话；在命令行及其它宿主中该通道完全不存在。详见「EAC 渠道」。
- **Kilo 渠道（免密免费池）**——内置 Kilo AI 公共网关的免费模型池（`isFree` 清单实时拉取，含 `kilo-auto/free` 自动路由），无需任何账号或 Key；模型卡带 Kilo 徽章。思考强度与 EAC 渠道同款：模型自身的档位菜单（Off / Low / Medium / High，默认 High），经网关统一的 `reasoning` 参数真实下发——Off 已逐家族实测将思考归零（nemotron、ling、dots、poolside、apodex、cohere）；stepfun 与 liquid 端点强制思考（对关闭请求返回 400）、两个自动路由不透传关闭，这些模型的菜单不含 Off 档。该池由上游免费提供，上游会在其模型卡中声明 prompt 可能被记录用于改进服务——请勿发送敏感内容，详见「免责声明」。
- **聚合渠道，自带 Key**——设置页新增一页，把第三方端点接进同一条模型清单：注册表内置 75 家提供商（NVIDIA NIM、OpenRouter、Groq、Cerebras、SambaNova、Gemini、DeepSeek、Mistral、Together、Fireworks、SiliconFlow、Nebius、Chutes、Hugging Face、Cloudflare、Z.ai、Kimi、MiniMax、QwenCloud/Alibaba、Bedrock、Vertex、Vercel AI Gateway、Azure OpenAI，以及无需账号的 Ollama、LM Studio、llama.cpp），写入 Key（本机免账号的提供商不需要）后其模型即以 `provider/model` 出现在选择器里，也可经本地网关调用。Key 只写入本机 0600 的 settings.json，API 只回显 `hasKey` 与 `…abcd` 指纹；每家可单独启停、测试（列表探测，不花一次生成）、发现模型、覆盖 Base URL 与模型清单。OAuth 与 ADC 认证的提供商照常列出，但标注为不可驱动。
- **省 Token**——三件事：工具输出压缩（RTK）在请求发出前就地重写 `tool_result`（git diff / status / log、grep、find、ls、tree、构建日志、编号转储、搜索清单、重复日志行），实测 40 KB 的 `git diff` 移除 90% 的字节且模型仍能就它作答；提示词瘦身有 caveman 与 ponytail 两族、默认全关；另有五个不占用上游请求的本地应答。设置页用与用量图表同一批统计行显示压缩前后字节、节省比例、压缩块数与统计调用数。
- **路由（降级链）**——把任意车道的模型串成一条命名链，以 `combo:<name>` 作为虚拟模型出现在选择器与网关上；`fallback` 固定从链首开始，`round-robin` 轮换起点并连续 N 轮粘滞。链接在输出任何正文之前失败会被整段丢弃，切换对调用方不可见；思考增量不算正文，因此「想了很久才撞上配额墙」正是降级最有价值的场景。
- **本地网关原生说 Anthropic**——新增 `POST /v1/messages`（流式与非流式，含 thinking / tool_use 块、真实 stop_reason 与流内 error 事件）与 `POST /v1/messages/count_tokens`（本地估算）；`/v1/models` 广播全部车道，含聚合行与链路。网关页新增「接入客户端」分区，按实际绑定的端口与真实要求的密钥生成 Claude Code、Codex、OpenAI SDK、Anthropic SDK、curl 与局域网的可复制配方。
- **接口具备鉴权围栏**——插件 HTTP 路由优先级高于内核 `/api`，因此内置与内核一致的信任检查（优先复用 composition 的 connection 服务，缺失时退回结构化围栏）。
- **十三个白嫖渠道，一体接入**——CodeArts（华为云）、CodeBuddy / WorkBuddy（腾讯）、LobsterAI（有道）、Qoder / Qoder 中国版（阿里系）、TRAE（字节）、Cline、Loomy（讯飞）、Raccoon（商汤）、MiniMax Code、ZCode（智谱）、Gemini（Google Code Assist）十一个账号渠道开箱即用，外加 Kilo 免费车道与原匿名免费通道；OpenCode 账号渠道在本插件中默认停用。各渠道的登录流程、账号池、每日积分领取、模型黑名单与其本地 OpenAI 网关（Chat Completions + Responses，默认 `127.0.0.1:8326`）原样挂载与运行；凭据只写入宿主凭据库，浏览器永远拿不到明文。
- **十一页毛玻璃界面**——设置页顶部导航扩为十一个页面：原有六页（**免费模型**（鱼缸水位 = 可用模型占比）、**EAC 模型**（鱼缸水位 = 协付池压力）、**白嫖模型接入**（十三张渠道卡：登录、账号、模型开关、一键领取积分）、**数据看板**（今日/全部 Token 消耗、平均生成速度、缓存命中率、成功率，账号透视与模型性能表、最近请求总览）、**运行日志**（逐请求明细：结果、耗时、首字、速度、Token 细分，失败原因悬停可见）与**网关设置**（网关开关/端点/密钥；局域网转发中继：监听地址、端口与独立中继密钥）），新增**聚合渠道**（提供商注册表、Key、测试、发现模型、Base URL 与模型清单覆盖）、**省 Token**（压缩开关、两族提示词档位、五个本地应答与节省统计）、**路由**（降级链编辑器）、**插件升级**（版本检查、一键升级与热重载）与**推荐项目**（EAC-Desktop / EAC-Pack / EAC-design-world 三张卡片：简介、直达链接与 Star 按钮，Star / Fork / 最近提交数实时取自 GitHub，取不到就整块不显示）五页；网关设置页另增「接入客户端」分区。页面切换与卡片入场为 150–250 ms 短动效，`prefers-reduced-motion` 下整体关闭。每页都有直达 GitHub 仓库的 Star 按钮。
- **局域网转发中继**——渠道网关本身只监听本机（上游的安全选择）；本插件提供自己的转发门：调用方用插件签发与轮换的中继密钥，转发跳由宿主换用网关凭据（凭据不出宿主进程），仅放行 `/v1/*` 模型接口并带环路保护。

## 你会看到什么

**输入框的模型选择器**

| 分组 | 内容 |
| --- | --- |
| Our Free Model | 当前网络出口可直接使用的模型 |
| Our Free Model · region-limited | 上游对该地区不放行的模型，保留可见但单独隔离 |

被判定为「已声明但不路由」的模型不出现在任何分组中——它们仅在设置页的「不在选择器中」分组保留记录，
附带拒因与探测时间；后续探测重新通过后自动回到选择器。

**设置页** 设置 → Our Free Model，包含七个分区：

- **模型清单**——各模型的可用性、是否支持视觉、上下文窗口、最长输出、各思考档位实际下发的输出上限、实测首字延迟，以及单次调用基准测试按钮。
- **EAC 渠道授权**——一键发起 GitHub 登录（自动打开浏览器，无需复制粘贴）、显示登录名与 star 校验状态、重新检查、退出登录；未授权时模型卡带锁标记。免费车道的模型不受影响。
- **公告中心**——仓库维护者推送的公告流：未读计数、紧急徽章、单条/全部标记已读、检查新公告按钮、系统通知开关。公告正文按白名单渲染 HTML。
- **用量看板**——总览计数、17 周 Token 热力图、总量曲线（Token / 请求数切换，总计与单模型切换）、速度迷你图、按模型汇总表。
- **本地转发**——开关、监听地址与端口、复制 base URL、显示 / 复制 / 轮换 API Key，并提供可直接执行的 curl 示例。
- **插件设置**——总开关、是否展示地区受限模型、探测间隔、默认输出上限，以及当前探测到的出口 IP 与国家。
- **插件升级**——当前/最新版本、检查更新、一键升级（含进度与失败原因）、最近一次升级历史、热重载按钮与文件监视开关。
- **首次启动公告**——分 5 页（前言 / 模型清单 / 使用步骤 / 功能介绍 / 公告与升级），确认一次后不再弹出，除非文案版本号被提升。

## 独立本地服务（开发中）

仓库现在提供两个入口：下文安装的是 **DSH 插件**；`packages/standalone` 是
**无需安装 DSH 的独立本地服务**。从完整源码仓库运行：

```powershell
npm run start:standalone
```

独立服务默认使用 `~/.our-free-model` 和端口 `18900`，拥有自己的 API Key，
不读取插件数据。支持匿名/Kilo、EAC 和原有十三个账号渠道，提供
Chat Completions、Responses API，以及独立网页管理（模型、统计、渠道、EAC、设置、API Key）。
启动后打开终端打印的一次性管理链接即可使用；账号在独立页面登录，也可手动导入插件账号备份。
启动、参数与验证见 [独立服务说明](packages/standalone/README.md)。
独立服务的安装制品与 Release 尚未发布。

## 安装

> **⚠️ 不要通过 npm 安装本插件。**
>
> npm 上的 `dsh-our-free-model` 包**不是本仓库发布的**。它由第三方打包，内容与本仓库
> 不一致：`index.js`、`client.js` 被改动，并额外包含本仓库从未有过的
> `src/channel-visibility.js`。装到它得不到本项目审核过的构建，也拿不到本仓库的签名
> 清单校验与应用内升级。
>
> 请只按本文档下方的方式安装：使用本仓库的 Release 发布包，或本地源码目录。
> 其它渠道出现的同名包一律以本仓库为准。

**命令行（纯 dsh web）**

```
dsh plugin --profile web add /绝对路径/dsh-our-free-model
```

安装完成后重启应用一次。`--profile` 填写实际使用的 profile 名称。

**DSHEAC AIO / 桌面端：请先阅读本节**

部分 DSHEAC AIO / 旧版桌面整合包在启动 web 服务之前会执行 profile 闸门，
限制 profile 中的符号链接或目录 junction。若当前宿主包含该检查，可能报错：

```
PROFILE_UPGRADE_REQUIRED: offline dependency migration is not yet available
```

遇到该闸门时，不要使用 `link:` 依赖或 junction；使用应用内插件管理器，
或下方的本地 tarball 安装。不同宿主的限制以自身日志和安装机制为准。

以真实目录手工安装时，使用可信源码打出的本地 tarball：

1. 创建 `<DSH_HOME>/profiles/<profile>/vendor/`，在审核过的本仓库目录运行 `npm pack --ignore-scripts --pack-destination "<DSH_HOME>/profiles/<profile>/vendor"`，或将本仓库正式发布的同版本 tarball 放入该目录。本地打包不执行 npm 发布。
2. 在 profile 的 `package.json` 的 dependencies 中加入 `"dsh-our-free-model": "file:./vendor/dsh-our-free-model-2.5.2.tgz"`。文件名版本跟随仓库 `package.json`，不要改成同名 npm 注册表版本；再通过宿主的安装流程解析依赖。
3. 在 dsh.profile.bundles 末尾追加 `"dsh-our-free-model"`。

包管理器拥有这份安装的字节时，同时将 bundle config 或插件 `settings.json` 的 `distribution` 设为 `managed`，由包管理器统一更新；应用内升级、公告 feed 与热重载会停用，模型功能保留。以后更新时替换可信 tarball 并同步依赖路径，避免包管理器按旧锁文件恢复旧版本。

若手工复制发布文件，必须复制完整包，包括 `adapter/`、`src/`、`locale/` 和 `vendor/channel-pack/` 下的 `pack.js`、WASM、LICENSE、NOTICE；只复制入口脚本会导致渠道加载失败。

不要再向 cordis.patch.yml 添加条目。被 dsh.profile.bundles 引用的包，其自带的
patch 层会自动生效；两处同时注册将报错 duplicate loader entry id: our-free-model。

**整合包（托管安装）**

插件由整合包（EAC 整合包、Mojobox 等）安装时，更新时机与文件字节由安装方控制：
安装时将 bundle config 设为 distribution: 'managed'（或向 settings.json 写入
同一字段），插件的应用内升级、公告 feed 与热重载即全部停用——两个写入方同时操作
同一安装目录只会导致目录损坏；模型 lane 不受影响。相关验收见
scripts/offline-test.mjs；目录就绪记录（manifest 0.15 / 出处 / 许可 / 完整性）
位于 catalog/ 下。

**启动桌面端前的自检**

可直接调用桌面端自身的闸门代码进行自检：

```
node -e "
const g = require('/sidecar/dist/lib/profile-upgrade.js');
const app = '', profile = '/profiles/';
console.log(g.planProfileUpgrade(app, profile));
g.assertProfileStartup(app, profile);
console.log('startup gate: PASS');
"
```

预期输出为 status: 'compatible'、mismatches 为空数组，随后输出 PASS。
若仅需确认 bundle 组合是否正确而不启动界面：

```
DSH_HOME= dsh --profile  --dump-config | grep our-free-model
```

应当只出现一个 id: our-free-model。

**安装失败：ERR_PNPM_VIRTUAL_STORE_DIR_MAX_LENGTH_DIFF**

该问题源于目标 profile 的 pnpm 状态，与插件仓库无关（报错发生在下载插件之前）：profile 中已有的
node_modules 由旧版 pnpm 生成，dsh 更新后内置的 pnpm 版本发生变化，pnpm 拒绝在旧参数上继续安装。
关闭 dsh，删除该 profile 的 node_modules 与 pnpm-lock.yaml 使其重建，然后重新安装：

```
rd /s /q "%DSH_HOME%\profiles\web\node_modules"
del "%DSH_HOME%\profiles\web\pnpm-lock.yaml"
```

同时出现的 Ignoring broken lockfile 警告会随重建一同消失。

**安装失败：`git ls-remote "git+ssh://git@github.com/..."`（插件市场自动安装）**

插件市场（dsh-plugin-hub）对 git 源的自动安装会把 GitHub 地址交给 pnpm 解析，pnpm 再调用本机
git 执行 `git ls-remote`。若本机 git 配置了 `insteadOf` 重写（常见于把 https 改写为 ssh 的
`url."git+ssh://git@github.com/".insteadOf` 规则），或 SSH 密钥未配置，这一步会在下载任何插件
文件之前失败。处理方式二选一：

- 修正本机 git 配置（`git config --global --get-regexp insteadof` 查看重写规则），保证终端里
  `git ls-remote https://github.com/Ebony-Vinyl/dsh-our-free-model.git` 能成功；
- 改用本地安装：从 Releases 下载发布包解压后 `dsh plugin add <解压目录>`，绕开 git 解析。

**安装失败：`profile "desktop" is managed exclusively by the Electron application`**

这是宿主自身的保护，不是插件问题：桌面端（Electron）的 profile 只允许桌面应用自己管理，
命令行 `dsh plugin add` 无法写入。请在桌面端的插件管理器（设置 → 插件）里完成安装或升级；
命令行安装仅适用于纯 web profile（`dsh web`）。

## 使用说明

**选择模型**：打开输入框的模型选择器，选择 Our Free Model 分组下的任意模型。选择结果按会话持久化。

**调整思考强度**：同一菜单中的 Effort。声明了思考档位的模型给出它自己的档位（如 Off / Low /
High / Max），选中值按原值下发；其余模型给 Light / Balanced / Deep 三档，档位越高思考占用的
输出预算越多，上限为强制下发，因此档位之间存在可测量的差异。思考与可见回答共享同一输出额度，
因此思考不可关闭的模型会将三档整体上移（设置 → Our Free Model 的模型卡上标注了每档的
实际数值，声明档位的模型则标注档位名）。若回答被截断，可切换至更高档，或调高设置中的
单次输出上限。

**供本机其它工具调用**：设置 → Our Free Model → 本地转发，启用后复制 base URL 并生成 Key。支持：

- GET /v1/models
- POST /v1/chat/completions（流式与非流式）
- POST /v1/responses
- POST /v1/messages（流式与非流式，Anthropic Messages）
- POST /v1/messages/count_tokens（本地估算，插件不含 tokenizer）

端口被占用时插件不会静默失效：先在同一端口重试数轮（刚关闭的监听、刚删除的
portproxy 规则通常在数百毫秒内释放），仍被占用则顺延至下一个可用端口，并在设置页标注
"请求的 18899 不可用，实际监听 18900"，落盘的也是该实际端口。Windows 上最常见的占用
来源是一条 netsh interface portproxy 规则（由 IP Helper 服务承载）：其对 0.0.0.0 的
监听会导致回环绑定直接返回 EACCES（区别于 EADDRINUSE）。netsh interface portproxy show all 可列出规则，netsh interface portproxy reset 可清除规则。

转发端点为全流式：除 `data:` 帧外，思考期间的静默由周期性写出的 SSE 注释帧
（以 `:` 开头）填充，客户端的 idle 超时因此不会将"上游仍在推理"误判为"连接已断开"。思考内容按
reasoning、reasoning_content、reasoning_text 三个字段识别——同一段思考若被上游同时
写入两个字段只计一次——reasoning_details 数组同样识别。上游本身不流式输出思考的模型，此处
也不会产生思考帧，详见「已知边界」。

**供同一网络中的其它设备使用**：同一面板下方还提供"局域网访问"。该功能默认关闭；启用后中继绑定一个可路由地址（默认 0.0.0.0），并要求使用独立的局域网 Key——与上述本机 Key 互不通用，因此任一泄露只需轮换对应一侧，本机已配置的工具不受影响。中继将请求原样转发至本机监听，模型清单、流式行为与错误语义与本机完全一致。端口填 0 表示自动分配（本机 18899 常已被占用或被端口代理占用），启用后面板会显示实际端口与局域网地址。**局域网地址按本机网卡实时读取**：面板在开启期间每 15 秒重读一次，切换到别的网络后不必重开面板。同一台机器常同时持有多张网卡上的私网地址——路由器分配的 `192.168.x.y`，以及虚拟交换机（WSL/Hyper-V/Docker）、VPN 或隧道适配器上的地址——面板把物理网卡的地址排在前面并作为可直接复制的那一条，其余地址列在其下；中继绑定的是所有接口，但某个地址能否被同网段的另一台机器拨通，取决于该地址所属的那张网卡。启用期间，任何能够访问该主机的用户均可使用此 Key 消耗本机的免费额度，因此请仅在可信网络中启用，必要时通过防火墙限制来源网段。

**重新核对地区**：点击"重新探测可用性"，将按当前出口重新执行探测。切换 VPN 状态后再执行一次，
地区受限模型会在两个分组之间自动迁移。

**接收公告**：全自动。仓库维护者推送新公告后，运行中的插件在一个轮询周期内（默认
30 分钟，也可在公告中心点击"检查新公告"立即拉取）收到通知：普通公告弹出 toast，
`urgent` 级别直接触发全屏弹窗，两者均会进入公告中心并保留未读标记。如需同时接收
系统级通知，在公告中心点击"开启系统通知"。

**升级插件**：设置 → Our Free Model → 插件升级 → 检查更新 → 立即升级。全流程
在应用内完成（下载 → 校验 → 备份 → 替换 → 热重载），无需重新安装，也无需
重启应用。升级失败会自动回滚至上一版本并给出失败原因。


### Gemini 与 Cline 的代理连接

Gemini 登录需要访问 `accounts.google.com`、`oauth2.googleapis.com`、`www.googleapis.com`，模型请求还需访问 Google Code Assist 服务。浏览器能打开授权页，只说明浏览器的网络可用，插件仍需能访问这些端点。

Gemini 的登录、续期、项目探测和推理，以及 Cline 的登录、续期和推理，共用逐请求代理：优先使用已运行的插件出口代理，其次读取 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY`，最后在 Windows 读取当前用户的手动系统代理；没有代理时直连。环境代理遵守 `NO_PROXY`，系统代理遵守 `ProxyOverride`；回环请求不自动使用代理。无需为这两条渠道设置 `NODE_USE_ENV_PROXY`，也不会改动宿主的全局代理。

Windows 自动检测只支持手动代理，不执行 PAC 自动配置脚本；系统设置最多缓存 30 秒。仅配置 PAC 时，请改用插件出口或环境代理。网络失败会显示所选路径及 `UND_ERR_CONNECT_TIMEOUT`、`ENOTFOUND` 等底层错误码；代理连接失败不会自动重试直连。浏览器回调未到达的授权超时仍需检查本机回调地址和端口是否可达。

## 聚合渠道、省 Token、路由与本地网关

### 聚合渠道：自带 Key 的 75 家提供商

设置页的**聚合渠道**一页把第三方端点接进同一条模型清单。提供商注册表内置 75 家（`src/providers/registry.json`，分类为 `free | free-tier | apikey | oauth | local`），包括 NVIDIA NIM、OpenRouter、Groq、Cerebras、SambaNova、Gemini、DeepSeek、Mistral、Together、Fireworks、SiliconFlow、Nebius、Chutes、Hugging Face、Cloudflare、Z.ai、Kimi、MiniMax、QwenCloud/Alibaba、Bedrock、Vertex、Vercel AI Gateway、Azure OpenAI，以及本机、无需账号的 Ollama、LM Studio、llama.cpp。注册表数据来自 free-claude-code 的提供商目录与 9router 的提供商注册表。

写入 Key（本机免账号的提供商不需要）后，该提供商的每个模型以 `provider/model` 成为清单行：在选择器里可选，也可经本地网关调用。三种线协议按提供商各自声明：OpenAI Chat Completions、OpenAI Responses 与 Anthropic Messages（后两者用于只提供这两种协议的上游）。

Key 只写入插件自己的 0600 `settings.json`，接口永不回显——页面只显示 `hasKey` 与 `…abcd` 指纹；字段缺省表示保留已存 Key，空字符串表示清除。每家提供商提供：启用/停用、测试、发现模型、Base URL 覆盖（Azure / Cloudflare / Vertex 没有可用默认值，必须覆盖）、模型清单覆盖与移除。测试按钮是**列表探测**：它用提供商的模型列表验证 Key，不花一次生成；提供商声明没有列表接口时，按钮如实说明。OAuth 与 ADC（Google ADC）认证的提供商照常列出并标注「不可驱动」——本车道无法替它们完成交互式登录或云侧凭据流程。OpenCode 的免密免费池**不在此注册表内**：它要求每请求一枚铸造形状的会话 id、v2 客户端 User-Agent 与一组官方工具声明，本车道的通用传输没有地方承载这些，硬列进来只会是一个点不通的选择器行——这 10 个模型本来就由本插件自己的免费车道原生提供（见「免费车道」）。

### 省 Token：工具输出压缩、提示词瘦身与本地应答

**工具输出压缩（RTK）** 在请求发出之前就地重写 `tool_result` / `role:"tool"` 内容：git diff、git status、git log、grep、find、ls、tree、构建与包管理器日志、带行号的文件转储、Cursor 搜索清单，以及成串重复的日志行。实测：40 KB 的 `git diff` 移除 90% 的字节，模型仍就这份 diff 作出了回答。安全规则：报错的工具结果永不触碰，小于尺寸下限的内容不碰，替换结果永不大于原文，过滤器抛错时原样放行，且整条管线幂等。该压缩对全部车道生效（含本地网关），默认开启。

**提示词瘦身** 有两族可选项与档位：`caveman`（电报体回复：`off/lite/full/ultra/wenyan-lite/wenyan/wenyan-ultra`）与 `ponytail`（YAGNI 最小实现：`off/lite/full/ultra`）。它们改变助手的说话方式，因此所有档位默认 `off`。注入是幂等的、按线协议进行的（chat 的 system 消息、Anthropic 的 `system`（含块数组形式，且插在最后一个 `cache_control` 之前）、Responses 的 `instructions`/input 项），并且可以撤销。

**节省统计** 显示压缩前字节 → 压缩后字节、节省字节、节省比例、压缩块数与统计调用数——数据取自用量图表所用的同一批统计行。

**五个本地应答**（自 free-claude-code 移植，各自独立开关，默认全开）不调用任何提供商：额度探测（`max_tokens:1` + "quota" → `Quota check passed.`）、shell 命令前缀识别（`<policy_spec>` + `Command:` → 前缀，检测到命令注入时拒绝）、会话标题生成（→ `Conversation`）、建议模式（→ 空字符串）与文件路径提取（→ `<filepaths>` 块）。它们由本地网关在进程内直接应答。

### 路由：命名降级链（combo）

一条命名、有序的模型 id 列表，跨全部车道，以 `combo:<name>` 出现在选择器与网关上，如同一个虚拟模型。两种策略：`fallback`（固定从链首开始）与 `round-robin`（轮换起点，连续 N 轮粘滞）。链会逐个链接尝试直到有一个产出输出；在**任何正文增量之前**失败的链接被整段丢弃，因此切换对调用方不可见。思考增量刻意不算正文——「想了一分钟，然后撞上配额墙」正是最值得降级的场景。一旦已有正文增量交付，之后的失败按正常方式结束该回合（单模型检查点恢复仍先获得它的续写尝试）。链路容量取交集（只有每个链接都支持视觉，链才声明视觉；上下文窗口取最小值），全部链接当前不可用的链会被原样保存并标注为不可用，而不是被静默丢弃。

### 本地网关：原生 Anthropic 接口与接入配方

新增端点 `POST /v1/messages`（流式与非流式，`message_start` / `content_block_*` / `message_delta` / `message_stop` 正确成帧，含 `thinking` 块、`tool_use` 块、真实 `stop_reason`，以及响应头发出之后才失败时的流内 `error` 事件）与 `POST /v1/messages/count_tokens`（本地估算——插件不含 tokenizer）。Claude Code 与 Anthropic 各 SDK 因此可以直接指向本插件。原有的 `/v1/chat/completions` 与 `/v1/responses` 不变，`/v1/models` 现在广播全部车道，含聚合行与链路。网关页新增「接入客户端」分区，按实际绑定的端口与真实要求的密钥生成可复制的配方：Claude Code 环境变量、Codex `config.toml`、OpenAI SDK、Anthropic SDK、curl，以及中继开启时的局域网版本。

顺带修掉一个假成功：一轮只产出了一个调用方从未声明的工具调用时，过去会以干净的空成功收尾；现在会如实报告发生了什么——压缩器自己追加的 `[full diff: rtk git diff --no-compact]` 提示就可能让模型去调一个调用方没有的工具。


## 实现结构

```
index.js Host 半身：适配器注册、清单与可用性探测、设置/用量存储、
 webServer 路由、转发端口生命周期、公告/升级/热重载接线
adapter/ 内核接缝：全包唯一允许 import @deepseek-ai/* 的位置
 （kernel.js：attribution User-Agent，失败降级为字面量）
src/adapter.js 结构性 LlmAdapter：providerInfo、listModels、resolveModel、
 prepareCall、stream、providerRetryPolicy
src/upstream.js 网关身份：凭据、session/request id 铸造、工具指纹、按线协议选端点
src/stream.js 三种线协议解码（chat / messages / responses）归一为 harness StreamChunk，
 并做不相交的 token 计数
src/messages.js harness 消息 -> 各线协议形态，外加工具调用配对修复
src/effort.js 思考档位 -> 输出预算
src/forward.js 独立的 OpenAI 兼容监听器（另含 Anthropic Messages 端点）
src/providers/registry.json 聚合车道注册表：75 家提供商的分类、认证、线协议与端点
src/providers/index.js 注册表读取与 provider/model 复合 id 解析
src/aggregate.js 聚合车道：清单行、凭据解析、Key 脱敏、列表探测、按线协议发送
src/anthropic.js /v1/messages 的 Anthropic Messages 编解码与本地 token 估算
src/token-saver/index.js 压缩管线：提示词注入 -> 工具输出压缩，按字节留痕、失败开放
src/token-saver/inject.js chat / messages / responses 三线的幂等注入与撤销
src/token-saver/prompts.js caveman / ponytail 两族提示词与档位
src/token-saver/rtk/ 工具输出过滤器：git diff/status/log、grep、find、ls、tree、
 构建日志、编号转储、搜索清单、重复日志行
src/local-optimize.js 五个本地应答：额度探测、命令前缀、会话标题、建议模式、文件路径
src/combos.js 降级链：虚拟清单行、两种策略、容量取交集
src/route/classify.js 全车道统一的失败词汇与冷却策略
src/trust.js 插件路由的请求信任围栏（connection 服务桥 + 结构化围栏）
src/push.js SSE 推送枢纽：公告到达、更新可用、升级完成
src/feed.js 远程公告 feed：多源拉取、校验、缓存、到达检测
src/updater.js 应用内升级：清单校验、SHA-256 分级校验、备份、原子替换、回滚
src/reload.js 自热重载：镜像内核 HMR 的缓存清除 + 重导入 + 重注册 + 回滚序列
client.js 浏览器半身：手写 ModuleLoader bundle，无构建步骤
```

几个值得了解的架构决定：

**一个适配器，两条 provider 路由。** harness 的模型选择器严格按 provider 路由分组，
而清单的线格式中并不存在 group / tag / badge 字段。因此要呈现独立的 region-limited
标题，唯一方式是再注册一条路由；又由于客户端会丢弃空分组，一旦地区限制解除，
两个分组会自动合并为一个。

**以结构化方式实现适配器，不 import @deepseek-ai/dsh-llm。** 内核从不执行 instanceof
检查，因此鸭子类型即可满足。这使插件不必将依赖固定在特定内核版本上，也是同一份代码能同时
运行于 0.1.5 与 0.1.7 的原因。

**使用自有 JSON 存储，不接入 settings seam。** settings 注册 API 在两版内核间不一致；
私有 JSON 存储行为一致，且转发 Key 存放于 0600 权限文件中，不进入任何共享设置文档。

**Token 压缩跑在唯一收口上，且失败开放。** 提示词注入与工具输出压缩在 payload 完成全部
改写之后执行——指纹改名、档位补丁、密封车道的节奏提示都已落定——收口在 `payloadFor()`：
适配器自己的派发与本地网关（它同样经适配器发起）都从这唯一一处经过，因此每条车道、每一段
恢复请求都同样压缩。每一步都失败开放：压缩器抛错就跳过，过滤器抛错就原样放行，形态不认识
就不动——一个请求绝不能因为一个「本来是为了让它更便宜」的环节而失败。

**combo 是一条虚拟清单行，降级在适配器里解析。** 链路以 `channel:'combo'` 加一串真实模型
id 并入合并后的清单，因此选择器照常广播它、本地网关照常按名调用它；链的展开与推进判定发生
在适配器的 `runStream()` 内，于是两个调用方都不必知道降级这件事。

## 思考强度：档位菜单与预算阶梯

**两类模型，两种控制。**

声明了思考档位的模型（清单里的 `reasoning_options` 给出 `effort.values`）走**档位菜单**：
选中的档位按原值下发到上游的 `reasoning_effort` 字段，与 EAC / Kilo 渠道同款。这是 2026-10-17
的复测结论——早期（2026-09-24）该车道确实忽略这个字段，但现在它**会校验**：发一个集合外的
取值直接回 `400 invalid_value` 并列出可接受集合（`none|minimal|low|medium|high|xhigh|max`），
而思考量随档位真实变化（`deepseek-v4.1-flash-free` 三次采样中位数：none 0 / low 793 /
high 700 / xhigh 1405 / max 1906）。因此菜单只列出该模型自己声明过的档位；模型没声明
「关闭」档（如 GLM 5.3 Flash，其 `none` 实测关不掉思考）就不提供 Off 档。

没有档位菜单的模型（清单只给 `toggle` 或 `budget_tokens`，或压根没有 `reasoning_options`）
保留**预算阶梯**：思考强度实现为硬性输出 token 上限，该上限确实产生约束——留痕的思考 token
随档位单调上升。对一个上游表达不了档位的模型，编一档等于谎报能力，所以这里不编。

模型的窗口与输出上限按 9router / models.dev 的口径取（`limit.context` / `limit.output`、
`modalities.input`）；上游清单本身只公布 id，不含任何能力字段。

## 三个实际消耗过调试时间的内核行为

此处列出是因为编写 provider 插件时通常会遇到：

**providerRetryPolicy() 会被原样保存并使用。** 两版内核均不解析其返回值，而退避调度器读取的是
顶层的 initialDelayMs / maxDelayMs / jitterRatio。将这三项嵌套在 backoff:{} 中，
调度器读到 undefined，于是 undefined \* 2ⁿ = NaN，而持久会话日志会直接拒绝非有限数值——
一个本可恢复的瞬时故障因此导致整轮对话报废。应返回已解析完毕的扁平策略。

**一次被中断的工具调用会永久污染该会话。** 缺少对应结果的工具调用在重放时，上游返回
400 invalid_request_error，此后该会话中的每一次请求都会失败。本插件在发送前修复配对，
三种线协议共用同一处修复逻辑。

**未在 inject 中声明的服务，属性直读会抛错（与返回 undefined 不同）；而 ctx.get() 在服务
"尚未被 provide 出来"时返回 undefined。** 这两条本轮各自触发过一次问题：将 inject 缩减为仅剩
llm 之后，typeof ctx.interval === 'function' 直接抛出 cannot get property "timer" without inject（ctx.interval 是 timer 服务上的 mixin），插件在所有 composition 中
均不再激活；改用 ctx.get('webServer') 后返回 undefined——原因不在于缺少 web
server，而在于插件先于 web 半身加载——导致设置页路由全部未注册。正确做法是
ctx.inject(deps, callback)：为所需服务开启一条独立的 fiber 使其待命，
避免在加载瞬间做一次性判断。

## 为什么按 body 的形状而不是 Content-Type 读响应

该车道会在高负载下以 200 + application/json 返回完整的 SSE 帧序列。旧实现依赖 header，
于是 await response.text() 将整条流读成字符串、JSON.parse 失败、整轮报废——而该
错误对象携带 status: 200，还会使可用性探测将完全可用的模型判为"不可路由"，
使其在下拉框中消失一轮。当前实现先嗅探首块（≤4 KB）按形状分流，再将已读取的字节
重新注入流中，实时性不受影响；src/http.js 的 sniffBody 为唯一判据。

## 为什么速度那一栏会显示 —

早期版本曾为一条实际仅 ~40 tok/s 的车道报告出 2 941 tok/s。问题不在网关——直连
读包的探针显示 64 个帧跨越 5.6 秒，确为增量投递——而在于分子与分母度量的不是同一段
时间：一次调用计费 422 个输出 token，其中 291 个是未流出任何帧的 reasoning token，
它们在第一个可见 token 之前即已生成完毕，而窗口起点正是该 token。以整段
以整段 completion 耗时除以答案文本落地所用秒数，无法反映解码速度。

因此当前实现仅在"能够容纳分子的那段时间"内输出速率：windowTokens() 将未流出的
reasoning token 从分子中剔除，decodeWindow() 拒绝过短以至于无法计时的窗口以及不真实的
高速率，看板与模型表均改为 Σtoken / Σ秒，不再对各次速率取平均——曾有一个 1 ms
的窗口将 26 次调用的均值抬高了三个数量级。因此答案集中在一两个大帧中落地的模型，
不具备可测量的输出速度，该栏显示 —。

## 长思考截断后的自动恢复（issue #12）

所有模型默认启用一次有界恢复，Chat Completions、Messages、Responses 三种上游协议
共用该行为。触发条件为：首段仅有非空思考、无正文且无工具调用，且上游在未发送正常
结束帧的情况下直接关闭流；或上游发送了正常 stop 收尾、但同样只有思考而无正文——宿主会将
此类「空停」回合判定为空响应，恢复流程会继续请求一次正文。以下情况不触发恢复：用户取消、
已输出正文或工具调用的正常结束、达到输出上限、明确的上游错误。

插件将已收到的思考作为检查点文本，与原始输入一起发起新请求，要求直接输出整理后的回答。
该机制基于检查点重新发起请求，与上游原生 resume 无关，也不会重放已显示的思考内容。恢复段禁用工具调用；已输出
正文或已开始调用工具的截断回合不执行恢复，以避免内容重复或工具重复执行。

为避免重复长思考，恢复提示要求结论优先、最多 800 词；此为提示层面的约束（非硬性 token
限制），模型可能不遵守。恢复属于降级回答，原始请求中的长篇或逐步分析可能被简化。

每个逻辑回合最多两次物理请求：原始请求加一次恢复。默认总时限 900 秒（15 分钟），恢复段最多
300 秒，且受剩余总时长约束；恢复输出上限 8192 tokens，并继续受用户与模型的上限
约束。首段已知的输出 tokens 会从原始预算中扣除，恢复预算不足 512 tokens 时不发起恢复。
检查点最多 131072 字符，且必须通过基于文本字节的保守上下文余量估算；该估算不计算图片
token，不等同于精确的 tokenizer 校验。超出限制即停止恢复，不会无限续接。恢复必须正常结束且
产生非空白正文方为成功；失败返回 STREAM_CUT，宿主不会将该回合整轮重发，用户取消
则保持 aborted / ABORTED。

可通过本机 settings.json 的 streamRecovery: false 关闭恢复；也可通过对象的 enabled
开关及数值限制收窄边界，数值只能低于或等于默认上限。默认不限制模型名单。

用量看板将物理请求与逻辑回合分开统计。上游请求数与请求失败数按实际发出的请求次数计数；
对话回合数、回合失败数与已恢复数按一次适配器调用的最终结果计数。例如首段中断、
续写成功会记为 2 次上游请求、1 次请求失败，同时记为 1 个对话回合、0 次回合失败、
1 次已恢复。每段样本仍包含恢复关联、段序号与 noUsage 等标记；通过 recoveryId
关联各段的 noUsage 以判断缺失情况。最终上报宿主的 usage 仅汇总上游实际报告的已知值；
缺少某段 usage 时，该值不等于整轮完整 token 总量。思考检查点不写入统计文件。

升级前的旧统计仅包含物理请求记录，迁移后展示的回合数与失败数为基于这些记录的推算值，
看板会明确标注；升级后的回合按最终结果精确记录。
请求数、回合数与 Token 总量为累计值；速度、首帧延迟与热力图使用本机保留的历史窗口。

已在一次真实 MiMo V2.6 Flash · Deep 请求中恢复成功；此前一次恢复曾在 480 秒
截止时失败。这不代表全部模型均已实测，也不保证每个长思考回合都能生成答案。
下一节列出的 v1.3.1 记录描述的是恢复功能引入前的行为。

## 验收情况

在 Windows 环境下针对真实上游实测。本节按轮次记录，并注明每项的验证方式——仅标注
「真实上游」与「实机点击」的条目才对应用户在界面上可见的行为。

### Issue #12：验收状态

恢复实现、离线回归与真实上游结果单独记录在
docs/issue-12-recovery.md。合并前 review 修复了一处告警
重复累积的缺陷并补充回归用例，recovery 99/99、truncation
35/35、fingerprint 新增 11 项与 typecheck 均已通过；其中 12 项使用真实插件与本地 HTTP
验证转发成功、失败、客户端断开与统计落盘。最终全量结果以技术文档为准。
真实 MiMo Deep 首段在 304.161 秒自然 EOF，
恢复段 32.777 秒生成 4264 字符正文，以 stop / usage / [DONE] 正常结束；共两次
请求、336.942 秒。首段无 usage，汇总值仅为已知用量。首次 480 秒恢复失败记录
保留在技术文档中；真实 dsh UI 与其它模型尚未逐一验收。

### 历史：v1.3.2（对应 issue #11、#13、#19、#20、#21）

| 项目 | 修复 | 验证 |
| --- | --- | --- |
| #19 自更新信任链 | 清单 Ed25519 签名（公钥 pin 在插件内，私钥不入仓）、feedUrl 与更新源彻底解耦、清单 base 只允许相对路径 | updater-test 新增签名/篡改/异钥/feedUrl 不跟随 4 组用例；release-e2e 负控改为在签名处拒绝 |
| #19 转发口面 | localhost 绑定先执行 DNS 解析且要求结果全为回环；插件 API 请求体 1MB 上限（413）；转发非 JSON body 返回 400、未知模型返回 404 | forward-test resolveLoopbackBind 三态用例；offline-test 404 用例 |
| #20/#21 转发下工具不可调用（#21 报告的 Unknown tool 'bash'/'read'/'grep' 正是指纹诱饵四件套：车道强制声明这些名称，模型发起调用而转发客户端未注册） | 流式 tool_calls[].index 按调用重新编号，从 0 起（不再与 reasoning 共用块索引）；指纹诱饵工具调用在转发口按块抑制（未命名块先扣留参数）；参数被截断的回合流式同样返回 length | forward-test 4 组流式/非流式用例（本地服务器 + 脚本化 lane） |
| #20 dsh 内诱饵隐患 | stream.js 中无 index 的并行工具调用按 id 分块，裸参数续写归入前一块 | 现有 truncation/fingerprint 套件全绿 |
| #13 达额体验 | 429 移出可重试状态码（同一回合不再自动重试三次）；探测整轮全为 429 后按 30→120 分钟指数退避（手动 reprobe/出口变化/启动轮不受限）；探测可识别 200 流内 error 帧；测速按钮调整默认档并放宽前端超时 | retry-safety-test 断言更新；probe 逻辑随 offline 套件全绿 |
| #13 转发配额集中 | 429 不再自动重试（同上）；转发会话键维持按 user/conversation 派生（上游按会话计额，为刻意设计） | 行为不变，无新增消耗面 |
| #11 热力图 | 格子 gap 归零、圆角收小，呈现 GitHub contribution graph 式连贯观感；布局本身已为列优先周对齐，无需改动 | client-lint 全绿 |
| 其它 | 前端按路由放宽超时（bench 240s/升级 600s，8s 兜底仅作用于快速路由）；EventSource 断连改为退避重连（30s→5min），不再永久失效；升级完成推送会清除旧错误横幅；看板"速度"文案与最近 40 次的实现一致；store 落盘失败会在日志中记录一次 | client-lint；speed-stat 全绿 |

全部 20 个离线套件（含新增 forward-test）与 tsc --noEmit 通过；host-selftest 需真实出网并消耗免费额度，未随本轮运行。

### 历史：v1.3.1（对应 issue #8、#9、#10）

| 项目 | 方式 | 结果 |
| --- | --- | --- |
| 两种工具结果形状均实际送达模型 | 真实上游 host-selftest.mjs 第 2 步 | 同一模型、同一 get_weather 结果，分别按 pre-V4 的 user+tool-result 与 V4 的 role:'tool' 各发一轮：两条均 finish=stop，且模型均复述出结果中的 22°C / sunny。修改前插件对第一种形状完全无感知（src/messages.js 中从未出现 tool-result），该轮发出的请求既无工具调用也无结果 |
| 消息形状取自实际记录（不依赖推测） | 本机全部 4 处 session 根、共 40 个 session\*.jsonl.zstd（zstd 需按帧切分后逐段解压） | tool/result 事件共出现两种形状：role:'user' 携带 tool-result 块 362 条（V1/V3 格式——AIO 6.9.3 的 v3 家目录写入 336 条，~/.dsh 的 v1 写入 26 条），V4 的 role:'tool' 27 条（v4 格式的会话副本）。两代格式均在被使用，而插件此前仅识别后者——issue #9 的判断成立，只是其描述的形状比报告者所用内核更新 |
| 投影与配对修复 | 离线 projection-test.mjs（新增，40 条断言） | 三条线 × 两种形状：调用与其结果均落到 wire 上、按 call id 一一对应；三个并行调用各自的结果逐个送达，Messages 线合并进同一 user 轮且 tool_result 置于最前（与内核自身的 Messages 适配器同一规则）；结果中内嵌的图像不再丢失（Chat 走紧随其后的 user 轮，Messages 直接嵌入 tool_result）；同一份结果在任一线上只出现一次（按答案字节出现次数判定，不依据块类型——块类型断言无法发现重复）；无 call id 的工具答案、悬空调用、孤儿结果照旧剔除；已配对历史逐字节不被改写 |
| pwsh 顶替 bash 槽位可被网关接受 | 真实上游 probes/shell-slot-promotion.mjs（新增） | 声明名称为 bash, glob, grep, read，其中 bash 携带 pwsh 的真实 schema、无诱饵：网关未返回 FreeTierError，finish=tool-calls，模型返回的调用被还原为 pwsh（{"command":"Get-Date"}）——即内核确实可执行。离线另有 fingerprint-test.mjs（新增，20 条）固定以下行为：不重复声明、真实 bash 优先、无 donor 时才落诱饵 |
| 半截流不再被判定为正常结束 | 离线 truncation-test.mjs（新增 22 条） | 本地 HTTP 服务真实执行 res.end() 关闭一条无 finish token 的流 → kind=error、统计行 ok=false 且带 truncated 标记；三条线各验证一次；message_stop、response.completed 等真实结束帧不误判；有 finish 但无 usage 的行标记 noUsage，0/0 与"确无产出"自此可区分。重发策略按已流出内容区分：未流出任何 token 的截断仍为 TRANSPORT（可重试），已流出内容的截断为 STREAM_CUT（不在重试名单内，立即失败）——理由见下一行 |
| 一次真实内核会话实测出的重试代价 | 真实内核 dsh web + 浏览器中发起的一轮 MiMo V2.6 Flash · Deep | durable 会话日志逐事件取回：llm/retry retry=1 delay=702ms code=TRANSPORT 落在 304s，retry=2 delay=1124ms 落在 608s，turn/end {kind:"error",code:"TRANSPORT"} 在 912s；stats.json 中三条 ok:false truncated:true 的 0/0 行，间隔 304s；界面呈现为「本轮运行失败」加原始语句加 TRANSPORT。即：该车道的截断由本轮长度决定，可重试代码只会将同一个五分钟重复支付三次，因此内容已流出时不再重发 |
| 复查本轮发布，发现上述两项自身的问题 | 离线 projection-test.mjs 第 7 节、truncation-test.mjs 第 12 节，另加 tui-test.mjs 一次转发端往返 | ① Messages 线在识别 V4 的 role:'tool' 之后，将同一段结果既放入 tool_result、又保留在紧随的普通块中——文本重复两份，图像连同 base64 重复两份；当前实现在发出结果后跳过该消息自身，撤掉修复则此断言立即失败。② response.incomplete / response.failed / response.done 同样属于 Responses 线的正常收尾，此前仅识别 response.completed，导致触及输出上限的一轮被判定为"被截断"、白白消耗两次重试；当前实现仍由 status 决定 finish token，且不带原因的收尾帧不再清除前一帧已给出的 token。③ 转发端的 /v1/responses 此前无用例覆盖工具历史，现通过桩上游逐字节核对发出的 messages：调用与其结果均存在 |
| 该车道的正常收尾形态 | 真实上游 probes/stream-terminal-frames.mjs（新增） | 逐帧抓取原始 SSE：finish_reason:"stop" → 带 usage 的帧 → data: [DONE] → {"choices":[],"cost":"0"}，两个模型一致。因此"始终未出现 finish token"确属异常，不属于该车道的另一种正常写法——这也是 #10 判定条件的依据 |
| 真实车道上无误判 | 真实上游 host-selftest.mjs 全量 | 11 个模型探测 + 普通对话 + 两轮工具 + 三档思考 + 视觉输入，全部落到各自的正常收尾（stop / tool-calls / max-tokens），无一条被判定为截断；被地区门拦截的模型仍返回 REGION_BLOCKED |
| 上游来源成文（#8） | 代码中全部出网目标逐条核对 | 新增「上游是哪些源」一节：opencode.ai/inference/v1/\*（推理与 /models，2026-10-14 起；原为 /zen/v1）、本仓库 feed/\*.json（raw 优先、jsDelivr 兜底）、api.ipify.org / ipinfo.io / ipapi.co（仅读取本机出口 IP 与国家码）。当前无号池、无中转 |
| 离线套件 | npm test（18 个套件） | 全绿；新增 projection、fingerprint 两套，仍不出网、不消耗免费额度 |

### 上一轮：v1.2.2（对应 issue #1–#4、#6）

每项均注明验证方式：离线假内核不出网、真实上游指插件实际请求网关但运行于手工搭建的
cordis context 上、真实内核则指将插件装入 dsh 后启动。三者的差异本轮已由此获得一次
教训——见最后一行。

| 项目 | 方式 | 结果 |
| --- | --- | --- |
| 发布清单与实物一致 | 离线 build-manifest.mjs --check + release-e2e.mjs | 26 个发布文件全部一致。修改前线上 main 的 1.2.1 清单已漂移 6 个文件（index.js、README.md、README_EN.md、src/catalog.js、src/store.js、src/upstream.js），比 issue #1 报告的 2 个更多——即提出 issue 之后再次复发。现已随版本重新生成；--check 与新增的 release-e2e.mjs（使用真实清单与真实文件完整执行一次升级，含"清单虚报 1 个字节必须被拒绝"的反向对照）均已纳入 npm test 与 CI。本轮补充修复两个同源漏洞：清单现按 LF 归一化后的字节计算（.gitattributes 为 * text=auto eol=lf，而 Windows 编辑器可将工作区写为 CRLF 且 git status 不报错——这正是 issue #1 上次的复现路径），目录收集也改为递归（旧的单层扫描会遗漏 src/lib/x.js 这类嵌套文件：npm 会安装它、清单中却没有它，而 installStaged 会将清单未列名的文件从用户机器删除）。两条各有一条常驻断言，后者还将 26 个文件全量转为 CRLF 后再执行 --check |
| 离线套件 | npm test（14 个套件） | 14/14 通过；不出网、不消耗免费额度。套件端口取自临时端口段（固定端口在两个进程同时运行时会冲突：本轮实测——先占用 tui 的固定端口再运行该套件，请求被发送至其它进程的监听，套件一直挂起直至被 runner 超时终止、打印出的"失败详情"为六行 ok），runner 对每个套件设置 60 s 硬超时并输出挂起原因 |
| 新增测试确实能捕获回归 | 逐条还原旧行为后重新运行 | computeMembership 的未判定模型：还原旧写法 → picker 报 Cannot read properties of undefined (reading 'state')（2 条检查失败）；postStreamed 的 Content-Type 判定：还原旧写法 → sniff 7 条检查失败。恢复后各自全绿。本轮新增的断言另执行了一轮变异测试：在临时副本中将 9 处修复逐条还原后运行对应套件，9/9 变红（逐条输出见下方"本轮复审"三行） |
| 探测判定与选择器广播 | 真实上游 host-selftest.mjs | 清单 10 个模型 → 主分组 7 + region-limited 2，转发端口 /v1/models 同步 9 个；deepseek-v4-flash-free（Model is unavailable）移出下拉框并在设置页保留拒因；5xx/429/断网一律保持可达（issue #3 的判定不再误伤网络抖动） |
| 未判定模型不再致命 | 离线假内核 picker-test.mjs | 清单新增一个模型、且其探测被测试挂起时，listModels 与 /summary 均正常返回，该模型 availability=unknown 且照常广播 |
| 思考档位仍然强制生效 | 真实上游，MiMo V2.6 Flash | light 当前下发 4096：同一 prompt 下 2 980 tokens 正常 stop；修改前 light=2048 在同一 prompt 上以 length 收尾 |
| 长回答不再被截断 | 真实上游 probes/long-answer.mjs | balanced 实际下发 max_tokens=16384，单次请求输出 10 164 tokens（19 914 字符、194 秒）后 finish=stop；同一请求在旧的 8192 档上必然以 length 结束——即 issue #2 报告的现象。设置页模型卡标注每档实际数值（默认档上限 16K，已在实际浏览器中确认） |
| SSE 帧不再受 header 误导（issue #6） | 离线假网关 sniff-test.mjs | 200 + application/json + 响应体为 SSE 帧：正常输出 token，不报错；跨 chunk 截断的中文字符、超过 4 K 嗅探窗口的 400 帧长流、单包 JSON、空 body、HTML 等各类内容均按形状分流。同一场景在旧代码下会导致探测将可用模型判为 unavailable |
| 无 web server 的 composition | 离线假内核 scripts/tui-test.mjs | 仅挂载 llm 时 apply() 不抛错、注册两条路由、完成一轮流式对话、转发端口启动并拒绝无 Key 请求；后台循环使用普通 unref 定时器。看板模块保持待命状态，webServer 出现后自动注册两条路由。真实 dsh-tui 尚未实机验证：本机两套内核（dsh 0.1.7 源码构建、AIO 6.9.3）均不含 tui profile |
| 插件在真实内核中确实可安装 | 真实内核 dsh 0.1.7-rc.1 web，端口 3099 | 启动无 did not activate；/api/our-free-model/summary 返回 200（10 个模型：6 available、2 region-blocked、1 unknown、1 unavailable）、/events 启动并推送 hello；在实际浏览器中进入 设置 → Our Free Model 逐项读取到 10 张模型卡、不在选择器中 分组、思考不可关 与 默认档上限 16K 标签，控制台零报错。本轮最初版本在此步骤失败：inject 仅保留 llm 后读取 ctx.interval 抛出 cannot get property "timer" without inject，插件在所有 composition 中均不再激活 |
| 复审发现的两个新问题 | 定向复现 + 常驻断言 | ① head 嗅探阶段被 abort 时抛出的是原生 AbortError（code 为数字 20），toFailure 无法识别从而降级为 TRANSPORT——而 TRANSPORT 位于可重试名单内，用户主动取消的回合存在被内核重试的可能；当前三条读取路径共用 classifyStreamFailure，sniff 中保留两条 abort 断言。② 提交后又修改了 src/http.js，清单再次漂移，被 --check 与新增的 release-e2e.mjs 当场捕获——门禁按设计生效，同时也说明任何改动后都需重新执行 |
| 本轮复审：请求路径上两处"整轮丢弃/重复计费" | 本地假网关定向复现 + 常驻断言 | ① readHead 需填满 4 KB 才判定形状：一条已完成输出的短回答，只要网关未立即关闭连接，就会在嗅探窗口中等待至 deadline，随后连同已读取的帧一起被 cancel 丢弃——整轮以一个可重试的 TIMEOUT 结束，内核再次发送、额度再次消耗（复现输出为 frames delivered: 0）。当前实现在首帧识别为流后立即放行，同时不再阻塞每轮开头那 4 KB 的 token。② 流内错误的分类写入了 llmCode，而 toFailure 仅读取 code——导致每条流内拒绝都降级为可重试的 TRANSPORT（已输出 token 的回合被重发），中途的 RegionError 也永远无法触发切换出口重探。当前流内错误与错误信封统一走 classifyFailure |
| 本轮复审：设置入口缺少类型校验 | 离线 picker-test.mjs + effort-test.mjs | probeIntervalMinutes:'abc' → Math.max(1,'abc') 为 NaN，而 setTimeout(fn, NaN) 在 Node 中等价于 1 ms：每秒执行一次全量探测。defaultMaxTokens:0（清空设置页输入框即会提交 0）→ min(容量, 0)，每轮被裁剪至 512 token，而选择器仍标注 4 K/16 K/32 K 的档位。当前数值项在 POST /settings 入口与使用处各设一道校验，非正值一律按"未设置"回落。同一批断言还固定了转发端口只能绑定回环（0.0.0.0 直接返回 400 并注明原因），以及 connection 的准入判定为逐请求读取（还原为 apply 时的一次性快照 → 该 401 断言立即失败） |
| 本轮复审：三条"看似在测试"的套件 | 变异测试（在临时副本中逐条还原旧行为） | retry-safety-test.mjs 的四个用例全部落在"模型不在清单上"的提前返回分支（传入 model:"our-free-model/test-model-free"，而 baseModelId 仅剥离 label 不剥离路由），未发出任何请求——改为真实调用后 7 个用例逐个固定 code／是否可重试／是否触发区域重探。tui-test.mjs 的 unref 断言比较的是两个不同总体的计数（移除 120 s 循环的 unref() 后仍全绿）→ 改为按周期逐个核对。写死在套件中的端口（tui 的 18931）与另一进程争用同一端口时，表现为 180 s 静默挂起、打印出的"失败详情"为六行 ok → 端口改为取自临时端口段，runner 增加 60 s 硬超时并如实说明"该套件挂起" |
| usage 计数正确 | 离线 retry-safety-test.mjs | 缺少 prompt_tokens_details 的 usage 不再使 inputTokens 变为 NaN；转发端口按 prompt_tokens/completion_tokens 上报，被网关拒绝的转发请求返回错误，不返回空 200。Messages 线上 message_delta 仅携带 output 一侧，旧写法会覆盖整条 usage 记录、使每个 Claude 回合的 prompt tokens 记为 0；当前改为按字段合并 |
| 本轮复审：5xx 的原因短语不再被当作判定（issue #3 的同类回归） | 离线 sniff-test.mjs + 反向验证 | stateOf 的消息兜底匹配不检查状态码，而反向代理返回 503 的标准原因短语正是 Service Unavailable——过载的网关因此被判定为"点名拒绝该模型"，模型逐个从选择器中消失（issue #3 修复的代价从消息兜底路径再度引入）。当前该兜底仅在状态码无法代表网关意图时才生效；响应体中点名模型的（含 5xx 下的 type: ModelError）仍判定为拒绝。新增 4 条断言，还原旧实现后其中 2 条立即失败 |

### 上一轮：v1.1.2（公告、升级、热重载与信任围栏）

全部新能力均经过实际操作验证，包括在浏览器与 DSHEAC AIO 桌面窗口中的逐项点击：

| 项目 | 结果 |
| --- | --- |
| dsh 0.1.7-rc.1（源码构建） | 启动无报错；选择器两个分组正确；多轮工具调用完成 |
| dsh 0.1.5-rc.2（DSHEAC AIO 6.9.3 内核） | 启动无报错；与已安装的其它第三方插件共存 |
| EAC 启动闸门 | 安装时与应用内升级后各执行一次：compatible / PASS |
| 模型可调用性 | 10 个清单模型全部可达（该轮行为：探测失败/暂不可用的模型也保留在选择器中；自 v1.2.2 起不再广播判定为不可用的模型）；real chat、多轮工具、视觉输入在两套内核中通过 |
| 真实 harness 对话 | dsh web 与 AIO 桌面端各完成一轮真实对话并收到回复 |
| 公告 feed | 在本地"仓库服务器"推送新公告 → 运行中的两端在一个轮询周期内收到 |
| 公告中心 UI | 4 条公告渲染（粗体/代码/链接/列表）、紧急红色徽章、未读标记、单条/全部已读 |
| 紧急公告 | urgent 推送触发全屏弹窗，点击"知道了"即写入已确认状态 |
| Toast + 系统通知 | 新公告实时 toast；桌面端 window.Notification 通道存在（WebView2 权限策略拒绝授权时 UI 如实提示） |
| 应用内升级 | dsh web 与 AIO 桌面端各完成一次 1.1.0 → 1.1.2 升级：23 个文件下载、SHA-256 校验、备份、替换、热重载；升级后 /meta 立即上报新版本 |
| 升级安全性 | 哈希不匹配 → staging 丢弃、已安装包不变、历史记录标记失败；升级产物通过 EAC 闸门并完整重启加载 |
| 热重载 | 按钮、API 两种入口；ESM 缓存清除 + 重注册 + 回滚序列；generation 递增、客户端通过 localStorage 提示一次 |
| 客户端 bundle 热更 | 替换 client.js 后浏览器端由内核 client-hmr 自动重载（实测两次） |
| 信任围栏 | 非 loopback Host / 跨站 sec-fetch-site / 异源 Origin 一律 403；无 cookie 的回环请求 401（与内核 /api 一致） |
| SSE 推送 | hello/announcements/update/upgraded 事件实测通过；热重载后自动重连 |
| 思考强度传递 | light/balanced/deep 三档实测：reasoning 2048（被预算截断）/ 3386 / 3522，输出单调上升 |
| 地区门 | 受限模型返回 REGION_BLOCKED 并保留在自身分组 |
| 转发端口 | /v1/models、流式与非流式 /v1/chat/completions；无 Key 请求被拒 401 |
| 界面文案 | 无乱码；上游厂名仅出现在仓库文档与公告正文两处——#8 要求的披露需要一个用户可见的位置，公告即说明位。模型选择器、设置页与报错文案中始终不出现 |
| 未验证部分如实说明 | OS 级通知的最终视觉呈现未逐像素确认——AIO 桌面端的 WebView2 权限策略拒绝了 Notification.requestPermission()（插件的 Tauri 通知通道存在，纯浏览器路径可用，被拒时设置页如实显示"需要在系统/浏览器 设置中手动恢复"）；AIO 对内置插件存在报告式静态启发扫描（TROJAN_EXFIL_ENV 会对 src/upstream.js 的 env+URL 邻近模式记录一条报告日志），仅记录不改动文件 |

## 已知边界

"不限量"指不存在额度体系：无需充值、不按 token 计费、没有套餐与用量面板。但该车道按 session 统计速率，短时间内打满会返回 429。插件将该模型标记为"已达限额"，不做隐藏，下一轮探测自动恢复。

部分模型上游本身延迟较高。nemotron-3.5-lightning-free 曾实测首字延迟超过 30 秒。此为上游延迟，看板会如实显示。

输出速度有时会显示 —。答案集中在一两个大帧中落地、或思考过程根本不流式返回的模型，不存在可用于计算的时间窗。看板宁可留空，也不会将"思考耗时"计入"输出速度"。

思考过程为静默等待，且与正文共享输出预算。实测 mimo-v2.6-flash-free 可在思考阶段静默 60–70 秒，期间上游计费 3024 个 reasoning token 但不发送任何思考帧；此类回合会以 stop 收尾而正文为空，客户端容易报告"空响应"。转发端点与局域网中继通过心跳保持连接，但心跳维持的是连接，不能解决超时问题：注释帧会被 SSE 解析器跳过，pi-ai 的空闲看门狗（streamIdleTimeoutMs，默认 300 秒）仅在读到真实内容帧时重置，链路滞留超过该值仍会以 TIMEOUT 失败（实测时间线见 issue #34）。预算只能由调用方给出：将单次输出上限提升至 16k 以上，或改用模型卡中标注 reasoning: false 的模型。

自动恢复存在次数、时间与上下文边界。仅恢复纯思考 EOF 与纯思考空停（正常 stop 收尾但无正文），最多追加一次请求；已输出正文、工具调用、用户取消与明确错误不触发恢复。该机制基于检查点重新发起请求，无法保留上游未发出的内部状态，且不保证成功。缺失 usage 时的用量仅为已知部分。

能力标注以探测可证明者为限。公开清单与实测均无法取得证据的，不予标注。

源码为明文 JavaScript。作为本地插件必须如此。能够访问该目录的人员即可读懂网关逻辑——请将其视为该分发形态的固有属性，混淆无法解决该问题。

桌面端安装需要真实目录，原因见安装一节。

升级与热重载的信任边界：应用内升级的信任根自 v1.3.2 起为插件内 pin 的 Ed25519 公钥，不再依赖"HTTPS 到仓库"——清单必须携带发布私钥签名方可安装，镜像（含 jsDelivr）被投毒只会导致升级失败，不会执行其中的代码。持有发布私钥者可推送任意代码，这在信任模型上与"可推送仓库者"等同，但将"仓库账号被接管"从直接 RCE 降级为"所有用户升级失败"。文件层面的完整性由签名与 SHA-256 清单双重保障，代码层面的安全由客户端白名单 HTML 渲染器与宿主的插件隔离承担。

DSHEAC AIO 的 WebView2 权限策略可能拒绝通知授权（本机实测 denied）。被拒时公告中心的开关会如实提示；通过纯浏览器访问 dsh web 不受影响。

转发端口不要求固定占用 18899。端口被占用时监听顺延至下一个可用端口，并将实际端口写回设置（设置页给出提示）。此为有意设计：宁可更换端口，也不让本地转发静默停摆；占用方由操作系统错误码决定，插件仅如实转述。

插件接口的鉴权级别取决于 composition：挂载了 connection 服务的 composition（dsh web、AIO 桌面端）下与内核 /api 同级（需要应用自身的 cookie/token）；不含 connection 服务的极简 composition 退回结构化围栏（loopback + 同源检查），本机其它进程仍可访问——与内核在同类 composition 下的行为一致。该说明同样适用于 /forward/key 与 /forward/lan/key：在这类 composition 下，本机任意进程通过一次请求即可取得转发 Key 与局域网 Key，再从其它机器消耗本机的免费额度。使用这类 composition 时，这两把 Key 应视作本机进程可读文件（与 settings.json 同一信任级别），如需更强隔离请在部署时挂载 connection 服务。

## 开发

```
npm test # 以下全部离线套件 + 清单一致性检查，一条命令
node scripts/client-lint.mjs # 浏览器半身：文案键与样式键双向覆盖、bundle 可执行
node scripts/retry-safety-test.mjs # 交给内核的失败对象、退避策略与 usage 计数必须可持久化
node scripts/speed-stat-test.mjs # 任何一次调用都不得被平均成虚假的 tok/s
node scripts/sanitize-test.mjs # 公告 HTML 白名单渲染器：XSS 语料必须全部被丢弃
node scripts/trust-test.mjs # 插件路由的请求信任围栏
node scripts/feed-test.mjs # 公告 feed：解析、故障转移、缓存、到达检测（本地 HTTP 服务器）
node scripts/updater-test.mjs # 应用内升级：清单校验、SHA-256、备份/回滚（本地 HTTP 服务器）
node scripts/effort-test.mjs # 档位模型下发 reasoning_effort、预算模型下发 max_tokens，且与留痕档位一致
node scripts/sniff-test.mjs # 200 响应按 body 形状分流：SSE 帧、单包 JSON、空 body、跨 chunk 多字节、中途 abort
node scripts/release-e2e.mjs # 使用真实 feed/manifest.json 执行一次升级，并验证虚报字节的清单会被拒绝
node scripts/picker-test.mjs # 选择器只广播可用的模型，且永不广播空集合
node scripts/tui-test.mjs # 无 web server 的 composition 中插件仍能启动并输出模型
node scripts/host-selftest.mjs # Host 半身端到端，会真实出网
node scripts/build-manifest.mjs # 发布：重新生成 feed/manifest.json（发布文件哈希清单）
```

发布清单必须使用发布私钥签名（--key  或 OFM_MANIFEST_KEY 环境变量），
未签名清单会被构建器直接拒绝——应用内升级自 v1.3.2 起仅安装能与插件内公钥验签通过的
清单。私钥不进入仓库、不进入任何分发物；更换密钥等同于更换信任根，需同时修改 src/updater.js
中 pin 的公钥并执行一轮完整发布流程。

scripts/probes/ 为逆向过程中的一次性取证脚本——能力矩阵、地区门、
reasoning_effort 无效性采样、预算方言、悬空工具调用、工具名字符集规则、
原始读包时刻（batch-delivery）、逐帧到达与 usage 对照（decode-window）、
长回答是否会被额度截断（long-answer）。
其中六个基于本插件自身代码，可在仓库根目录直接执行
（node scripts/probes/pairing-repair.mjs）；其余借助第三方 SSE 客户端直连上游，
模块路径按该仓库结构编写，因此仅作为取证记录保留，不可作为测试套件使用。
这些脚本均未接入 npm test，属于取证记录，不属于测试套件；npm test 执行的是上述不需要
出网、不消耗免费额度的离线检查。

需要 Node ^22.19.0 || >=24.0.0。无安装步骤、无依赖。

```
npm run typecheck # tsc --noEmit，严格检查 adapter/ 接缝（可选：需要 typescript）
```

## EAC 渠道（桌面端专属）

除免费车道外，插件内置一条协付渠道（EAC）。宿主识别支持以下运行方式：

DSHEAC AIO（Tauri 壳）：内核路径、内嵌 node、web-desktop profile 三重信号同时命中才解锁；

DeepSeek Harness 桌面端（Electron 壳）与 DSH Tauri：使用内核提供的 `desktop` 或 `tauri` profile 上下文；仅有命令行参数不作为通过依据。

内核声明的 `web` / `web-desktop` profile 同样支持该渠道。未通过宿主识别时，不展示渠道、不发请求；通过识别后仍需满足独立的 GitHub 授权要求。

显示规则：模型名仅显示模型本名并带渠道前缀，如 EAC DeepSeek V4.1 Flash、EAC Kimi K3；设置页的模型卡上另有独立的 EAC 渠道徽章。

加密密封：渠道凭据与端点从不以可读形式出现在插件中——它们仅以 AES-256-GCM 密文存在，解密密钥由分散在两个文件中的三片掩码分片在解锁时即时派生；非授权宿主不进入派生路径，密文对搜索引擎与字符串扫描而言仅为噪声。

凭据不落盘、不出进程：解锁按请求即时发生，明文仅存在于构造请求的那一帧中，不写入文件、不进入日志、不出现在任何 API 响应或错误消息中。

签名网关（推荐形态）：worker/ 目录附带一个 Cloudflare Worker 网关——插件密封的仅有网关地址与 HMAC 签名密钥，请求按 时间戳 + HMAC-SHA256(方法/路径/ body 摘要) 签名，中继的真实 key 仅存放于 Worker 的环境变量中；防重放时间窗、模型白名单、可选按 IP 限速均在网关执行，签名密钥泄露只需在网关侧轮换即可全体吊销。部署与轮换见 worker/README.md。

**GitHub 授权闸门**：自建网关（宝塔 Node 形态）另带一道按人计的授权闸门——对话请求除签名外还需携带一枚**专属令牌**，而令牌只发给「用 GitHub 登录 + 已 star 本仓库」的账号。登录全程在浏览器里完成：设置页「EAC 渠道授权」一键发起，网关回调页确认 star 状态后签发令牌，插件自动领取，无需复制粘贴；未 star 时页面会给出 ⭐ 按钮与「我已 star，重新检查」，不必重新登录。网关默认每 12 小时用保存的授权复查一次 star，取消 star 即在复查窗口内吊销令牌；GitHub 侧不可达时保留既有判定，不会误伤已授权用户。网关只申请 `read:user` 最小权限，授权仅用于 star 复查。免费车道（opencode）不经过网关，完全不受影响。

## 上游是哪些源

两条公开免密来源，均直连、不经任何第三方中转；另有第四条出网目标为自建网关（EAC 渠道，见其专节）。

**免费车道：OpenCode 的免密网关，https://opencode.ai/inference/v1/\***（2026-10-14 从
`/zen/v1` 迁到这里；旧路径对免费模型一律 403 FreeTierError）。
具体到代码——src/upstream.js 中每一条均通过直接请求核对（路径与指纹：2026-10-14 / 10-16）：

| 用途 | 目标 | 携带何种凭据 |
| --- | --- | --- |
| 推理请求 | POST …/inference/v1/chat/completions、…/inference/v1/responses、…/inference/v1/messages（按模型分流，见 endpointFor） | Authorization: Bearer public——该车道本身即为公开免密额度，插件中不含任何属于你的密钥 |
| 模型清单 | GET …/inference/v1/models | 同上 |
| 公告与升级清单 | 本仓库的 feed/\*.json：raw.githubusercontent.com 优先，cdn.jsdelivr.net 兜底 | 无 |
| 出口地区判定 | api.ipify.org / ipinfo.io / ipapi.co，仅用于读取本机公网 IP 与国家码 | 无 |

**Kilo 渠道：Kilo AI 的公共网关，https://api.kilo.ai/api/gateway**（2026-10-06 接入）。
代码在 src/kilo.js，每一条均于接入当日通过直接请求核对：

| 用途 | 目标 | 携带何种凭据 |
| --- | --- | --- |
| 推理请求 | POST …/api/gateway/chat/completions（OpenAI Chat Completions 兼容，SSE 流式） | **无**——该网关的免费池（清单中 `isFree: true` 的模型，含 kilo-auto/free 自动路由）不需任何账号、Key 或登录态 |
| 模型清单 | GET …/api/gateway/models | 无 |

关于隐私与信任，说明如下：

没有号池、没有中转、没有二道贩子。上表即为本插件全部出网目标；npm test 的离线套件完全不出网（共享测试脚手架会把两条免密来源都默认指向已关闭的本机端口，杜绝任何套件"顺带"打到真实网关），仅 scripts/host-selftest.mjs 与 scripts/probes/ 会主动请求这些地址，且需手动运行。若将来引入新的来源，本节会先于功能更新，不会默认将流量分配给第三方。

你的 prompt、工具结果与随附图像会作为正常推理请求发送至所选模型对应的上游——与调用任何模型 API 相同。除此之外插件不上传任何内容：用量看板数据、设置、转发 Key 均只落在本机 DSH_HOME/our-free-model/。

免密不等于无人管理：免费车道通过 x-opencode-\* 指纹识别客户端、按会话统计免费额度，会因地区返回 403、因超量返回 429。**Kilo 免费池在其模型卡中明确声明：prompt 可能被上游提供方记录，并用于改进其服务**（原文见 kilo-auto/free 模型卡："Prompts may be logged by the upstream provider and used to improve their services. Not suitable for production or sensitive data workloads."）。模型集合与额度政策由上游决定，随时可能变更；插件仅能如实将不可用的模型从选择器中移除。

本节属于仓库文档。应用内的选择器、设置页与报错文案中仍不出现上游厂名（该约定见验收情况一节），但 Kilo 渠道的模型卡徽章悬停提示会告知"prompt 可能被上游记录"——这是选择模型时需要知道的信息。
## 免责声明

- **本插件是一个客户端，不是模型服务方。** 所有模型响应均由上述第三方上游（OpenCode Zen 网关、Kilo AI 公共网关、以及你自己部署的 EAC 网关）生成并传输；插件不托管、不修改、不过滤任何模型输出。模型可能产出错误、过时或有偏颇的内容，请自行核实后再使用。
- **免费不等于无限，也不等于私有。** 免费额度由上游单方面提供，随时可能限流、收费或下线；Kilo 免费池明确声明 prompt 可能被上游记录并用于改进服务。**请勿通过本插件的免费车道发送密码、密钥、个人身份信息、商业机密或任何你不愿第三方处理的内容**；生产与敏感场景请使用你自己的付费 API。
- **上游条款由你遵守。** 使用各渠道即表示你同意对应上游的服务条款与用量政策；因违反上游政策导致的限流、封禁或其它后果由使用者自行承担。插件不对任何上游的可用性、准确性或连续性作任何承诺。
- **EAC 渠道为协付性质。** 该渠道的凭据与网关由仓库维护者部署（GitHub 登录 + star 仓库解锁），仅限授权用户使用；请勿尝试绕过授权闸门，勿转售或共享渠道访问权——滥用会导致全体用户的通道被收紧。
- **本插件与上述任何上游厂商无隶属或背书关系。** 各厂商名称与商标归其各自所有者所有，仅在说明来源时引用。

## 安全与隐私

所有状态写入 DSH_HOME/our-free-model/；用量与设置仅落在本机，不上传至任何位置。

聚合车道的 Key 同样不出本机：它只写入插件自己的 0600 `settings.json`，请求只发往你自己配置的那家提供商，插件接口只回显 `hasKey` 与 `…abcd` 指纹，从不回显 Key 本身；测试与发现模型两次探测也把回包中的 Key 一律脱敏。

转发监听仅绑定回环地址，默认 127.0.0.1，无 Key 请求一律拒绝。将地址改为可路由接口会被直接拒绝（POST /settings 返回 400 并注明原因；在无 web server 的 composition 中手工写入 settings.json 同样不会启动监听）——该端口的流量消耗的是本机这条免密车道，不应由一个字符串决定是否向整个子网开放。

局域网访问是另开的一扇门，并不放宽上述规则：本机监听仍只绑回环、修改地址仍被拒绝；需要跨机器使用时必须显式启用"局域网访问"，中继绑定可路由地址，且每个请求都需携带局域网 Key——连 /、/health 这类存活探针也一并鉴权（仅本机监听免 Key 应答存活探测），否则一个未鉴权的应答等同于向整个子网宣告"该主机正在代理"。中继仅转发 /v1/models、/v1/chat/completions、/v1/responses、/v1/messages、/v1/messages/count_tokens 五条白名单路径（各自的去 /v1 写法同样放行），不代理任意 loopback 服务；入口处将局域网 Key 换为本机 Key，因此两把 Key 互不通用；携带跳数标记的请求直接拒绝（508），因此端口即使配置为本机监听的同一端口也不会自环。局域网 Key 同样由 crypto 生成、以 timingSafeEqual 比对、存放于同一 0600 文件中，可在面板上单独轮换。

转发 Key 由 crypto 运行时生成、以 timingSafeEqual 比对、存放于 0600 权限文件中。本仓库不含任何硬编码凭据。/ 与 /health 为存活探针，先于 Key 检查应答，但仅回答"是否在线"，获取模型清单仍需 Key。

插件的 HTTP 路由带请求信任围栏（自 v1.1 修复）：插件的 /api/our-free-model 前缀在 webServer 的最长前缀分发下优先于内核 /api，曾绕过内核鉴权。当前每个请求先经由 composition 的 connection 服务准入（与内核 /api 完全同级的 cookie/token 校验）；connection 缺失的 composition 退回结构化围栏——loopback Host、拒绝跨站 sec-fetch-site、Origin/Referer 必须与 Host 同源同端口，Host 缺失或为空也拒绝（fail closed，不回退至 socket 本地地址）。实测结果：异源 Host/Origin 返回 403，无 cookie 的回环请求返回 401。connection 为逐请求获取，因为浏览器半身要到插件加载之后才将其 provide 出来——若在 apply 时以快照方式读取一次，围栏会在整个进程周期内退化为结构化那一层（本轮将该读取改回快照后，picker-test 的 401 断言立即失败）。

公告 HTML 在客户端经严格白名单渲染：scripts/sanitize-test.mjs 使用 XSS 语料（脚本注入、事件属性、javascript:/data: URL、iframe/svg/form、样式注入、畸形标签）验证全部被丢弃；不经过任何 innerHTML sink。公告源的 feedUrl 可被用户指向任意 URL，因此渲染器按不可信输入处理。

应用内升级的完整性链（v1.3.2 加签）：清单 Ed25519 签名验证（公钥 pin 在 src/updater.js，无签名或验签失败的清单直接拒绝，未签名镜像不会被安装）→ 清单校验（semver、路径逃逸、哈希格式、base 必须为清单相对路径）→ 下载时逐文件校验 SHA-256 与字节数 → staging 回读校验 → 安装后回读校验 → 任一步失败即恢复备份；安装前强制重新拉取清单，杜绝陈旧清单。文件与代码边界见已知边界一节。

更新通道与 feedUrl 彻底解耦（v1.3.2）：feedUrl 仅重定向公告 feed，永不再重定向升级清单——此前一个设置项即可将升级源指向任意服务器并配以自配平的哈希，等同于将"修改一个设置值"升级为"在宿主进程中执行任意代码"。公告 override 本身也收紧为仅 https（回环 http 除外，本机镜像与测试仍可用）且不得内嵌凭据。目标域不受限制：任何 https 地址均可作为 feedUrl，插件按 feedPollMinutes 的间隔轮询——因此在不含 connection 服务的 composition 中（见上文鉴权说明），能够修改设置的本机调用者可让进程持续请求任意外部地址。这与插件的其余外联一样按"设置即信任"对待：能够修改 settings.json 的人本来就能安装代码。

转发监听仅绑回环地址，且按解析结果绑定（v1.3.2）：localhost 这类主机名先经 dns.lookup 解析、全部结果均为回环才放行，绑定使用解析出的 IP——当 hosts 文件或企业 DNS 将 localhost 指向可路由接口时，校验与监听不再各自为政。

卸载只需移除 bundle 条目，插件不留任何补丁；其数据目录为纯 JSON，可直接删除。

## 许可证

MIT，见 LICENSE。

本项目为独立插件，与任何模型提供方无隶属、认可或赞助关系。使用该插件访问免费额度受各提供方
自身条款约束；在超出个人机器的场景中部署前，请先确认这些条款。

## Star 趋势

图表由 Star History 自动更新，无需手动提交图片。受服务缓存（当前为 24 小时）和 GitHub 图片缓存影响，显示可能延迟，并非秒级实时；点击图表可查看在线趋势。

<a href="https://www.star-history.com/?type=date&amp;repos=Ebony-Vinyl%2Fdsh-our-free-model">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Ebony-Vinyl/dsh-our-free-model&amp;type=Date&amp;theme=dark" />
    <img alt="dsh-our-free-model 的 GitHub Star 增长趋势" src="https://api.star-history.com/svg?repos=Ebony-Vinyl/dsh-our-free-model&amp;type=Date" />
  </picture>
</a>
