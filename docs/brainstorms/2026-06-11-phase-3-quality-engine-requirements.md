---
date: 2026-06-11
topic: phase-3-quality-engine
---

# 阶段 3：质量引擎

## Problem Frame

Phase 2 完成了度量与学习地基（直发率追踪、few-shot 编辑器、aiDraft diff、degrade 统计）。
但核心痛点仍未解决：**AI 草稿四维质量普遍偏低**——正文内容太窀/太水、口吻/风格不对、
标题不够吸引、分类/标签错误——导致每条帖子都需要大量手动改稿，审核成为真正的速度瓶颈。

Phase 3 的核心目标是**让操作者看到的草稿质量显著提升**，使「直发率」从当前基线稳定达到
≥70%，并在质量提升的过程中顺带降低审核认知负担，实现质量与产能同步增益。

**根本假设**：草稿质量是主要瓶颈，而非选题数量或审核 UI。验证方式：Phase 3 完成后，
直发率指标应明显爬升（用 Phase 2 建立的 trajectory 追踪）。

---

## 阶段 3 过闸闸门

> 直发率（`hasManualEdit === false`）在 ≥10 篇 authorized 发布数据窗口内稳定 ≥70%；
> AI 自评触发率和重写效益可从 trajectory 读取。

---

## Requirements

**核心质量组（过闸前必交付）**

*AI 自评重写*

- R1. **AI 二次评审**：生成草稿后，以固定评审 prompt 发起第二次 LLM 调用，对生成结果按
  四个维度打分：①正文丰富度、②社区口吻/风格、③标题吸引力、④分类/标签准确性。
  若所有维度均通过，原草稿直接进批次队列；若任一维度不通过，进入 R2 重写步骤。
  最多触发 1 次重写（不循环）。

- R2. **定向重写**：仅针对 R1 不通过的维度调用重写 pass，其他维度保持原稿不变。
  重写结果覆盖 BatchItem.draft（操作者不可见原稿）。
  使用 fallbackModel（若已配置）降低二次调用成本；fallbackModel 未配置则复用主 endpoint。

- R3. **成本透明**：二次调用的 llmCostTokens 独立累加到 BatchItem.llmCostTokens，
  并在 trajectory 中以 `reviewCostTokens` 字段单独记录，方便成本对账。
  BatchItem 新增 `aiReviewTriggered?: boolean`（是否触发重写）。

- R4. **批次审核 badge**：BatchItem 卡片在被重写时显示「✦ 已自评优化」徽章（灰色，低调）；
  未触发重写时不显示任何 badge。批次详情汇总条新增「N 条自评已优化」统计（仅 done 阶段显示）。

*评审 Prompt 管理*

- R5. **评审 prompt 可配置**：Settings 中新增「评审标准 prompt」文本框，存入
  `Settings.reviewCriteriaPrompt`；为空时使用内置默认评审标准
  （覆盖四维：丰富度/口吻/标题/分类标签）。操作者可针对社区特定风格覆盖默认标准。

**运营先决条件组（与核心质量组并行，不阻塞过闸）**

- R0-fix. **P0 修复**：`vitest.config.ts` 排除 `packages/**`，使 `pnpm test` 零失败
  （当前 8 个后端测试文件因 fastify/better-sqlite3/@51publisher/shared 缺失而报错）。

- R6. **首飞观察项补档（U6 续）**：创建 `docs/run-sheet-首飞与基线.md`，
  预填结构化表格供操作者填写五项观察（cover_url 类型、session 寿命、隐藏帖可见性、
  save 响应 URL、发布时间戳）。结论影响 R19（封面）、R8（publishUrl）的后续规划。

**后闸门组（闸门通过后评估是否需要）**

- R7. **直发率仪表盘**：在 side panel 主视图中新增「质量概览」折叠区，
  展示：直发率（最近 N 篇）、每篇平均 LLM 成本、AI 自评触发率。
  数据源：本地 trajectory（客户端计算，不依赖后端）。
  *闸门通过后评估：若数据已被高频手动查看，则有交付价值；否则延后。*

- R8. **批次快速审核快捷键**：在 BatchReviewPanel 添加键盘快捷键（「→」下一条、
  「Space」批准当前、「ESC」中止）。*优先级低于 R1-R5，质量提升后再评估是否需要。*

---

## Success Criteria

- **直发率指标**：≥10 篇 authorized 发布后，直发率（`hasManualEdit === false`）≥70%。
- **自评触发率可读**：trajectory 中可查 `aiReviewTriggered === true` 的比例。
- **测试全绿**：`pnpm test` 零失败，`pnpm compile` 零错误。
- **run-sheet 补档**：`docs/run-sheet-首飞与基线.md` 存在并包含 5 行观察条目（允许部分「待核实」）。

---

## Scope Boundaries

- **不做自动发布**（隐藏态自动发被 Phase 2 评审击穿后推翻）；操作者仍需批准每批次。
- **不做 A/B prompt 框架**；Phase 3 只做单一 prompt 优化循环，A/B 基础设施延后到证明需要时。
- **不做批量自动审核**（sampling/全自动档继续延后，需 U9b 威胁模型先行）。
- **R7 数据看板延后**：先收集数据，闸门通过后再决定是否交付 UI；不阻塞核心质量工作。
- **不做封面图自动化**（依赖 R6 run-sheet 中 cover_url 观察结论①，本阶段先补档）。

---

## Key Decisions

- **两次 LLM 调用（生成 + 评审）**：代价是每篇约 2x 成本，但评审与生成职责分离，
  比「单次 prompt 内自评」更可靠，也方便用 fallbackModel 降低评审成本。
- **操作者只看最终版**：不展示「原稿 vs 重写后」对比，设计更简洁；
  badge「✦ 已自评优化」提供最低程度的透明度。
- **最多 1 次重写**：避免无限循环和成本失控；第二次重写质量提升边际效益未知，先观察数据。
- **评审 prompt 可覆盖**：社区口吻/风格是高度定制化的，不应锁死在代码里。

---

## Dependencies / Assumptions

- Phase 2（feat/phase-2-measurement）已合并，trajectory 数据在生产环境已在采集。
- `packages/backend/dist/` 的后端实现已就位（published-posts-routes、migration 003）；
  Phase 3 不需要新的后端端点——评审调用在 `background.ts` 直接发出，与生成调用平级。
- `Settings.fallbackModel` 已可配置（U8 已交付，`lib/types.ts:85`：`{ endpoint: string; model?: string }`）；
  评审调用直接读此字段，fallbackModel 未配置时复用主 endpoint。

## 架构决策（可行性评审后补充）

以下决策在评审中发现为遗漏，需在规划时明确并反映到 U-level 设计中：

1. **评审 LLM 调用路径**：在 `background.ts` 独立发起（不修改 backend），调用
   `generateDraft` 等同层级的 `reviewDraft()` 函数（`lib/llm.ts` 新增）。
   使用 `Settings.fallbackModel.endpoint`（若配置）或主 endpoint + 更轻量模型。

2. **评审响应类型**：返回结构化 JSON，格式为
   `ReviewResult: { dimensions: Array<{ name: string; pass: boolean; reason?: string }> }`，
   需要在 `lib/llm.ts` 新增 `buildReviewRequest()` + `parseReviewResult()` 两个函数。
   **不**使用 `ContentDraft` 格式；评审 pass/fail 与草稿内容分离。

3. **定向重写合并逻辑**：失败维度（如 `body` + `tags`）调用一次重写 LLM 调用，
   仅把 `ContentDraft` 中对应字段从重写结果合并回原草稿（其他字段保持不变）。
   需要在 `lib/llm.ts` 新增 `buildRewriteRequest(draft, failedDims)` + 合并函数。

4. **批次状态机新增 `markReviewed()`**：`batch.ts` 需要新增 `markReviewed(batch, itemId, reviewResult)` 函数，
   写入 `BatchItem.aiReviewTriggered` + 合并 review token 到 `BatchItem.llmCostTokens`。
   `markFilled()` 在 `markReviewed()` 之前调用（现有接口不变）。

5. **llmCostTokens 基线问题**：根目录 `lib/llm.ts` 目前不提取 `response.usage`
   （只有 `packages/backend/dist/llm.js` 做了此提取）。Phase 3 实现时需在 `lib/llm.ts`
   补充 usage 提取，与后端实现对齐，否则 `BatchItem.llmCostTokens` 永远为 undefined。
   此工作归入 Phase 3 规划，不影响 R1–R4 的其余部分。

6. **评审调用 fail-open 行为**：评审 LLM 调用失败（网络/超时）时，
   用原草稿直接进队列（不阻塞批次）。`BatchItem.aiReviewTriggered` 区分三态：
   `undefined`（未触发评审）/ `false`（触发但所有维度通过，无重写）/ `true`（触发并重写）；
   调用失败时设 `aiReviewTriggered = undefined`（等同于未触发），不在 UI 中显示 badge。

---

## Outstanding Questions

### Resolve Before Planning

（无——所有方案分支均内嵌兜底路径，不阻塞规划启动。）

### Deferred to Planning

- [Affects R1][Needs research] 内置默认评审标准 prompt 的具体文本（四维 scoring 标准）；
  需对照 golden-set 中的「期望输出方向」制定，实现时从 `docs/eval/golden-set.md` 取材。
- [Affects R4, R7][UX] `aiReviewTriggered` 统计展示位置：是放批次详情顶部汇总条
  还是单独展示区？规划时结合 R4 badge 和 R7 延后决策一起确定。
- [Affects R0-fix][Technical] 是否同时将 `packages/` 加入 `.gitignore`（长期方案），
  还是仅修改 vitest 排除（短期方案）？建议两者同时做；规划时确认。
- [Affects R3][Technical] `lib/llm.ts` 补充 `response.usage` 提取时，
  字段名映射规则（不同代理端点可能为 `prompt_tokens` vs `inputTokens` 等）；
  实现时对照实际端点响应格式确认。

---

## 执行顺序建议

```
阶段 3 执行图
─────────────────────────────────────────────
立即：  R0-fix（P0 修复，1 行 vitest 改动）
        R6（run-sheet 模板，纯文档）
─────────────────────────────────────────────
核心：  R5 → R1 → R2 → R3 → R4
       [评审 prompt 配置] → [评审调用] → [定向重写] → [成本记录] → [badge]
─────────────────────────────────────────────
后闸门：收集 ≥10 篇数据 → 测量直发率
        → 若 <70%，迭代 R5 评审 prompt
        → 若数据已高频查看，交付 R7 看板
        → 若手速仍是瓶颈，交付 R8 快捷键
─────────────────────────────────────────────
```

## Next Steps

→ `/ce:plan` 进行阶段 3 结构化实现规划
