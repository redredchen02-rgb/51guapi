---
date: 2026-06-15
topic: grounding-phase2-full-field-protection
---

# Grounding 闸 Phase 2:完整 grounded 字段防护

## Problem Frame

Phase 1(PR #23)已止血发布闸的求值对象错位(snapshot + 最终 draft 双求值 + fail-closed + subtitle/description【待补】扫描)。但 Phase 1 评审揭出更大的攻击面尚未覆盖:操作者(或模型)可手编**会发布的字段**注入未经事实核实的内容,绕过防幻觉铁律——
- **body 实际可编辑**(DraftPreview body textarea 无 readOnly,「只读」仅注释级);
- **title(作品名)/description(简介)可手编**成编造内容,Phase 1 只查【待补】不查 verbatim;
- **subtitle 纯散文**可塞伪信息(Phase 1 已扫【待补】,但散文本就允许);
- **tags/category 来自 LLM**(非 facts),可编可发,无任何校验;
- ~~**单条发布路径 handlePublish 零闸**~~ → **已决定退役该死路径**(UI 零调用);裸奔 authorized 出口由删除消除,不再「下沉闸」。详见 `2026-06-15-publish-action-robustness-requirements.md`。

统一框架:防幻觉铁律的本质是「grounded 事实(作品名/集数/链接/简介)来自操作者 facts **verbatim**,模型只写口吻散文」。Phase 2 据此把「字段是否可手编」与「字段是否 grounded」对齐:**grounded 字段只读(改它须改 facts → 重新生成),口吻散文可编 + 扫描**。

受影响者:操作者(审核发布流程变化——不再能手打作品名/正文,改走 facts);防幻觉铁律(从「部分字段被守」升级为「所有发布字段被守」)。

> **术语**:`assembledDraftSnapshot` = `assembleDraft()` 的直接产物;snapshot provenance 不变量要求它只能由该产物写入,全文「snapshot」「assembleDraft 纯产物」均指此。

## Requirements

**字段可编辑性策略(核心)**
- R1. grounded 字段在审核 UI 改为**只读**(UI 层 `readOnly` + 闸层 defense-in-depth 不接受其变更):title(含作品名)、body(整块,含集数/制作/链接的组装 HTML)。
- R2. 口吻散文字段保持**可编辑 + grounding 扫描**:subtitle;description 仅在 prose-fallback 态(见 R3)可编。
- R3. description 为**双态**且由 facts.简介 是否在场**自动判定**(非手动切换):在场→视为 grounded、只读;缺→prose fallback、可编 + 扫描。
- R4. body 不提供手编;不满意走「重新生成」(符合「AI 生成 → 人审阅 → 填充」产品模型)。grounded 内容(如链接)有误也经重生成修正,非字段级编辑——此为接受的取舍。

**全发布字段覆盖**
- R12. 审计 fillers.ts/field-mapping.ts 的**全部会发布字段**,确保无遗漏:除已覆盖的 title/subtitle/body/description/tags/category,还有 coverImageUrl(隐藏 `cover_url`,URL 类→需来源校验)、postStatus、mediaId、publishedAt 等。每个字段明确归类(grounded 只读 / prose 可编+扫描 / 操作者元数据不校验),不留隐式裸奔。

**facts 编辑 UI + 重新生成**
- R5. 新增 facts 编辑 UI:操作者可在审核区编辑该项的 FactsBlock(作品名/集数/制作/漢化/無修/题材/简介…),用于修正抓错或补缺的事实。
- R6. facts 编辑后**手动点「重新生成」**才调 LLM 重新组装(成本可控);重新生成同时刷新 draft 与 assembledDraftSnapshot(snapshot 来源仍为 assembleDraft 纯产物)。
- R7. title/body 只读后,缺/错作品名的唯一修正路径 = 编辑 facts.作品名 → 重新生成(解死锁)。

**tags/category 校验**
- R8. tags 逐元素必须 ∈ 该分类的允许标签集(recommendedTags / 后台分类合法标签);category 必须 ∈ 后台合法选项集。不在集内即拦。来源为分类规则,不依赖 facts。

**全路径覆盖**
- R9. ~~单条发布路径纳入闸~~ → **改为:退役单条发布死路径**(handlePublish / PUBLISH_PAGE / requestPublish,UI 零调用)。裸奔 authorized 出口由**删除**消除,**不再需要**「从页面反向回读 draft + 建快照来源」这一子工程。落地见 `2026-06-15-publish-action-robustness-requirements.md`(R1–R3、R5 诚实硬化)。

**Strip UX**
- R10. GroundingStrip 显示与发布闸一致的可读判决 + 拦截原因(哪个字段/事实)。
- R11. strip 文案诚实:绿不等于发布必过时,标注另需通过的检查(如生成期 snapshot 校验);grounded 字段已只读,操作者修正路径指向 facts 编辑而非手改字段。

## Success Criteria
- 操作者无法通过手编**任何会发布的字段**(title/body/subtitle/description/tags/category)发布未经事实核实或不在分类允许集的内容。
- 抓错/缺作品名可经 facts 编辑 → 重新生成修正,无死锁。
- 单条发布死路径已退役;authorized 档下**唯一发布出口**为批量审批路径(经同一双求值闸),无裸奔出口。
- 合法的散文润色(subtitle / prose-fallback description)不被误拦。
- 防幻觉铁律的求值基准维持不变(snapshot 来源恒为 assembleDraft 纯产物)。

## Scope Boundaries
- 不引入「手编后不重新生成 snapshot 直接改 snapshot」机制(snapshot provenance 不变量:仅 assembleDraft 产物可写)。
- 不做 body 的结构化分块编辑(body 整块只读)。
- 不改 off/dry-run 档行为(仅 authorized 拦截)。
- 后端不新增 grounding 路由(逻辑维持扩展端)。

## Key Decisions
- 路线 A「grounded 只读 + facts 编辑 UI」而非「保留可编 + verbatim 校验」:最契合铁律(事实只能来自 facts),且让 grounded 字段无法被手编后,verbatim 子串/esc() 转义的脆弱比对面大幅缩小(只读字段无需运行期 verbatim)。代价是 UI 改造较大(facts 编辑 + 字段只读化)。
- body 整块只读而非散文块可编:body 是组装 HTML,混有 grounded 与散文;整块只读最简,符合产品「生成→审阅→重生成」节奏。
- tags/category 校验锚分类允许集而非 facts:因 tags/category 本就来自 LLM/分类规则而非 facts,allow-list 是正确的真相源。
- facts 编辑后手动重新生成而非自动:控制 LLM 成本,意图明确。
- ~~单条路径下沉闸而非废弃:保留单条发布能力~~ → **改判:单条死路径退役(废弃)**。它 UI 零调用、与批量路径功能重复但缺其安全;删除一刀消除裸奔出口 + 清死代码 + 塌缩本文 R9 的回读+快照子工程。被删的是「无 grounding 的裸奔能力」;APPROVE_SINGLE_ITEM 仍覆盖「发布一条**经 grounding 的** item」。详见 publish-action-robustness 文档。

## Dependencies / Assumptions
- 重新生成复用现有 retry/generateDraft 管线(已重建 snapshot)。
- 后台分类的合法标签集 / category 选项集可从现有 field-mapping / prompt-assembly recommendedTags 取得。
- ~~单条发布路径能从目标页回读结构化 draft~~ —— **已作废**(单条路径退役,不再需要回读;见 R9 / publish-action-robustness 文档)。
- **facts 是信任根**:本方案把「事实正确性」前移到 facts。操作者在 facts 填入错误/编造内容(含 facts.漢化/無修 的伪 URL),重新生成后会被视为「有来源」而过闸。这是设计上接受的边界(操作者对 facts 负责),非本方案能消除;只读化只是杜绝「绕过 facts 直接手编输出」。
- **本需求文档评审降级声明**:document-review 本轮 5 persona 中 4 个(feasibility/security/design/adversarial)因 API 529 过载失败,仅 coherence 完成;其余角度由主代理 inline 自审补足(已整合进 R12、上述 facts 信任根、下方 Outstanding Questions)。planning 阶段建议补跑完整多 persona 评审。

## Outstanding Questions

### Deferred to Planning
- [Affects R5][Technical] facts 编辑 UI 的落点与表单形态(审核区内联展开 vs 弹层);FactsBlock 哪些字段开放编辑(必须含作品名,否则 R7 解死锁路径失效——见 coherence 评审)。
- [Affects R6][Design] 重新生成会丢弃操作者已做的散文手编(如 subtitle 润色):是否警示「重生成将覆盖你的编辑」,或先暂存散文编辑再回灌?
- [Affects R8][Needs research] tags/category allow-list 权威源:recommendedTags 是推荐非强约束——是否存在后台真正的合法标签白名单?category 选项取 field-mapping select 还是后台动态?**这是 R8 能否落地的前置。**
- [Affects R8][Needs research] 「分类允许标签集」的权威来源:recommendedTags(prompt-assembly)是推荐非强约束,后台是否有真正的合法标签白名单?category 合法选项集从 field-mapping 的 select 选项取还是后台动态?
- [Affects R3][Technical] description grounded/prose 双态的判定与 UI 切换(facts.简介 在场→只读,缺→可编)。
- [Affects R1][Technical] body/title 只读化对现有 DraftPreview/ItemCard 交互的影响面(onDraftChange/draftOverrides 链路)。

## Next Steps
→ /ce:plan for structured implementation planning
