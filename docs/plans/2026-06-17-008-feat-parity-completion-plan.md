---
date: 2026-06-17
topic: parity-completion
type: feat
status: backlog
companion: ./2026-06-17-007-refactor-deep-master-plan.md
---

# 51guapi 对等补齐 feat 计划(从 Deep 重构总纲分流)

> **为什么单独成计划**:Deep 重构总纲严守「纯重构 = 行为保持」铁律。以下条目都需要**改/补行为**,故从总纲分流到此(用户决定:「对等补齐另开 feat 计划」)。本文件是 **backlog stub**——记录意图、依赖、范围边界,留待 `/ce:plan` 逐条深化为可执行计划。**未排期、未承诺,纯候选。**

## 背景

51guapi 由发布器重塑而来,重塑后有些能力处于「半成品 seam」或「缺口」状态:不是死代码(有前瞻价值),但当前**无行为**。把它们补齐 = 行为变更 → 不属于纯重构。

## 候选项

### F1 · 接入 review/rewrite 到 UI(AI 二次润色/改写)
- **现状**:backend `services/llm.ts` 有审稿/改写端点,extension `lib/llm.ts` 有 `reviewDraft()`/`rewriteDraft()` client,但**无任何 UI 调用方**(半成品 seam)。
- **决定**:用户已选「保留为 feat seam」,故重构期**不删**(总纲 P4-1 拆 llm.ts 时只拆不删)。
- **范围**:在草稿预览处加「AI 润色/改写」入口 → 调 client → 展示 diff → 人工采纳。
- **依赖**:总纲 P4-1(llm.ts 拆分后 review/rewrite 模块更清晰)。
- **边界**:仍受「绝不发布」硬约束——只改草稿,不写回站点。

### F2 · metrics counters 生产路径真实递增
- **⚠️ 现状(2026-06-17 核验修正)**:并非「生产全 0」。核验实况:
  - ✅ `recordScraperRun()` **已接入生产**——`gossip-routes.ts:208/221/246` 与 `scraper-routes.ts:210/214` 的成功/失败分支均调用。scraper 维度计数**已真实递增**。
  - ❌ `recordDraft()` 导出但**无任何调用方**(孤立)→ draft 维度生产恒 0。
  - ❌ `recordBatchCompleted()` 死的发布器残渣(总纲 P1-1 已计划纯删)。
  - `metrics.test.ts` 直接改写 counters 再读回 → **draft 维度测试仍假阳性**(TODOS.md P2)。
- **范围(收窄)**:只需把 `recordDraft()` 接到 draft 生成成功/失败路径;加 e2e 断言 draft 计数真实反映在 `/metrics`。scraper 维度无需动(已接)。
- **行为变更**:`/metrics` 的 draft 维度从恒 0 变真实值 → feat 非重构。
- **注意**:总纲 P1-1 已删的是**死的** `recordBatchCompleted`(发布器 batch 概念);本项接的是**活的** guapi 路径 counters,二者不冲突。

### F3 · backend 接入链接校验(防幻觉 grounding parity)
- **现状**:链接校验(`verifyLinks`/`extractLinks`/`normalizeUrl`)仅 extension 有;backend 提炼草稿时不做链接 grounding 校验。
- **依赖**:总纲 P3-2 把 `link-source` 搬进 shared(单一真相)之后,backend 才能复用。
- **范围**:backend 在 `gossip-fact-extractor` / 草稿生成路径接入链接校验,拒绝/标注未验证链接。
- **行为变更**:backend 多一道 grounding 闸 → feat。

### ~~F4~~ · off-mode / trajectory 状态命名澄清 → **核验:已死,移出 feat**
- **2026-06-17 核验结论**:全包 grep `handleApproveBatch` / `fill-completed` / `off-mode` / `trajectory` **无任何符号存活**,已随发布机器整删。
- **处置**:不属 feat(无行为可补)。已是死代码,无残留可删 → **本项关闭**,从候选移除。原 TODOS.md P3 视为已解决。

## Scope Boundaries(明确非目标)

- **绝不发布/填充/写回任何站点**——所有 feat 仍受此硬约束,F1 的「改写」只动本地草稿。
- 不在此计划做纯重构(那些在 [总纲](./2026-06-17-007-refactor-deep-master-plan.md))。

## Next Steps

→ 各条目独立 `/ce:plan` 深化(建议顺序:F2 最独立可先做 → F1 → F3 依赖总纲 P3-2 → F4 先验证存活)。
