# vendor/channel-pack — 上游免费渠道包的来源与再构建

本目录是 **[dsh-codearts-auth](https://gitee.com/iJetLi/deepseek-harness-codearts)**
的完整拷贝，由 `dsh-our-free-model` 的 Host 半身在独立 fiber 上挂载，
使 CodeArts、CodeBuddy、WorkBuddy、LobsterAI、Qoder、Qoder 中国版、TRAE、
Cline、Loomy、Raccoon、MiniMax Code、ZCode、Gemini 这十三个账号渠道的
登录流程、账号池、积分领取、模型黑名单与本地 OpenAI 网关可用。OFM 挂载时关闭上游 OpenCode 账号接入，原有匿名免费车道保持独立。
目录名与内部标识符在本插件的再构建中统一改为 channel-pack；出处与许可证不变。

- 上游仓库：`https://gitee.com/iJetLi/deepseek-harness-codearts`
- 吸收的提交：`345f0a07b22713c0ae189ca7d8b97ec4f64626c6`（2026-10-06）
- 许可证：MIT（见 `LICENSE`，与上游一致）

## 目录内容

| 路径 | 说明 |
| --- | --- |
| `src/` | 上游 TypeScript 源码，包含下述 OFM 本地适配（便于审计与再构建） |
| `pack.js` | **插件运行时实际加载的代码**：直接由 `src/` 经 `scripts/build-channel-pack.mjs` 打包成单文件（jose/undici 内联，`@deepseek-ai/*` 保持外部），使发布清单不超文件上限 |
| `qoder-auth-wasm.wasm` | Qoder 加密推理所需的 WASM，必须与 `pack.js` 同目录（`pack.js` 按 `import.meta.url` 定位它） |
| `locale/` | 上游文案 |
| `scripts/`、`tsconfig.json`、`package.json` | 再构建所需的元数据（`lib/` 与 `node_modules/` 不入库，按下面步骤重建） |

宿主提供的依赖（`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-credentials`、
`@deepseek-ai/cordis`、`@deepseek-ai/schemastery`）不在此目录，按 Node 解析规则
从安装它的 profile 的 `node_modules` 取；缺少时渠道包整体降级（`/summary.channels`
报告 `state: "failed"` 与原因），免费车道不受影响。

## 再构建

直接从受版本管理的 `src/` 打包，不使用未入库的 `lib/`：

```bash
# 在仓库外准备构建依赖，保持插件零运行依赖
npm install --prefix /tmp/ofm-channel-build --no-package-lock --ignore-scripts esbuild@0.24.2 jose@6.2.9 undici@8.11.2
mkdir -p vendor/channel-pack/node_modules
cp -R /tmp/ofm-channel-build/node_modules/jose /tmp/ofm-channel-build/node_modules/undici vendor/channel-pack/node_modules/
OFM_ESBUILD_DIR=/tmp/ofm-channel-build npm run channel-pack
# qoder-auth-wasm.wasm 沿用上游已有文件，须与 pack.js 同目录
# 清理本次创建的构建依赖；这些目录不入库、不随插件发布
rm -rf vendor/channel-pack/node_modules
```

## OFM 本地适配

- `src/index.ts`：增加可选 `disableOpencode` 挂载配置；OFM 开启它时跳过重复 OpenCode adapter、默认匿名账号和能力表预热，保留历史账号及凭据。省略时维持上游行为。
- `src/channel-pack-rpc.ts`：追加同一配置，关闭时拒绝 `opencode.*` 与通用 `account.create(provider=opencode)`。
- 打包入口改为 `src/index.ts`；宿主模块仍保持外部，jose/undici 内联。
- 构建依赖固定为 esbuild 0.24.2、jose 6.2.9、undici 8.11.2；本次重构建核对了原包的依赖代码，未借此升级运行依赖。

本目录**不含**上游的浏览器半身（`plugin-src/client`）与其设置页——
界面由 `dsh-our-free-model` 自己的三页界面取代，渠道操作经上游的
`/api/channel-pack` RPC 完成（`connection.rpc.call('/api', 'channel-pack', { method, payload })`）。
