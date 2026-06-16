---
title: "feat: 完整发帖 Workflow 收尾 — 隐藏发布 + 注册表回写 + 逐篇审读"
type: feat
status: completed
date: 2026-06-12
origin: docs/brainstorms/2026-06-12-001-complete-publish-workflow-requirements.md
---

# feat: 完整发帖 Workflow 收尾

## Overview

修复三个让「一键备稿 → 逐篇审读 → 发布隐藏帖 → 注册表回写」闭环无法跑通的缺口：

1. **postStatus 默认公开**：`llm.ts` 硬编码 `"1"`，帖子直接公开发出。
2. **published_posts 回写是死代码**：`ApproveBatchDeps.recordPost` 已在 orchestrator 实现，但 `background.ts` 从未传入。
3. **TodayBatchView 缺逐篇审读**：生成后只展示静态列表并让用户去 BatchView，R28「每篇必读才能发布」未实现。

## Problem Frame

(see origin: docs/brainstorms/2026-06-12-001-complete-publish-workflow-requirements.md)

操作者今天点「一键备稿」后，帖子直接公开发出（R1 缺），注册表永远空（R3 缺），且没有逐篇确认内容的 UI（R7-R12 缺）。三个缺口串在一起导致完整流程无法上线运营。

## Requirements Trace

- R1/R2. `llm.ts` `postStatus` 改 `"0"` + 测试更新
- R3/R4/R5/R6. `background.ts` 接线 `recordPost` → `recordPublishedPost`
- R7-R12. `TodayBatchView` 增加审读模式：状态轮询 + 逐篇展开 + 已读门控 + 单条发布

## Scope Boundaries

- **不含** `/healthz` 路由挂载（次要，独立 PR）
- **不含** postStatus UI 下拉改造
- **不含** `chrome.alarms` 定时触发
- **draftOverrides 跨 SW kill 不持久化**（已知限制，接受）

## Context & Research

### Relevant Code and Patterns

- `packages/backend/src/llm.ts:152` — 硬编码 `postStatus: "1"`
- `packages/backend/src/llm.test.ts:186,473` — 期望 `"1"` 需同步改
- `packages/extension/lib/batch-orchestrator.ts` — `ApproveBatchDeps.recordPost?` 已定义，`writeConfirmed` 内已调用（`r.url` 作为 `publishUrl`），**只差 background.ts 注入**
- `packages/extension/lib/published-posts-client.ts` — `recordPublishedPost(record: PublishedPostRecord)` 完整实现，已有 best-effort 错误吞噬
- `packages/extension/entrypoints/background.ts:273` — `handleApproveBatch` 调用 `approveBatch({...})`，**缺 `recordPost` 字段**；`recordPublishedPost` 未被 import
- `packages/extension/lib/read-tracker.ts` — `markItemRead / isItemRead / getReadItems / clearReadItems` **全部实现**，用 WXT `storage` 持久化
- `packages/extension/entrypoints/background.ts:221` — `clearReadItems()` 在 `handleRunBatch` 中已调用（新批次时重置）
- `packages/extension/lib/messaging.ts` — `approveBatch` 发 `APPROVE_BATCH` 消息；单条发布需新增 `APPROVE_SINGLE_ITEM` 类型
- `packages/extension/lib/batch-orchestrator.ts` — `approveBatch(deps)` 的 for 循环仅处理 `status === "awaiting-approval"` 的 item，加 `itemIdFilter?` 字段即可实现单条过滤
- `packages/extension/entrypoints/sidepanel/BatchView.tsx` — 审批 UI 模式参考：`approveBatch` 调用 + `withBusy` + 状态 refresh 轮询

### Institutional Learnings

- SW 30s idle timeout：生成耗时长，`chrome.alarms` 已注册；审读 UI 中的轮询间隔应合理（1-2s）以避免 SW 过早回收
- tab 定位：`resolveAdminTabId()` 全窗口匹配，不用 active-tab query
- RunBatchDeps / ApproveBatchDeps 注入模式：business logic 在 `lib/`，background.ts 只做 deps 构造（< 25 行接线原则）

### External References

- 无需外部研究，本地模式已完备

## Key Technical Decisions

- **`recordPost` 接线在 background.ts 而非 orchestrator 改**：orchestrator 已正确实现，只需在 background.ts 的 `approveBatch({...})` 中补 `recordPost: recordPublishedPost`，最小变更，不改 orchestrator 逻辑（see origin R3）
- **`itemIdFilter?` 扩展 `ApproveBatchDeps`**：单条发布的最小侵入方式——在 `approveBatch` for 循环头部加 `if (deps.itemIdFilter && item.id !== deps.itemIdFilter) continue`，向后兼容，现有测试不受影响（see origin 「Deferred to Planning」R10）
- **新消息类型 `APPROVE_SINGLE_ITEM`**：不复用 `APPROVE_BATCH`，语义更清晰；timeout 与 APPROVE_BATCH 一致（300s）；background handler 内构造与 handleApproveBatch 相同的 deps + itemIdFilter
- **TodayBatchView 两阶段 UI**：Phase 1「备稿中」（runBatch 进行时）→ Phase 2「审读队列」（runBatch 结束后轮询 GET_BATCH 展示真实状态）；不新增 React 路由，用 `stage` state 切换
- **read-tracker 已就绪**：`markItemRead / isItemRead / getReadItems` 直接用，不需要新实现

## Open Questions

### Resolved During Planning

- **`recordPost` 的 `url` 字段**：`batch-orchestrator.ts` 的 `writeConfirmed` 内已有 `r.url`（`PublishResult.url`），传给 `recordPost` 时 `publishUrl: r.url ?? ""`，无需 BatchItem 另存 url 字段
- **单条 approve 方式**：新增 `APPROVE_SINGLE_ITEM` 消息 + `ApproveBatchDeps.itemIdFilter?` 过滤，向后兼容，最小改动

### Deferred to Implementation

- `TodayBatchView` 轮询 GET_BATCH 的间隔与停止条件：`isTerminalAll`（所有 item 终态）或用户离开视图时停止，具体 ms 数在实现时根据体验微调

## Implementation Units

- [x] **Unit 1: postStatus 默认改 "0"**

**Goal:** LLM 生成的草稿默认以「隐藏」状态发布

**Requirements:** R1, R2

**Dependencies:** 无

**Files:**
- Modify: `packages/backend/src/llm.ts`（单行 `"1"` → `"0"`）
- Test: `packages/backend/src/llm.test.ts`（更新两处期望值 `"1"` → `"0"`）

**Approach:**
- `llm.ts:152` 的 `postStatus: "1"` 改为 `"0"`
- `llm.test.ts:186` 注释说「非 AI 默认值」，改期望值并更新注释

**Patterns to follow:**
- `packages/backend/src/llm.ts` 中的 assemblePost 函数结构

**Test scenarios:**
- Happy path: `buildDraft(...)` 返回的草稿 `postStatus === "0"`
- 现有两个测试用例期望值更新即可，不需要新增

**Verification:**
- `pnpm --filter @51publisher/backend test` 全绿

---

- [x] **Unit 2: published_posts 回写接线**

**Goal:** `handleApproveBatch` 在 `publish-confirmed` 后调用 `recordPublishedPost` 写入注册表

**Requirements:** R3, R4, R5, R6

**Dependencies:** Unit 1（无硬依赖，但逻辑上属同一 PR）

**Files:**
- Modify: `packages/extension/entrypoints/background.ts`（import + 1 行接线；`BackgroundHandlerDeps` 接口加 `recordPost?: typeof recordPublishedPost`）
- Test: `packages/extension/lib/batch-orchestrator.test.ts`（验证 recordPost 已有 U10 测试，检查覆盖是否需补 background 层集成场景）

**Approach:**
- 在 `background.ts` imports 中加 `import { recordPublishedPost } from "../lib/published-posts-client"`
- `BackgroundHandlerDeps` 接口加 `recordPost?: (r: PublishedPostRecord) => Promise<void>` 字段，方便测试 mock
- 在 `handleApproveBatch` 的 `approveBatch({...})` 调用中增加：`recordPost: deps.recordPost ?? recordPublishedPost,`
- 不需要改 orchestrator（recordPost 的 best-effort catch 已在 orchestrator 内）
- **职责边界**：`addPublishedTopics`（已有）负责去重/避免重选题；`recordPublishedPost`（新加）负责发布历史归档。两者均 best-effort，互不依赖，一方失败不影响另一方

**Patterns to follow:**
- `addPublishedTopics` 的 best-effort 调用模式（`background.ts:324`）
- `batch-orchestrator.test.ts` 的 U10 describe block（`approveBatch recordPost`）

**Test scenarios:**
- Integration: `handleApproveBatch` 触发后，`recordPublishedPost` 被调用一次，入参含正确 `batchItemId`/`sourceTitle`/`publishUrl`
- Error path: `recordPublishedPost` 抛出时不影响 `approveBatch` 返回值（已由 orchestrator 保证，验证即可）
- Edge case: `publishUrl` 为空时 `publishUrl` 字段 = `""` 而非 `undefined`

**Verification:**
- `pnpm --filter publisher-fill-assistant test` 绿；`published_posts` 相关测试通过

---

- [x] **Unit 3: ApproveSingleItem — orchestrator 扩展 + 消息接线**

**Goal:** 让 TodayBatchView 能对单条 `awaiting-approval` 草稿发起 approve-fill-publish，而不触碰其余条目

**Requirements:** R10

**Dependencies:** Unit 2（需要相同的 `recordPost` 接线）

**Files:**
- Modify: `packages/extension/lib/batch-orchestrator.ts`（`ApproveBatchDeps` 加 `itemIdFilter?`，for 循环加过滤）
- Modify: `packages/extension/lib/messaging.ts`（新增 `approveSingleItem(tabId, itemId)` 导出函数，发 `APPROVE_SINGLE_ITEM` 消息）
- Modify: `packages/shared/src/types.ts`（`RuntimeMessage` union 加 `{ type: "APPROVE_SINGLE_ITEM"; tabId: number; itemId: string }`）
- Modify: `packages/extension/lib/messaging.ts`（`SW_TIMEOUT` 加 `APPROVE_SINGLE_ITEM: 300_000`；新增 `approveSingleItem(tabId, itemId)` 导出函数）
- Modify: `packages/extension/entrypoints/background.ts`（message router 加 `APPROVE_SINGLE_ITEM` 分支，调新 handler `handleApproveSingleItem`）
- Test: `packages/extension/lib/batch-orchestrator.test.ts`

**Approach:**
- `ApproveBatchDeps` 新增可选字段 `itemIdFilter?: string`
- `approveBatch` for 循环头部：`if (deps.itemIdFilter && item.id !== deps.itemIdFilter) continue`
- `background.ts` 新增 `handleApproveSingleItem(tabId: number, itemId: string)`，**内联构造 deps**（不调用 handleApproveBatch），与 handleApproveBatch 共享模式但独立签名，避免签名变化连锁影响
- handler 入口校验：`if (typeof tabId !== "number" || typeof itemId !== "string" || !itemId) return`
- `messaging.ts` 新增 `approveSingleItem(tabId, itemId)` 辅助函数，设 300s timeout（在 `SW_TIMEOUT` 表中登记）

**Technical design:**
> 此为方向性示意，非实现规范。

```
// batch-orchestrator.ts (ApproveBatchDeps 扩展)
itemIdFilter?: string  // 存在时只处理匹配 id 的 item

// approveBatch for-loop 头部
if (deps.itemIdFilter && item.id !== deps.itemIdFilter) continue;

// background.ts 新 handler
handleApproveSingleItem(tabId, itemId) {
  return handleApproveBatch(tabId, undefined, itemId)
  // 或内联构造 deps，与 handleApproveBatch 共享逻辑
}
```

**Patterns to follow:**
- `handleApproveBatch` 在 `background.ts` 的构造模式
- `approveBatch` 函数在 `messaging.ts` 中的发消息模式

**Test scenarios:**
- Happy path: `approveBatch({ itemIdFilter: "item-2", ... })` 只处理 id=item-2，其余 awaiting-approval 保持状态不变
- Edge case: `itemIdFilter` 指向不存在 id → batch 无变化，函数正常返回
- Integration: itemIdFilter 与 recordPost 同时传入时，publish-confirmed 后 recordPost 仅被调用一次（对应过滤的那条）
- Backward compat: `itemIdFilter` 为 `undefined` 时行为与原 `approveBatch` 完全一致

**Verification:**
- `batch-orchestrator.test.ts` 中 `itemIdFilter` 相关新 describe block 全绿
- 原有 approveBatch 测试无退化

---

- [x] **Unit 4: TodayBatchView 审读 UI 重写**

**Goal:** 生成完成后切换到「审读队列」模式，每条草稿需展开预览后才能点「发布」

**Requirements:** R7, R8, R9, R10, R11, R12

**Dependencies:** Unit 3（`approveSingleItem` 需先可用）

**Files:**
- Modify: `packages/extension/entrypoints/sidepanel/TodayBatchView.tsx`（全面扩展，保留现有 Phase 1 备稿触发逻辑）

**Approach:**

两阶段 UI，用 `stage: "generating" | "review"` state 切换：

**Phase 1「备稿中」（现有逻辑扩展）**
- 展示「一键备稿」按钮
- `runBatch` 返回后**保存返回的 `batchId`** 进 state，切换到 Phase 2
- `runBatch` 进行中：每 2s 调一次 `getBatch(batchId)` 轮询，展示「生成中 X/N」进度（X = 非 queued 状态的 item 数）
- `runBatch` 抛出：`setError(...)` 并留在 Phase 1（不切到 Phase 2），使按钮恢复可点击

**Phase 2「审读队列」**
- `useEffect` 轮询 `getBatch(batchId)`（`GET_BATCH` 消息），间隔 ~1500ms，所有 item 终态后停止轮询
- 进入 Phase 2 时 `setPublishingItems(new Set())`（清除上批次乐观锁状态）
- 展示批次所有 item，按状态分区：
  - `filled` / `awaiting-approval`：审读就绪，可展开预览
  - `gate-failed`：内容问题 + 「重新生成」按钮（`retryBatchItemMsg`）；retry 后轮询自动感知新状态
  - `publish-confirmed`：已发布（绿色）
  - `error` / `aborted`：显示原因，无操作按钮
- 每条 `filled`/`awaiting-approval` 草稿：
  - `<details>` 折叠区展示 `title` / `subtitle` / `body`（**前 200 字 + 「查看全文」展开链接**，点击展开后 body 显示完整内容）
  - `onToggle` 时调 `markItemRead(item.id)`（触发即记为已读，不要求看完全文，语义=「知情确认」）
  - 「发布」按钮：`isRead` 为 `false` 时 `disabled`；处于 `publishingItems` 中时也 `disabled`
  - 每条旁边提供「公开/隐藏」切换（默认「隐藏」，对应 `postStatus: "0"`），点发布时携带覆盖值
  - 点「发布」→ 加入 `publishingItems`（乐观锁）→ `approveSingleItem(tabId, item.id, { postStatus })` → 刷新 batch 状态
- 初始化时 `getReadItems()` 加载已读集合进 React state（`Set<string>`）
- `markItemRead` 后同步更新 React state（避免等待下轮轮询才解锁按钮）

**Patterns to follow:**
- `BatchView.tsx` 的 `withBusy` + `refresh` 模式
- `read-tracker.ts` 的 `markItemRead / getReadItems` API
- `BatchView.tsx` 的条目状态颜色与标签常量（可直接复用 `STATUS_LABEL` / `STATUS_COLOR`）

**Test scenarios:**
- Happy path: `stage === "review"` 时 batch 含 1 条 `awaiting-approval` item → 折叠区存在 + 「发布」按钮 disabled
- Happy path: 用户展开折叠区（`<details>` onToggle）→ `markItemRead(item.id)` 被调用 → 「发布」按钮 enabled
- Happy path: 点「发布」→ `approveSingleItem` 被调用 → item 进入 `publishingItems` → 发布按钮即时 disabled（乐观锁）→ 轮询后 item.status = `publish-confirmed`
- Phase 1 进度: runBatch 执行中 → 每 2s 轮询 → 展示「生成中 X/N」文字
- Phase 1 失败: runBatch 抛出 → 显示错误信息 → 停留在 Phase 1 → 按钮恢复可点击
- Race guard: 同一 item 在 `publishingItems` 中时重复点击无效（按钮已 disabled）
- postStatus 覆盖: 切换为「公开」→ 点发布 → `approveSingleItem` 携带 `postStatus: "1"`
- retry 流程: gate-failed item 点「重新生成」→ retryBatchItemMsg 调用 → 轮询自动感知新 status
- Edge case: `gate-failed` item → 展示 `gateFailReason` + 「重新生成」按钮，无「发布」按钮
- Edge case: `publish-dispatched` item（刚开始发布但 SW 还在）→ 按钮 disabled，轮询持续
- Edge case: SW kill 后重新打开 TodayBatchView → `getReadItems()` 恢复已读 Set，已展开的 item 发布按钮 enabled
- Edge case: 所有 item 终态（publish-confirmed/error/gate-failed/aborted）→ 轮询停止，显示「批次完成」提示
- Phase 2 重置: 再次点「一键备稿」切回 Phase 1 → `publishingItems` 清空

**Verification:**
- 手动冒烟：一键备稿 → 等待生成 → 进入审读列表 → 折叠/展开 → 发布按钮从 disabled 到 enabled → 点发布 → 状态变 publish-confirmed
- `pnpm compile` 类型检查通过

## System-Wide Impact

- **Interaction graph:** `APPROVE_SINGLE_ITEM` 新消息类型需同步在 `shared/src/types.ts` 的 `RuntimeMessage` union 中注册；`SW_TIMEOUT` 表需加对应超时
- **Error propagation:** `recordPublishedPost` 在 orchestrator 内已 best-effort catch，background.ts 层无需额外错误处理
- **State lifecycle risks:** `readItems` 持久化在 `chrome.storage.local`，`clearReadItems` 在 `handleRunBatch` 时已重置；新批次开始时旧的 read 状态被清空，不污染下次备稿
- **Tombstone 并发**：`writeTombstone`/`clearTombstone` 以 itemId 为 key；若 APPROVE_BATCH（全量）与 APPROVE_SINGLE_ITEM（单条）同时对同一 item 运行，tombstone 可能提前清除导致崩溃恢复失效。缓解：TodayBatchView 不提供「全量审批」按钮；BatchView 不提供单条 approveSingleItem；两视图不应同时触发批次，文档注明此限制
- **重复发布竞态**：`approveBatch` 无内置互斥锁。两个并发调用读到相同批次状态会重复发布同一 item。缓解：TodayBatchView 在点「发布」后立即将该 item 加入 `publishingItems: Set<string>` React state（乐观锁），并在此状态下 disable 发布按钮；orchestrator 已有 `markDispatched`（→ `publish-dispatched`），轮询稳定后也会 disable
- **in-flight 状态窗口**：点「发布」到 `markDispatched` 写入之间约 100-500ms，轮询尚未收到 `publish-dispatched`，发布按钮仍可点击。缓解：同上 `publishingItems` 乐观锁，点击即时 disable
- **draftOverrides scope**：`handleApproveSingleItem` 不传 `draftOverrides`（TodayBatchView 不提供草稿编辑），无跨 item 覆盖风险
- **Unchanged invariants:** 现有 `APPROVE_BATCH` 消息类型和 `BatchView` 行为完全不变；`itemIdFilter` 为可选字段，undefined 时行为与现在一致

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `APPROVE_SINGLE_ITEM` 超时：单条 fill+publish 在 30s 内完成，但保守设 300s | 与 APPROVE_BATCH 对齐，充分裕度 |
| TodayBatchView 轮询频率影响 SW idle：1500ms 间隔比 SW 30s 超时短，轮询本身会保持 SW 活跃 | 轮询在所有 item 终态后停止，不无限 ping |
| `postStatus "0"` 改变已有操作者工作流（有人依赖默认公开）| `DraftPreview` 的「状态」字段仍可人工改为 `"1"` 覆盖；需在 `docs/install-and-usage.md` 注明默认值变更 |

## Documentation / Operational Notes

- `docs/install-and-usage.md` 补注：草稿默认以「隐藏（0）」发布，如需公开发布请在草稿预览的「状态」字段改为 `"1"`

## Sources & References

- **Origin document:** [docs/brainstorms/2026-06-12-001-complete-publish-workflow-requirements.md](docs/brainstorms/2026-06-12-001-complete-publish-workflow-requirements.md)
- Related code: `packages/extension/lib/batch-orchestrator.ts` (`ApproveBatchDeps`, `approveBatch`)
- Related code: `packages/extension/lib/read-tracker.ts` (`markItemRead`, `getReadItems`)
- Related code: `packages/extension/lib/published-posts-client.ts` (`recordPublishedPost`)
- Related plan: `docs/plans/2026-06-11-003-feat-phase5-daily-batch-review-plan.md` (Phase 5 原始设计)
