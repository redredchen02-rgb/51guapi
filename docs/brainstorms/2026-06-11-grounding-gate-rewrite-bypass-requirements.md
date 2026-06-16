---
date: 2026-06-11
topic: grounding-gate-rewrite-bypass
---

# 修复 grounding gate 被 AI 评审重写绕过的防幻觉漏洞

## Problem Frame

防幻觉是本产品的核心铁律:作品名/集数/链接等事实由操作者 verbatim 注入,模型碰不到;缺失的事实位由 `post-assembler` 标成 `【待补】`,grounding gate 见到 `【待补】` 或无来源链接就拦截(gate-failed),逼操作者补全事实再发。

2026-06-11 路径 B 真发冒烟实测发现:一个**零事实**的选题(`冒烟测试:缺事实选题`)本应被 gate 拦成 gate-failed,实际却进了「待审」(可发布),并显示「✦ 已自评优化」。

根因(已在已提交代码 HEAD 确认):`batch-orchestrator.ts` `runBatch` 的顺序是 **生成 →(标题质量不过则)AI 评审重写 → grounding gate**。`mergeRewriteResult` 在 `title_quality` 维度不过时用 AI 重写的标题覆盖原 `【待补】`;等 gate(HEAD 第 178 行 `gateCheck(draft, …)`,`draft` 已是重写后)检查时,占位符已被 AI 编造内容填掉 → 放行。即 **AI 重写"洗白"了未接地内容,使防幻觉硬闸失效**。

影响面:这不止影响备稿阶段的 gate-failed 分流信号——发布前硬闸(`approveBatch` 的 `checkGrounding`)同样只查草稿里的 `【待补】`,占位符一旦被重写抹掉,**真发硬闸也会一并放行**,可能把模型编造的作品名/内容真发上线。

## Requirements

- R1. grounding gate(备稿阶段 `evaluateGrounding` 与发布前 `checkGrounding`)的判定必须基于**重写前**的草稿内容(`post-assembler` 直接产出的原稿),AI 评审重写不得改变 gate 的判定结果。
- R1b.(P0,审查共识)`post-assembler` 原稿快照必须**独立持久化**到 BatchItem(如 `assembledDraftSnapshot`),写入后只读、绝不被 `mergeRewriteResult` 或后续 `save` 覆盖;**发布前硬闸 `checkGrounding` 必须读该快照,而非已被重写覆盖的 `item.draft`**。当前 `markFilled` 持久化的是重写后 `draft`,故只改 gate 的输入仍会让真发硬闸读到洗白稿放行——真发幻觉洞不闭。这是本修复的承重点,不是 planning 的倾向性选择。
- R2. 零事实 / 关键事实缺失的选题,产出的草稿带 `【待补】`,无论 AI 重写是否运行,最终都必须落 gate-failed(备稿)/被发布前硬闸拦截(真发),不得进入「待审」或真发;两条路径的 gate 目标都必须是持久化的原稿(R1b),而非重写后内容。
- R3. 回归测试覆盖该路径:① 构造「标题质量评审不过 + 缺事实(标题 `【待补】`)」的草稿,**不 mock 真实 gate + 真实 `mergeRewriteResult`**,断言重写后该条仍被 gate 判为 gate-failed;② 断言零事实选题经 `post-assembler` 组装产物确实带 `【待补】`(守护 R2 的前置假设);③ 断言持久化往返(save→load)后原稿快照仍含 `【待补】`,`checkGrounding` 读快照仍拦截(守护 R1b);④ 断言 `markGateFailed` 后的条目不被 `presentForApproval` 升格为 awaiting-approval(独立守护 Assumption 2)。

## Success Criteria

- 重放冒烟场景(零事实选题 + 评审触发重写):该条落 gate-failed,而非「待审」。
- 防幻觉铁律恢复:任何 `【待补】` 缺失事实的草稿,AI 重写都无法使其通过备稿 gate **或发布前硬闸**(真发路径用持久化原稿快照实测)。
- gate-failed 条目向操作者展示的草稿应能让其判断缺哪些事实(占位符可见或原稿可查),而非只看到 AI 重写后的编造内容。
- 有事实、内容合格的正常选题不受影响:仍正常重写优化、进入待审、可真发。

## Scope Boundaries

- 不改 gate 的检测规则本身(仍是 `【待补】` 占位 + 无来源链接);只改"gate 评估哪一份草稿"。
- 不做「生成前事实完整性预筛」(本次已明确否决,见 Key Decisions);选题照常生成草稿,让操作者看到内容判断补哪些事实。
- 不重构 Phase 3 评审/重写管道的其他行为(fail-open、token 计量、三态 aiReviewTriggered 语义均保持)。
- 不处理「重写在 gate 通过的草稿上**新引入**无来源链接/幻觉」这一独立风险(列入 Outstanding,本次不扩范围)。**注意暴露面**:R1b 让 gate 锚定原稿快照后,重写后产物(= 实际展示 + 真发的 `item.draft`)完全不过 grounding 检查;对有事实的正常选题,重写新编造的链接/作品名可真发上线,只靠操作者人工审核兜底。本次接受此风险,但需在 Outstanding 显式记录,避免后续误以为已覆盖。

## Key Decisions

- **gate 位置 = 生成后、但评估重写前的原稿**(操作者选定):选题照常生成草稿(操作者能看内容判断缺哪些事实),但 gate 的判定锚定在 `post-assembler` 原稿上,重写不得影响判定。否决了「生成前预筛缺事实」(省 token 但操作者看不到草稿、且要新定义"哪些事实算关键")。
- **真发硬闸同样需修**:`checkGrounding` 与备稿 `evaluateGrounding` 是同一漏洞的两个面;只修备稿 gate 不够——必须保证真发前判定也锚定未被重写污染的内容。

## Dependencies / Assumptions

- 假设 `post-assembler` 对缺失事实确实注入 `【待补】`(已确认:缺作品名 → `title=【待补】`)。
- 假设备稿 gate-failed 的草稿不会进入 `awaiting-approval`,故不会到达真发——但 R1 仍要求真发硬闸独立锚定原稿,作为纵深防御(防止未来管线顺序变动重新打开缺口)。

## Outstanding Questions

### Deferred to Planning

- [Affects R1][Technical] 实现机制二选一:(a)把 gate 调用**移到重写之前**(reorder);(b)在重写前**捕获原稿快照**,gate 在原位评估该快照。**两者对备稿 gate 等效,但对真发硬闸不等效**——只有 (b) 的快照天然支持 R1b(持久化供 `checkGrounding` 锚定)。若选 (a) reorder,仍须**独立**持久化原稿快照供真发闸使用,否则真发洞不闭。planning 按改动面/可测性定,但必须满足 R1b。
- [Affects R1b][Technical] 原稿快照的持久化字段与展示用的重写后 `draft` 必须**物理分离**,且贯穿 `createBatch`/`markFilled`/`batch-sync` 双写/序列化;旧批次缺该字段的降级路径需定义(无快照时 `checkGrounding` 回落到何种安全行为)。
- [Affects R3][Technical] 备稿 gate 的现有单测注入 mock `evaluateGrounding`;需新增**不 mock、走真实 gate + 真实 mergeRewriteResult**的集成测试才能复现该漏洞。

### 实施风险(Resolve Before Planning 不阻塞,但实施者必读)

- ⚠️ **工作树 `batch-orchestrator.ts` 当前有约 880 行未提交 diff**,来自不可信的并行进程(同批还动了 `.gitlab-ci.yml`/`telegram.ts`/Docker 等无关文件)。其中混有一个未提交的 `assembledDraft` 改动**已让备稿 gate 半边读原稿(line 175/225)**——即备稿半边可能在工作树里已"修了",但 HEAD 没有,且该 diff **不可信任/采用**。
  - 实施第一步:`git diff packages/extension/lib/batch-orchestrator.ts` 确认**实际起点**,不要假设 HEAD line 178 就是待修代码;真正未修的是 **R1b 真发硬闸 + 持久化半边**(无论工作树备稿半边状态如何)。
  - 隔离策略:建议用 `git worktree` 从干净 HEAD 拉独立分支重做,**不在当前污染工作树上操作**;那 130+ 改动文件由谁负责、是否保留需先确认,避免 reset 误删。
  - 提交闸:提交前人工 `git diff` 核对本次 commit **只含** `batch-orchestrator.ts` + `batch.ts`(快照字段)+ 测试,**绝不含** `.gitlab-ci.yml`/`telegram.ts`/Docker 等无关文件。

## Next Steps
→ /ce:plan for structured implementation planning
