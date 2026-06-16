---
title: "fix: 发布闸求值对象 = 实际发布对象(堵 grounding 手编泄漏)"
type: fix
status: active
date: 2026-06-15
deepened: 2026-06-15
origin: docs/brainstorms/2026-06-15-grounding-gate-publish-basis-requirements.md
---

# fix: 发布闸求值对象 = 实际发布对象

## Overview

修复 authorized 发布的防幻觉铁律泄漏:grounding 闸求值 `assembledDraftSnapshot ?? item.draft`(batch-orchestrator.ts:333),但实际发布 `sendFill(item.draft)`(:356)。闸检查的 artifact ≠ 发布的 artifact。

**分阶段交付**(评审揭出攻击面比初版假设更大——body 实际可编辑、subtitle 裸奔、tags 无 facts 源、无 facts 编辑 UI 使 title 只读会死锁;故拆分以遵循「小独立 PR」institutional learning):
- **Phase 1(本 plan 全量,最小止血,独立可合)**:闸对 **snapshot 与最终 draft 各跑一次现有 `evaluateGrounding`** + snapshot 缺失 fail-closed,并把现有「【待补】+ 无来源链接」扫描扩到 subtitle/description。无新抽象,显著收窄泄漏面。
- **Phase 2(本 plan 仅记录,需后续 /ce:brainstorm + /ce:plan)**:grounded 字段 verbatim 校验(作品名/简介/链接)、title 强锚、tags 策略、body 只读策略、facts 编辑 UI、单条发布路径、strip UX。多项含未决产品/架构叉,不在 Phase 1 落地。

## Problem Frame

见 origin。闸读 snapshot 而发布填 draft = 真泄漏。Phase 1 用「双求值 + fail-closed」止血(现有检查已能抓最终 draft 中 title/body/subtitle/description 的【待补】与无来源链接注入);Phase 2 才处理 verbatim/作品名编造等需新抽象与产品决策的部分。

## Requirements Trace

### Phase 1 — 止血(本 plan)
- R1. authorized 发布前,闸对**实际将发布的 item.draft**求值(非仅 snapshot)。
- R2. 闸**保留对 snapshot 的现有检查**,防回退 2026-06-11 rewrite-bypass 修复。
- R4. assembledDraftSnapshot 缺失时 fail-closed 直接拦。
- R7. 现有「【待补】/无来源链接」扫描扩到 subtitle、description(堵这两个可编辑可发布字段的同类注入)。

### Phase 2 — 完整 grounding(仅记录,需再 brainstorm/plan)
- R3. grounded 字段(作品名/简介/集数/链接)verbatim 与 facts 一致。
- R5/R6. strip 单一判决 + 诚实文案 + 不一致原因 + 恢复路径。
- R8. 可编辑字段全覆盖策略(title 强锚或只读、tags 源头、body 只读 enforcement)。
- R9. 单条发布路径(handlePublish/PUBLISH_PAGE)的 grounding 覆盖。

## Scope Boundaries

- Phase 1 **不**引入 FACT_TARGET/verbatim 抽象、不改 title 可编辑性、不动 tags、不强制 body 只读(留 Phase 2)。
- 不引入「手编后重新生成 snapshot」(另开 brainstorm)。
- 后端不新增 grounding 路由。
- 不改 `off`/`dry-run` 档(仅 authorized 拦截)。

## Context & Research

### Relevant Code and Patterns

- `packages/extension/lib/grounding-gate.ts` — `evaluateGrounding(draft, facts?, qualityScore?)`→`{ok, reasons}`(**注意:实际导出名是 `evaluateGrounding`**;orchestrator 内 import 为 `defaultEvaluateGrounding`,注入参数名 `checkGrounding`)。现检查 title/body 的 `PLACEHOLDER`、body 的 `hasUnsourcedLink(verifyLinks(...))`、qualityScore<0.6(非阻塞)。**当前不扫 subtitle/description。**
- `packages/extension/lib/link-source.ts` — `extractLinks/verifyLinks/normalizeUrl` 纯 regex(:3 注释陈旧错误,顺修)。
- `packages/extension/lib/batch-orchestrator.ts:328-356` — 闸(:333 读 snapshot)+ `sendFill(item.draft)`(:356,同 loop 体读同一 item.draft,原子);`retryItem`(~537 `markFilled(...draft)` 第 7 参=draft)。
- `packages/extension/entrypoints/background.ts:180` — `handlePublish` 直调 `orchestratePublish`,**不传 checkGrounding**(单条路径无闸;且 background 侧只有 tabId,无 item/snapshot 概念)→ Phase 2/架构。
- `packages/extension/entrypoints/sidepanel/DraftPreview.tsx` — title(:29)、subtitle(:39)、category(:46)、description、**body(:76-77)均可编辑、无 readOnly**(「body 只读」当前是注释级、非代码级)。
- `packages/shared/src/post-assembler.ts` — `assembleDraft`:作品名→title(未转义)、集数/制作/漢化/無修→body(经 `esc()` 私有函数)、简介→description(缺则模型散文 fallback,slice 120)、subtitle=模型散文。`ContentDraft`={title, subtitle, body, description, tags, category, ...}。tags 来自 LLM `parsed.tags`(非 assembler/facts)。
- `packages/shared/src/facts.ts` — `FactsBlock`(题材/标签为自由文本字符串,无集合解析)。

### Institutional Learnings

- `docs/brainstorms/2026-06-11-grounding-gate-rewrite-bypass-requirements.md` — snapshot 来由;不得丢 snapshot 检查。
- `docs/solutions/best-practices/incremental-pr-adversarial-verification-2026-06-15.md` — **小独立 PR**(本 plan 据此拆 Phase)、负向断言测试、注入缝、评审声明先核验(本轮已纠正「DraftPreview 不存在」「不是泄漏」等假声明)。

## Key Technical Decisions

- **Phase 1 不依赖 verbatim 抽象**:仅复用现有 `evaluateGrounding`,对 snapshot 与最终 draft 各跑一次。这是可独立验证、独立合并的最小止血(adversarial 建议)。
- **subtitle/description 纳入现有扫描(R7)**:二者可编辑可发布,现有「【待补】+无来源链接」扫描扩到它们成本低、价值高,且不需 facts 源(纯防注入,非 verbatim)。
- **闸下沉/单条路径推迟到 Phase 2**:`handlePublish` 无 snapshot 概念,统一覆盖需架构设计(R9)。Phase 1 仅在 batch authorized 路径止血,并加守护测试记录单条路径未覆盖。
- **gate-runs-on-shipped-draft 不变量**::332 与 :356 同 loop 体读同一 `item.draft`,Phase 1 断言此不变量。
- **命名对齐**:plan 内统一用 `evaluateGrounding`(注入点参数名沿用 `checkGrounding`)。

## Open Questions

### Resolved During Planning

- 是否拆阶段 → 是(用户确认),Phase 1 最小止血。
- Phase 1 是否需 FACT_TARGET/verbatim → 否,推迟 Phase 2。
- subtitle/description Phase 1 处理 → 纳入现有扫描(R7)。
- 单条发布路径 → Phase 2(架构,无 snapshot 概念)。

### Deferred to Phase 2(需 /ce:brainstorm 重定 WHAT)

- **tags 源头**:facts.题材/标签是自由文本字符串,draft.tags 来自 LLM 非 facts,且与 prompt-assembly 的 recommendedTags(分类推荐)关系未定 → 「tags ⊆ facts」不可直接实现,需先定源头口径。
- **title 只读 vs 强锚 + facts 编辑 UI**:无 facts 编辑入口时 title 只读会让抓错作品名死锁(retry 复用同 facts)。需先决定是否新增 facts 编辑 UI,再定 title 策略。
- **body 只读 enforcement**:当前可编辑;Phase 2 决定代码级只读 vs 纳入 verbatim/扫描。
- **verbatim 比对实现**:esc() 需从 post-assembler export 共用;body 用 esc 空间、URL 用 normalizeUrl、title/description 原值;`expectedTitle?` 注入缝(锁定参数方案,禁止 orchestrator 侧另比对以免口径分叉)。
- **strip UX**:诚实文案术语、grounded 不一致的撤销/恢复动作、缺 snapshot 老批次的群体性提示。
- **存量缺 snapshot 老批次 go/no-go**:R4 fail-closed 的存量影响盘点(见 Phase 1 Unit 2 阻塞前置)。

### Deferred to Implementation(Phase 1)

- **[阻塞前置 Unit 2 合并]** 存量缺 snapshot 老批次盘点:查 `PUBLISHER_DATA_DIR` 下 awaiting-approval 且 `assembledDraftSnapshot===undefined` 的项数。非零则 Unit 2 需提供「缺快照,请重新生成」清晰失败态(指向既有 retry);**不得**用现有 draft 回填 snapshot。此项为 go/no-go,**不是**纯 Deferred。

## High-Level Technical Design

> 方向性说明,非实现规范。Phase 1 闸求值(authorized 档):

```
snapshot = item.assembledDraftSnapshot
if (!snapshot)                          -> BLOCK "缺发布快照,请重新生成"   // R4
vSnap  = evaluateGrounding(snapshot,   facts)                              // R2
vFinal = evaluateGrounding(item.draft, facts)                              // R1
if (!vSnap.ok || !vFinal.ok)            -> BLOCK reasons(vSnap+vFinal)
else                                     -> sendFill(item.draft)
```

R7:`evaluateGrounding` 内现有 placeholder 扫描扩到 `draft.subtitle`、`draft.description`;现有 unsourced-link 扫描扩到 subtitle/description 文本。

## Implementation Units(Phase 1)

- [x] **Unit 1: evaluateGrounding 扫描扩到 subtitle + description**

**Goal:** 现有「【待补】/无来源链接」检查覆盖 subtitle、description(此前只查 title/body)。

**Requirements:** R7

**Dependencies:** 无

**Files:**
- Modify: `packages/extension/lib/grounding-gate.ts`、`packages/extension/lib/link-source.ts`(修 :3 陈旧注释)
- Test: `packages/extension/lib/grounding-gate.test.ts`

**Approach:** placeholder 检查加 `draft.subtitle`/`draft.description`;unsourced-link 检查的文本域并入 subtitle/description。不引入 facts verbatim(Phase 2)。

**Patterns to follow:** 现有 title/body 检查写法与 reasons 文案。

**Test scenarios:**
- Happy:干净 draft → 通过。
- Error:subtitle 含【待补】→ `ok=false`。
- Error:subtitle/description 含无来源 URL → `ok=false`。
- Error:description 含【待补】→ `ok=false`。
- Edge:既有 5 项测试不回归。

**Verification:** subtitle/description 的【待补】与伪 URL 被拦;既有测试全绿。

- [x] **Unit 2: orchestrator 闸改为「snapshot + 最终 draft」双求值 + 缺失 fail-closed**

**Goal:** authorized 档对 snapshot 与最终 draft 各跑一次 `evaluateGrounding`,任一不过即拦;snapshot 缺失直接拦不回退。

**Requirements:** R1, R2, R4

**Dependencies:** Unit 1;**阻塞前置:存量缺 snapshot 老批次盘点(见 Open Questions)**

**Files:**
- Modify: `packages/extension/lib/batch-orchestrator.ts`(~328-345)
- Test: `packages/extension/lib/batch-orchestrator.test.ts`(扩 U4 + bypass 套件)

**Approach:** 替换 `evaluateGrounding(snapshot ?? draft, ...)` 单次为:snapshot 缺失守卫 + 两次 `evaluateGrounding`(snapshot、draft);合并 reasons 走现有 `markGenerateFailed(..., 'grounding-blocked: ...')`;不改 `sendFill(item.draft)`。

**Execution note:** 复用既有注入缝;保留 2026-06-11 no-mock 集成测试语义。

**Patterns to follow:** test 的 U4 套件(896-981)、bypass 套件(989-1135)。

**Test scenarios:**
- Happy:snapshot 与 draft 均干净 → 继续。
- Error(核心负向):snapshot 干净但 draft 被手编注入【待补】/伪 URL(title/body/subtitle/description 任一)→ gate-failed(旧逻辑放行,守此回归)。
- Error(R2 回归):重写洗掉 draft【待补】,snapshot 仍含 → gate-failed。
- Error:snapshot 缺失 → gate-failed「缺发布快照」,不回退放行。
- Integration:save→load 往返后仍拦(沿用 bypass ③)。
- Edge:`off`/`dry-run` 不受影响(且 dry-run 仍渲染内容、不被新逻辑阻断)。

**Verification:** 手编注入、重写绕过、snapshot 缺失三路径 gate-failed;合法发布不阻;U4+bypass 既有测试绿。

- [x] **Unit 3: 单条发布路径守护测试 + 记录未覆盖边界**

**Goal:** 明确记录 `handlePublish` 单条路径当前不过 grounding 闸(无 snapshot 概念),加守护测试防未来误以为已覆盖;真正覆盖留 Phase 2(R9)。

**Requirements:** R9(部分:仅记录 + 守护)

**Dependencies:** Unit 2

**Files:**
- Modify(必要时): `packages/extension/entrypoints/background.ts`(注释标注 + 若可低成本传 checkGrounding 则传)
- Test: 对应 background/publish 测试

**Approach:** grep 确认所有 `orchestratePublish`/`sendGrant` 调用点;batch 路径已过闸;单条路径记录为 Phase 2 范围。加一个断言「batch authorized 发布必经 evaluateGrounding」的守护测试。

**Test scenarios:**
- Integration:batch authorized 发布路径必经闸(守护)。
- Test expectation:单条路径覆盖留 Phase 2,仅记录结论。

**Verification:** batch 路径有守护测试;单条路径边界在代码注释 + plan 明确记录。

## System-Wide Impact

- **Interaction graph:** 闸块在 `runBatch` authorized 档;`retryItem` 重建 snapshot+draft;`handlePublish` 单条路径(Phase 2)。
- **gate-runs-on-shipped-draft 不变量:** :332/:356 同 loop 读同一 `item.draft`,Phase 1 断言。
- **retryItem provenance(Phase 2 关注):** retryItem 当前以 `gen.draft` 作 snapshot(:537 第 7 参=draft),**非** assembleDraft 纯产物 → Phase 2 的 title 强锚若锚 snapshot.title 需先修此 provenance,否则锚被污染。Phase 1 不依赖该不变量(只用现有扫描,不做 title 强锚)。
- **Error propagation:** 不过闸 → `markGenerateFailed(..., 'grounding-blocked')`,UI 走既有失败展示。
- **Unchanged invariants:** `off`/`dry-run`、`sendFill` 发布对象、snapshot write-once — 不变。**注意:「body 只读」当前并非代码级不变量(DraftPreview body 可编辑),Phase 1 不依赖之;Phase 2 决定 enforcement。**

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| R4 fail-closed 拦截存量缺 snapshot 老批次 | Unit 2 合并阻塞前置:先盘点;非零给「缺快照请重新生成」态;不得用 draft 回填 |
| Phase 1 止血不覆盖作品名编造/tags/单条路径 | 明确记录为 Phase 2;Phase 1 文案不宣称完全闭合;adversarial 接受「先收窄再迭代」 |
| 命名混淆 evaluateGrounding/checkGrounding | plan 已统一;注入点参数名沿用 checkGrounding |
| 提交夹带无关文件 | 只提交相关文件 + 测试;提交前 `git diff` 核对 |

## Documentation / Operational Notes

- 修 `link-source.ts:3` 陈旧 DOMParser 注释。
- 上线前跑存量缺 snapshot 老批次盘点(go/no-go)。
- Phase 1 合并后开 `/ce:brainstorm` 定 Phase 2 WHAT(tags 源头、title/facts-UI、body 策略、verbatim、单条路径、strip UX)。

## Sources & References

- **Origin:** docs/brainstorms/2026-06-15-grounding-gate-publish-basis-requirements.md
- 约束:docs/brainstorms/2026-06-11-grounding-gate-rewrite-bypass-requirements.md
- 实践:docs/solutions/best-practices/incremental-pr-adversarial-verification-2026-06-15.md
- 代码:grounding-gate.ts、batch-orchestrator.ts:328-356、background.ts:180、post-assembler.ts、facts.ts、link-source.ts、DraftPreview.tsx
