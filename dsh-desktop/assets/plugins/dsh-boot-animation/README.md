# dsh-boot-animation

给 DSH 加一段**开机动画**：每次打开 DSH 播一次，视频铺满整个窗口。

> English: [README.en.md](README.en.md)

- **每次启动 DSH 播一次**（0.4.2 起；在这之前是「每个新会话一次」，所以看起来像一次性的）
- **指定会话每次打开都播** —— 在侧边栏页脚点一下图钉即可
- **铺满窗口**、可跳过、放完自动关闭
- **可以换自己的片子**（三种方式，见下）

## 安装

```sh
dsh plugin --profile web add github:NativeDog1/dsh-boot-animation
```

> 仓库里已经提交了构建产物 `lib/`，也没有 `prepare` 生命周期脚本，
> 所以这条命令**不编译任何东西**，不会触发 pnpm 的 `allowBuilds` 构建授权。
> （等包发布到 npm 之后，也可以写成 `dsh plugin --profile web add dsh-boot-animation`。）

### 支持的 DSH 版本

| DSH 版本线 | 状态 |
|---|---|
| `0.1.5-rc.x` / `0.1.7-rc.x` | ✅ 支持（桌面版旧内核，以及 `npm i -g @deepseek-ai/dsh` 那条线） |
| `0.2.0-rc.x` | ✅ 支持（桌面版新内核，以及 `@next` 那条线） |

**本插件刻意不声明任何 `@deepseek-ai/dsh-*` 的 `peerDependencies`。** host 半边只用
`ctx.webServer`，客户端半边只通过**动态注入**取 `slots` / `uiSession`，两处都不静态
依赖某个宿主包。这样做的直接好处是：它**永远不会被 dsh 的版本兼容闸门跳过** ——
0.2.0 起那道闸门会把 `peerDependencies` 对不上的插件**整包跳过**，现象是"装上了、
但重启后什么也没发生"，而且不报错（市场自己的兼容守卫也会拦）。其它插件要靠
`^0.1.5-rc.3 || ^0.2.0-rc.1` 这种 `||` 列表来适配，本插件不需要，也不会因为漏写
某条版本线而被跳过。

代价是宿主形状变了得自己容忍，这部分由测试守着：`verify-blank`（13 种宿主形状）、
`verify-session-id`、`verify-client-boot`（11 项 boot 安全）。例如"这是不是全新对话"
在 0.2.0 从 binding 上的 `blankBit` 挪到了 `session.getSnapshot().blank` —— 两种都读，
并且**订阅那个 face 本身**而不是采样一次。

装完**必须重启一次 DSH 服务**才生效（bundle 层是在启动时装配的）：

```sh
# 停掉当前的 dsh web，然后
dsh web
```

### 装完看不到效果？先做这件事

DSH 的客户端 bundle 响应带 `cache-control: max-age=31536000, immutable`，
而 URL 上的 `rev` 是**进程 nonce**、不会随内容变化。所以浏览器会一直用**第一次抓到的副本**。

装好或升级后请在新窗口里按 **Ctrl+Shift+R（硬刷新）**。普通 F5 不够。

## 用法

### 「什么时候播」是一个开关（0.4.2 新增）

片库面板（页脚 **🎛**）里有一行明确写着：

```
什么时候播：  [ 🚀 每次启动 DSH 时播放一次：开 / 关（只在新建会话时播） ]
```

| 开关 | 行为 |
|---|---|
| **开**（默认） | **每次启动 DSH 应用时播一次** —— 在启动后你进入的那个对话里播。同一轮使用中切会话、新建会话都不重复；下次打开 DSH 再播一次 |
| **关** | 回到原来的行为：只在**新建会话**时播一次（一个会话记一次，之后不再播） |

- 记录写在 `sessionStorage`（`dsh-boot-animation:boot`），浏览器把它限定在一个标签页里、
  关掉标签页就清掉，所以开关打开时的「一次」= **一次应用启动**，而不是「一个会话」
- **被钉住的会话两种模式下都一样**：钉住的会话仍然每次进入都重播，这个开关管不到它
- **开关本身存在宿主那边**（`$DSH_HOME/boot-animation/selection.json` 的 `playOnAppStart`），
  不存 localStorage —— localStorage 按来源（`host:port`）隔离，DSH 换个端口设置就丢了
- 界面上的开关状态是**读回宿主设置**显示的；宿主还没答复之前插件不做任何播放决定

> 0.4.1 及之前没有这个开关，固定是「每个会话只播一次」—— 于是同一个会话里片头只播一次、
> 之后**永远**不再出现。这就是「开了一次之后就再也没有见过」「是个一次性的」的成因。
> 0.4.2 把规则交给你选，默认值是新的「每次启动播一次」，所以**默认行为变了**：
> 如果你要的是老行为，把开关关掉即可。
>
> 直接按 F5 刷新页面**会**再播一次（开关打开时）：sessionStorage 在同一个标签页里能扛过刷新。
> 如果你连着刷新好几次都看得到，那不是 bug。

### 让某个会话每次打开都播（推荐）

1. 打开那个会话
2. 点侧边栏最下面的 **🎞** 图标（就在「设置」旁边）
3. 图标变绿 **🎬** = 已钉住

之后**每次**进入这个会话都会播一遍 —— 切走再切回来、刷新页面，都会重播。
无论上面那个开关是开还是关，都一样。

再点一下图标取消。

> 注意：如果刚启动时你的活动主面板不是「对话」（比如停在某个插件的面板上），
> 当前会话还不存在，图钉是禁用状态。先打开一个对话即可。

### 只给某一个会话换片头（0.4.0 新增）

上面那个 🎞 图钉管的是「**什么时候播**」；如果你要管「**这个会话播哪一段**」，
用片库里的 **「仅本会话」**：

1. 打开那个会话
2. 点页脚 **🎛** 打开片头片库
3. 在你想播的那一行点 **「仅本会话」**

那一行会变成蓝底并挂上「本会话」徽章，面板顶部也会写明「本会话固定播放：xxx」，
旁边有 **「取消（回到全局）」**。之后**只有这个会话**播这一段 ——
其它会话、以及你在别处选的那一段，都不受影响。
「选它」改的是**全局**，「仅本会话」改的是**这一个会话**，两者互不覆盖。

优先级：**会话覆盖 → 随机 → 全局选择 → 环境变量 → `intro.mp4` → `videos/` → 内嵌内置片**。
会话覆盖连「随机播放」也压得住 —— 把一个会话钉住之后又被随手塞一段随机片，
那不是"钉住"的意思；但显式请求随机的调用（`mode=random`）仍然不被覆盖。

> 指的那一段被删掉或移走时，这个会话**回落到全局**而不是黑屏，并在 diagnostics 里
> 记一条 `conversation-override-stale`；文件回来了这条钉住自动生效
> （不会因为一次失联就被清掉）。

## 换自己的视频（片库）

插件现在是一个**片库**，不是单个槽位：它会把所有能找到的视频都列出来，你选一个，选择会被记住。

### 插件自带四段片头（内嵌在代码里）

装完不用加任何东西，片库里就已经有四段可选：

| 片库里的名字 | 来源 | 大小 |
|---|---|---|
| `DeepSeek 品牌片头` | 内嵌 `lib/clips.data.js` | 1.2 MB |
| `DeepSeek 赛博朋克片头` | 内嵌 `lib/clips.data.js` | 1.8 MB |
| `DeepSeek 数字角色苏醒` | 内嵌 `lib/clips.data.js` | 2.5 MB |
| `DeepSeek 启动问题` | 内嵌 `lib/clips.data.js` | 3.2 MB |

**这些片段没有落盘的 mp4 文件** —— 它们以 base64 存在 `lib/clips.data.js` 里，host 在
第一次被请求时才 import（约 11.5 MB 的模块，如果在启动时解析，每次开 DSH 都要白付这个代价）。
这样做的意义是：不会再有 `files` 字段漏写、安装副本过期、或者随包发出一个没做 faststart
的容器这些事。`media/*.mp4` 只是 `npm run embed-clips` 的输入，**不随包发布**。

四段都是 **faststart** 过的（`moov` 在文件头），可以边下边播；生成脚本会拒绝任何
`moov` 不在前面的输入。这很重要：索引表在文件末尾的 mp4 要整段下载完才出画面，
叠加客户端 25 秒看门狗，表现就是「片头全黑」。

体积：npm 包 **9.1 MB**（tarball）/ 解包 **12.2 MB**。四段都做过 CRF 20 重编码 + faststart
重排，相比各自的原片省下 36%–71%（合计 20.4 MB → 8.7 MB），画质指标 SSIM 0.988–0.996、
PSNR 44–48 dB —— 这是「肉眼看不出差别」的区间。原片另存于仓库外 `~/dsh-dev/_clip-masters/`。

想换成自己的片子：把 mp4 放进 `media/`，改 `scripts/embed-clips.mjs` 里的清单，
跑 `npm run embed-clips`。（临时试片不用这么麻烦 —— 见下面的「最省事的方式」。）

### 最省事的方式（推荐）

1. 把 mp4 丢进 `~/.dsh/boot-animation/videos/`
2. 在侧边栏页脚点 **🎛**（在 🎞 图钉旁边）打开「片头片库」
3. 点一下你想播的那一条

选中的那段会在**下一次**播放片头时登场：下次启动 DSH、以及你钉住的会话。

> Windows 上就是 `C:\Users\<你>\.dsh\boot-animation\videos\`
> 具体路径以片库面板底部显示的那一行为准。
>
> 你不需要为了"干净"删任何东西：**同一个视频存在多份副本时，片库只列一条**
> （按 大小+mtime 判定同一份内容），并标注「合并 N 份重复」。你的文件一直留在
> 原处，只是不重复显示。这解决的是历史上一个真实的困惑：用户自己也放了一份
> `intro.mp4`，于是同一段片子在面板上出现两次、挂两个不同徽章，看起来像
> "插件里没有这一段"。

### 片库面板

| 元素 | 作用 |
|---|---|
| ✓ 标记 | 当前生效的那一条（全局选择） |
| 来源徽章 | `你自己加的` / `插件自带` / `内置原始` / `环境变量` |
| 文件大小 | 帮你确认换对了没有 |
| **▶ 预览** | **立刻播放这一行**，不改你的任何选择 |
| **选它** | 把它设为**全局**片头（以后开片头都播它） |
| **仅本会话** | **只让当前这个会话**播它，不动全局选择（见上） |
| `本会话` 徽章 | 这一行是这个会话固定播放的那段 |
| 面板顶部的本会话条 | 本会话当前固定播放哪一段，带「取消（回到全局）」 |
| 刷新 | 刚往文件夹里丢完文件，点它重新扫描 |
| `原片源` 徽章 | 历史上那个 `intro.mp4` 落点，仍然优先 |
| ⚠ 未优化 徽章 | 该文件的索引表 `moov` 在末尾，建议重排（见下） |
| `铺满屏幕` / `完整显示` | 播放时怎么贴合窗口，见下 |

### 换了片子却"没反应"？先点「预览当前」

片头动画的触发**故意很窄**：

- **启动 DSH**：整轮启动只播**一次**（0.4.2 起；记录在 `sessionStorage`）
- **钉住的会话**：每次打开都播

所以**在同一个会话里切来切去**，片子**本来就不会重播** —— 这很容易被误认为
"我换了片子但另一个视频不出现"。点片库里的 **▶ 预览当前** 可以立刻播放选中的那段，
确认换对了没有。

### 播放时怎么贴合窗口（黑边问题）

覆盖层铺满整个窗口，但**窗口的长宽比几乎不会是视频的长宽比**——浏览器有标题栏和
工具栏，可视区通常比 16:9 更宽。这时：

| 模式 | CSS | 效果 |
|---|---|---|
| **铺满屏幕**（默认） | `object-fit: cover` | 填满窗口，**没有黑边**，超出部分被裁掉 |
| 完整显示 | `object-fit: contain` | 整帧都在，长宽比不匹配时**留黑边** |

在片库面板里切换，**下次播放生效**。选「完整显示」的情况：片子里有贴着边缘的字幕、
logo 或水印，不想被裁掉。

> 如果黑边来自**视频本身烧进去的边框**（导出时带上的），改 CSS 没用，要用
> ffmpeg 裁掉：`ffmpeg -i in.mp4 -vf "crop=W:H:X:Y" -c:a copy out.mp4`。
> 判断方法：`ffmpeg -v info -i in.mp4 -vf cropdetect=24:16:0 -f null -`，
> 若 `crop=` 值全程稳定，就是烧进去的；若随画面变化，那只是深色背景，别裁。

### 支持的格式

`.mp4` `.m4v` `.webm` `.mov` `.mkv` —— 但**能不能播取决于浏览器解码**。
H.264 + AAC 的 mp4 最稳；HEVC(H.265)、ProRes、部分 mkv 大概率只有声或黑屏。

### 手动方式（老办法，仍然有效）

host 半侧按这个顺序解析，**每次请求都重新解析**（换片子不用重启）：

| 顺序 | 位置 |
|---|---|
| 0 | **当前会话的覆盖**（`selection.json` 的 `conversationOverrides`；只有带 `?session=` 的请求会看这一层） |
| 1 | `~/.dsh/boot-animation/selection.json` 里选中的那个 id（片库面板写的） |
| 2 | 环境变量 `DSH_BOOT_ANIMATION` 指向的文件 |
| 3 | `~/.dsh/boot-animation/intro.mp4`（历史落点，仍优先于片库里的其他文件） |
| 4 | `~/.dsh/boot-animation/videos/` 里最新修改的那个 |
| 5 | **内嵌的四段**（按 `scripts/embed-clips.mjs` 里的顺序，品牌片头优先）—— 永远兜得住，因为它在代码里 |

所以最保险的手动换法依然是：

```sh
mkdir -p ~/.dsh/boot-animation
cp 我的片子.mp4 ~/.dsh/boot-animation/intro.mp4
```

想确认当前用的是哪一个，直接访问状态端点：

```sh
curl http://127.0.0.1:3080/dsh-boot-animation/status.json
curl http://127.0.0.1:3080/dsh-boot-animation/videos.json
```

看**某个会话**会播哪一段，以及把某个会话钉到某一段（`id: null` 取消）：

```sh
curl "http://127.0.0.1:3080/dsh-boot-animation/resolve.json?mode=active&session=<会话id>"

curl -X POST http://127.0.0.1:3080/dsh-boot-animation/select \
  -H 'content-type: application/json' \
  -d '{"scope":"conversation","sessionId":"<会话id>","id":"builtin:cyberpunk"}'
```

不带 `?session=` 时，每一个回答都和 0.3.0 逐字节一致。

### 排错：视频是黑的 / 放着放着没了

**多半是容器没做 faststart。** 如果 mp4 的索引表 `moov` 在文件末尾，浏览器必须
**整段下完**才能解码，中间一直黑屏；而客户端有 **25 秒看门狗**（`STALL_TIMEOUT_MS`），
超时就自己把覆盖层关掉 —— 症状就是「点开什么都没有」。

用 ffmpeg 重排一下容器（**无损**，不重新编码）：

```sh
ffmpeg -i 原片.mp4 -c copy -movflags +faststart 修好的.mp4
```

验证 moov 是否前置：

```sh
ffprobe -v trace 修好的.mp4 2>&1 | grep -m1 moov   # 偏移应该很小
```

## 浏览器的两条硬性策略

自动播放**带声音**、以及 Fullscreen API，**都要求用户手势**，任何网页都绕不过。所以：

1. 动画以**静音**在铺满窗口的覆盖层里自动开始（视觉上已经是全屏）
2. **点一下画面**：同时开启声音并进入**真全屏**
3. 万一连静音自动播放也被拒，会显示「点击播放」而不是黑屏

## 覆盖范围（说实话）

- 浮层是 `position:fixed;inset:0;z-index:2147483000`，覆盖的是 **DSH 客户端窗口**
  —— 也就是你能看到侧边栏、对话框的那一整块区域
- **它盖不住操作系统的屏幕**。Windows 的任务栏、桌面、别的应用窗口都在它上面。
  **这不是 Windows 开机画面**，也不会替代系统启动过程 —— 它是 DSH 这个应用自己的片头
- 覆盖层的矩形与视口逐像素相等、四个角与中心都命中在它内部，这一点由
  `scripts/verify-letterbox.mjs` 在真实浏览器里量过（见「验证脚本」一节）
- **别的插件如果用更高的 z-index，我们压不过它**。`2147483000` 是我们自己的值，
  不是全局最大值；宿主自己的部分浮层也在同一量级。真遇到有东西盖在片头上，
  那是两个浮层的层级之争，本插件不改别人的值，也不声称"一定在最上层"
- 库面板（片库）的遮罩是 `2147483200`，**刻意比浮层高 200**：
  打开片库时它必须盖在正在播的片头之上

## 排错

| 现象 | 原因 / 处理 |
|---|---|
| 完全没出现 | 十有八九是缓存：**Ctrl+Shift+R**（普通 F5 不够）。升级/装完还要**重启一次 DSH 服务** |
| 装完当天见过一次，之后再也没见过 | **0.4.1 及之前的 bug**：那时是「每个会话只播一次」。升到 0.4.2 后是「每次启动 DSH 一次」。还不行就看下一行 |
| 一直不播（怀疑"脚本没生效"） | 见下面「装上了但没反应 / 脚本像没生效」一节，三条可能逐条排除 |
| 钉住了也不播 | 确认图钉是绿色；确认打开的就是被钉的那个会话 |
| 黑屏无画面 | 先看 moov 是否前置（见上「排错：视频是黑的」）；再访问 `/dsh-boot-animation/status.json` 看片源；最后看浏览器控制台有没有解码错误 |
| 换了片没生效 | 片库里点完要有 ✓ 才生效；确认文件在 `videos/` 里并点了「刷新」 |
| 只有一个会话播的不是你选的 | 那个会话可能有「仅本会话」覆盖：打开片库看顶部那条，点「取消（回到全局）」 |
| 某个会话的固定片头突然没了 | 它指的片段被移走或删除了 —— 该会话已回落到全局；`status.json` 里能看到 `conversation-override-stale` |
| 播到一半自己没了 | 25 秒看门狗（`STALL_TIMEOUT_MS`）超时 —— 通常还是 faststart 或解码太慢 |
| 片头只盖住一块面板，没铺满窗口 | 这**不该发生**：浮层是 `position:fixed`，只有祖先里有 `transform` / `filter` / `perspective` / `contain` / `will-change` 时才会退化成盖一块面板。跑 `npm run verify:letterbox` 量一下；插件自身不设置这些属性 |
| 有东西盖在片头上面 | 另一个浮层的 z-index 更高（我们的是 `2147483000`）。**本插件不保证压过别人的浮层**，也不会为了压过它去改全局层级 |
| 想让片头盖住任务栏 / 整个屏幕 | 做不到，也不该做：覆盖范围是 **DSH 客户端窗口**，不是操作系统屏幕。这不是开机画面 |
| 想看到插件在干什么 | 把 `src/client/index.ts` 顶部的 `DEBUG` 改成 `true` 重新构建，控制台会打印每次决策 |

### 装上了但没反应 / "插件脚本像是被覆盖了、没生效"

这一条**多半不是本插件能修的**：下面是三个已知原因，都能自查。请按顺序排除，
**不要**把「看起来像被覆盖」直接当成代码 bug。

**① 浏览器缓存（最常见）。** 宿主给客户端 bundle 的响应头是
`cache-control: max-age=31536000, immutable`，而 URL 上的 `rev` 是**进程 nonce**、
**不随内容变化**。所以浏览器会一直用**第一次抓到的那份**，装新版本也一样。

- 处理：在新窗口里按 **Ctrl+Shift+R**（硬刷新）。普通 F5 不够。
- 再确认：装完/升级后**重启一次 DSH 服务**（`dsh web`）—— bundle 层是启动时装配的。

**② 换了端口（或 `localhost` ↔ `127.0.0.1`）—— 这是浏览器语义，插件绕不开。**
`localStorage` 和 `sessionStorage` 都按**来源（`scheme://host:port`）隔离**。
DSH 换端口 = 换来源 = 之前「钉住的会话」和「已播记录」**一个都读不到**：

```js
// 在 GUI 的开发者工具里粘一下，看当前来源和记录
location.origin
JSON.stringify({ boot: sessionStorage.getItem('dsh-boot-animation:boot'),
                 pinned: localStorage.getItem('dsh-boot-animation:pinned') })
```

`boot` 为 `null` 且**没有**播片头 → 记录其实在另一个来源下。重新钉一次即可。

**③ 宿主没提供插件需要的槽位。** 本插件的两个服务（`slots` / `uiSession`）走
**动态注入**；宿主既不支持动态注入、又没有 `uiSession` 时，插件会**静默闲置**，
不报错也不挂载。这是刻意的（静态注入一旦被宿主跳过，**整个 GUI 会打不开**，有实测事故），
但症状确实很像"脚本没生效"：

```js
// 控制台里应该能看到这一行（插件每次加载都会打，与 DEBUG 无关）
// [dsh-boot-animation] idle: host offers no dynamic injection and no uiSession
```

- 看到这一行 → 是宿主/版本问题，不是本插件。先确认 DSH 版本在该支持线内（见上表）。
- **没看到任何 `[dsh-boot-animation]` 输出** → 脚本根本没被加载，
  这时才该怀疑插件确实没装上/被跳过（例如兼容闸门跳过、或安装副本过期）。
  用 `dsh plugin --profile web list` 确认它在列表里，再 Ctrl+Shift+R。

## 实现速记（给维护者）

- 挂载点：`shell.overlay`（帧级浮动层，`kind: list`，新增一格不顶替官方 UI）+
  `sidebar.footer.action`（页脚那个图钉和 🎛 片库入口）
- **这个插件绝对不能用静态 `inject`** —— 这是踩过的坑，别改回去。
  客户端加载器把**任何不是 `active` 的条目**都当成致命错误：

  ```js
  if (u !== "active") if (u === "pending") { … }
  if (o.length > 0) throw new Error(`web boot: ${o.length} entry did not activate …`)
  ```

  静态 `inject` 一旦有宿主给不出的服务，本插件 fiber 就**永远 pending**，
  于是**整个 GUI 打不开**。实测事故原文：

  ```
  web boot: 1 entry did not activate dsh-boot-animation: pending (waiting for service: uisession)
  ```

  所以两个服务都用 cordis 的**动态注入** `ctx.inject(['slots','uiSession'], cb)`
  —— 等待发生在**子 fiber**，我们自己的条目照常 `active`。宿主给不出时插件静默闲置，
  这对一个装饰性插件才是正确的失败方式。
  `scripts/verify-client-boot.mjs` 专门断言"产物里没有静态 `inject`"，并覆盖四种服务情形。
- 当前会话来自 `ctx.uiSession.adapter.current` 这个 React 友好的 store。
  **它的快照不是会话记录**，而是解析后的描述符产物
  `{ key, hooks, keyedHooks, props }` —— 会话 id 在 `props.sessionId`，会话快照在 `hooks.session`
- **「这是个全新对话」的字段，DSH 0.2.0 起改了位置**：`hooks.session` 现在是
  `SessionFace`（`ISession & ObservableSnapshot<SessionSnapshot>`），空白标志在
  **`getSnapshot().blank`**；0.2.0 之前它是直接挂在 binding 上的 `blankBit`，而
  0.2.0 把它变成了 `private`。
  这两个字段都读（新优先），并且**订阅那个 face 本身**而不是采样一次 ——
  旧写法的问题不是报错而是**沉默**：读一个不存在的字段得到 `undefined`，
  判断恒为假，于是「新对话自动播放」悄悄失效。同理，触发也不要求
  "必须是切换会话的那一次渲染"，否则会取决于两个 store 谁先落定。
- 「每次点开都播」实现为**监听进入会话**这个动作，而不是记"播过没有"，
  所以被钉的会话不受"已看过"记录限制
- 视频路由支持 **Range**（浏览器对媒体会发 Range；该给 206 却给 200 时有些播放器会拒绝播放）
- 媒体响应是 **`no-cache` + ETag，不是 `no-store`**：`no-store` 让浏览器一个字节都不能留，
  于是**每次开片头都要重下整段**，加载期间就是黑屏。`no-cache` 表示"留着但要先问"，
  配合 ETag：没换片子 → 304 直接用本地副本（秒开）；换了片子 → ETag 不同 → 重新下发。
  这条的正确性由 `verify-routes.mjs` 断言（含"带旧 ETag 请求新片子必须 200"的反例）
- **hook 只能在组件里调**：`apply()` 是插件加载器调的，不是 React 调的，所以状态
  全部住在 `AppRoot` 组件内。片库入口在图钉那个 slot、对话框在 overlay 那个 slot，
  是两个独立的 React 根，用模块级 `libraryOpeners` 订阅集合桥接
- 片库的路由：`videos.json`（列）、`media/<id>`（按 id 流）、`select`（POST 写选择或钉会话）、
  `resolve.json`（"现在播谁"）、`boot.mp4`（老路由，302 到具体片段，向后兼容）
- **按会话覆盖是主机的一层，不是客户端的一层**：`resolveActive(sessionId)` 把
  `conversationOverrides[sessionId]` 排在最前面，客户端只把 session 带上（`?session=`）——
  优先级链因此仍然只有一份实现。`mode=random` 是唯一绕过它的入口，因为那是调用方
  **指名**要随机；`mode=active` / `mode=selected` 都认这一层
- `conversationOverrides` 放进 `selection.json`（v3）而不是另开一个文件：它就是用户选择，
  而这个 store 是插件里唯一知道怎么原子写、怎么自愈损坏文件的地方，另开一个文件
  等于把那两件事再抄一遍。键值两侧的校验和 `selectedClipId` 完全一样（路径一律被拒），
  所以手改文件也无法从这张表里塞进媒体路径；表有上限（200），淘汰**最久没被设置**的那个
- `videos.json` / `status.json` **只公布发问那个会话的** `conversationClipId`，
  从不把整张表发给浏览器 —— 一个把用户钉过的每个会话 id 都吐出去的端点，
  比一个只回答被问到的问题的端点差得多
- 内嵌片段的 id 是 `builtin:<name>`，与路径派生的 id 不会撞；它们的 ETag 用自身的
  内容哈希（`"embedded-<sha256前16位>"`），所以重校验是精确的、不依赖 stat
- **同一个视频在多个位置时按内容去重**（sha256；文件侧按 size+mtime 缓存哈希结果），
  内嵌那份优先胜出 —— 它不可能被删掉，所以指向它的选择永远解析得到
- **prefix 路由不能带尾部斜杠**：webserver 用
  `pathname !== prefix && !pathname.startsWith(prefix + '/')` 匹配，注册
  `.../media/` 会被当成 `.../media//`，永远匹配不上（曾导致 /media/<id> 全 404）
- **「什么时候播」是一条纯函数**：`decidePlay()`（`src/client/session.ts`）吃下
  sessionId / 是否刚进入 / 宿主设置是否到达 / `playOnAppStart` / 是否被钉 / 是否新会话 /
  两个记录，吐出 `none | play(pinned | app-start | new-conversation)`。副作用（写记录）
  在 `recordDecision()` 里，UI 只负责收集输入和调 `playMode()`。这样决策矩阵可以在测试里
  穷举（`verify-play-decision.mjs`），而不是靠渲染一个浮层去反推
- **设置到达之前不做决定**：`snapshot.settingsLoaded` 为假时 `decidePlay` 一律返回 `none`。
  默认值猜错任何一边都会让"明确关掉开关的人"又被播一次
- 覆盖层**不依赖祖先的层叠上下文**：它插在 `shell.overlay` 槽位里，而宿主那个
  `data-shell-overlay` 层是 `position:absolute;inset:0`，**没有** `transform` / `filter` /
  `contain` / `will-change`，所以 `position:fixed` 真的以视口为包含块。
  这条不靠读代码保证：`verify-letterbox.mjs` 会走一遍真实祖先链，
  并且用一个 `transform:translateZ(0)` 包裹的**反例页面**做阴性对照 ——
  探针必须能看出反例没铺满，否则"正面通过"没有意义

## 验证脚本（改完跑一遍）

| 命令 | 作用 |
|---|---|
| `npm run verify:routes` | 用**服务器自己的匹配规则**驱动真实 handler，断言每条路由 |
| `npm run verify:conversation` | 按会话覆盖的完整行为：只对自己生效、不碰全局选择、压过随机但不压过 `mode=random`、片段失效时回落并记录、只公布发问者的钉住、校验与上限 |
| `npm run verify:boot-scope` | 启动记录的作用域（sessionStorage）、存储抛异常 / 不存在时回退到内存 |
| `npm run verify:play-decision` | 「什么时候播」的决策矩阵：开关开 / 关、钉住会话、宿主设置未到达、同一轮不重复 |
| `npm run verify:app-start-setting` | 开关作为宿主设置的完整往返：默认 true、`/select` 写入与读回、非布尔被拒、v3 旧文件迁移 |
| `npm run verify:letterbox` | 用 CDP 驱动本机 Edge，量出所选贴合方式实际留多少黑边，并**量出覆盖层是否等于视口 + 四角/中心命中测试 + 阴性对照** |
| `npm run verify:boot-animation` / `verify:pin` | 真 GUI 端到端（`npm run verify:gui-boot` / `verify:gui-pin`；需要带 `--remote-debugging-port` 的 DSH GUI，**不是** `npm run check` 的一部分）。`gui-boot` 也会量一遍覆盖层 |
| `npm run check` | 上面全部 **18 组**（build / routes / selection / conversation / cache / blank / boot / boot-scope / play-decision / app-start-setting / preview / playback / random / fallback / install / teardown / version-refresh / session-id） |
| `npm run build:client` | 先跑 CSS 检查再构建（防带病构建） |

两个脚本都是被真实 bug 逼出来的，各自都有过一次"用自己的规则测自己"的教训：
它们的断言刻意复刻被测方的规则，并且在提交前会做**反向验证**（故意改坏 → 必须报错）。

> 客户端构建有一个坑：整个 CSS 是一段模板字符串，注释里写一个反引号就会提前把它
> 结束掉，而报错是 **TypeScript 的 parse error 指向某行 CSS**，同时 `lib/client.js`
> 保持不变 —— 看起来像改成功了其实没生效。`scripts/check-css-template.mjs` 专门
> 拦这个，已接进 `build:client`。

## 许可

BSD-3-Clause，见 [LICENSE](LICENSE)。包内 `lib/clips.data.js` 里的内嵌片源以相同条款分发。

## 安装时报 `connection to github.com timed out after 5000ms`

如果安装插件时看到这样的提示：

```
任务 ① 安装 dsh-boot-animation
{"code":"operation-error","diagnostic":"dsh: connection to github.com timed out after 5000ms"}
```

**这不是插件坏了。** 这一行是 DSH 在**拉取插件**时自己报的：它在 5 秒内没能从 github.com 取到东西。
插件运行时代码里没有任何访问 github.com 的请求 —— 它的 `fetch` 全部指向自己的本地路由，超时常量是 25 秒的卡顿检测，
和这里的 `5000ms` 没有关系。

常见原因与处理：

1. **网络到 github.com 不通或很慢**（国内尤其常见）。先做的是：**再装一次**；仍然失败就换网络（手机热点试一下）、
   或挂上代理后重试。
2. **不想走网络**：把仓库克隆到本地，用本地路径安装，例如
   `dsh plugin add <你克隆下来的目录>`。走本地路径不需要连 github.com。
3. **安装包体积**：这个仓库里带着插件自带的四段片头（`lib/clips.data.js` 约 12 MB，是把视频内嵌进代码里的结果）。
   在慢网络上，这个体积本身也会把 5 秒的窗口撑爆。0.4.1 已把仓库里两个无关的大文件删掉（见 CHANGELOG），
   安装时传输的体积因此明显变小。

如果你确认网络正常、重试多次仍失败，请把上面那段 `diagnostic` 原文贴到 issue 里 —— 里面有 DSH 报的原始原因。
