# 贡献规范

本仓库通过任务分支和 Pull Request 协作，`main` 不作为直接开发分支。

## 开始任务

1. 获取最新远程引用：`git fetch origin`。
2. 从 `origin/main` 创建语义化任务分支。
3. 检查并保留工作区已有修改。
4. 使用 `.agents/skills/deepseek-harness-eac-dev` 判断架构归属、影响范围和最低验证级别。

推荐分支前缀：

```text
feat/
fix/
refactor/
test/
docs/
chore/
release/
codex/
```

## 提交

采用 Conventional Commits：

```text
<type>(<scope>): <简短说明>
```

提交前检查：

```powershell
git status --short --branch
git diff --check
git diff
git diff --cached
```

未经明确授权，不提交、push、创建 PR、合并、打标签或发布。

## 验证

项目开发 Skill 位于：

```text
.agents/skills/deepseek-harness-eac-dev
```

运行 Skill 自检：

```powershell
pwsh -NoProfile -File .\.agents\skills\deepseek-harness-eac-dev\scripts\validate-skill.ps1 `
  -SkillPath .\.agents\skills\deepseek-harness-eac-dev `
  -RepoPath .
```

Windows PowerShell 5.1：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\.agents\skills\deepseek-harness-eac-dev\scripts\validate-skill.ps1 `
  -SkillPath .\.agents\skills\deepseek-harness-eac-dev `
  -RepoPath .
```

功能修改还必须运行 Skill 分类器给出的最低验证集。无法执行的验证必须说明环境阻断和残余风险。

## 依赖补丁

不得任意修改 `node_modules`。项目批准的依赖补丁必须同时维护：

- `dsh-desktop/scripts/patch-deps.js`
- 受控 vendored 文件
- `tauri-shell/stage-resources.mjs` 的 staging 重放或覆盖逻辑

发布只使用 `.github/workflows/release-tauri.yml`。`.github/workflows/release.yml` 保留为禁用的 Electron 历史记录。

## 发布

发布由仓库维护者在本地完成，流程固定为：构建 → 校验 → 提交 → 打标签 → 上传产物。

### 每个 Release 必须包含启动器安装包

**所有新发布的 Release 都必须附带 EAC 启动器的 Windows x64 安装包**，无论该版本的主体改动是桌面端、内核还是插件。启动器与桌面端分别构建，但共享同一个 Releases 页面，用户不应为了拿到启动器而翻找历史版本。

每个 Release 的附件至少包含：

| 文件 | 说明 |
| --- | --- |
| `EAC-Launcher-<version>-x64-setup.exe` | NSIS 安装器，启动器唯一推荐入口 |
| `EAC-Launcher-<version>-x64-portable.exe` | 免安装便携版 |
| `SHA256SUMS.txt` | 上述文件的 SHA-256 校验和 |

启动器产物在 `launcher/` 下构建，产物目录 `launcher/artifacts/` 已被忽略，只作为 Release 附件分发：

```powershell
cd launcher
npm ci
npm run runtime:prepare
npm run tauri:build
```

安装包输出在 `src-tauri/target/release/bundle/nsis/`，连同 `eac-launcher.exe` 一并上传。构建后先实际运行一次产物确认窗口可渲染，再上传。

### Latest 标记

GitHub 只允许把**正式 Release**（非 prerelease、非 draft）标记为 Latest，预发布版本无法设置。因此：

- 启动器正式版发布后，若希望它出现在仓库首页下载位，用 `gh release edit <tag> --prerelease=false --latest` 转为正式版并设为 Latest。
- 这会取代原 Latest（桌面端旧版本）。确认这是本次发布的意图后再执行。
- 纯预览性质的构建请保留 `--prerelease`，并接受它无法成为 Latest。

### 校验与验收

上传后重新下载附件并核对校验和，确认运输无损：

```powershell
gh release download <tag> --dir check
cd check
sha256sum -c SHA256SUMS.txt
```

发布说明需写明：本次包含哪些平台产物、是否已签名、以及当前按计划关闭的功能（如 GitHub 登录）。不要声称未实际验证的能力。
