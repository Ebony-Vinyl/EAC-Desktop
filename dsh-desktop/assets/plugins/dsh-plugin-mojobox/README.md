# dsh-plugin-mojobox

Mojobox 官方客户端整合包管理插件（EAC 随包版）。

作为 EAC 内置随包插件，本目录只保留运行时产物：宿主导入入口
`lib/index.js`（esbuild 自包含打包，已内联 `ajv`/`semver`/`tar`/`yauzl`
运行时依赖）和浏览器侧 `lib/client.js`，配合 `cordis.patch.yml` 注册
`mojobox-manager` 行。源码与测试不在本目录整树收纳随包，见下方来源。

- **能力**：在设置的「Mojobox」入口完成整合包导入、预览、选择安装、更新核对、
  失败项重试与单组件启停/删除。
- **数据目录**：当前 Profile 的 `.mojobox-manager/`。
- **宿主兼容**：`engines.dsh >= 0.1.5-rc.1`（node `>=24.9.0`）。

## 来源

上游源码：<https://github.com/lanyun077/Mojobox-Installer> （MIT）。

随包产物取自 EAC 历史提交 `5d6edc0` 中已适配 EAC 0.2.1 的 mojobox 完整树
（含已构建 `lib/`、兼容处理 `engines.dsh >=0.1.5-rc.1`）。为满足随包自包含
要求、避免缺失 `tar`/`yauzl` 运行时依赖导致「failed to import」，宿主导入入口
`lib/index.js` 用 esbuild 重新打包（`packages: 'bundle'`），将真实 npm 依赖
内联进单一文件，与 `ds-harness-remote`/`dsh-wechat` 同法。内联依赖的第三方
许可见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

## 构建（若要重建 `lib/index.js`）

```bash
npm install        # 取得 esbuild 与运行时依赖（仅构建机）
npx esbuild src/index.ts --bundle --platform=node --format=esm \
  --target=es2023 --packages=bundle --outfile=lib/index.js
```

> 当前随包树不收纳 `src/`（构建痕迹）；如需从源码重建/审阅，检出上游或 EAC
> 历史提交中的完整树。