# GitHub 登录、Star 与插件点赞

启动器提供两种登录方式，二选一即可：

1. **浏览器设备流**（推荐）：不需要客户端密钥，不需要回调地址。需要先在 GitHub
   创建一个 OAuth App，并启用 `Enable Device Flow`。
2. **访问令牌**：不想创建 OAuth App 时使用。经典令牌需要 `read:user` 和
   `public_repo` 两个权限。

## 1. 创建 OAuth App（设备流）

1. 打开 GitHub `Settings → Developer settings → OAuth Apps → New OAuth App`。
2. 名称随意，Homepage URL 可以填 `https://github.com/Ebony-Vinyl/EAC-Desktop`。
3. 创建后进入应用设置，勾选 **Enable Device Flow**。
4. 复制页面上的 **Client ID**（公开信息，不是 Client Secret）。

把 Client ID 交给启动器的方式（按优先级）：

1. **发布构建内置（推荐给发行者）**：构建前设置环境变量，`option_env!` 会把它编译进程序，用户端免配置：

   ```powershell
   $env:EAC_GITHUB_CLIENT_ID = "<你的 Client ID>"
   npm run tauri:build
   ```

2. **运行时环境变量**：启动前设置 `$env:EAC_GITHUB_CLIENT_ID`（优先于内置值）。
3. **登录窗口手填**：打开「登录 GitHub」→「浏览器授权」，在首次使用面板粘贴并保存。

Client ID 保存在启动器状态的 `settings.githubClientId`，不会写进快照之外的地方。
**仓库不内置 Client ID**：OAuth App 必须由发布者或用户自己注册。

授权时启动器请求的作用域是：

| 作用域 | 用途 |
| --- | --- |
| `read:user` | 读取公开资料（登录名、头像、简介、仓库数等） |
| `public_repo` | 在启动器里 Star / 取消 Star 公开项目 |

设备流流程：启动器向 GitHub 申请一次性代码 → 浏览器打开
`https://github.com/login/device` → 输入代码并确认 → 启动器轮询并保存令牌。
令牌只保存在本机。

## 2. 网络代理（国内网络常见）

GitHub 设备流的授权码接口只在 `github.com` 上；`api.github.com` 可直连时
`github.com` 也可能被重置。引擎默认不走系统代理，因此需要**显式**设置：

```powershell
$env:EAC_HTTPS_PROXY = "http://127.0.0.1:7890"   # 你的本地代理端口
npm run tauri:dev
```

- 只支持 http/https 代理（不支持 socks5）；`EAC_GITHUB_PROXY` 是等价别名。
- 设置后引擎的全部 HTTPS 出站请求（GitHub 授权/Star、发行版下载、npm 元数据）
  都会走代理，DNS 由代理解析；未设置时保持原有 DNS 固定 + 私网校验。
- 安装版同样读取该环境变量，可在系统环境变量或快捷方式里设置。
- 设备流申请失败且提示「无法直连」时，就是这个原因。

## 3. 使用访问令牌

在「登录 GitHub」→「访问令牌」中粘贴令牌。创建入口：

<https://github.com/settings/tokens/new?scopes=read:user,public_repo&description=EAC%20Launcher>

经典令牌请勾选 `read:user` 和 `public_repo`。细粒度令牌对 Star 的支持取决于
GitHub 当前策略；如果登录后个人中心提示缺少 `public_repo`，Star 按钮会失败，
请换用经典令牌或重新授权。

## 4. 令牌存储与边界

- 令牌保存在启动器数据目录的 `github.json`；Unix 下权限为 `0600`。
- 快照、任务消息、日志、用量统计和大厅请求都不包含令牌。
- Star 请求由 Rust 直接发往 `api.github.com`，只有用户点击 Star 按钮时才会写入。
- 插件点赞的登录门槛在启动器本地完成；大厅只收到随机 `client` 标识用于去重，
  不接收令牌或 GitHub 账号信息。
- 退出登录会删除 `github.json` 并清空内存中的设备流状态；已产生的本地点赞记录
  仍按账号保存在 `social.json`，重新登录同一账号会恢复显示。

## 5. 插件下载榜

插件市场顶部有「日榜 / 周榜 / 月榜」：

- 大厅服务器运行新版 `pack-hall/server.mjs` 时，显示 `大厅实时`，数据来自所有
  启动器上报的真实安装次数与点赞数。
- 大厅不可达或仍是旧版接口时，自动回退到 `本机记录`，只统计这台机器的真实
  成功安装记录，并在界面上明确标注。
- 只有插件安装成功后才会记录下载；失败、取消或仅浏览不会计数。

部署大厅：

```bash
HALL_DATA_DIR=/var/lib/eac-hall PORT=4317 node pack-hall/server.mjs
```

然后在「偏好设置 → 整合包大厅」填入地址。

## 6. 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| `尚未配置 GitHub OAuth Client ID` | 按第 1 节创建 OAuth App，或在登录窗口粘贴 Client ID |
| GitHub 返回 `device_flow_disabled` / 404 | OAuth App 没有勾选 `Enable Device Flow`，或 Client ID 填错 |
| 授权码申请提示「GitHub 无法直连」 | 按第 2 节设置 `EAC_HTTPS_PROXY` 指向本地代理 |
| `GitHub 授权已失效，请重新登录` | 令牌被撤销或过期；重新登录 |
| 登录后 Star 提示缺少 `public_repo` | 令牌权限不足；换经典令牌或重新授权 |
| `GitHub API 速率限制` | 稍后再试；启动器会缓存 Star 列表 2 分钟 |
| 榜单显示「本机记录」 | 大厅未部署新版接口，或当前网络不可达 |

## 7. 本地验证

```powershell
# Rust 单元测试（含 GitHub 参数、成就、用量解析）
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --lib

# 浏览器联调（真实 Rust 桥接，不使用模拟后端）
$env:EAC_LAUNCHER_HOME = "$PWD/.verify/launcher-home"
$env:EAC_USAGE_INCLUDE_HOME = "1"   # 测试个人中心时扫描本机 ~/.dsh
npm run dev:connected
```

测试用的 `github.json`、`social.json` 和截图都在忽略目录 `.verify/`，不会提交。
不要把真实令牌写入仓库或截图。
