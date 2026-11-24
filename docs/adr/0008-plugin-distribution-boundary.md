# ADR 0008：插件分发边界

日期：2026-09-16
状态：已接受

> **唯一事实来源规则（2026-11-24 收敛更新）**
>
> 分发集合的实时条目与各层计数**唯一以账本 `.sync/plugin-distribution.json`（及 `.sync/policies.json` 中的 `pluginDistribution.expectedCounts`）为准**，由 `node dsh-desktop/scripts/plugin-sync.mjs validate` 与自动化门禁测试强校验零漂移。本 ADR 仅定义分层语义与迁移门禁，不再手写随版本演进的静态数字（早期基线与退役记录保留于 `.sync/plugin-inventory-history.json`）。

## 背景

`.sync/plugins.json` 是仓库当前随包资产的库存账本（精确对应 `dsh-desktop/assets/plugins` 下的实物目录），描述源码如何维护及当前实际随包的资产，不能同时充当物理剥离后仍保留 `external` 条目的生态目录。

因此需要将生态与配套插件按交付边界划分为 `builtin`（随包内置）、`recommended`（推荐包候选）与 `external`（外部按需安装）三层，同时避免在独立发布源、安装通道和回滚能力就绪前丢失 EAC 补丁。

## 决策

### 1. 三个轴保持正交

- `maintenanceClass` 回答源码怎样维护，继续由 `.sync/plugins.json.class` 表达。
- `distributionClass` 回答插件怎样交付，值为 `builtin`、`recommended` 或
  `external`，由 `.sync/plugin-distribution.json` 表达。
- `category/conflicts/impact` 回答插件做什么及与谁冲突，由冲突审计定义。

来源类型、维护方式和功能类别都不能推导分发类别。

### 2. 分发集合以账本为唯一事实源

`.sync/plugin-distribution.json` 必须完整覆盖所有受管 plugin id，且无重复、无未知项，计数与 `.sync/policies.json` 的 `expectedCounts` 严格一致：

- `builtin`：随安装包交付，默认启用且核心锁定、可离线恢复。
- `recommended`：归属官方推荐包候选集 `dev.dsh-eac.desktop-recommended`（与该草案的 `x-eac.intendedPluginIds` 严格一致），不是本体资产的第二份副本。
- `external`：通过市场、独立 `.dshpack`、GitHub 或 npm 按需安装，首次引入默认禁用。

皮肤、SDK fixture 和宿主融合能力不参与该三分法。

### 3. 推荐包只引用独立发布源

推荐包成员未来必须使用精确 npm 版本或 GitHub 40 位 commit，并校验归档
SHA-256。推荐包禁止使用 `builtin:` 或 `latest`，也不得在首次启动时无提示联网
下载。

在真实发布源、版本和 integrity 尚未核实时，账本保持
`migration.state=source-pending`，不得填写猜测值。

### 4. 删除前设置硬门禁

任一 recommended/external 插件只有同时满足以下条件，才可从仓库资产和安装包移除：

1. 有不可变 npm/GitHub 源及归档 SHA-256。
2. EAC patch 已由 EAC 可控源发布，或有证据证明上游已吸收。
3. 发布物包含运行、manifest、Cordis patch 与许可证所需文件，离线 inspect 可验证。
4. 在隔离 profile 中通过安装、启动、停用、升级、卸载和回滚。
5. 不携带第二份 `@deepseek-ai/*` 内核依赖。
6. Task 4/5 安装入口可用，`unified-market` 与恢复链仍为 builtin。
7. 旧用户的启停与已安装状态可迁移。
8. 平台插件有 Windows/macOS/Linux 支持矩阵及 unavailable 行为。

缺少任一证据时保持 `source-pending` 和仓库副本，不得把目标分类当成删除许可。

### 5. 账本职责与交叉校验

`.sync/plugin-distribution.json` 只记录交付决策和迁移状态；来源审计继续以
`dsh-desktop/assets/SOURCES.json` 为事实源，许可证继续由现有 inventory 与本地
`package.json` 校验。validator 通过资产路径连接两份账本，避免复制审计结论。

`.sync/plugins.json` 在物理迁移发生前继续精确对应资产目录；不得向其中加入已经不在
仓库的 external 占位行。`.sync/plugin-inventory-history.json` 保存全部受管与已退役插件的
稳定 `id/path/patched` 基线；资产移出当前 inventory 后不得删除对应历史行。validator
要求每个 distribution id 存在于历史账本且历史路径能唯一连接 `SOURCES.json`，并要求
当前 inventory 覆盖所有尚未迁移的条目。只有 `migration.state=migrated/retired` 且
`migration.current` 已不是 `bundled` 的条目可以仅由历史账本接续。

### 6. 与最简本体拆分的顺序

Task 3.1 可以先剥离当前本体，但必须保留本 ADR 和分发账本作为接回事实源。Task 3.3
按 builtin 集合接回最简本体；Task 4/4.1 消费推荐包；Task 5/5.1 提供外部安装和标准
加载接口。物理删除只在对应安装通道和上述门禁完成后分批执行。

## 后果

- 分发目标可独立演进，不污染 bundled inventory 的一一对应语义。
- 非内置插件只有在满足 §4 全部门禁后才从仓库移除；否则保持 `source-pending`。
- 推荐包在全部 `recommended` 成员拥有不可变可验证源之前保持冻结草案态（`draft`），不得发布到市场快照。
- 后续增删或迁移插件必须同步更新 `SOURCES.json`、`.sync/` 账本并重新生成 `plugins.lock.json` 与 `plugin-sync-registry.ts`，通过交叉校验门禁。
