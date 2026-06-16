---
title: "feat: Phase 3 质量引擎 — AI 自评重写"
type: feat
status: active
date: 2026-06-11
origin: docs/brainstorms/2026-06-11-phase-3-quality-engine-requirements.md
---

# feat: Phase 3 质量引擎 — AI 自评重写

## Overview

在草稿生成后增加一次 AI 评审 LLM 调用（四维打分），对不通过维度发起定向重写；操作者只看最终草稿，badge 轻量标注重写事实。同时修复 P0 测试失败（vitest 误扫 `packages/`）、补档首飞观察 run-sheet 模板，并在 Settings 中提供评审 criteria prompt 配置入口。

目标：草稿直发率（`hasManualEdit === false`）在 ≥10 篇 authorized 发布窗口内稳定达到 ≥70%。

## Problem Frame

Phase 2 建立了度量与学习地基（直发率追踪、few-shot 编辑器、trajectory 记录），但核心痛点未解决：AI 草稿四维质量普遍偏低（正文内容单薄、口吻/风格不对、标题不吸引、分类/标签错误），每条都需要大量手动改稿。Phase 3 在 `packages/extension/lib/batch-orchestrator.ts` 的 `runBatch()` 函数中通过 `RunBatchDeps` 注入 `reviewDraft?`/`rewriteDraft?`，并在 `gen.ok` 分支内插入评审→重写 pass，让操作者看到的草稿质量显著提升。（见 origin: docs/brainstorms/2026-06-11-phase-3-quality-engine-requirements.md）

## Requirements Trace

- R0-fix. vitest `packages/**` 排除，`pnpm test` 零失败
- R1. AI 二次评审：生成后第二次 LLM 调用，四维打分，全通过则原稿进队列，任一维度不通过则触发 R2
- R2. 定向重写：仅针对不通过维度，最多 1 次，重写结果白名单合并回草稿
- R3. 成本透明：`reviewCostTokens` 独立记录到 trajectory；`BatchItem.aiReviewTriggered?: boolean` 三态语义
- R4. badge UI：`aiReviewTriggered === true` 时显示「✦ 已自评优化」徽章；批次汇总显示 N 条已优化
- R5. 评审 prompt 可配置：`Settings.reviewCriteriaPrompt`，空时使用内置四维默认标准
- R6. run-sheet 模板：补全 `docs/run-sheet-首飞与基线.md` 的待填观察条目（文件已存在，需确认内容完整性）
- Success: `pnpm test` 零失败；`pnpm compile` 零错误；trajectory 中 `aiReviewTriggered` 可读；run-sheet 文件完整；**Phase 3 闸门**：≥10 篇 authorized 发布后直发率（`hasManualEdit===false`）≥70%

## Scope Boundaries

- 不做自动发布；操作者仍需批准每批次（see origin）
- 不做 A/B prompt 框架；单一 prompt 优化循环
- R7（直发率仪表盘）和 R8（快捷键）延后到闸门通过后评估
- service worker keepalive（大 batch 超 30s timeout 风险）本阶段仅记录，不解决
- KILL_BATCH AbortSignal 传播至 reviewDraft/rewriteDraft 本阶段不解决

## Context & Research

### Relevant Code and Patterns

- **`packages/extension/lib/llm.ts`**：`generateDraft()` 是**后端代理客户端**——调用 `POST http://127.0.0.1:3001/api/v1/drafts/generate`，apiKey 字段留存仅为接口兼容、执行时被忽略。所有 LLM 调用必须经过本地后端，扩展层不直接调用 LLM。`reviewDraft`/`rewriteDraft` 同样需要作为薄代理客户端实现（调用新后端端点），参照 `generateDraft` 模式。
- **`packages/extension/lib/batch-orchestrator.ts`**：`RunBatchDeps` 接口 + `runBatch()` 函数——生成循环在此（第 107–122 行）；Phase 3 评审调用插入 `gen.ok` 分支内、`markFilled` 之前。`reviewDraft?`/`rewriteDraft?` 需作为可选 deps 注入到 `RunBatchDeps` 接口。
- **`packages/extension/lib/batch.ts`**：`patchItem()` + `transition()` 不可变状态机；`markFilled(batch, id, draft)` 当前调用只传 3 个参数（`llmCostTokens` 等可选参数可扩展但当前未使用）。
- **`packages/extension/lib/trajectory.ts`**：`buildRecord()` 使用 optional-spread 模式添加可选字段（`...(input.x !== undefined ? { x: input.x } : {})`）；`canonical()` 中的哈希字段列表**不可扩展**，否则旧记录验证失败。
- **`packages/shared/src/types.ts`**：共享类型库（`Settings`、`BatchItem`、`GenerateDraftResponse` 等）。`fallbackModel?: string`——仅为模型名称字符串，**无** `.endpoint` 属性（见 P0 架构决策）。

### Institutional Learnings

- `canonical()` 哈希字段列表固定；新增 `reviewCostTokens`/`aiReviewTriggered` 到 `TrajectoryRecord` 时**不能**加入 `canonical()`。
- `generateDraft` 的 `llmCostTokens` 字段当前永远返回 `undefined`（扩展层 `packages/extension/lib/llm.ts` 是代理，不提取 `response.usage`；用量提取由后端处理，若后端在响应中返回则 extension 透传）；Phase 3 评审成本追踪以后端响应中的用量字段为准。
- 测试注入模式：`packages/extension/lib/llm.test.ts` 通过 `fetchFn` 参数 mock 网络调用；`packages/extension/lib/batch.test.ts` 直接对纯函数断言。
- `docs/eval/golden-set.md` 在本地文件系统中**不存在**（`docs/eval/` 目录未找到）；「内置 default criteria prompt 文字」需在实现时直接制定，或确认该文件正确路径后取材。

### External References

无需外部文档研究——本地已有完整调用模式可直接复用。

## Key Technical Decisions

- **markFilled 扩展（而非独立 markReviewed()）**：评审发生在 `generating` 状态期间，不需要独立状态节点；扩展 `markFilled` 签名加可选 `reviewMeta?` 参数实现原子写入，避免 `aiReviewTriggered` 写入时机竞态（spec flow gap 1a）。（see origin 架构决策 4）
- **aiReviewTriggered 四状态语义**：`undefined` = 评审未触发（fail-open 或 Phase 3 部署前）；`false` = 评审通过，无重写；`true` = 评审失败 + 重写**成功**；重写触发但失败视为 fail-open，同样设 `undefined`，确保 badge 只在真正改善时出现。
- **fallbackModel fail-open（不双重回退）**：`fallbackModel` 是 `string?`（模型名称），未配置 → 后端使用默认模型；`fallbackModel` 已配置 → 在请求 body 中传给后端（如 `{ ..., settings }`），由后端决定调用哪个模型。后端调用失败 → fail-open，确保不阻塞 batch loop。原因：避免双重计费和语义歧义；失败成本（丢失评审）低于双重调用成本。（⚠️ `fallbackModel` 无 `.endpoint` 属性——见 P0 架构决策）
- **rewrite 白名单合并**：`mergeRewriteResult(original, rewrite, failedDims)` 根据失败维度决定合并字段：`title_quality` → `title`；`body_richness` / `community_tone` → `body`；`category_accuracy` → `categories` + `tags`；`id`、`coverImageUrl`、`mediaId` 始终保留原草稿值。（see origin 架构决策 3）
- **4 维度 canonical 名称**：`body_richness`、`community_tone`、`title_quality`、`category_accuracy`；评审 prompt 要求 LLM 以这些名称返回结构化 JSON，确保 failedDims 字符串与合并白名单一致。
- **extractUsage 函数**：单独封装可测试函数，兼容 `usage.prompt_tokens`/`completion_tokens`（OpenAI 标准）和 `usage.inputTokens`/`outputTokens`（部分代理）两种格式；无法识别时返回 `undefined`（不是 `{ estimated: true }`），避免虚假数据。

## Open Questions

### Resolved During Planning

（见 Key Technical Decisions，所有设计分叉已在规划期闭合。）

### Deferred to Implementation

- **内置 default criteria prompt 文字**：四维打分标准具体文本需结合 `docs/eval/golden-set.md` 的「期望输出方向」制定；实现时从该文件取材。
- **extractUsage 字段名确认**：实际端点 `response.usage` 字段名在真实调用中确认（`prompt_tokens` vs `inputTokens`）。
- **service worker keepalive（大 batch 风险）**：Phase 3 每 item 处理延长约 5-9s，10+ item batch 有超 30s idle timeout 风险；记录到 TODOS.md，本阶段不解决。

---

## High-Level Technical Design

> *本图说明评审重写管道的意图形状，为方向性指导，不是实现规范。实现时以 Key Technical Decisions 和 Implementation Units 为准。*

```
handleRunBatch（每个 BatchItem 串行）
────────────────────────────────────────────────────────
markGenerating(batch, id)
  ↓
generateDraft(prompt, deps)
  ↓ ok
[Phase 3 插入]
  ↓
reviewDraft(draft, criteriaPrompt, reviewDeps)
  ├── ok: false  (网络/格式失败)
  │     → finalDraft = gen.draft
  │       aiReviewTriggered = undefined   [fail-open]
  │
  └── ok: true
        ├── all dims pass
        │     → finalDraft = gen.draft
        │       aiReviewTriggered = false
        │
        └── any dim fails
              ↓
          rewriteDraft(gen.draft, failedDims, rewriteDeps)
              ├── ok: false
              │     → finalDraft = gen.draft
              │       aiReviewTriggered = undefined
              │
              └── ok: true
                    → finalDraft = mergeRewriteResult(gen.draft, rewrite, failedDims)
                      aiReviewTriggered = true
  ↓
markFilled(batch, id, finalDraft, totalTokens, genDurationMs,
           reviewMeta: { triggered: aiReviewTriggered, reviewCostTokens })
────────────────────────────────────────────────────────
```

---

## Implementation Units

```mermaid
graph TB
  U1[U1: Groundwork\nvitest + types + run-sheet]
  U2[U2: LLM proxy clients\nreviewDraft + rewriteDraft\n+ 后端新路由]
  U3[U3: batch.ts\nmarkFilled extension]
  U4[U4: Settings UI\nreviewCriteriaPrompt]
  U5[U5: batch-orchestrator.ts\n+ background.ts 接线]
  U6[U6: Badge UI]

  U1 --> U2
  U1 --> U3
  U1 --> U4
  U1 --> U5
  U2 --> U5
  U3 --> U5
  U5 --> U6
```

---

- [x] **Unit 1: Groundwork — vitest 修复 + 类型地基 + run-sheet**

**Goal:** 让 `pnpm test` 零失败；建立 Phase 3 所有新类型；提供首飞观察模板。

**Requirements:** R0-fix, R3（类型部分）, R5（类型部分）, R6

**Dependencies:** 无

**Files:**
- Modify: `vitest.config.ts`（根目录，排除 packages/ 扫描）
- Modify: `.gitignore`
- Modify: `packages/shared/src/types.ts`（`ReviewResult` 新类型 + `Settings.reviewCriteriaPrompt` + `BatchItem.aiReviewTriggered`）
- Modify: `packages/extension/lib/trajectory.ts`（TrajectoryRecord + TrajectoryInput + buildRecord）
- Verify / update: `docs/run-sheet-首飞与基线.md`（文件已存在，确认 5 行观察条目完整）

**Approach:**
- `vitest.config.ts`（根目录）：`exclude` 数组末尾追加 `'packages/**'`（单行改动）
- `.gitignore`：追加 `packages/` 条目（长期方案，防止后续意外追踪）
- `packages/shared/src/types.ts`：
  - 新增 `ReviewResult` 类型：`{ ok: boolean; dimensions?: Array<{ name: string; pass: boolean; reason?: string }> }`（放在 `GenerateDraftResponse` 附近）
  - `BatchItem` 新增 `aiReviewTriggered?: boolean`（放在 `llmCostTokens` 后）
  - `Settings` 新增 `reviewCriteriaPrompt?: string`（放在 `fewShotPairs` 后）
- `packages/extension/lib/trajectory.ts`：
  - `TrajectoryRecord` + `TrajectoryInput` 各新增：`reviewCostTokens?: { prompt: number; completion: number; estimated?: boolean }` 和 `aiReviewTriggered?: boolean`
  - `buildRecord()` 用 optional-spread 模式透传两个新字段（参照 `llmCostTokens` 的处理方式，**不加入 `canonical()`**）
- `docs/run-sheet-首飞与基线.md`：确认 5 行观察表格存在（cover_url 类型、session 寿命、隐藏帖可见性、save 响应 URL、发布时间戳），如缺失则补全

**Patterns to follow:**
- `packages/extension/lib/trajectory.ts` 中 `llmCostTokens` 的 optional-spread 模式
- `packages/shared/src/types.ts` 中 `BatchItem` 现有可选字段列表

**Test scenarios:**
- Happy path: `buildRecord({ aiReviewTriggered: true, reviewCostTokens: {...} })` → record 包含两个新字段
- Edge case: `buildRecord({ aiReviewTriggered: undefined })` → record 不含 `aiReviewTriggered` 键（非 `false`）
- Edge case: 旧记录（无新字段）反序列化 → `verifyTrajectory()` 仍返回 `true`（证明 canonical 未改动）

**Verification:**
- `pnpm test` 零失败（8 个 backend test 不再出现）
- TypeScript 编译通过：`pnpm compile`
- `docs/run-sheet-首飞与基线.md` 存在且含 5 行观察条目

---

- [x] **Unit 2: LLM proxy clients — reviewDraft, rewriteDraft（扩展层）+ 后端新路由**

**Goal:** ① 在扩展层 `packages/extension/lib/llm.ts` 实现 `reviewDraft`/`rewriteDraft` 薄代理客户端（调用新后端端点）；② 在后端 `packages/backend/src/` 实现对应路由（prompt 构建、LLM 调用、响应解析）；③ 实现 `mergeRewriteResult` 合并函数（可放扩展层，纯 JSON 操作无网络依赖）。

> ⚠️ **P0 架构约束**：`packages/extension/lib/llm.ts` 是后端代理，apiKey 被忽略，不可直接调用 LLM。`reviewDraft`/`rewriteDraft` 必须 POST 到本地后端端点 `http://127.0.0.1:3001/api/v1/drafts/review` 与 `/api/v1/drafts/rewrite`，prompt 构建和 LLM 调用逻辑在后端实现。
> ⚠️ **fallbackModel 类型**：`Settings.fallbackModel` 是 `string?`（模型名称），无 `.endpoint` 属性。评审调用通过 `settings` 对象传给后端，由后端决定使用哪个模型。

**Requirements:** R1, R2, R3（token 提取部分）

**Dependencies:** Unit 1（ReviewResult 类型）

**Files:**
- Modify: `packages/extension/lib/llm.ts`（新增 `reviewDraft`/`rewriteDraft`/`mergeRewriteResult` 薄客户端函数）
- Modify: `packages/extension/lib/llm.test.ts`（通过 `fetchFn` mock 新函数）
- Create: `packages/backend/src/routes/drafts-review-route.ts`（POST /api/v1/drafts/review）
- Create: `packages/backend/src/routes/drafts-rewrite-route.ts`（POST /api/v1/drafts/rewrite）
- Modify: `packages/backend/src/app.ts` 或路由注册入口（注册新路由）

**Approach（扩展层）:**
- **`reviewDraft(draft, criteriaPrompt, deps: LlmDeps)`**：POST `{draft, criteriaPrompt, settings}` 到 `${BACKEND_BASE}/api/v1/drafts/review`；响应类型为 `{ ok: true, result: ReviewResult, reviewCostTokens? }` 或 `{ ok: false, kind, error }`；全程不 throw
- **`rewriteDraft(draft, failedDims, criteriaPrompt, deps: LlmDeps)`**：POST `{draft, failedDims, criteriaPrompt, settings}` 到 `${BACKEND_BASE}/api/v1/drafts/rewrite`；响应为 `{ ok: true, draft: ContentDraft, rewriteCostTokens? }` 或 `{ ok: false }`；全程不 throw
- **`mergeRewriteResult(original, rewrite, failedDims): ContentDraft`（export）**：白名单合并，`title_quality` → 取 `rewrite.title`；`body_richness`/`community_tone` → 取 `rewrite.body`；`category_accuracy` → 取 `rewrite.categories` + `rewrite.tags`；`id`/`coverImageUrl`/`mediaId` 始终保留 `original` 值
- 参照 `generateDraft` 的 Auth header + AbortController + 结构化错误返回模式

**Approach（后端路由）:**
- 路由直接内联到 `packages/backend/src/index.ts`（参照 `/api/v1/drafts/generate` 的注册方式，第 106-157 行）
- 两个路由均：读 `LLM_API_KEY`/`LLM_ENDPOINT` env；忽略 `settings.endpoint`（安全约束，与 generate 路由一致）；使用 `packages/backend/src/llm.ts` 的 `buildRequest`/`extractContent`/`parseContentJson`
- **`POST /api/v1/drafts/review`**：接收 `{draft, criteriaPrompt, settings}`；构建四维评审 prompt（`criteriaPrompt` 为空时用内置默认）；调用 LLM；parse + 验证响应为 `ReviewResult`（含 `dimensions` 数组）；提取 `response.usage` 作为 `reviewCostTokens`；返回 `{ok, result, reviewCostTokens?}`
- **`POST /api/v1/drafts/rewrite`**：接收 `{draft, failedDims, criteriaPrompt, settings}`；构建定向重写 prompt；调用 LLM；parse 响应为 `ContentDraft` 字段；返回 `{ok, draft: ContentDraft, rewriteCostTokens?}`
- usage 提取：在 `packages/backend/src/llm.ts` 新增 `extractUsage(raw)` 兼容 `usage.prompt_tokens`/`completion_tokens`（OpenAI）和 `usage.inputTokens`/`outputTokens`（代理）

**Test scenarios（扩展层——通过 fetchFn mock）:**
- Happy path: `reviewDraft` — fetchFn 返回 `{ok:true, result:{dimensions:[...]}}` → 正确透传
- Error path: `reviewDraft` — fetchFn throws / 返回 401 / 返回 500 → `{ ok: false, kind: 'network' }`
- Happy path: `rewriteDraft` — fetchFn 返回合法 ContentDraft → `{ ok: true, draft }`
- Error path: `rewriteDraft` — fetchFn 失败 → `{ ok: false }`
- Happy path: `mergeRewriteResult` — failedDims 含 `title_quality` → `title` 来自 rewrite，`id`/`body` 保留 original
- Happy path: `mergeRewriteResult` — failedDims 含 `body_richness` + `community_tone` → `body` 来自 rewrite
- Edge case: `mergeRewriteResult` — rewrite 缺少某字段 → 保留 original 对应字段

**Patterns to follow:**
- `packages/extension/lib/llm.ts` 中 `generateDraft` 的代理模式（第 69–119 行）
- `packages/backend/src/` 中 generate 路由 handler 的 LLM 调用模式

**Verification:**
- `packages/extension/lib/llm.test.ts` 全部测试绿
- TypeScript 通过

---

- [x] **Unit 3: batch.ts — markFilled 扩展**

**Goal:** 扩展 `markFilled` 接受可选 `reviewMeta` 参数，实现评审结果的原子写入。

**Requirements:** R3（batch 状态部分）

**Dependencies:** Unit 1（`BatchItem.aiReviewTriggered` 类型）

**Files:**
- Modify: `packages/extension/lib/batch.ts`
- Modify: `packages/extension/lib/batch.test.ts`

**Approach:**
- `markFilled` 签名增加可选第六参数 `reviewMeta?: { triggered?: boolean; reviewCostTokens?: BatchItem['llmCostTokens'] }`
- `patchItem` 时将 `reviewMeta.triggered` 写入 `aiReviewTriggered`；`reviewMeta.reviewCostTokens` 独立保存（不累加到 `llmCostTokens`，因为前者是生成成本，后者是评审成本）
- `reviewMeta` 为 `undefined` 时，`aiReviewTriggered` 不写入（保持 `undefined` 而非 `false`，确保三态语义不被污染）
- 现有调用方不传 `reviewMeta` → 行为完全不变（向后兼容）

**Patterns to follow:**
- `markFilled` 现有 patchItem 调用（`packages/extension/lib/batch.ts`）
- Phase 2 中 `llmCostTokens` 字段的写入模式

**Test scenarios:**
- Happy path: `markFilled(..., { triggered: true, reviewCostTokens: {...} })` → `item.aiReviewTriggered === true`，`item.reviewCostTokens` 已设
- Happy path: `markFilled(..., { triggered: false })` → `item.aiReviewTriggered === false`
- Edge case: `markFilled(..., undefined)` → `item.aiReviewTriggered === undefined`（未设）
- Edge case: `markFilled(..., { triggered: undefined })` → `item.aiReviewTriggered === undefined`（非 false）
- Invariant: 无 reviewMeta 的现有调用 → 所有已有字段行为不变（回归测试）

**Verification:**
- `lib/batch.test.ts` 全部测试绿
- TypeScript 通过

---

- [x] **Unit 4: Settings UI — reviewCriteriaPrompt 文本框**

**Goal:** 在 Settings 面板新增「评审标准 prompt」文本区域，让操作者可针对社区风格覆盖内置评审标准。

**Requirements:** R5

**Dependencies:** Unit 1（`Settings.reviewCriteriaPrompt` 类型）

**Files:**
- Modify: `packages/extension/entrypoints/sidepanel/Settings.tsx`
- Modify: `packages/extension/entrypoints/sidepanel/Settings.test.tsx`

**Approach:**
- 在 `fewShotPairs` 编辑器之后新增一个 `<textarea>` 区域，label 为「评审标准 prompt（可选）」
- placeholder 文字描述四维内置默认标准（告知操作者不填时的行为）
- 读写 `settings.reviewCriteriaPrompt`，空字符串存储时与 `undefined` 等效（均回落到内置默认）
- 样式参照 `promptTemplate` 文本区域的现有样式

**Patterns to follow:**
- `promptTemplate` 文本区域的读写模式（`packages/extension/entrypoints/sidepanel/Settings.tsx` 中的现有 textarea 实现）
- 其他可选 Settings 字段的 save/load 模式

**Test scenarios:**
- Happy path: `reviewCriteriaPrompt` textarea 渲染正确；初始值来自 settings.reviewCriteriaPrompt
- Happy path: 用户输入后保存 → storage 中 settings.reviewCriteriaPrompt 更新
- Edge case: 清空字段后保存 → storage 中值为 `''` 或 `undefined`（两者均触发内置默认，无需强制一种）

**Verification:**
- `Settings.test.tsx` 新增测试绿
- TypeScript 通过
- UI 视觉：textarea 出现在 fewShotPairs 编辑器之后，有合理 label 和 placeholder

---

- [x] **Unit 5: batch-orchestrator.ts + background.ts — 评审重写管道集成**

**Goal:** ① 在 `RunBatchDeps` 接口新增 `reviewDraft?`/`rewriteDraft?` 可选注入；② 在 `runBatch()` 的 `gen.ok` 分支内插入评审→重写逻辑；③ `background.ts` 补充新 deps 的接线（调用扩展层客户端函数）。

**Requirements:** R1, R2, R3

**Dependencies:** Unit 1（类型）, Unit 2（reviewDraft, rewriteDraft, mergeRewriteResult）, Unit 3（markFilled 扩展）

**Files:**
- Modify: `packages/extension/lib/batch-orchestrator.ts`（主要修改：`RunBatchDeps` 接口 + `runBatch()` gen.ok 分支）
- Modify: `packages/extension/entrypoints/background.ts`（薄接线：向 deps 传入 reviewDraft/rewriteDraft）

**Approach:**
- **`RunBatchDeps` 扩展**（`batch-orchestrator.ts`）：新增两个可选注入：
  ```
  reviewDraft?: (draft: ContentDraft, criteriaPrompt: string, deps: LlmDeps) => Promise<ReviewDraftResponse>
  rewriteDraft?: (draft: ContentDraft, failedDims: string[], criteriaPrompt: string, deps: LlmDeps) => Promise<RewriteDraftResponse>
  ```
- **`runBatch()` gen.ok 分支插入**（第 119 行之后、`markFilled` 之前）：
  1. 若 `deps.reviewDraft` 已注入：从 `settings.reviewCriteriaPrompt`（或空字符串）构造 `effectiveCriteriaPrompt`
  2. 调用 `reviewDraft(gen.draft, effectiveCriteriaPrompt, llmDeps)`
  3. 根据结果确定 `finalDraft`、`aiReviewTriggered`、`reviewCostTokens`（按四状态规则）
  4. 若 `review.ok && failedDims.length > 0` 且 `deps.rewriteDraft` 已注入：调用 `rewriteDraft(...)`
  5. 调用 `markFilled(batch, item.id, finalDraft, gen.llmCostTokens, genDurationMs, { triggered: aiReviewTriggered, reviewCostTokens })`
- **`background.ts` 接线**：在 `runBatch(deps)` 调用处，向 deps 传入 `reviewDraft: (d, c, llmDeps) => reviewDraftClient(d, c, llmDeps)` 和 `rewriteDraft: ...`（调用 Unit 2 的扩展层客户端函数）
- `appendTrajectory` 调用中传入 `aiReviewTriggered` 和 `reviewCostTokens` 新字段
- `reviewDraft`/`rewriteDraft` never-throw 保证由 Unit 2 提供；`runBatch` 本身不需要额外 try-catch，失败路径已结构化

**Patterns to follow:**
- `RunBatchDeps` 现有可选 deps（`bypassReentry?`、`persistentBlockedTopics?`）的注入模式
- `background.ts` 现有 `runBatch(deps)` 接线位置
- `approveBatch` 中 `appendTrajectory` 调用的 `TrajectoryInput` 构建方式（同文件 ~250 行）

**Test scenarios:**
- Integration: `deps.reviewDraft` 未注入（deps 不含该字段） → 流程与 Phase 2 完全一致，`aiReviewTriggered === undefined`，无任何 review 调用
- Integration: reviewDraft 全维度通过 → `item.aiReviewTriggered === false`，`item.draft` 是 gen.draft
- Integration: reviewDraft 失败一个维度（`failedDims.length > 0`），rewriteDraft 成功 → `item.aiReviewTriggered === true`，`item.draft` 是 mergeRewriteResult 结果
- Error path: reviewDraft 返回 `{ ok: false }` → `item.aiReviewTriggered === undefined`，`item.draft` 是 gen.draft，loop 继续（下一个 item 不受影响）
- Error path: reviewDraft 通过但 rewriteDraft 失败 → `item.aiReviewTriggered === undefined`，`item.draft` 是 gen.draft
- Integration: trajectory record（`appendTrajectory` 调用）包含 `aiReviewTriggered` 和 `reviewCostTokens` 字段
- Edge case: `settings.reviewCriteriaPrompt === ''` → 向 reviewDraft 传空字符串；后端用内置 default（不传空字符串直接给 LLM 是后端责任）
- Edge case: `settings.fallbackModel` 未配置 → settings 照常传给后端，后端自行使用默认模型，orchestrator 不崩溃

**Verification:**
- `pnpm test` 全绿
- TypeScript 通过
- 手动测试：在 dry-run 模式生成一批次，观察 BatchItem 的 `aiReviewTriggered` 字段被正确设置

---

- [x] **Unit 6: Badge UI — 批次审核 badge**

**Goal:** 在 `BatchReviewPanel` 对被重写的草稿显示低调 badge；在批次汇总条显示总计数。

**Requirements:** R4

**Dependencies:** Unit 5（`aiReviewTriggered` 字段被实际设置）

**Files:**
- Modify: `packages/extension/entrypoints/sidepanel/BatchReviewPanel.tsx`
- Modify: `packages/extension/entrypoints/sidepanel/BatchReviewPanel.test.tsx`

**Approach:**
- 在每个 BatchItem 卡片标题区域，当 `item.aiReviewTriggered === true` 时渲染 `<span>✦ 已自评优化</span>` badge（灰色调，低调不抢眼）
- 在批次详情顶部汇总条（`done` 阶段）新增「N 条自评已优化」文本，`N = items.filter(i => i.aiReviewTriggered === true).length`
- `aiReviewTriggered === false` 或 `undefined` 时不渲染任何 badge

**Patterns to follow:**
- 现有 `degrade` 徽章的 inline badge 渲染模式（`packages/extension/entrypoints/sidepanel/BatchReviewPanel.tsx`）
- 批次汇总条的现有统计展示格式

**Test scenarios:**
- Happy path: `item.aiReviewTriggered === true` → badge 「✦ 已自评优化」出现在卡片中
- Edge case: `item.aiReviewTriggered === false` → 无 badge
- Edge case: `item.aiReviewTriggered === undefined` → 无 badge
- Happy path: 2 个 item 的 `aiReviewTriggered === true` → 汇总条显示「2 条自评已优化」
- Edge case: 零个 item 触发重写 → 汇总条不显示「0 条自评已优化」（隐藏或省略）

**Verification:**
- `BatchReviewPanel.test.tsx` 全绿
- TypeScript 通过
- 视觉：badge 低调（灰色），不干扰主操作流；汇总计数仅在 done 阶段可见

---

## System-Wide Impact

- **Interaction graph:** `packages/extension/lib/batch-orchestrator.ts` 的 `runBatch()` 在每个 item 的生成之后通过注入的 `reviewDraft?`/`rewriteDraft?` 增加最多 2 次后端代理调用；`markFilled` 签名扩展但向后兼容；`appendTrajectory` 新增两个可选字段
- **Error propagation:** `reviewDraft` / `rewriteDraft` 薄代理客户端永不 throw，所有失败转为结构化 `{ ok: false }`；per-item 失败不阻塞 batch loop
- **State lifecycle risks:** `aiReviewTriggered` 通过 `markFilled` 原子写入，避免写入竞态；trajectory `canonical()` 不变，旧记录验证不受影响
- **Performance:** 每个 item 处理时间由 ~3s 增至约 6–12s（+review 后端调用 + optional rewrite 后端调用）；service worker 30s idle timeout 对 5+ item batch 存在风险（记录于 Deferred to Implementation）
- **Integration coverage:** Unit 5 的集成测试覆盖 review+rewrite 的四条路径（see Unit 5 test scenarios）；`packages/extension/lib/llm.test.ts` 通过 `fetchFn` mock 覆盖无网络环境
- **Unchanged invariants:** `BatchItem` 现有字段（`draft`、`userEdited`、`llmCostTokens`、`fillResults`）行为不变；`markFilled` 无 reviewMeta 时 behavior identical；trajectory `canonical()` 不变；后端新路由对外是新端点，不影响现有 `/api/v1/drafts/generate`

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| reviewDraft 永远不 throw 的契约被破坏 → batch loop 中断 | Unit 2 测试显式覆盖 throw 场景；Unit 5 per-item try-catch 作为最后防线 |
| 4 维度 default criteria prompt 质量低 → 直发率不提升 | Phase 3 闸门：10 篇数据后测量直发率；若 <70% 迭代 R5 评审 prompt |
| fallbackModel endpoint 用相同 apiKey 导致 401 → fail-open | fail-open 行为确保不阻塞；操作者配置时文档说明 apiKey 复用语义 |
| extractUsage 字段名不匹配 → llmCostTokens 永远 undefined | `extractUsage` 返回 `undefined` 而非 `{ estimated: true }`；成本追踪失效但不阻塞发布 |
| service worker 30s idle timeout（5+ item batch） | 已记录 TODOS.md；建议操作者初期用小 batch（3–5 item）验证 |
| `canonical()` 意外修改 → 旧 trajectory 验证失败 | Unit 1 测试验证旧记录 `verifyTrajectory()` 仍为 true |

## Documentation / Operational Notes

- Phase 3 上线后，建议操作者先用 dry-run 模式跑小 batch（3 item），观察 aiReviewTriggered 字段是否正确设置
- `docs/run-sheet-首飞与基线.md` 中的五项观察需要在真实首飞后填写，结论影响后续 R19（封面）和 publishUrl 规划
- Phase 3 闸门：`authorized` 档位累计 ≥10 篇发布后，通过 trajectory 读取 `hasManualEdit === false` 比例；目标 ≥70%

## Sources & References

- **Origin document:** [docs/brainstorms/2026-06-11-phase-3-quality-engine-requirements.md](../brainstorms/2026-06-11-phase-3-quality-engine-requirements.md)
- Core LLM proxy pattern: `packages/extension/lib/llm.ts` — `generateDraft`（代理模式范本），`LlmDeps`，`BACKEND_BASE`
- Batch-orchestrator + RunBatchDeps: `packages/extension/lib/batch-orchestrator.ts` — `runBatch`, `RunBatchDeps`（注入接口）
- State machine pattern: `packages/extension/lib/batch.ts` — `markFilled`, `patchItem`, `transition`
- Trajectory pattern: `packages/extension/lib/trajectory.ts` — `buildRecord`, `canonical`, optional-spread
- Shared types: `packages/shared/src/types.ts` — `Settings`, `BatchItem`, `GenerateDraftResponse`
- Golden set (default criteria prompt 参考文本，需确认路径): `docs/eval/golden-set.md`（⚠️ 文件当前不存在，实现时需创建或确认正确路径）
- Baseline definition: `docs/baselines/direct-publish-rate.md`
