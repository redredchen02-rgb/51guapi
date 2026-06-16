---
date: 2026-06-15
topic: grounding-gate-publish-basis
---

# 发布闸求值对象 = 实际发布对象(原 Theme E E2 / grounding strip 一致性)

## Problem Frame

authorized 发布存在**真实的防幻觉铁律泄漏路径**:grounding 闸求值 `item.assembledDraftSnapshot ?? item.draft`(batch-orchestrator.ts:332-335,优先不可变 snapshot),但实际填充发布的是 `sendFill(item.draft)`(batch-orchestrator.ts:356)——即操作者经 draftOverrides → patchBatchDrafts 改写过的 draft(只改 draft、不动 snapshot)。**闸检查的 artifact ≠ 发布的 artifact。**

后果:操作者在 awaiting-approval 态可手编 title/subtitle/tags/category/description(body 只读)。把 title 从有据作品名改成**编造名**(不触发【待补】、来源链接还在),snapshot 干净 → 闸放行 → 发布编造内容。闸全程没看过手编后的 draft。

**前提更正(本次评审推翻早先两版 framing):**
1. 早先「这不是铁律泄漏」错误——它只核验了「闸读 snapshot」,没核验「发布填的是 draft」。
2. 单纯「重跑现有闸于最终 draft」也不充分——现有闸只查残留【待补】+ 无来源链接,抓不住「有据作品名被改成编造名」这类不触发上述两项的注入;要堵它需校验 grounded 字段与 snapshot/facts verbatim 一致。
3. 又不能改成只读 snapshot 检查丢弃——否则回退已修复的 AI 重写洗【待补】绕过(见 docs/brainstorms/2026-06-11-grounding-gate-rewrite-bypass-requirements.md;snapshot 检查是那次的修复)。

真问题:**闸的求值对象与防护维度,未覆盖实际发布的手编 draft。** strip↔真闸的「认知错位」是这同一根因的 UI 表征。

## Requirements

**发布闸求值对象修复(P0,核心)**
- R1. authorized 发布前,grounding 闸必须对**实际将发布的 item.draft(含手编)**求值,使闸与发布是同一 artifact。
- R2. 闸必须**同时保留对 snapshot 的现有检查**(残留【待补】/无来源链接),防止回退 AI 重写绕过修复。snapshot 缺失或不过 → 拦。
- R3. 闸必须校验最终 draft 的 **grounded 字段(作品名/集数/链接等 verbatim 注入字段)与 snapshot/facts 一致**;被改成无据内容即拦。仅口吻散文槽位允许与 snapshot 不同。
- R4. assembledDraftSnapshot 缺失时 fail-closed 直接拦截,不回退到可编辑 draft(原窄路径)。

**Strip 一致性(从属,随 P0 修复大幅简化)**
- R5. 闸改为覆盖最终 draft 后,GroundingStrip(本就对编辑后 draft 求值)与真闸结论自动趋于一致;strip 显示**单一权威判决**即可,标注「此即发布时真闸结论」。不再需要原计划的双行(预览 vs 真闸)对照。
- R6. 闸因 grounded-字段不一致而拦时,strip 给出可读原因(哪个字段偏离 snapshot),便于操作者修正或撤销编辑。

## Success Criteria
- 操作者无法通过手编 draft(尤其 title)发布未经闸覆盖的内容;闸覆盖实际发布的 artifact。
- AI 重写洗【待补】绕过仍被拦(不回退既有修复)。
- snapshot 缺失项在 authorized 档一律被拦,无 fail-open。
- strip 显示的判决 = 发布时真闸判决,无「绿灯却被拦」/「以为修好却仍拦」困惑。
- 合法手编(口吻散文润色)不被误拦。

## Scope Boundaries
- 不引入「手编后重新生成 snapshot」机制(动铁律边界,属另一次 brainstorm)。
- 不让 body 正文变为可手编(维持只读)。
- 不保留原计划的双行 strip(R5 已使其多余)。
- 后端不新增 grounding 路由(逻辑维持扩展端 fail-closed)。

## Key Decisions
- 闸求值对象改为最终 draft + 保留 snapshot 检查 + grounded 字段 verbatim 校验三者并存:任一不过即拦。理由:三条分别堵手编注入、AI 重写绕过、作品名编造,缺一不可。
- 不采「authorized 从 snapshot 填充」:会丢弃合法的口吻散文手编;改为「门控实际发布的 draft」更精准。
- 不采「禁止手编 grounded 字段」:作为 R3 校验的替代手段过严,且 UI 改造面更大;R3 的 verbatim 校验已覆盖该风险。
- strip 简化为单行权威判决:闸覆盖最终 draft 后,双行对照的前提消失(adversarial/subtraction 检验)。

## Dependencies / Assumptions
- snapshot 在正常生成路径写入(markFilled 深拷贝,batch.ts:107-136);R4 处理异常/老批次缺失。
- grounded 字段集(哪些字段属 verbatim 注入、哪些属口吻散文)需从 shared/post-assembler.ts + facts 结构确定(planning)。

## Outstanding Questions

### Deferred to Planning
- [Affects R3][Technical] grounded 字段 verbatim 校验的具体实现:逐字段比对 draft vs snapshot,还是比对 draft vs facts?字段清单从 post-assembler.ts 哪个结构取?
- [Affects R1/R2][Technical] 闸三条检查在 batch-orchestrator.ts:332 处的组织方式:扩展 checkGrounding/evaluateGrounding 签名,还是新增独立校验步?需保证 UI strip 与 orchestrator 复用同一纯函数(避免再次口径分叉;feasibility 指出链接项在 DOM/无 DOM 环境本有口径差)。
- [Affects R4][Technical] 存量缺 snapshot 的 awaiting-approval 老批次:fail-closed 上线会批量拦截历史合法内容——量级多少?一次性回填 snapshot(须来自 post-assembler 而非现有 draft,否则把脏 draft 洗白)、豁免、还是接受被拦?上线前需 go/no-go 判据,不能纯 Deferred。
- [Affects R5][Needs research] 单条发布路径(publish-orchestrator.ts)是否也展示 GroundingStrip / 有同类错位?本 feature 是否需覆盖单条路径。
- [Affects R6][Technical] grounded-字段不一致时 strip 文案与出口(修正/撤销编辑/移入隔离区)。

## Next Steps
→ /ce:plan for structured implementation planning
