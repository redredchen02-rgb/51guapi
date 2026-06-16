---
title: "fix: grounding gate 被 AI 评审重写绕过(防幻觉硬闸修复)"
type: fix
status: active
date: 2026-06-11
origin: docs/brainstorms/2026-06-11-grounding-gate-rewrite-bypass-requirements.md
---

# fix: grounding gate 被 AI 评审重写绕过(防幻觉硬闸修复)

## Overview

防幻觉硬闸失效:`runBatch` 顺序是「生成 → AI 评审重写 → grounding gate」,重写把 `post-assembler` 注入的 `【待补】` 占位符填成 AI 编造内容,等 gate 检查时占位符已消失 → 放行。更关键的是 `markFilled` 持久化的是**重写后** `draft`,真发硬闸 `checkGrounding(item.draft)` 读到的也是洗白稿,所以真发路径同样漏。

修复:在重写前捕获 `post-assembler` 原稿,**独立持久化**为 BatchItem 字段;备稿 gate 与真发硬闸都改为评估该原稿快照,而非被重写覆盖的 `item.draft`。

## Problem Frame

见 origin 文档。核心:防幻觉是产品铁律(作品名/链接由操作者 verbatim 注入,模型碰不到;缺失事实标 `【待补】`,gate 见占位符即拦)。AI 重写"洗白"了 `【待补】`,使备稿 gate-failed 分流信号失真,且真发硬闸一并失效——可能把编造内容真发上线。2026-06-11 路径 B 冒烟实测复现(零事实选题进了「待审」)。

## Requirements Trace

- R1. 备稿 `evaluateGrounding` 与真发 `checkGrounding` 的判定都基于**重写前**的 `post-assembler` 原稿(see origin R1)。
- R1b.(P0)原稿快照独立持久化到 BatchItem,只读不被重写/save 覆盖;`checkGrounding` 读快照而非 `item.draft`(see origin R1b)。
- R2. 零事实/缺关键事实的选题(原稿带 `【待补】`),无论重写是否运行,备稿落 gate-failed、真发被拦,两路径 gate 目标都是持久化原稿(see origin R2)。
- R3. 回归测试 4 条断言(见 Unit 3)(see origin R3)。
- SC. gate-failed 条目向操作者展示带 `【待补】` 的原稿,使其能判断缺哪些事实(see origin Success Criteria)。

## Scope Boundaries

- 不改 gate 检测规则本身(仍是 `【待补】` + 无来源链接);只改"评估哪一份草稿"。
- 不做「生成前事实预筛」(origin 已否决)。
- 不处理「重写在合格草稿上**新引入**幻觉/无来源链接」——origin 已知并接受此残留暴露面,本计划不扩范围。
- 不改 Phase 3 评审/重写其他行为(fail-open、token 计量、`aiReviewTriggered` 三态语义不动)。

## Context & Research

### Relevant Code and Patterns

- `packages/extension/lib/batch-orchestrator.ts` `runBatch`(HEAD):第 146 行 `let draft = …gen.draft`;评审重写段 `draft = mergeRewriteResult(...)`;第 178 行 `verdict = gateCheck(draft, item.facts)`(**bug:gate 查重写后**);末尾 `markFilled(batch, item.id, draft, …)` 持久化重写后稿。
  - ⚠️ **工作树该文件已含未提交 `assembledDraft` 改动(line 175/225),备稿半边可能已"修";但不可信任。实施按 Unit 0 隔离。**
- `packages/extension/lib/batch-orchestrator.ts` `approveBatch`(HEAD 第 248-255 行):`checkGrounding(item.draft, item.facts)`,仅 `gate.mode==='authorized'` 触发(**bug:真发硬闸也查重写后存稿**)。
- `packages/extension/lib/batch.ts`:`BatchItem` 接口 + `createBatch` + `markFilled`(持久化 draft 的唯一入口)。
- `packages/extension/lib/grounding-gate.ts` `evaluateGrounding`:查 `draft.title/body.includes('【待补】')` + `hasUnsourcedLink`;不查事实是否为空。**规则本身不改。**
- `packages/extension/entrypoints/background.ts`:`runBatch`/`approveBatch` 的 deps 接线(`evaluateGrounding`、`checkGrounding` 注入点)。
- `packages/extension/entrypoints/sidepanel/BatchReviewPanel.tsx` 第 818-834 行:gate-failed 渲染分支(显示 `gateFailReason`,目前不展示草稿)。
- 持久化:本地 `chrome.storage.local`(primary),`saveBatch=withBackendSync(saveBatch)`;BatchItem 新字段随 `JSON.stringify` 自动序列化,无需改 schema。

### Institutional Learnings

- `.ai-memory` / `memory/smoke-test-findings-2026-06-11.md`:本 bug 的冒烟实测来源与机制确认。
- `memory/content-quality-gated-baseline.md`:防幻觉=结构化生成,模型只写口吻散文,事实由 `post-assembler` 注入。

## Key Technical Decisions

- **机制选 (b) 捕获原稿快照并持久化**,而非 (a) 单纯 reorder:reorder 只修备稿 gate,真发硬闸仍读重写后 `item.draft`;只有持久化快照能同时满足 R1b。(see origin Outstanding 第1条)
- **新字段 `assembledDraftSnapshot` 与既有 `publishedDraft` 职责区分(必读)**:`BatchItem` 已有 `publishedDraft`(markFilled 第 177 行 `publishedDraft: {...draft}`,存的是**传入的 draft = runBatch 里的重写后稿**,供 R5b slot-diff 用)。**绝不可复用 `publishedDraft` 当原稿快照——它正是重写后的,复用会原样复现 bug。** 新增独立字段 `assembledDraftSnapshot` = 重写前原稿 = gate 判据;两字段并存、各写各的、互不覆盖。
- **快照字段与展示用 `draft` 物理分离**:`markFilled` 写入一次后只读,`mergeRewriteResult`/后续 save 绝不碰它。
- **快照存内容用于 gate 判定,发布内容仍用 `item.draft`(重写后、操作者审过的稿)**:gate 决定"能不能发",发布的是审核稿;两者职责分离。
- **旧批次缺快照的降级 = fail-safe(备稿与真发两处一致)**:`evaluateGrounding`(Unit 1)与 `checkGrounding`(Unit 2)遇 item 无 `assembledDraftSnapshot` 时**都**回落到 `item.draft`(保持旧行为,不因缺字段崩溃);新批次一律有快照。

## Open Questions

### Resolved During Planning

- 机制 reorder vs 快照?→ 快照(唯一能闭真发洞)。
- 快照要不要进后端镜像?→ 不强制:gate 在扩展端读本地 batch,本地持久化即足够;后端 best-effort 同步会顺带带上该字段(JSON 序列化),无需改后端 schema。
- 真发发布的是快照还是重写稿?→ 重写稿(`item.draft`,操作者审过);快照仅供 gate 判定。

### Deferred to Implementation

- `assembledDraftSnapshot` 的精确类型:复用 `ContentDraft` 还是只存 gate 需要的 `{title, body}` 子集?倾向存完整 `ContentDraft`(简单、与 draft 同构、未来 gate 规则扩展不受限),实施时定。
- 旧批次降级的确切回落语义(回落 `item.draft` vs 直接判 fail)实施时按 fail-safe 原则定;倾向回落 `item.draft` 保持旧行为。

## Implementation Units

- [ ] **Unit 0: 隔离污染工作树,建立干净基线(前置,非代码)**

**Goal:** 确保本修复基于干净 HEAD 重做,不混入并行进程的不可信 diff。

**Requirements:** origin 实施风险

**Dependencies:** 无。最先做。

**Approach:**
- `git status` + `git diff packages/extension/lib/batch-orchestrator.ts` 确认实际起点(工作树备稿半边可能已被 `assembledDraft` 改动,但 HEAD 没有)。
- 用 `git worktree` 从干净 HEAD 拉独立分支重做本修复;**不在当前含 ~130 文件未提交改动的污染工作树上操作**。
- 先与操作者确认那批无关改动(`.gitlab-ci.yml`/`telegram.ts`/Docker 等)归属,避免误丢。

**Test scenarios:** Test expectation: none — 环境隔离步骤,无行为变更。

**Verification:** 新 worktree 基于干净 HEAD;`git diff` 仅会包含本修复将动的文件。

- [ ] **Unit 1: 持久化原稿快照 + 备稿 gate 评估快照**

**Goal:** 捕获重写前 `post-assembler` 原稿,持久化,备稿 gate 改查快照。

**Requirements:** R1, R1b, R2

**Dependencies:** Unit 0

**Files:**
- Modify: `packages/extension/lib/batch.ts`(`BatchItem` 加 `assembledDraftSnapshot?: ContentDraft`;`markFilled` 增加写入快照的参数/逻辑,只写一次)
- Modify: `packages/extension/lib/batch-orchestrator.ts`(`runBatch`:重写前捕获原稿、传入 markFilled、gate 改查 snapshot;**`retryItem` 同步:其 markFilled 调用前也捕获原稿快照并传入**,否则 gate-failed 重试后无快照)
- Test: `packages/extension/lib/batch.test.ts`、`packages/extension/lib/batch-orchestrator.test.ts`

**Approach:**
- 捕获时机:在 `runBatch` 把封面注入 `draft`(`draft.coverImageUrl`)**之后**、进入评审重写**之前**,把当时的 `draft`(= `post-assembler` 原稿 + 封面)捕获为 `snapshot`(含 coverImageUrl,与展示用 draft 同基)。
- `markFilled` 持久化 `draft`(重写后)用于展示/发布,同时持久化 `snapshot` 到 `assembledDraftSnapshot`(只读,独立于既有 `publishedDraft`)。
- gate 判定从 `gateCheck(draft, …)` 改为 `gateCheck(item.assembledDraftSnapshot ?? draft, …)`——**新批次用快照,旧批次/缺快照 fail-safe 回落 draft**。
- 保持现有 fail-open:gate 抛异常视为通过。
- **retry 路径**:`retryItem`(gate-failed→queued→重生成的唯一回流,经 BatchReviewPanel onRetryItem)是独立函数,不在 runBatch 循环内;须在其 markFilled 前同样捕获并刷新快照,使重试后产出的新原稿(可能仍带 `【待补】`)重新成为 gate 判据。

**Patterns to follow:** `markFilled` 现有 `...(cover ? {coverImageUrl} : {})` 的可选字段写入模式;`createBatch` 同序平行字段注入。

**Test scenarios:**
- Happy path: 有事实选题 → snapshot 无 `【待补】` → gate 通过 → filled→awaiting-approval。
- Error path(核心复现): 零事实选题(snapshot.title=`【待补】`)+ 注入真实 `mergeRewriteResult`(重写填掉 title)→ **断言该条 gate-failed**(证明 gate 查的是 snapshot 而非重写后 draft)。
- Edge case: 重写未触发(评审全过)→ snapshot==draft → gate 行为不变。
- Edge case: retry 路径——gate-failed 项经 `retryItem` 重生成出带 `【待补】` 的新原稿 → 快照被刷新 → 仍 gate-failed(不残留旧快照)。
- Edge case: 旧批次 item 无 `assembledDraftSnapshot` → `evaluateGrounding` fail-safe 回落 `item.draft`,不崩、行为同修复前。
- Integration: `markFilled` 后 `item.assembledDraftSnapshot` 含原稿、`item.draft` 含重写稿、`item.publishedDraft` 含重写稿,三者职责不同;snapshot 与 draft 不同对象、互不影响。

**Verification:** 复现冒烟场景的单测红→绿;零事实选题落 gate-failed;retry 与旧批次边界覆盖。

- [ ] **Unit 2: 真发硬闸 checkGrounding 评估快照 + 旧批次降级**

**Goal:** 关闭真发路径的洗白洞。

**Requirements:** R1, R1b, R2

**Dependencies:** Unit 1(需 `assembledDraftSnapshot` 字段已存在)

**Files:**
- Modify: `packages/extension/lib/batch-orchestrator.ts`(`approveBatch` 的 `checkGrounding` 调用点:从 `checkGrounding(item.draft, item.facts)` 改为 `checkGrounding(item.assembledDraftSnapshot ?? item.draft, item.facts)`)
- Test: `packages/extension/lib/batch-orchestrator.test.ts`
- 注:`checkGrounding` 函数签名不变(仍 `(draft, facts)`),`background.ts` 的 deps 接线**零改动**——只改 approveBatch 内部传给它的实参。

**Approach:**
- 真发硬闸读 `assembledDraftSnapshot`;缺字段(旧批次)回落 `item.draft`(fail-safe,保持旧行为)。
- 该硬闸双重门控:仅当 `deps.checkGrounding` 注入 **且** `evaluateGate()` 返回 `mode==='authorized'` 时触发——测试须 mock `evaluateGate()→{mode:'authorized'}` 且把真实 `evaluateGrounding` 注入为 `checkGrounding`。
- 发布内容(`sendFill(item.draft)`)不变——发的仍是审核过的重写稿。

**Test scenarios:**
- Error path(核心): item.draft 已被重写抹掉 `【待补】`、但 snapshot 仍含 `【待补】`,authorized 档 → **`checkGrounding` 仍拦截**(转 error,不 dispatch)。
- Edge case: 旧批次 item 无 snapshot → 回落 item.draft,行为同修复前(不崩)。
- Happy path: snapshot 无占位 → 正常 dispatch 发布。
- Integration: 持久化往返(save→load batch)后 snapshot 仍含 `【待补】`,checkGrounding 仍拦(守护 R1b 持久化)。

**Verification:** 重写抹占位后真发仍被拦;旧批次不崩。

- [ ] **Unit 3: gate-failed 向操作者展示原稿快照(UI)**

**Goal:** gate-failed 条目展示带 `【待补】` 的原稿,使操作者知道补哪些事实。

**Requirements:** SC

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/extension/entrypoints/sidepanel/BatchReviewPanel.tsx`(gate-failed 分支,第 818-834 行附近:除 `gateFailReason` 外,展示 `it.assembledDraftSnapshot` 的 title/body 而非重写后 `it.draft`)
- Test: `packages/extension/entrypoints/sidepanel/BatchReviewPanel.test.tsx`

**Approach:**
- gate-failed 渲染优先用 `assembledDraftSnapshot`(含 `【待补】`);无快照时回落现状。

**Test scenarios:**
- Happy path: gate-failed 项渲染 → 显示 snapshot 的 `【待补】` 标题,而非重写后编造标题。
- Edge case: 无 snapshot 的旧 gate-failed 项 → 回落显示 `gateFailReason`,不崩。

**Verification:** gate-failed 卡片显示带占位符的原稿。

- [ ] **Unit 4: 端到端集成测试(守护两路径 + 不变量)**

**Goal:** 锁住完整链路,防回归。

**Requirements:** R3

**Dependencies:** Units 1-2

**Files:**
- Test: `packages/extension/lib/batch-orchestrator.test.ts`(集成)

**Approach:** 不 mock gate / mergeRewriteResult,走真实函数;构造零事实选题跑完 runBatch→approveBatch。

**Test scenarios(origin R3 四断言):**
- ① 零事实 + 标题质量评审不过 + 真实重写填占位 → 重写后该条仍 gate-failed。
- ② 零事实选题经 `post-assembler` 组装产物确实带 `【待补】`(守护 R2 前置假设;若 post-assembler 行为变更,此断言先红)。
- ③ 持久化往返后 snapshot 仍含 `【待补】`,checkGrounding 读快照仍拦。
- ④ `markGateFailed` 后的条目不被 `presentForApproval` 升格为 awaiting-approval(状态机正确性:gate-failed 不经显式人工动作不得进入待审,这是真发不被触达的底层保证)。

**Verification:** 四断言全绿;`pnpm -r compile`、`pnpm test` 全绿。

## System-Wide Impact

- **Interaction graph:** `runBatch`(写快照)→ `markFilled`(持久化)→ `evaluateGrounding`(读快照)→ `approveBatch`/`checkGrounding`(读快照)→ `BatchReviewPanel`(展示快照)。新增字段贯穿生成→审核→发布→UI。
- **State lifecycle risks:** 快照只写一次、只读;须确保 `mergeRewriteResult` 与任何后续 `patchItem`/`save` 都不覆盖它。retry(`retryFromGateFailed`→queued→重生成)时快照应被重新捕获(下一轮 markFilled 覆盖为新原稿)——实施时确认 retry 路径也走 Unit 1 的捕获逻辑。
- **API surface parity:** 后端 `batch-store.ts` 的 `BatchItem` 镜像类型可选加 `assembledDraftSnapshot`(保持结构一致),但 gate 不在后端跑,非必须;若不加,后端同步时该字段被忽略,不影响扩展端 gate。
- **Unchanged invariants:** 零提交铁律、发布闸门链、gate 检测规则(`【待补】`+无来源链接)、发布内容仍是 `item.draft`、`aiReviewTriggered` 三态语义——全部不变。

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| 污染工作树的 ~880 行不可信 diff 被误并入提交 | Unit 0 隔离 + 提交前 `git diff` 人工核对只含目标文件 |
| 快照被后续 save/重写覆盖,bug 原样复现 | Unit 1 markFilled 一次写入只读;Unit 4 ③ 持久化往返断言守护 |
| retry 重生成后快照仍是旧原稿 | System-Wide 已标;实施时确认 retry 走捕获逻辑,加测试 |
| 旧批次缺快照导致 gate/checkGrounding 崩 | fail-safe 回落 item.draft(**Unit 1 备稿 + Unit 2 真发两处一致**);各自 edge case 测试 |
| 残留暴露面:gate 锚定原稿后,重写在合格稿上**新引入**的幻觉链接/作品名(= 实际展示 + 真发的 item.draft)完全不过任何 grounding 检查,可真发上线,仅靠操作者人工审核兜底 | origin R2 已知并接受,本计划不扩范围;明确记录避免后续误以为已覆盖 |
| `markFilled` 位置参数将达 6+ 个(code smell) | 本计划不重构为 options 对象(保持改动最小);记入 Deferred 供后续 |

## Documentation / Operational Notes

- 修复后建议重放冒烟(零事实选题)验证 gate-failed,可补进 `docs/ops-runbook.md` 的首周观察项。
- 无需数据迁移:新字段可选,旧批次走 fail-safe 降级。

## Sources & References

- **Origin document:** [docs/brainstorms/2026-06-11-grounding-gate-rewrite-bypass-requirements.md](../brainstorms/2026-06-11-grounding-gate-rewrite-bypass-requirements.md)
- Related code: `packages/extension/lib/batch-orchestrator.ts`(runBatch/approveBatch)、`lib/batch.ts`(BatchItem/markFilled)、`lib/grounding-gate.ts`、`entrypoints/sidepanel/BatchReviewPanel.tsx`
- Learnings: `memory/smoke-test-findings-2026-06-11.md`
