# 客户端完整包更新清单 v1

日期：2026-10-18。状态：实现协议；正式清单和包尚未发布。

清单文件名为 stable.json，采用带签名的 envelope。客户端只信任随产品构建的 client-update-defaults.json 中的公钥，不读取来源提供的信任根。

~~~json
{
  "schemaVersion": 1,
  "keyId": "release-key-id",
  "payload": "BASE64_OF_EXACT_UTF8_MANIFEST_BYTES",
  "signature": "MINISIGN_SIGNATURE_TEXT_OR_BASE64_OF_TEXT"
}
~~~

payload 解码后的结构：

~~~json
{
  "schemaVersion": 1,
  "product": "eac-desktop",
  "releaseChannel": "stable",
  "version": "6.1.1",
  "publishedAt": "2026-10-13T00:00:00Z",
  "artifacts": [
    {
      "target": "windows-x86_64-portable",
      "installKind": "portable",
      "url": "EAC-Lite-6.1.1-windows-x86_64-portable.zip",
      "size": 123456789,
      "sha256": "LOWERCASE_HEX_SHA256_WITH_64_CHARACTERS",
      "signature": "MINISIGN_ED_PREHASHED_PACKAGE_SIGNATURE"
    }
  ]
}
~~~

以上为结构示例，签名与 hash 占位值不可用于安装。签名覆盖 payload 的原始 bytes，不先重排 JSON 字段。包身份由签名清单中的 target、size、sha256 和 signature 固定；下载结束同时校验大小、SHA-256 和包签名。

清单支持 Ed 原始签名和 ED 的 BLAKE2b-512 预 hash 签名；完整包要求 ED，使大小不限的包验证可以流式执行。验证同时检查 key id 与 trusted comment 的第二个签名。支持签名文本及其 base64 传输封装。当前验证证据来自隔离 crypto 夹具；正式 Tauri/minisign 发布产物的交叉验证仍需完成。

支持的 target 是 windows/linux、x86_64/aarch64、安装形态三者的精确组合。Windows 允许 nsis/portable；Linux 允许 appimage/deb/rpm。同一 target 只能出现一次，不跨形态或架构回退。版本仅接受无预发布和无 build metadata 的三段数值版本。

GitHub/Gitee 读取 Release 元数据，过滤 draft、prerelease 与非 vX.Y.Z 标签，在候选 Release 的 stable.json 上验证产品、通道、版本和签名。GitHub 数组式 assets 与 Gitee links 式 assets 均有隔离回归。最多读取十页，达到分页上限时明确失败，避免把未完成查询当作最新结果。

自定义源使用 HTTPS 清单地址；包地址可以是 HTTPS 地址或相对于清单的地址。每次跟随重定向前检查 HTTPS、禁止 URL 凭据。自定义源失败不访问官方源。

本地源选择目录或清单文件，读取同一 envelope。包 url 必须为根目录内的相对路径；拒绝绝对路径、..、反斜杠、带盘符路径及任意路径组件的链接/junction。下载前重新解析源，移除外置存储或替换源时明确失败，不转用网络。

源设置保存在 update-settings.json，事务表现保存在 update-state.json，包与锁定计划保存在独立 transactions/<uuid> 目录。源切换取消旧操作并等待其收敛；未验证 partial 文件不会复用。用户手动选择保持 manual，auto 回退只记录本次实际来源，不改写偏好。

生成器、安装适配器、准备/备份与重启健康已实现，部分平台真实A→B通过；正式发布仍需选定产品公钥、构建/签署全部实际支持目标、上传资产和核验远端服务。当前范围见[功能说明](../development/client-update-implementation.md)。

## 2026-10-14：计划格式与生成器

签名 envelope 也可承载功能计划中的 product=com.deepseek.dsh.desktop.tauri、channel=stable、platforms 格式。publishedAt 仍为必需的有效时间。客户端先验证 payload 原始字节签名，再归一化为内部 artifacts；不得混入另一格式的 artifacts／releaseChannel，未知产品和预发布仍拒绝。

create-update-manifest.mjs 使用现有 Node crypto 和流式 SHA256／BLAKE2b 生成包签名及清单签名。输入 spec 为 schemaVersion、product、channel、version、publishedAt 和 artifacts 列表，各 artifact 包含绝对 file、target 与 url。私钥输入为 Ed25519 PKCS8 PEM，公钥为 minisign Ed packet（可带 comment／base64 文本封装），需与私钥匹配；脚本不生成或替换产品信任根。

CLI 参数：--spec、--private-key、--public-key、--key-id、--out；默认要求计划中的全部 10 个 OS／架构／安装形态目标。--allow-partial 仅用于隔离开发，并明确返回 completeMatrix=false。输出使用 CreateNew 语义，已存在文件不会被覆盖。仅生成签名不会证明输入产物在对应平台运行或已发布，CI 完整构建矩阵与分发验收仍是独立门槛。

全部 10 目标的签名回归、缺目标默认拒绝、explicit partial 标记、错误键／产品／版本／重复目标与不安全 URL 拒绝均已验证。隔离完整包也经生成器验签；单目标测试仍标记不完整矩阵。正式私钥、端点与正式Tauri/minisign交叉验证未提供，不以fixture结果宣称正式服务可用。