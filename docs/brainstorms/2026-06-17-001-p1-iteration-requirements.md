---
date: 2026-06-17
topic: p1-iteration-metrics-ci-dashboard
---

# P1 迭代三件套：metrics 接线 + 度量面板

> ⚠️ **部分过时（2026-06-17 freshness 核对）**：本 brainstorm 早于 v0.1 拆除发布机器。R9/R10 引用的 `trajectory`（hasManualEdit / llmCostTokens / gossipFetchSuccess / TrajectoryRecord）已随 `lib/trajectory.ts` 删除，**不再可用**。后续 plan（`docs/plans/2026-06-17-001-feat-metrics-wiring-and-panel-plan.md`）已据此修正：度量视图改为只用 Prometheus（recordScraperRun/recordDraft）+ ExtensionCounters(batchesCompleted)，不读 trajectory。**以 plan 为准。**

## Problem Frame

v0.2.1.0 落地后，两个 P1 缺口阻止运营者感知发布质量：

1. **backend counters 未接线**：`recordDraft()` 已定义但 gossip-routes.ts 未调用，`/api/v1/metrics` 的草稿生成计数永远为 0。发布尝试与批次完成的计数器（`recordPublishAttempt` / `recordBatchCompleted`）因真实流程在扩展端 background.ts，需改为由扩展端 storage 自行维护，不可经后端接线。

2. **度量面板 UI 缺失**：trajectory 数据（slotDiff / hasManualEdit / llmCostTokens）已在 chrome.storage.local 中存储，但 sidepanel 没有可视化入口；运营者无法回顾发布质量。

> **已确认不需要做的事（评审后修正）：** CI 已有完整的 pnpm audit（verify job）+ dependency-review job，B 区块（R5-R7）前提错误，已删除。

## Requirements

**A. Backend Counter 接线（gossip-routes）**

- R1. `packages/backend/src/routes/gossip-routes.ts` POST `/gossip/topics/from-url` 成功/失败路径分别调用 `recordDraft(true)` / `recordDraft(false)`；语义为「内容抓取成功/失败次数」
- R2. `packages/backend/src/services/metrics.ts` 的 `recordDraft` 函数注释更新，明确语义为事实提取（gossip fetch），与 LLM 草稿生成区分
- R3. `metrics.test.ts` 中「直接通过 HTTP `/api/v1/metrics` 断言 draftsGenerated 非零」测试补全（现有测试仅断言内存对象，未经 HTTP 路由验证）

**B. 扩展端计数器（发布 + 批次）**

- R4. 扩展端新增轻量 storage key：`local:extensionCounters`，类型 `{ publishAttempts: { success: number; failed: number }; batchesCompleted: number }`
- R5. `background.ts` 中发布流程成功/失败分支分别递增 `publishAttempts.success` / `publishAttempts.failed`
- R6. `background.ts` 中批次完成（handleRunBatch 成功退出）时递增 `batchesCompleted`
- R7. 计数器不做持久化到后端；重启后从 chrome.storage.local 读取（跨会话持久）

**C. 度量面板 UI**

- R8. sidepanel 新增「度量」视图入口，与现有 workflow-card 导航一致（App.tsx view 类型扩展为 `'metrics'`，不是 tab bar 组件）
- R9. 度量视图展示以下数据，数据来源为 `chrome.storage.local`：
  - 手动编辑率：trajectory 中 `hasManualEdit === true` 的比例（最近 30 次）
  - Token 用量：trajectory 中 `llmCostTokens` 累计（最近 30 次）
  - 内容抓取成功率：`local:extensionCounters` 中 `publishAttempts.success / (success + failed)`
  - 草稿生成成功率：后端 `/api/v1/metrics` 的 `draftsGenerated / (draftsGenerated + draftsFailed)`（需后端可用）
- R10. 新增 `gossipFetchSuccess: boolean` 字段到 `TrajectoryRecord`（`lib/trajectory.ts`），由 gossip-routes 返回后扩展端写入 trajectory 条目，用于度量视图的内容抓取成功率展示
- R11. 无数据时显示空态「暂无发布记录」，不崩溃；后端不可用时 draftsGenerated 卡片显示「后端离线」
- R12. 度量视图有组件测试，覆盖：空态 + 有数据 + 后端离线三条路径

## Success Criteria

- `pnpm -r compile` + `pnpm test` 全绿
- 手动触发一次内容抓取后，`GET /api/v1/metrics` 返回 `draftsGenerated >= 1`（不再全 0）
- sidepanel 有可点击的「度量」视图入口，展示手动编辑率 + token 用量
- 一次发布动作后，`local:extensionCounters.publishAttempts.success >= 1`

## Scope Boundaries

- **不做**：CI 依赖扫描（已有 `pnpm audit --prod --audit-level=high` + `dependency-review` job）
- **不做**：recordPublishAttempt / recordBatchCompleted 在后端接线（真实流程在扩展端，跨进程无法直接调用）
- **不做**：图表库（CSS 数字卡片 + 进度条，零新依赖）
- **不做**：度量数据实时推送（每次打开视图读一次）
- **不做**：DegradeStats / UsageStats / FillStats 新类型（现有 trajectory 字段已够用）

## Key Decisions

- **counters 分两套**：后端 in-memory counters 接 gossip-routes（事实提取），扩展端 chrome.storage.local 维护发布 + 批次计数。两套数据在度量视图聚合展示。
- **recordDraft 语义 = 事实提取**：gossip-routes.ts 的职责是 content fetch，recordDraft(true/false) 语义接受为「内容抓取成功/失败」，不等于 LLM 草稿生成。
- **度量视图用 view-switch 不用 tab bar**：App.tsx 现有模式是 `useState<'main'|'settings'|...>` + workflow-card 导航，新增 `'metrics'` view，不引入 Tab 组件。
- **trajectory 仅加一个新字段**：`gossipFetchSuccess: boolean`，足以支撑内容抓取成功率展示，不定义 DegradeStats 等新聚合类型。

## Dependencies / Assumptions

- R10（gossipFetchSuccess 写入 trajectory）依赖 gossip-routes R1 接线，且扩展端需在处理后端响应时将结果写入 trajectory 条目
- 假设 `lib/trajectory.ts` 的 `TrajectoryRecord` 类型可扩展字段（在 `@51guapi/shared` 中或直接在 lib/）
- 假设 background.ts 中 handleRunBatch 有明确的成功退出点可接 R6

## Outstanding Questions

### Deferred to Planning

- [Affects R10][Technical] gossip-routes 返回后，扩展端写 trajectory 的时机：是在 `background.ts` GENERATE_DRAFT handler 内还是 gossip-client 层？需确认调用链
- [Affects R9][Technical] `draftsGenerated / draftsFailed` 从后端 `/api/v1/metrics` 读取时，R1 的 metrics 计数器在多少请求后才有统计意义（后端重启归零，度量视图需说明此限制）

## Next Steps

→ `/ce:plan` for structured implementation planning
