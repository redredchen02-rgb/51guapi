---
title: "feat: grounding 完整字段防护(Phase 2)"
type: feat
status: active
date: 2026-06-15
origin: docs/brainstorms/2026-06-15-grounding-phase2-full-field-protection-requirements.md
---

# feat: grounding 完整字段防护(Phase 2)

## Overview

Phase 1(PR #23)已止血发布闸求值对象错位(snapshot + 最终 draft 双求值 + fail-closed + subtitle/description【待补】扫描)。Phase 2 把防护从「止血」提升到「完整」:按统一框架**grounded 字段只读(改它须改 facts → 重新生成),口吻散文可编 + 扫描**,覆盖全部会发布字段,并把闸下沉到单条发布路径。

> **术语**:`assembledDraftSnapshot` = `assembleDraft()` 直接产物;provenance 不变量要求只能由该产物写入。

## Problem Frame

见 origin。Phase 1 评审揭出更大攻击面:body 实际可编辑(注释级只读)、subtitle/category 裸奔、tags 无 facts 源、无 facts 编辑 UI 致 title 只读会死锁。Phase 2 据防幻觉铁律本质(grounded 事实来自 facts verbatim,模型只写口吻散文)统一处置。

## Requirements Trace

- R1. grounded 字段(title/body)审核 UI 只读 + 闸层 defense-in-depth。
- R2. 口吻散文(subtitle、prose-fallback description)可编 + 扫描。
- R3. description 双态由 facts.简介 是否在场自动判定(在场只读 / 缺可编)。
- R4. body 整块只读,改走重新生成(接受的取舍)。
- R5/R6/R7. facts 编辑 UI + 手动「重新生成」+ 解 title 死锁。
- R8. tags 逐元素 ∈ 分类允许集;category ∈ 合法选项集;不在即拦。
- R9. 单条发布路径(handlePublish)纳入闸。
- R10/R11. strip 与闸一致判决 + 诚实文案 + 修正路径指向 facts。
- R12. 全发布字段审计分类(coverImageUrl/postStatus/mediaId 等)。

## Scope Boundaries

- 不引入「手编后不重生成直接改 snapshot」(provenance 不变量)。
- 不做 body 结构化分块编辑(整块只读)。
- 不改 off/dry-run 档。
- 后端不新增 grounding 路由。

## Context & Research

### Relevant Code and Patterns

- `packages/extension/entrypoints/sidepanel/DraftPreview.tsx` — title/subtitle/category/description/body 均 `value+onChange`(`set({...})`),无 readOnly。Phase 2 在此加只读 + facts 表单 + 双态。
- `packages/extension/entrypoints/sidepanel/batch-review/ItemCard.tsx` — 渲染 DraftPreview / GroundingStrip;`onDraftChange`→`draftOverrides`;`onRetryItem` 触发重新生成。
- `packages/extension/lib/grounding-gate.ts` — `evaluateGrounding(draft, facts?, qualityScore?)`;Phase 1 已扫 title/body/subtitle/description【待补】+ body 链接。Phase 2 加 grounded verbatim(R1 defense-in-depth)+ tags/category allow-list(R8)。
- `packages/extension/lib/batch-orchestrator.ts` — approveBatch 闸(Phase 1 双求值);`retryItem`(~530-545)以新生成 draft 重建 snapshot(R6 复用)。
- `packages/extension/entrypoints/background.ts:180 handlePublish` — 单条发布直调 `orchestratePublish`,无 checkGrounding/snapshot(R9)。
- `packages/shared/src/post-assembler.ts` — 字段 provenance(作品名→title 未转义、集数/链接→body 经 `esc()`、简介→description 或散文 fallback、subtitle=散文);`esc()` 私有需 export 供闸复用。
- `packages/shared/src/facts.ts` — FactsBlock、CORE_FACT_KEYS、URL_FIELDS;无 FACT_TARGET/集合解析(需新增)。
- `packages/shared/src/field-mapping.ts` — 全发布字段选择器(R12 审计源);`fillers.ts:152-179` valueFor(发布字段全集)。
- `packages/backend/.../prompt-assembly.ts` — recommendedTags(分类推荐,非强约束;R8 需研究权威源)。

### Institutional Learnings

- `docs/brainstorms/2026-06-11-grounding-gate-rewrite-bypass-requirements.md` — snapshot 不可丢。
- `docs/solutions/best-practices/incremental-pr-adversarial-verification-2026-06-15.md` — 小独立 PR、负向断言、注入缝、前提核验。
- `docs/brainstorms/2026-06-15-grounding-gate-publish-basis-requirements.md` + Phase 1 PR #23 — 闸求值对象=发布对象。

## Key Technical Decisions

- 路线 A(grounded 只读 + facts UI)而非保留可编+verbatim:见 origin。只读化后 grounded 字段无法被手编 → verbatim 闸检查退为 defense-in-depth(而非唯一防线),esc() 脆弱比对面缩小。
- body 整块只读;facts 编辑后**手动**重新生成(成本可控)。
- tags/category 锚分类 allow-list(非 facts)——它们本就来自 LLM/分类。
- 单条发布下沉闸:需先确立单条路径的 draft/snapshot 来源(本计划最大未知,见 Open Questions)。
- `FACT_TARGET: Record<FactKey, "title"|"body"|"description"|"tags">` 置于 shared/facts.ts,assembler 与闸共用。
- `esc()` 从 post-assembler export 到 shared 供闸 verbatim 比对同层规范化。

## Open Questions

### Resolved During Planning

- 统一框架、body 只读、facts 手动重生、tags allow-list、单条下沉 → 见 origin Key Decisions。
- FactsBlock 可编字段 → 至少含全 CORE_FACT_KEYS(必含作品名,否则 R7 失效)。

### Deferred to Implementation

- [R8] 分类 allow-list 权威源:recommendedTags 是推荐非强约束。实施时先确认后台是否有真合法标签白名单;若无,R8 降级为 category-only 校验 + tags 记 scope boundary(回 brainstorm)。
- [R9] 单条发布 draft/snapshot 来源:`handlePublish` 只有 tabId、内容在页面表单。实施时验证能否从页面回读结构化 draft + 是否需先走一次 assembleDraft 建立可信 snapshot;不可行则 fallback:authorized 档单条发布直接禁用/拦截(success criteria 兜底)。
- [R6] 重新生成覆盖操作者散文手编(subtitle)的处理:警示确认 vs 暂存回灌。
- [R3] description 双态判定时机(facts.简介 在场→只读)与 UI 切换实现。

## High-Level Technical Design

> 方向性说明,非实现规范。

字段防护矩阵(R1/R2/R8/R12):

| 字段 | 来源 | 策略 |
|---|---|---|
| title(作品名) | facts verbatim | 只读 + 闸 verbatim defense-in-depth |
| body(集数/制作/链接 + 散文) | 组装 HTML | 整块只读 + 闸现有【待补】/链接扫描 |
| description | facts.简介 在场 / 散文 fallback | 双态:在场只读;缺可编+扫描 |
| subtitle | 模型散文 | 可编 + 【待补】/链接扫描 |
| tags | LLM | 可编 + ∈ 分类允许集 |
| category | LLM | 可编 + ∈ 合法选项集 |
| coverImageUrl 等 | 适配器/操作者 | R12 审计后逐一归类(URL 类需来源校验) |

闸求值(authorized,batch + 单条统一):snapshot 缺失→拦;`evaluateGrounding(snapshot)` ∧ `evaluateGrounding(finalDraft)`(后者含 grounded verbatim + tags/category allow-list)任一不过→拦。

## Implementation Units

- [x] **Unit 1: FACT_TARGET 映射 + esc() 提取到 shared**

**Goal:** 建立 grounded 字段→位置映射与共享转义函数,供后续 verbatim 闸与只读判定复用。

**Requirements:** R1, R3(基础)

**Dependencies:** 无

**Files:**
- Modify: `packages/shared/src/facts.ts`(加 `FACT_TARGET`)、`packages/shared/src/post-assembler.ts`(export `esc`)
- Test: `packages/shared/src/*.test.ts`(facts/post-assembler 既有测试)

**Approach:** FACT_TARGET 显式映射(作品名→title、简介→description、集数/制作/漢化/無修→body、题材/标签→tags);export esc。

**Test scenarios:**
- Happy:FACT_TARGET 覆盖全 CORE_FACT_KEYS。
- Edge:esc 对 `& < > "` 转义与 assembler 注入一致(同函数)。

**Verification:** shared build 绿;assembler 行为不变(复用同 esc)。

- [ ] **Unit 2: 闸加 grounded verbatim(defense-in-depth)+ tags/category allow-list**

**Goal:** `evaluateGrounding` 对最终 draft 增:grounded 字段值 verbatim 在场(按 FACT_TARGET + esc 空间 / normalizeUrl);tags ⊆ 分类允许集、category ∈ 合法选项集。

**Requirements:** R1, R8

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/extension/lib/grounding-gate.ts`
- Test: `packages/extension/lib/grounding-gate.test.ts`

**Approach:** facts 在场时按 FACT_TARGET 校验 grounded 值仍在对应字段(body 经 esc、URL 走 normalizeUrl、title/description 原值);tags/category 对 allow-list 校验(allow-list 源见 Deferred R8——实施先确认,无则 category-only)。grounded 字段已只读时此为 defense-in-depth。

**Execution note:** 负向断言为主(编造作品名/越界 tag → ok=false);含 `&` 合法值不误拦。

**Test scenarios:**
- Error:title 作品名改成 facts 外值 → ok=false(verbatim)。
- Error:tags 含分类允许集外标签 → ok=false。
- Error:category 非法选项 → ok=false。
- Edge:作品名/URL 含 `&` → esc/normalizeUrl 比对不误拦。
- Edge:facts 缺字段 → 跳过该字段不误报。

**Verification:** 五类越界被拦;合法不误拦;Phase 1 测试不回归。

- [ ] **Unit 3: facts 编辑 UI + 手动重新生成**

**Goal:** 审核区可编辑该项 FactsBlock 并手动「重新生成」,解 title/body 只读后的修正死锁。

**Requirements:** R5, R6, R7

**Dependencies:** 无(可与 Unit 1/2 并行)

**Files:**
- Modify: `packages/extension/entrypoints/sidepanel/DraftPreview.tsx` 或 `batch-review/ItemCard.tsx`(facts 表单)、`BatchView.tsx`(facts 保存 + 触发 retry)
- Test: 对应 sidepanel 测试

**Approach:** facts 表单(至少全 CORE_FACT_KEYS);保存写回 item.facts;「重新生成」复用 `onRetryItem`/retry 管线(已重建 snapshot)。重生成前若有散文手编→警示(见 Deferred R6)。

**Test scenarios:**
- Happy:编辑 facts.作品名 → 重新生成 → 新 draft/snapshot 含新作品名。
- Edge:facts 未变点重新生成 → 正常。
- Integration:重新生成后 snapshot = assembleDraft 产物(provenance)。

**Verification:** 抓错作品名可经 facts 修正,无死锁。

- [ ] **Unit 4: grounded 字段只读 + description 双态(UI)**

**Goal:** title/body 在 DraftPreview 只读;description 按 facts.简介 自动双态;补「改作品名请编辑 facts」引导。

**Requirements:** R1, R3, R4, R11(部分)

**Dependencies:** Unit 3(只读须有 facts 修正出口才不死锁)

**Files:**
- Modify: `packages/extension/entrypoints/sidepanel/DraftPreview.tsx`、`batch-review/ItemCard.tsx`
- Test: 对应测试

**Approach:** title/body input/textarea 设 readOnly;description 渲染期按 `facts.简介` 在场判定只读/可编;只读字段旁提示指向 facts 编辑。

**Test scenarios:**
- Happy:title/body 不可编辑;有简介→description 只读;无简介→可编。
- Edge:facts 编辑后描述态随之切换。

**Verification:** grounded 字段无法手编;双态正确;有可见修正引导。

- [ ] **Unit 5: 全发布字段审计 + 归类(R12)**

**Goal:** 枚举 fillers.ts/field-mapping.ts 全部会发布字段,逐一归类(grounded 只读 / prose 可编+扫描 / 元数据不校验),补齐遗漏(尤其 coverImageUrl 的 URL 来源校验)。

**Requirements:** R12

**Dependencies:** Unit 2, Unit 4

**Files:**
- Modify: 视审计结果(grounding-gate.ts / DraftPreview.tsx)
- Test: grounding-gate.test.ts

**Approach:** 审计 valueFor(fillers.ts:152-179)全字段;coverImageUrl(隐藏 cover_url,URL)纳入来源校验或显式记 scope boundary;输出归类表入文档。

**Test scenarios:**
- Error:coverImageUrl 为无来源 URL → ok=false(若纳入)。
- Test expectation:纯元数据字段(postStatus/mediaId)记为不校验 + 理由。

**Verification:** 无未归类的会发布字段;审计表落文档。

- [ ] **Unit 6: 单条发布路径下沉闸(R9)**

**Goal:** handlePublish 单条 authorized 发布也过 snapshot + 最终 draft 双求值;消除裸奔出口。

**Requirements:** R9

**Dependencies:** Unit 2

**Files:**
- Modify: `packages/extension/entrypoints/background.ts`(handlePublish)、可能 `publish-orchestrator.ts`
- Test: 对应 background/publish 测试

**Approach:** 先验证能否从页面回读结构化 draft + 建立可信 snapshot(Deferred R9);可行→下沉双求值闸;不可行→fallback:authorized 档单条发布拦截/禁用并提示走批量。**实施前必须先定可行性。**

**Execution note:** 此 Unit 含架构未知,先做可行性探针再定实现/ fallback。

**Test scenarios:**
- Error:单条路径发布编造内容 → 拦(若下沉)。
- Integration:单条合法发布正常 / 或被引导走批量(若 fallback)。

**Verification:** 无绕过闸的 authorized 单条出口。

- [ ] **Unit 7: GroundingStrip 与闸一致 + 诚实文案(R10/R11)**

**Goal:** strip 显示与最终-draft 闸一致判决 + 可读原因;文案诚实(标注另需 snapshot 校验);修正路径指向 facts。

**Requirements:** R10, R11

**Dependencies:** Unit 2, Unit 4

**Files:**
- Modify: `packages/extension/entrypoints/sidepanel/batch-review/sub-blocks.tsx`、ItemCard.tsx
- Test: 对应测试

**Approach:** strip 复用 evaluateGrounding(含新 verbatim/allow-list);拦截渲染 reasons;文案动词式 + 非纯色点;标注「发布另需通过生成期快照校验」;grounded 不一致引导编辑 facts。

**Test scenarios:**
- Happy:合法 → 「可发布」。
- Error:越界 tag/编造作品名 → 「将被拦截」+ 原因。

**Verification:** strip 判决与闸一致;文案不误导。

## System-Wide Impact

- **Interaction graph:** DraftPreview/ItemCard(只读+facts 表单)、grounding-gate(verbatim+allow-list)、batch-orchestrator approveBatch + retry、background handlePublish。
- **provenance 不变量:** snapshot 仅由 assembleDraft 写;Unit 3 重生成与 retryItem 须遵守(retryItem 现以 gen.draft 作 snapshot——实施时核验是否 assembleDraft 产物,否则修)。
- **allow-list 数据流:** 分类→允许标签集的来源与刷新(Deferred R8)。
- **Unchanged invariants:** off/dry-run、snapshot 双求值闸(Phase 1)、后端无 grounding 路由。

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| R8 allow-list 无权威源 → tags 校验无法落地 | 实施先确认;无则降 category-only + tags scope boundary(回 brainstorm) |
| R9 单条路径无法建可信 snapshot | 先可行性探针;不可行 → authorized 单条禁用 fallback |
| 只读化前 facts UI 未就位 → 死锁 | Unit 4 依赖 Unit 3 |
| verbatim esc/normalizeUrl 误拦含特殊字符合法值 | 复用 assembler 同 esc;Unit 2 含 `&` edge 测试 |
| 重生成丢操作者散文编辑 | Unit 3 警示/暂存(Deferred R6) |
| 大 UI 改造范围 | 7 单元小步独立合并,逐 PR CI 绿 |
| 评审降级(API 过载) | 本计划 confidence-check/document-review 可能受限;API 恢复后补跑 |

## Documentation / Operational Notes

- 落地后更新操作者文档:作品名/事实改走 facts 编辑;body 只读、改走重新生成。
- 复核 2026-06-11「已接受残留」是否进一步关闭。
- 更新 field-mapping-guide 的字段归类表(Unit 5 产物)。

## Sources & References

- **Origin:** docs/brainstorms/2026-06-15-grounding-phase2-full-field-protection-requirements.md
- 前置:docs/plans/2026-06-15-004-fix-grounding-gate-publish-basis-plan.md(Phase 1,PR #23)
- 约束:docs/brainstorms/2026-06-11-grounding-gate-rewrite-bypass-requirements.md
- 代码:grounding-gate.ts、batch-orchestrator.ts、background.ts、DraftPreview.tsx、post-assembler.ts、facts.ts、field-mapping.ts、fillers.ts
