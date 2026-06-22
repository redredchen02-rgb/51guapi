---
title: "feat: 把提示词与基础配置全面切换到吃瓜场景（51瓜哥）"
type: feat
status: done
date: 2026-06-18
---

# feat: 把提示词与基础配置全面切换到吃瓜场景（51瓜哥）

## Overview

当前扩展的默认提示词与分类配置仍是 ACG/成人漫画场景（51娘、漫畫文章/動漫文章）。
后端吃瓜事实提取器（`gossip-fact-extractor`）已完成，但前端提示词与草稿组装逻辑
尚未跟上——吃瓜草稿的标题恒为"【待补】"（组装器读 `facts.作品名`，而吃瓜事实只有
`當事人`）。本次将提示词、分类词汇表、组装器、评审标准统一切换为吃瓜场景。

## Problem Frame

1. `DEFAULT_SETTINGS.promptTemplate`（扩展默认配置）：角色"51娘"，成人动画介绍站。
2. `buildConstraintSuffix`：分类约束写死"漫畫文章"/"動漫文章"。
3. `CATEGORY_VOCAB`（shared/vocab）：分类词汇表是 ACG 两选项，关键词全是漫画/动漫词。
4. `assembleDraft`（shared/post-assembler）：读 `facts.作品名`/`facts.集数`/`facts.漢化` 构建正文；
   吃瓜草稿无此字段，标题永远 `PLACEHOLDER`，来源链接永远不渲染。
5. `generateDraft`（backend/draft-gen）：`facts as unknown as FactsBlock`
   的强制转型掩盖了组装器不匹配的问题，且 grounding 闸用的是 `gossipFactUrls`（正确），
   但 body 组装用的是 ACG assembler（错误）。

## Requirements Trace

- R1. 默认提示词角色改为吃瓜场景，引导模型生成娱乐八卦口吻的草稿槽位（intro/highlights/titleSuffix 等）。
- R2. 提示词铁律不变：只根据 {{facts}} 事实写，禁止编造；绝不写 URL。
- R3. 分类词汇表和约束后缀替换为娱乐八卦类目（娛樂新聞 / 明星八卦）。
- R4. 新增 `assembleGossipDraft(slots, gossipFacts)` 组装函数，用 `當事人` / `發生時間` / `熱度標籤` / `來源連結` 构建标题+正文。
- R5. 后端 `generateDraft` 在 facts 为吃瓜类型时调用 `assembleGossipDraft`，而非 ACG assembler。
- R6. 所有受影响的测试更新以反映新场景；不变量（grounding、sanitize、placeholder 逻辑）不动。

## Scope Boundaries

- 不改后端 `gossip-fact-extractor` 的提炼提示词（已正确）。
- 不改 `post-assembler.ts` 中原有 `assembleDraft` 函数（保持 ACG 路径可用）。
- 不添加 UI 界面改动；分类下拉选项通过 `CATEGORY_VOCAB` 驱动（已有，只改内容）。
- 不修改 `DraftSlots` 接口定义（gossip 复用相同 slots 结构）。

## Context & Research

### Relevant Code and Patterns

| 文件 | 当前状态 | 需改内容 |
|---|---|---|
| `packages/extension/lib/storage.ts` | `DEFAULT_SETTINGS.promptTemplate` 是51娘 ACG | 替换为瓜哥吃瓜提示词 |
| `packages/extension/lib/prompt-assembly.ts` | `buildConstraintSuffix` 硬编码"漫畫文章" | 改为吃瓜分类标签 |
| `packages/shared/src/vocab.ts` | `CATEGORY_VOCAB` 两条 ACG 分类 | 替换为娱乐八卦两条分类 |
| `packages/shared/src/post-assembler.ts` | `assembleDraft` 读 ACG facts 字段 | 新增 `assembleGossipDraft` |
| `packages/backend/src/services/draft-gen.ts` | 强制转型 `facts as FactsBlock` 后调 ACG assembler | 判断 gossip facts，调吃瓜 assembler |
| `packages/backend/src/services/draft-review.ts` | `DEFAULT_CRITERIA` community_tone 已提及吃瓜 | 微调，使四个维度完全面向娱乐八卦 |

### Institutional Learnings

- **防幻觉不变量**（CLAUDE.md）：模型只写口吻槽位，事实由系统注入；本次 gossip assembler 同样遵循此约束。
- **grounding 闸**（draft-gen.ts）：`hasUnsourcedLink(verifyLinks(body, gossipFactUrls(facts)))` 用 `gossipFactUrls` 已正确取吃瓜来源 URL。gossip assembler 的来源链接从 `facts.來源連結` 注入，grounding 校验仍可通过。
- **tests → compile 顺序**（CLAUDE.md）：shared 先 build 才能跑 extension/backend 测试；更改 vocab/post-assembler 后需重跑 `pnpm --filter @51guapi/shared build` 再跑全套测试。

## Key Technical Decisions

- **重用 DraftSlots**：gossip 草稿复用相同的 `DraftSlots`（intro/highlights/titleSuffix/subtitle/outro/category/tags）。模型不感知 facts 字段名，保证两条路径可互换提示词模板。
- **新增而非修改 assembleDraft**：`assembleGossipDraft` 独立新函数，`assembleDraft` 保留原样。理由：现有 ACG 测试无需改动，避免合并两套字段导致函数复杂度爆炸。
- **gossip facts 检测**：在 `draft-gen.ts` 中检测 `facts` 是否含 `當事人` 字段来决定调哪个 assembler（而非传入显式 domain 参数），因为 `facts` 本身已携带足够类型信息，避免在调用链里透传额外参数。
- **CATEGORY_VOCAB 替换**：娛樂新聞（value="1"）/ 明星八卦（value="2"）作为两个占位值。由于系统是 export-only（不写回站点），value 数字只是内部占位符；若未来对接真实后台，直接改 CATEGORY_VOCAB 的 value 即可，其余逻辑不动。

## High-Level Technical Design

> *此图示说明各模块的调用关系，是设计方向指引，不是实现规格。*

```
Extension (prompt-assembly.ts)
  assemblePrompt(settings, topic, facts)
      ├── buildPrompt(template, topic, facts, fewshot)   ← 提示词模板（Unit 1）
      └── buildConstraintSuffix(recommendedTags)         ← 分类约束（Unit 2）
              "只能选「娛樂新聞」或「明星八卦」"

Backend (draft-gen.ts) generateDraft(prompt, deps)
  ├── callLLM → slots (JSON)
  ├── IS_GOSSIP? = "當事人" in facts
  │     ├── YES → assembleGossipDraft(slots, gossipFacts)  ← 新增（Unit 3/4）
  │     │         header: 當事人 / 發生時間 / 熱度標籤
  │     │         links:  來源連結 (verbatim)
  │     └── NO  → assembleDraft(slots, acgFacts)           ← 不动（ACG 路径）
  └── grounding guard → gossipFactUrls(facts) ✓（已正确）

Shared (vocab.ts)
  CATEGORY_VOCAB: [娛樂新聞, 明星八卦]                    ← Unit 2
  normalizeCategory: 关键词改为娱乐八卦词汇
```

## Implementation Units

- [ ] **Unit 1: 替换默认提示词模板（storage.ts）**

**Goal:** 将 `DEFAULT_SETTINGS.promptTemplate` 从"51娘"ACG 改为"瓜哥"吃瓜角色设定，生成同样的 JSON slots 结构（intro/highlights/titleSuffix/subtitle/outro/category/tags），但内容面向娱乐八卦。

**Requirements:** R1, R2

**Dependencies:** None

**Files:**
- Modify: `packages/extension/lib/storage.ts`
- Test: `packages/extension/lib/storage.test.ts`（验证 DEFAULT_SETTINGS 包含 promptTemplate 字段，无需断言内容）

**Approach:**

新提示词要点（维持 `{{fewshot}}{{topic}}{{facts}}` 三个占位符）：
- 角色：瓜哥（吃瓜娱乐资讯博主），口吻活泼，以"嗨！瓜哥来了"之类开场/结尾
- 任务说明：只写"口吻散文"槽位；当事人/时间/来源链接由系统注入，模型不写
- 铁律（保持防幻觉约束）：
  1. 只根据 【事实】（{{facts}}）写；禁止编造具体信息（人名、时间、情节细节等）
  2. 散文里绝不写任何 URL/链接
  3. 不罗列字段名，只写引子与看点的口语化叙述
- JSON 输出字段（与旧版相同结构）：
  - intro: 开场引子（瓜哥口吻，1–3句）
  - highlights: 看点介绍（2–4句，只用【事实】范围内信息）
  - titleSuffix: 标题后缀（如"出軌疑雲"、"官宣戀情"；系统会前置当事人名）
  - subtitle: 一句俏皮副标题
  - outro: 结尾招呼（可选）
  - category: 从已知分类选（娛樂新聞/明星八卦）
  - tags: 标签数组

**Patterns to follow:**
- 对照 `packages/extension/lib/storage.ts` 现有 `promptTemplate` 格式（join('\n') 数组）

**Test scenarios:**
- Happy path: `DEFAULT_SETTINGS.promptTemplate` 字段存在且为非空字符串
- Happy path: `promptTemplate` 包含 `{{topic}}` 和 `{{facts}}` 占位符
- Happy path: `promptTemplate` 不包含"51娘"或"漫畫"字样（回归检查）

**Verification:**
- `DEFAULT_SETTINGS.promptTemplate` 包含"瓜哥"字样，包含 `{{facts}}` 占位符

---

- [ ] **Unit 2: 替换分类词汇表与约束后缀**

**Goal:** 将分类从 ACG（漫畫文章/動漫文章）替换为娱乐八卦（娛樂新聞/明星八卦），让提示词约束和 `normalizeCategory` 都反映新场景。

**Requirements:** R3

**Dependencies:** None（可与 Unit 1 并行）

**Files:**
- Modify: `packages/shared/src/vocab.ts`
- Modify: `packages/extension/lib/prompt-assembly.ts`
- Test: `packages/extension/lib/vocab.test.ts`（全部重写，与新分类对齐）
- Test: `packages/extension/lib/prompt-assembly.test.ts`（更新分类名称断言）

**Approach:**

`vocab.ts` 改动：
- 将 `CATEGORY_VOCAB` 替换为两条吃瓜分类，value 暂用 "1"/"2"（export-only 场景，value 仅内部占位）
  - `{ value: "1", label: "娛樂新聞", keywords: /娛樂|娱乐|新聞|新闻|資訊|资讯/ }`
  - `{ value: "2", label: "明星八卦", keywords: /八卦|明星|藝人|艺人|吃瓜|緋聞|绯闻|爆料/ }`
- `FALLBACK_LABEL` 改为 `"娛樂新聞"`（模糊/缺失时默认娱乐新闻）

`prompt-assembly.ts` 改动：
- `buildConstraintSuffix` 中分类约束文字改为：`"只能选「娛樂新聞」或「明星八卦」"`

**Patterns to follow:**
- 现有 `CATEGORY_VOCAB` 结构（保持 `value`/`label`/`keywords` 三字段）

**Test scenarios:**
- Happy path: `normalizeCategory("1")` → `"娛樂新聞"`，`normalizeCategory("2")` → `"明星八卦"`
- Happy path: `normalizeCategory("娛樂新聞")` → `"娛樂新聞"`，`normalizeCategory("明星八卦")` → `"明星八卦"`
- Happy path: 关键词模糊命中（如 `normalizeCategory("八卦新聞")` → `"明星八卦"`）
- Edge case: `normalizeCategory("")` / `normalizeCategory(undefined)` → `"娛樂新聞"`（新 fallback）
- Happy path: `buildConstraintSuffix([])` 包含 `"娛樂新聞"` 且包含 `"明星八卦"`
- Happy path: `buildConstraintSuffix([])` 不再包含 `"漫畫文章"` 或 `"動漫文章"`

**Verification:**
- `pnpm test` 中 vocab 和 prompt-assembly 测试全绿
- `normalizeCategory` 对 ACG 关键词（如"漫畫"）返回 `FALLBACK_LABEL`（"娛樂新聞"）

---

- [ ] **Unit 3: 新增 assembleGossipDraft 组装函数**

**Goal:** 在 `post-assembler.ts` 中新增 `assembleGossipDraft(slots, gossipFacts)` 纯函数，使吃瓜草稿的标题、正文 header、链接区都能从 `GossipFactsBlock` 正确读取事实。

**Requirements:** R4

**Dependencies:** None（可与 Units 1、2、5 并行开发；Unit 4 依赖本 Unit）

**Files:**
- Modify: `packages/shared/src/post-assembler.ts`（新增函数，不改 `assembleDraft`）
- Modify: `packages/shared/src/index.ts`（导出新函数）
- Test: `packages/shared/src/post-assembler.test.ts`（新增 `assembleGossipDraft` 测试用例）

**Approach:**

组装逻辑：
- **标题**：`facts.當事人?.trim()` + `(slots.titleSuffix ?? "").trim()`；当事人为 null 时 title = `PLACEHOLDER`
- **描述**：`facts.事件摘要?.trim() || sanitizeToPlainText(slots.subtitle || slots.intro).slice(0, 120)`
- **Header 块**（只含已提供字段，verbatim，仿 ACG assembler 的 headerBits 模式）：
  - 若 `facts.當事人`：`當事人:${esc(name)}`
  - 若 `facts.發生時間`：`發生時間:${esc(time)}`
  - 若 `facts.熱度標籤`：`話題標籤:${esc(tags)}`
- **散文块**：intro、highlights（sanitizeToPlainText + esc，和 ACG 完全相同）
- **链接块**：`renderLink("來源連結", facts.來源連結)`（复用同一 renderLink 函数）
- **结尾**：outro（可选）

grounding 不变量：所有注入 body 的 URL 来自 `facts.來源連結`，`gossipFactUrls(facts)` 可正确枚举，grounding 校验通过。

**Technical design:**

```
// 方向性伪代码（不是实现规格）
function assembleGossipDraft(slots, facts):
  title  = (facts.當事人 ?? PLACEHOLDER) + (slots.titleSuffix ?? "")
  subtitle = sanitize(slots.subtitle)
  description = facts.事件摘要 || sanitize(slots.subtitle || slots.intro)[0:120]

  header_parts = [
    facts.當事人   → "當事人:${esc}"
    facts.發生時間 → "發生時間:${esc}"
    facts.熱度標籤 → "話題標籤:${esc}"
  ].filter(notNull)

  body = [
    header_parts → "<p>join(<br>)</p>"
    intro    → "<p>esc(sanitize)</p>"
    highlights→ "<p>esc(sanitize)</p>"
    renderLink("來源連結", facts.來源連結)
    outro    → "<p>esc(sanitize)</p>"  // optional
  ].filter(notEmpty).join("\n")

  return { title, subtitle, body, description }
```

**Patterns to follow:**
- `assembleDraft` 函数结构（`packages/shared/src/post-assembler.ts` line ~90+）：`headerBits`→`parts`→join 模式，`sanitizeToPlainText` + `esc`，`renderLink`

**Test scenarios:**
- Happy path: 完整 gossip facts → 标题 = `當事人 + titleSuffix`，body 含 header/intro/highlights/链接
- Happy path: `facts.當事人 = null` → title = PLACEHOLDER
- Edge case: `facts.來源連結 = null` → body 无链接块（整行省略，同 ACG renderLink 行为）
- Edge case: `facts.發生時間 = null` → header 块不含"發生時間"行
- Integration: grounding 校验 `verifyLinks(body, gossipFactUrls(facts))` → 无 unsourced link
- Integration: `sanitizeToPlainText` 已过的散文里不出现裸 URL（LLM 若偷插 URL → PLACEHOLDER）

**Verification:**
- `pnpm --filter @51guapi/shared build` 无 TS 错误
- 新测试用例全绿，且不影响原有 `assembleDraft` 测试

---

- [ ] **Unit 4: 后端 generateDraft 改用吃瓜组装器**

**Goal:** `packages/backend/src/services/draft-gen.ts` 中，当 `deps.facts` 为吃瓜类型时（含 `當事人` 字段），调用 `assembleGossipDraft` 替代 `assembleDraft`，消除强制转型 `as unknown as FactsBlock` 的不匹配。

**Requirements:** R5

**Dependencies:** Unit 3（`assembleGossipDraft` 必须先存在）

**Files:**
- Modify: `packages/backend/src/services/draft-gen.ts`
- Test: 无需新增测试文件；可在 `packages/backend/src/services/draft-gen.test.ts`（若已存在）补充一条 gossip facts 路径的 integration scenario

**Approach:**

检测逻辑（narrow the type，不引入 domain 参数）：
```
// 伪代码
function isGossipFacts(facts): facts is GossipFactsBlock {
  return "當事人" in facts
}

// 在 generateDraft 函数中：
const assembled = isGossipFacts(facts)
  ? assembleGossipDraft(slots, facts)
  : assembleDraft(slots, facts as FactsBlock)
```

同时：
- 移除原来的 `facts as unknown as FactsBlock` 强制转型
- grounding 闸（`gossipFactUrls` vs `factUrls`）已正确，无需改动

**Patterns to follow:**
- 现有 `generateDraft` 中 `assembleDraft` 调用（`draft-gen.ts` line ~300+）

**Test scenarios:**
- Integration: 传入 gossip facts（含 `當事人`="小明"）→ 返回 draft.title 含 "小明"（非 PLACEHOLDER）
- Integration: 传入 ACG facts（含 `作品名`）→ 仍调 `assembleDraft`，行为不变
- Error path: 两条路径的 grounding 校验都正常通过（来源 URL 可溯源）

**Verification:**
- `pnpm test` 全绿
- `pnpm compile` 无 TS 类型错误（无强制转型）

---

- [ ] **Unit 5: 微调 AI 评审标准（draft-review.ts）**

**Goal:** `DEFAULT_CRITERIA` 已包含"吃瓜口吻"，但 `body_richness` 描述还是通用的，`category_accuracy` 未提及吃瓜特征。微调四个维度描述，使其完全面向娱乐八卦内容。

**Requirements:** R1（配置全面吃瓜化）

**Dependencies:** None（可与 Unit 1 并行）

**Files:**
- Modify: `packages/backend/src/services/draft-review.ts`

**Approach:**

调整 `DEFAULT_CRITERIA` 四个维度描述：
- `body_richness`：保持字数要求，补充"包含事件来龙去脉，不空洞"
- `community_tone`：当前已较好（"含知情人/爆料/疑似等词汇"）；可再强化"语气活泼，符合吃瓜博主风格"
- `title_quality`：补充"标题含当事人名或事件类型关键词，让读者一眼知道是哪条瓜"
- `category_accuracy`：改为"分类是娛樂新聞或明星八卦，标签反映事件类型（如出軌、緋聞等）"

**Patterns to follow:**
- 现有 `DEFAULT_CRITERIA` 字符串格式（`packages/backend/src/services/draft-review.ts`）

**Test scenarios:**
- Regression: `DEFAULT_CRITERIA` 字符串包含 `"娛樂新聞"` 或 `"明星八卦"`（用 `includes` 断言）
- Regression: `DEFAULT_CRITERIA` 字符串不包含 `"漫畫"` 或 `"動漫"` 字样（防 ACG 回退）

**Verification:**
- `DEFAULT_CRITERIA` 不含"漫畫"/"動漫"字样
- `category_accuracy` 描述提到 "娛樂新聞" 或 "明星八卦"

## System-Wide Impact

- **Interaction graph:** 
  - `assembleGossipDraft` 仅被 `draft-gen.ts` 调用，不影响扩展端（扩展端不直接调组装器）
  - `CATEGORY_VOCAB` 被 `normalizeCategory`（draft-gen）、`buildConstraintSuffix`（prompt-assembly）、扩展端分类下拉 UI 共同读取——三处同步切换
- **Error propagation:** 无新错误路径；`assembleGossipDraft` 遵循 `assembleDraft` 的 fail-safe 惯例（null 字段整行省略，不抛错）
- **State lifecycle risks:** `DEFAULT_SETTINGS` 仅影响**新用户**初始化；现有用户已存 `settings.promptTemplate` 到 `chrome.storage.local`，不会被覆盖——旧用户需手动重置或在设置页清空 promptTemplate 以获取新默认值
- **Unchanged invariants:**
  - `assembleDraft`（ACG 路径）不改动
  - `DraftSlots` 接口不变
  - grounding 校验逻辑不变
  - 防幻觉不变量（模型只写散文槽位，事实由系统注入）不变

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| 现有用户 `chrome.storage.local` 已保存 ACG promptTemplate，Unit 1 对他们无效 | `DEFAULT_SETTINGS` 只影响 storage 为空时；CLAUDE.md 已记录此行为；可在 release notes 说明手动重置方法 |
| `CATEGORY_VOCAB` 的 value "1"/"2" 与未来真实后台分类 option value 不匹配 | export-only 场景 value 无实际用途；若对接真实后台，只改 CATEGORY_VOCAB 的两个 value 字段，其余逻辑不变 |
| `assembleGossipDraft` 首次引入，edge cases 未被 production traffic 验证 | Unit 3 测试覆盖 null facts/grounding/sanitize 等核心边界；与 `assembleDraft` 共享 `sanitizeToPlainText` / `esc` / `renderLink` 纯函数（已有测试守护） |
| `isGossipFacts` 检测依赖字段名"當事人" — 若 facts 空对象则误判 | facts 空时 `"當事人" in {}` 为 false，走 ACG 路径；空 gossip facts 应有 `當事人: null` 键（extractor 保证）；可补一条 Unit 4 测试 |

## Sources & References

- 现有 ACG 组装器：`packages/shared/src/post-assembler.ts`
- 吃瓜事实类型：`packages/shared/src/gossip-facts.ts`
- 吃瓜提炼提示词（已完成）：`packages/backend/src/scraper/gossip-fact-extractor.ts`
- 防幻觉设计：CLAUDE.md §安全与防幻觉
