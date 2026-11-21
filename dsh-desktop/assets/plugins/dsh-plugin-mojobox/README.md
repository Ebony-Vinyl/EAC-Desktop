# Mojobox 整合包管理（EAC 随包版）

在「设置 → Mojobox」浏览功能包和外观包，或导入本地 `.dshpack`／ZIP；预览后选择组件安装或更新，查看进度、重试失败项、保存脱敏日志，以及启停／删除单个组件。

目录来自 <https://mojobox.cn>，整合包来自主仓 GitHub Releases，组件由宿主配置的 npm 注册表提供。投稿者、下载量与热度后台加载，展示数据失败不阻断目录和安装。

- 包版本：`0.0.1-p3.1`。
- 源码：[Mojobox-Installer@26d775a](https://github.com/lanyun077/Mojobox-Installer/tree/26d775a3a45cebeb4841e33073f20c71c9576881)（MIT）。
- 数据目录：当前 Profile 的 `.mojobox-manager/`，保留原有安装记录和配置。
- 宿主：Node.js `>=24.9.0`；沿用上游实际接口和权限 Hook，不额外设置 DSH 版本门槛。模拟接口通过不代表所有 EAC 客户端版本已完成真实安装验收。

此副本从固定主线提交重建，包含 `v0.0.1-p3.1` 发行后的分类与兼容修复；它不是 GitHub Release 附件的原始字节。来源台账见 `assets/SOURCES.json#C122`。

## 随包布局

本目录只保留运行时与许可文件，不携带源码、测试或 `node_modules`。`lib/index.js` 内联运行依赖和 Schema，`lib/client.js` 保留上游 `window.__ModuleLoader__.load` 包装及外部 React 注入。

`cordis.patch.yml` 仍注册 `mojobox-manager`，由 EAC 的 companion-sync 加载。依赖与传递依赖许可见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

## 从固定源码重建

在独立构建目录执行，完成后将 `lib/index.js` 和 `lib/client.js` 同步到此目录，并核对包版本、来源台账与第三方许可：

```bash
git clone https://github.com/lanyun077/Mojobox-Installer.git
cd Mojobox-Installer
git checkout 26d775a3a45cebeb4841e33073f20c71c9576881
npm ci
npm run typecheck
npm test
npx --yes esbuild@0.28.2 src/index.ts --bundle --platform=node --format=esm \
  --target=es2023 --packages=bundle --outfile=lib/index.js \
  --banner:js='import { createRequire as __bannerCreateRequire } from "node:module"; const require = __bannerCreateRequire(import.meta.url);'
```

`createRequire` 不可省略：内联的 CommonJS 依赖需要它访问 Node.js 内置模块，否则 ESM 导入会报 `Dynamic require of "fs" is not supported`。重建后应通过复制到独立 Profile 的导入和路由测试，不能依赖开发机已有的 `node_modules`。
