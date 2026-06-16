---
title: "refactor: 编排层技术债清理(高价低风精选)"
type: refactor
status: completed
date: 2026-06-15
---

# refactor: 编排层技术债清理(高价低风精选)

## Overview

行为保持(characterization-first)地清理 extension 编排层的两处高价值、低风险技术债:
1. 合并 `background.ts` 的 `handleApproveBatch` / `handleApproveSingleItem`(两个 `ApproveBatchDeps` 字面量逐字节相同,后者是前者 + `itemIdFilter`);
2. 抽出 `handleRunBatch`/`handleRetryBatchItem` 逐字节相同的「组装 prompt」块为共享 helper。

**不加新能力、不改任何运行时行为。** 两件事是**互相独立的小 PR**(PR-1 / PR-2),各自单独可发、单独验证。

> 原列入的 ErrorCode 收敛(R4)经审查**已砍**:错误串被 sidepanel UI 按字面消费,producer-only 是半截迁移、全迁移 blast radius 过大,不达「高价低风」标准。详见 Requirements Trace / Scope Boundaries。

> 来源:2026-06-15 全面健检的 Theme C 技术债清单(经两份研究测绘 + institutional learning 收窄)。

## Problem Frame

健检发现编排层有可维护性债:approve 双 handler 60+ 行近重复、配置读取+prompt 组装在 3 处重复、错误串以裸字符串跨模块边界流动(telemetry/日志聚合困难)。这些随功能扩展会加重。但**这类大重构有前车之鉴**:`docs/plans/2026-06-09-001` 与 `2026-06-10-001` 两份「7 维度一次做」的重构计划都被 **superseded/作废**,教训是「大重构先于产品验证反让仓库更脆弱」。故本计划刻意收窄为 3 件独立小事,并**砍掉** status 枚举(11 值已是 TS union 但散在 ~120 处含大量 UI,blast radius 过大)与 HTTP client 统一基类(各 client 契约分歧大:config 用 AbortController、gossip 抛异常而其余返回哨兵、401 时机/参数顺序不一,高风险低收益)。

## Requirements Trace

- R1. 合并两个 approve handler 为单一 handler + `itemIdFilter` 参数,行为对 `APPROVE_BATCH` 与 `APPROVE_SINGLE_ITEM` 两条消息路径完全不变。
- R2. 合并前先为 `handleApproveSingleItem` 补 background 层 characterization 测试(当前该路径在 background 层无测,网薄)。
- R3. 抽出 `handleRunBatch` 与 `handleRetryBatchItem` **逐字节相同**的「`buildPrompt`+`buildConstraintSuffix`(+`generateDraftFn` with facts/enrichment)」块为共享 helper,两处调用结果不变。(注:`handleGenerate` 只对**已组装好**的 prompt 加 `buildConstraintSuffix`、不调 `buildPrompt`、无 facts/enrichment——形状不同;只在「顺手不增签名复杂度」时才纳入,否则明确排除,helper 即为 2-site。)
- ~~R4. ErrorCode 收敛错误串~~ — **已砍**(用户 2026-06-15 决定)。审查证明错误串被 sidepanel UI 按字面消费,producer-only 迁移是半截、价值仅 cosmetic;全迁移(含 UI)blast radius 接近被砍的 status-enum。价值/风险不达「高价低风」标准,移出本轮(若日后要做,须含 UI consumer 全迁移)。

## Scope Boundaries

- **不做** ErrorCode 错误串收敛(原 R4,已砍;错误串被 UI 按字面消费,半截/全迁移均不达高价低风,另行立项须含 UI)。
- **不做** status union 的全局枚举化(UI ~120 处,blast radius 过大;另行评估)。
- **不做** HTTP client 统一基类(契约分歧大、收益不明;另行评估)。
- **不做** batch-orchestrator.ts 的文件拆分 / `retryItem` 退化复制去重(本轮不在精选范围;可作后续独立项)。
- **不碰** 存储层(JSON→SQLite 统一已试过并回退,别重蹈)、注入面三处、`RuntimeMessage` 消息协议、save 顺序语义(本地 PRIMARY / 后端 SECONDARY fail-closed)。
- 不加新能力、不改任何用户可见行为。
- characterization 铁律:重构不得改变现有行为;以现有测试为安全网,任一行为变更即视为 bug。

## Context & Research

### Relevant Code and Patterns

- **权威蓝本**:`docs/plans/2026-06-04-003-refactor-batch-orchestrator-plan.md` —— 当前 `batch-orchestrator.ts`(Deps 注入纯逻辑)+ `background.ts`(薄接线 factory+router)就是它的产物。须保留其 load-bearing 约束:`orchestratePublish` 在 approve 循环里逐条调用、deps 闭合当前 `batch`;接线层 <25 行、不写单测、靠 e2e 覆盖;`lib/batch.ts` 纯函数直接 import 不注入;settings/apiKey 在 deps 构造时一次性 await。
- **approve 双 handler**(`background.ts`):`handleApproveBatch`(278–341)与 `handleApproveSingleItem`(343–403);两个 `ApproveBatchDeps` 字面量(293–323 / 354–384)除以下差异外逐字节相同:`handleApproveSingleItem` 有 typeof tabId/itemId 入参守卫 + early return、不支持 `draftOverrides`、`itemIdFilter=itemId`、confirmedTopics 多一个 `it.id===itemId` 过滤、`onSnapshotDropped` 参数名 `id` vs `itemId`(纯 cosmetic)。orchestrator 的 `itemIdFilter` 已在 `batch-orchestrator.test.ts:1125–1179` 测过(single-item/nonexistent/undefined-equivalence)。
- **config-read + prompt 组装重复**:`Promise.all([deps.getSettings(), deps.getApiKey()])` 在 `handleGenerate`(163)、`handleRunBatch`(228)、`handleRetryBatchItem`(439);`buildPrompt(...)+buildConstraintSuffix(settings.recommendedTags ?? [])` 在 167–168 / 244–250 / 448–454;`generateDraftFn(prompt,{settings,apiKey,facts,enrichment})` 形状三处重复。
- **7 个自由错误/原因串**(应入 `ErrorCode`):`fill-failed`(orchestrator 366)、`grounding-blocked:` 前缀(orchestrator 340)、`operator-discarded`(485)、`blocked`(publish-orchestrator 41 / orchestrator 449 比较)、`fill-unreachable`(background 300/361)、`content-unreachable`(199/310/371)、`content-response-invalid`(132)。对齐后端 `src/error-response.ts` 的 `err()` 与 `src/utils/schemas.ts`。注意:`fill-completed`/`gateway-blocked` 经核实**不存在**(健检里的 off-mode 命名 TODO 可能已 moot)。
- **测试网**:`batch-orchestrator.test.ts`(1179 行)对 orchestrator 纯逻辑是**强网**(pin call counts/args/save-count/状态转移/tombstone 顺序/fail-open),可放心依赖。`__tests__/entrypoints/background.test.ts`(480 行)是**中等网**:覆盖 handleRunBatch/handleApproveBatch/handleGenerate/evaluateGate/buildConstraintSuffix,但**无 `handleApproveSingleItem` 测试**、config-read/prompt 重复仅经 handleGenerate/handleRunBatch 间接覆盖。

### Institutional Learnings

- `docs/plans/2026-06-09-001` & `2026-06-10-001`(均 superseded):大重构跨多维度一次做被否,改「止血→首飞→安全」+「小/独立/低风险 PR」。→ 本计划据此切 3 件独立 PR。
- `.ai-memory/feedback_frontend-backend-separation.md`:扩展侧 fetch 已有统一模式 `authHeaders()`+`handleUnauthorized()`+`withBackendSync` 闭包,双写后端失败 fail-closed 吞噬不传播——本轮不动 HTTP client,但记录以防误碰。
- `batchSeq` 曾是 module-level `let`,SW 重启重置 + 测试污染 → 改注入。**→ R3 的 helper 绝不引入跨调用 module-level 缓存。**
- `docs/solutions/` 近空;本次重构经验完成后宜补进 solutions。

## Key Technical Decisions

- **三件独立小 PR,不打包**:重蹈 06-09/06-10 被否覆辙的唯一方式就是 6/3 维度一次做。R1+R2 一个 PR(test-then-merge)、R3 一个 PR、R4 一个 PR。各自行为保持、独立验证、独立可回滚。
- **R2 先于 R1**:合并前补 `handleApproveSingleItem` 的 background characterization 测试,锁住「单条审批」路径的现有行为,否则合并是在无网下走钢丝。
- **R3 是「抽重复」非「加缓存」**:只把 3 处重复的 read+assemble 收敛为一个纯 helper(输入 settings/apiKey/topic 等,输出 prompt);**不跨调用缓存** settings/apiKey(SW 生命周期 + 测试污染陷阱)。
- **R4 的 ErrorCode 只收 7 个自由串,不动 status union**:status 已是类型安全 union 且 UI 重度依赖,枚举化收益低、风险高;自由错误串才是真正裸奔跨边界的。ErrorCode 形态对齐后端 `err()`,不另起炉灶。
- **characterization-first**:R1/R3/R4 都以现有测试为安全网,改完 `pnpm test`+`pnpm test:e2e`(23 条)+`pnpm compile` 全绿,且关键 pin(call counts、save-count、tombstone 顺序、itemIdFilter 等价性)不变。

## Open Questions

### Resolved During Planning
- 范围:精选 R1–R4,砍 status 枚举与 HTTP client 统一(用户确认)。
- approve 合并的差异点已测绘清楚(draftOverrides/itemIdFilter/入参守卫/confirmedTopics 过滤),合并后须保留全部分支语义。
- ErrorCode 落点:新建 `packages/extension/lib/error-codes.ts`(或对齐 shared,见 deferred),收 7 个串。

### Resolve Before Planning(执行前必决)
- ~~[阻塞所有单元] WIP 去向~~ — **已解决(2026-06-15)**:WIP 特性(批次作用域 item-id + slotDiff 轨迹)经诊断完整(958 测试绿),已格式化并作 PR #11 合入 main(`815a6346`)。**重构 baseline = 当前 main**;Unit 1「对当前 main 全绿」现已无歧义。无剩余阻塞。

### Resolved During Review
- **R4(ErrorCode)范围决策 → 砍掉**(用户 2026-06-15)。审查证明 producer-only 半截、全迁移 blast radius 过大;本轮只做 R1+R3。

### Deferred to Implementation
- 合并后的统一 handler 是否仍需对 `APPROVE_BATCH` 暴露 `draftOverrides`、对 `APPROVE_SINGLE_ITEM` 暴露 `itemId`——签名设计(一个带可选 `{itemId?, draftOverrides?}` 还是两个薄 wrapper 调同一核心)执行时定,以行为不变为准。
- R3 helper 的确切签名(纯函数 vs 也封 generateDraftFn 调用)执行时按消除重复的最小面定;是否纳入 handleGenerate 视是否零成本。

## Implementation Units

> 两组 PR:**PR-1 = Unit 1+2**(test-then-merge approve;**内部有序**:Unit 2 依赖 Unit 1)、**PR-2 = Unit 3**(prompt helper)。PR-1/PR-2 **彼此**独立、可任意顺序/并行;但都共享同一 WIP 前置。(原 Unit 4 / ErrorCode 已砍。)
>
> **关键前置(硬阻塞,所有单元)**:`background.ts` / `batch-orchestrator.ts`(及其测试 `background.test.ts` / `batch-orchestrator.test.ts`)当前有会话前遗留的**未提交、未完成的特性变更**,经核实包含:(a) `buildItemId(i)→(batchId,i)`、删 `genItemId`、createBatch 改 `(i)=>${batchId}:${i}`(批次作用域 item-id);(b) approveBatch 内新增 `computeSlotDiff` + 写入 `appendTrajectory` 的 `slotDiff` 字段。**这不是散落小改,而是一个横跨 4 文件(含测试 mock 已迁移到新签名)的未完成特性,正好压在 Unit 1/2 的 approve handler 与 approveBatch 行上。** 因此 committed main 与工作树**互相不一致**:Unit 1 的「对当前 main 全绿」必须先明确 baseline = 哪个状态。开工前必须由操作者**确认 WIP 去向**——要么提交并使其测试全绿、要么丢弃——**再建立重构 baseline**(WIP 解决后重新校准 item-id 格式位置)。WIP 非本计划所有。

- [x] **Unit 1: 补 handleApproveSingleItem 的 background characterization 测试**

**Goal:** 在合并前锁住两条 approve 路径在 background 层的**差异行为**(单条路径 + batch 路径的 draftOverrides 预处理),作为合并安全网。
**Requirements:** R2
**Dependencies:** WIP 前置(baseline 须先定:见下 Execution note)
**Files:**
- Modify: `packages/extension/__tests__/entrypoints/background.test.ts`
**Approach:** 仿现有 `handleApproveBatch` 测试块(136–181)的 `createHandlers(deps)`+`fakeBrowser` 风格。补两组:(1) `handleApproveSingleItem` 的入参守卫 / itemId 过滤 / null-batch / FILL_PAGE 派发;(2) **`handleApproveBatch` 的 `draftOverrides` 预处理分支**——这是单条路径没有、且是 stateful save 的最高静默丢失风险点(`getBatch→patchBatchDrafts→saveBatch` 在调 approveBatch **之前**),现有测试**未必**钉了它的 call order / save count,合并前必须钉死。
**Execution note:** characterization-first。**baseline 歧义**:因 WIP 已改 `buildItemId` 签名且 background.test.ts mock 已迁移,「对当前 main 全绿」须先由 WIP 前置确定 baseline = committed HEAD 还是 WIP 已落地后的树;在确定的 baseline 上让这些测试先全绿。
**Patterns to follow:** `background.test.ts` 现有 handleApproveBatch/evaluateGate 测试块。
**Test scenarios:**
- Happy:`handleApproveSingleItem(tabId, itemId)` → 只对该 itemId 走 approve,其余 item 不动。
- Edge:typeof tabId/itemId 非法 → early return null(入参守卫)。
- Edge:itemId 不存在 → 不崩、按现有行为返回。
- Error:getBatch 返回 null → null。
- Integration:对该 item 派发 FILL_PAGE(仿 handleApproveBatch 的 fill 断言)。
- **Integration(draftOverrides 预存):`APPROVE_BATCH` 带非空 draftOverrides → 在 approveBatch 之前发生 `patchBatchDrafts`+`saveBatch`,钉死 call order 与 save 次数。**
**Verification:** 新测在确定的 baseline 上全绿;`pnpm --filter publisher-fill-assistant test` 绿。

- [x] **Unit 2: 合并 approve 双 handler**

**Goal:** 把 `handleApproveBatch` 与 `handleApproveSingleItem` 收敛为单一核心 + 参数区分,消除两个逐字节相同的 `ApproveBatchDeps` 字面量。
**Requirements:** R1
**Dependencies:** Unit 1(安全网)
**Files:**
- Modify: `packages/extension/entrypoints/background.ts`
- Test: `packages/extension/__tests__/entrypoints/background.test.ts`(Unit 1 已加,合并后须仍全绿)
**Approach:** 提取一个内部 `buildApproveDeps(tabId, { itemIdFilter?, draftOverrides? })` 构造共享 `ApproveBatchDeps`;两条消息路径(`APPROVE_BATCH`/`APPROVE_SINGLE_ITEM`)保留各自入口语义(batch 支持 draftOverrides + patchBatchDrafts 预处理;single 有入参守卫 + itemIdFilter)。**保留全部差异分支**:confirmedTopics 过滤、onSnapshotDropped 语义、early return。`RuntimeMessage` 协议与 onMessage 路由签名不动。
**Execution note:** characterization-first —— 不依赖新行为;Unit 1 的测试 + orchestrator 的 itemIdFilter 测试(1125–1179)是安全网。
**Patterns to follow:** 现有 `ApproveBatchDeps` 字面量;06-04-003 的 deps-闭合-batch 约束(deps 必须闭合当前 batch 变量)。
**Test scenarios:**
- Happy:`APPROVE_BATCH` 全量审批行为与合并前一致(call counts/trajectory-once 不变)。
- Happy:`APPROVE_SINGLE_ITEM` 只审该条(Unit 1 测试仍绿)。
- Edge:`draftOverrides` 仅 batch 路径生效、single 路径不受影响。
- Edge:single 入参守卫仍 early return。
- Integration:两路径的 sendFill/sendGrant/appendTrajectory 调用次数与合并前逐一相等。
**Verification:** Unit 1 测试 + 全套 background/orchestrator 测试全绿;`pnpm test`+`pnpm compile` 绿;diff 显示净减重复行、无行为分支丢失。

- [x] **Unit 3: 抽共享 prompt 组装 / config-read helper**

**Goal:** 消除 `handleRunBatch` 与 `handleRetryBatchItem` **两处逐字节相同**的 `buildPrompt`+`buildConstraintSuffix` 组装(handleGenerate 形状不同,仅在零成本时纳入)。
**Requirements:** R3
**Dependencies:** WIP 前置(独立于 Unit 1/2)
**Files:**
- Create: `packages/extension/lib/prompt-assembly.ts`(或就近放入既有合适模块,执行时定)
- Modify: `packages/extension/entrypoints/background.ts`
- Test: `packages/extension/lib/prompt-assembly.test.ts`(纯函数,新建)
**Approach:** 把「`buildPrompt(...) + buildConstraintSuffix(settings.recommendedTags ?? [])`」收敛为一个纯函数(输入 settings/topic/facts 等,输出 prompt 串),`handleRunBatch`/`handleRetryBatchItem` 改用它。**不**跨调用缓存 settings/apiKey(SW 生命周期陷阱);仍在各 handler 内 await,只共享**组装**。
**Execution note:** 纯函数提取,**test-first**:`handleRetryBatchItem` 当前**无 background 测试**(repo-research 确认),提取前先为其 prompt 组装加一条 characterization 断言或在新纯函数测试里覆盖 retry 输入形状,否则该路径「逐字符相同」仅靠读码、无测可证。
**Patterns to follow:** 现有 `buildConstraintSuffix`(background 98–104,已导出且已测 330–376)。
**Test scenarios:**
- Happy(runBatch 形状):给定 settings(含/不含 recommendedTags)+ topic + facts → 输出 prompt 与原内联组装逐字符相同。
- Happy(retry 形状):给定 retry 路径的输入 → 输出与 `handleRetryBatchItem` 原内联组装逐字符相同(新覆盖)。
- Edge:`recommendedTags` 为 undefined/空 → 与 `?? []` 现有行为一致。
- Integration:`handleGenerate` 的 constraint-suffix 注入断言(background.test.ts 347–375)合并后仍绿。
**Verification:** 新纯函数测试绿(含 retry 形状);两处 handler 行为不变;`pnpm compile` 绿。

> **Unit 4(ErrorCode 收敛)已砍** —— 详见 Requirements Trace R4。错误串被 sidepanel UI 按字面消费,producer-only 半截、全迁移 blast radius 过大;不达「高价低风」。日后若做须含 UI consumer 全迁移,单独立项。

## System-Wide Impact

- **Interaction graph:** Unit 1/2 触 `background.ts`(接线层)+ 测试;Unit 3 触 `background.ts` + 新 `prompt-assembly.ts`。均不改 `RuntimeMessage` 协议、onMessage 路由签名、三世界注入面。
- **Error propagation:** 行为保持——approve 分支语义不变(R1)、prompt 组装输出不变(R3)。
- **State lifecycle risks:** 不改 save 顺序(本地 PRIMARY/后端 SECONDARY fail-closed);不引入 module-level 缓存(SW 重启陷阱);trajectory 写入仍在 approve 循环内、非 dryRun 才写。**注意 batch 路径的 `draftOverrides→patchBatchDrafts→saveBatch` 预存步**:合并后必须保留其调用顺序与 save 次数(Unit 1 已钉)。
- **API surface parity:** 合并 approve handler 须保留两条消息路径的对外行为。
- **Unchanged invariants:** batch-orchestrator 的 Deps 注入架构、deps-闭合-batch、纯函数直接 import、接线层 <25 行不写单测(靠 e2e)——全部保持。
- **Integration coverage:** 23 条 e2e 是端到端兜底;每个 PR 合并前 `pnpm test:e2e` 须绿。

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| 合并 approve handler 丢失某条差异分支(draftOverrides 预存/itemIdFilter/守卫) | Unit 1 先补 background 测试(含 draftOverrides 预存步 call order/save count)+ orchestrator itemIdFilter 测试;合并后逐一比对 call counts/分支 |
| 会话前 WIP(未完成特性)与重构撞车、baseline 不稳 | Resolve-Before-Planning 硬阻塞:操作者先确认 WIP 去向(提交+绿 或 丢弃)再建 baseline |
| R3 误引入跨调用 config 缓存 → SW 重启 staleness / 测试污染 | Key Decision 明确只抽组装、不缓存;沿用 batchSeq 教训 |
| R3 retry 路径无测、「逐字符相同」仅靠读码 | Unit 3 提取前先为 retry 形状补 characterization(test-first) |
| 把重构打包成大 PR 重蹈被否覆辙 | 两件独立 PR、独立验证、独立回滚;砍掉 ErrorCode/status 枚举与 HTTP client 统一 |

## Documentation / Operational Notes

- 两个 PR 各自跑 `pnpm test` + `pnpm test:e2e` + `pnpm compile` + `pnpm lint:ci` 全绿门。
- 完成后建议 `/ce:compound` 把「approve handler 合并的 deps-闭合约束」「为何不做 status 枚举/HTTP 统一」沉淀进 `docs/solutions/`。
- 不触发部署/迁移;无运行时影响。

## Sources & References

- 权威蓝本:`docs/plans/2026-06-04-003-refactor-batch-orchestrator-plan.md`
- 被否教训:`docs/plans/2026-06-09-001-*`、`docs/plans/2026-06-10-001-*`(superseded)
- 健检结论:本会话 2026-06-15 全面健检(Theme C 技术债)
- 关键代码:`packages/extension/entrypoints/background.ts`(approve handlers 278–403、config-read 163/228/439)、`packages/extension/lib/batch-orchestrator.ts`、`publish-orchestrator.ts`
- 测试网:`batch-orchestrator.test.ts`(1179)、`__tests__/entrypoints/background.test.ts`(480)
- 既有错误格式:`packages/backend/src/error-response.ts`、`src/utils/schemas.ts`
- `.ai-memory/feedback_frontend-backend-separation.md`、`project_51publisher.md`
