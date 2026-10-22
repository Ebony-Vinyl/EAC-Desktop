# ADR 0008：插件分发边界

日期：2026-09-16
状态：已接受

> **计数批注（2026-09-30，控制包 `工程控制/EAC-ISOLATION-SYNC-02`，ISO-001 初记，ISO-004 复核更新）**
>
> 本文声明的分发集合 `16 builtin / 14 recommended / 19 external = 49` 已随账本收敛
> 不再权威。经 ISO-004 收敛后，`.sync/plugin-distribution.json` 实测为
> **10 builtin / 15 recommended / 20 external = 45**：4 个插件退役（`dsh-skin-switch`、
> `dsh-plugin-manager`、`dsh-terminal`、`dsh-file-drop-eac`），且 `balance` 由
> builtin 改归 recommended、`plugin-wizard` 由 builtin 改归 external。**分发集合以账本
> `.sync/plugin-distribution.json` 为准**（`plugin-sync.mjs validate` 强校验）。
>
> **2026-10-18 更新**：`dsh-our-free-model` 由「仅 full 预置层」改归 builtin（随 Lite
> 交付），账本实测为 **11 builtin / 15 recommended / 20 external = 46**。判定依据见
> `.sync/plugins.json` 该条目的 `runtimeUpdate.allowed=false` 与 `dsh-desktop/assets/SOURCES.json#C116`。

## 背景

当前 `.sync/plugins.json` 是仓库随包资产的库存账本，覆盖 49 个插件、10 个皮肤和
1 个 SDK fixture。它描述源码如何维护及当前实际存在的资产，不能同时充当迁移后仍
保留 external 条目的生态目录。

Task 2.1 需要把 49 个现有插件划分为 16 个内置插件、14 个推荐包成员和 19 个外部
按需插件，同时避免在独立发布源、安装通道和回滚能力就绪前丢失 EAC 补丁。

## 决策

### 1. 三个轴保持正交

- `maintenanceClass` 回答源码怎样维护，继续由 `.sync/plugins.json.class` 表达。
- `distributionClass` 回答插件怎样交付，值为 `builtin`、`recommended` 或
  `external`，由 `.sync/plugin-distribution.json` 表达。
- `category/conflicts/impact` 回答插件做什么及与谁冲突，由 Task 2.2 定义。

来源类型、维护方式和功能类别都不能推导分发类别。

### 2. 分发集合固定为 16/14/19

`plugin-distribution.json` 必须完整覆盖本次固定的 49 个 plugin id，且无重复、无未知项：

- 16 个 `builtin` 随安装包交付，默认可离线恢复。
- 14 个 `recommended` 属于官方推荐包
  `dev.dsh-eac.desktop-recommended`，但不是本体资产的第二份副本。
- 19 个 `external` 通过市场、独立 `.dshpack`、GitHub 或 npm 按需安装。

皮肤、SDK fixture 和宿主融合能力不参与本次三分法。

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
仓库的 external 占位行。`.sync/plugin-inventory-history.json` 保存本次 49 个插件的
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
- 当前阶段不会减少安装包体积；33 个非内置插件仍保留在仓库中。
- 推荐包在 14 个成员全部拥有可验证源之前只能是草案，不能发布到市场快照。
- 后续迁移必须同时更新分发状态、inventory/lock/registry 和消费端，保留历史账本条目，
  并重新运行交叉校验。
