# EAC 整合包大厅 · 参考服务器

零依赖 Node 服务器，存放启动器「整合包大厅」的分享数据。**只保存整合包清单（插件引用列表 + 名称描述），不保存、也不分发任何插件本体**——本体始终从官方 npm / GitHub / 原始 tarball 安装。

## 启动

```bash
node pack-hall/server.mjs          # 默认 0.0.0.0:4317
PORT=8080 node pack-hall/server.mjs
```

数据保存在 `pack-hall/data/store.json`（自动创建）。备份/迁移 = 复制这个文件。

## 接入启动器

启动器「偏好设置 → 整合包大厅」填入服务器地址，例如 `http://127.0.0.1:4317`。
之后在「整合包 → 大厅」即可浏览、点赞、一键空投其他人分享的整合包；
「从实例导出」对话框可以把本机实例的插件组合发布上来。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| GET | `/api/packs?sort=likes\|downloads\|new&limit=50&offset=0` | 大厅列表（默认按点赞排序） |
| POST | `/api/packs` | 发布/更新 `{ manifest }`；同作者同名视为更新 |
| GET | `/api/packs/:id` | 取完整清单（下载计数 +1） |
| POST | `/api/packs/:id/like` | 点赞切换 `{ client: "随机标识" }` |
| GET | `/api/announcement` | 当前公告（无则 `announcement: null`） |
| POST | `/api/announcement` | 发布公告（需 `Authorization: Bearer $ANNOUNCE_TOKEN`） |
| GET | `/api/plugins/stats?period=day\|week\|month&limit=50&ids=a,b` | 插件下载/点赞统计与日/周/月榜；`ids` 用于批量查询卡片数据 |
| POST | `/api/plugins/:id/download` | 记录一次真实安装 `{ client }`；同一 client 同一天去重 |
| POST | `/api/plugins/:id/like` | 切换点赞 `{ client }`，返回 `{ likes, liked }` |

插件统计保存在 `store.json` 的 `plugins` 字段；下载按 UTC 日期分桶，只保留
最近 120 天，点赞按 client 去重后保留。启动器在插件**安装成功后**才上报下载；
离线或大厅不可达时回退到本机真实安装记录。点赞的登录门槛在启动器端完成，
大厅只收到随机 `client` 标识用于去重，不接收 GitHub 令牌或账号信息。可以用
`HALL_DATA_DIR=/tmp/eac-hall` 指定测试数据目录。

## 发公告

服务器进程需设置 `ANNOUNCE_TOKEN` 环境变量（systemd 单元里已配置）。然后：

```bash
node pack-hall/announce.mjs --token <ANNOUNCE_TOKEN> --title "公告标题" 公告.html
```

公告文件是 HTML 片段：`h1-h5 / p / ul / ol / li / strong / em / a / img / table / code / pre / blockquote` 等都会渲染，**内联 `style` 保留**（方便美化配色）；`script / iframe / 表单 / 事件属性` 会被启动器端净化移除。图片建议用公网 https 链接。新公告的 `id` 变化后，用户端启动器会弹一次窗，之后可在「偏好设置 → 应用与更新」重新查看。

校验规则与启动器一致：`eac-pack` v1 清单、名称 ≤ 60 字、插件 ≤ 300 条、
引用必须可安装（`https://` tarball / `github:owner/repo` / `name@exact-version`）。

## 部署建议

- 公网部署时建议放在反向代理后面加 HTTPS 与限流（清单 POST 有 64KB 上限兜底）。
- 点赞以 `client` 随机标识去重，防的是误触，不是刷票；需要强防刷请自行加鉴权。
