---
title: "feat: 产品体验升级(Theme E,4 独立特性)"
type: feat
status: completed
date: 2026-06-15
---

# feat: 产品体验升级(Theme E,4 独立特性)

## Overview

健检产品机会清单经审查收敛为 **3 项**用户可感知改进,**各自独立成 PR、单独可发可回滚**(沿用 Theme C 教训:别打包成大 PR)。按价值/风险排序交付:

1. **PR-E1 设置「测试连接」**(先做):设置页一键验证连通,复用现成 `listModels()`(态分辨力以其实际可分者为准,LLM 侧合一)。
2. **PR-E4 LLM 429/503 退避重试**(后端):后端模型循环内加指数退避 + 同请求重试,仅按状态码分桶,与 model-fallback/gemma4 降级不打架。
3. **PR-E3 隔离区视图 + 批量撤出**:隔离全景 + 一键批量撤出(orchestrator 累积单次原子 save)。

> **原第 4 项「grounding 手编后复核」(R2)经审查切出本轮**:实时 GroundingStrip 用编辑稿(非 `assembledDraftSnapshot`)算 verdict,手编洗白【待补】后 strip 已变绿——这是潜在防幻觉铁律泄漏,「实时 strip 是否应改评原稿快照」是铁律层产品决策,需 **/ce:brainstorm** 专门讨论,不应作为无 owner 的阻塞单元留在本计划。见 Deferred Requirements。

> 来源:2026-06-15 全面健检 Theme E。**没有上游 brainstorm 文档**;行为多数已从健检 + 两份研究测绘明确,故走 ce:plan + 本计划的轻量产品框定,但特性 2 含一个真正的产品决策(下方 Resolve Before Planning)。

## Problem Frame

4 个独立的体验/可靠性缺口:配错 LLM 要等真生成才发现;LLM 过载(429/503)时无退避、扩展端无重试;隔离区无全景、只能逐条撤出;gate-failed 条目手编后状态徽章不更新(可能误以为已修)。Theme C 已验证:小而独立的 PR 比大重构稳——故 4 件各自独立交付,可任意挑选/暂停。

## Requirements Trace

- R1. 设置页新增「测试连接」动作:点击后经后端验证连通性,即时反馈。**可机器区分的态有限**(见 E1 纠偏):成功 / 401(token 失效)/ 超时 / 连不上后端,均可分;但「后端可达但 LLM 异常 vs 后端 config 错误」在 `/api/v1/models` 都返 500、错误文案为后端未受控透传——客户端**无法可靠细分**,合并为一态「后端可达但 LLM/配置异常」。要清晰细分须后端加结构化 `kind`(超出本轮 scope,列为可选)。
- R4. LLM 调用对 **429/503** 做指数退避 + 有限次同请求重试(可读 `Retry-After`,设**总等待上限**防上游 stall);**仅按 HTTP 状态码分桶**——gemma4 的 400/200-坏JSON 等格式错误**不进重试桶**;不破坏 review/rewrite「失败返 `ok:false`、不 throw」契约;退避日志只记 model/status/attempt/delay,不记 body/headers/URL/key。
- R3. 隔离区(状态 `needs-human-verification`)专用视图 + **批量撤出**(单次原子 save);批量逻辑进 orchestrator 可测层;守 save 顺序与「隔离不自动升格、不自动重发」铁律;批量撤出是**批量削弱人工核验闸**,需明确确认强度。
- ~~R2. grounding 手编后状态反映~~ — **切出本轮**(审查共识)。真相:GroundingStrip 用编辑稿(非 `assembledDraftSnapshot`)重算,手编洗白【待补】后实时 strip 已变绿——这本身是**潜在防幻觉铁律泄漏**,且「实时 strip 是否应改评原稿快照」比「UI 文案」改动大,属铁律层产品决策,需 **/ce:brainstorm** 专门讨论(见 Deferred Requirements)。

## Scope Boundaries

- **4 件独立 PR,不打包**;可任意顺序(无强依赖),建议 E1→E4→E3→E2。
- **不碰** 防幻觉铁律的现有判据分离(`assembledDraftSnapshot` gate 评估原稿,见 `2026-06-11-005`)——除非 R2 的产品决策显式改变它(那需 brainstorm 级讨论)。
- **不改** `RuntimeMessage` 既有语义(可新增消息类型);不改注入面三处;不动存储层结构。
- **不做** 重试的跨调用 module-level 状态(SW 重启陷阱)。
- 不把 gemma4 的格式/400 问题与 429/503 混为一桶。

## Context & Research

### Relevant Code and Patterns

**特性 1(测试连接)**
- `packages/extension/lib/llm.ts` 的 `listModels()`(打后端 `/api/v1/models`,已区分 401→`clearToken` / 超时 / 连不上后端;20s timeout、用 `getAuthHeaders` + `getBackendUrl`)——**现成探针,直接复用,不新写**。
- 后端 `GET /api/v1/models`(`app.ts`,auth-gated,经 `services/llm.ts:listModels` round-trip 真 LLM endpoint,区分超时/CORS/非 OpenAI 兼容/空列表)。
- UI 落点:`packages/extension/entrypoints/sidepanel/Settings.tsx` 的 LLM 配置卡(按钮模式参「从后端加载」`btn btn-plain btn-sm`)。**注意**:endpoint/key 现在在后端 env,扩展无法直连 LLM,测试连接必经后端代理。
- 测试:`Settings.test.tsx` 现仅测纯函数;测连接 handler 宜抽纯 helper 或用 `@testing-library` 组件测。

**特性 4(LLM 退避重试)**
- 后端 `packages/backend/src/services/llm.ts` `generateDraft`(~195-336):`for (currentModel) { for (useSchema of [true,false]) {...} }`;**已识别** `res.status===429 || res.status>=500`(:270-273)但只 `break` 到下个 model、无退避/无同请求重试/无 `Retry-After`。schema→无 schema 的 400 降级(:266-268)是 **gemma4 怪癖**,与 429/503 不同桶。`callLlmForJson`(review/rewrite,:121-170)**无任何重试**且契约是「不 throw、失败返 ok:false」。
- 扩展 `packages/extension/lib/llm.ts` 是 thin proxy,`!res.ok` 一律 `kind:"network"`,不区分 429/503——**retry 落点在后端**(贴 endpoint、能读 Retry-After),扩展端不改或仅透传。
- 测试:后端 `services/llm.test.ts` 是现成覆盖锚。

**特性 3(隔离区)**
- 隔离 = `Batch` 内 status `needs-human-verification` 的 item(`batch.ts`,crash recovery 设);`quarantinedTopics(batch)`/`batchSummary().quarantined` 派生计数。`QuarantineContext`(`BatchReviewPanel.tsx:223-248`)仅展示。
- 撤出:**仅逐条**——`onRelease(itemId)`→`RELEASE_QUARANTINE`→`handleReleaseQuarantine`(`background.ts`)→`releaseQuarantine(batch,itemId)`(`batch.ts:274-279`,`needs-human-verification`→`aborted` + `error:"quarantine-released"`,不自动重发)。**无批量**。
- 视图落点:BatchView 第三 tab(`BatchView.tsx:231-244` 现有 批次/历史)或 App 顶层 view(`App.tsx:33` union + `workflow-grid` 按钮)。
- 蓝本:批量放行逻辑进 `batch-orchestrator.ts`(Deps 注入纯逻辑、强测试网 1179 行),不堆 background 薄接线(`2026-06-04-003`)。

**特性 2(grounding 手编后复核)**
- `lib/grounding-gate.ts` `evaluateGrounding(draft, facts?, qualityScore?)`→`{ok, reasons}`,查 `【待补】`+无来源链接;**fail-closed**(命中即 `ok:false` 拦截),仅 `verifyLinks` 在 SW 无 DOMParser 时该单项局部跳过。
- `BatchReviewPanel.tsx` GroundingStrip(:28-152)每次 render 用 **`draftOverrides?.get(it.id) ?? it.draft`(编辑稿,非 `assembledDraftSnapshot`)** 重算 verdict(:44)。
- ⚠ **这不是「已交付的价值」,而是潜在铁律泄漏**:手编洗白 `【待补】`后,实时 strip 立即变绿——但防幻觉铁律(`2026-06-11-005`)要求 gate 评**不可变原稿快照** `assembledDraftSnapshot`,正是为防手编/重写洗白。实时 strip 评编辑稿 = 在 UI 层已展示洗白结果。真硬闸在 approve 时 server-side 评 overrides——若它评编辑稿则铁律被绕,若评快照则用户「strip 绿却被拦」会困惑。**这是 R2 的核心,提高而非降低紧迫性。**
- 终态 `gate-failed`/`error:grounding-blocked` **状态徽章**(:880/:1028)亦不随手编辑转出。
- gate-failed 渲染分支:`BatchReviewPanel.tsx` ~818-834。

### Institutional Learnings

- **`docs/plans/2026-06-11-005-fix-grounding-gate-rewrite-bypass-plan.md`(必读 for R2)**:gate 评估 `assembledDraftSnapshot`(post-assembler 原稿,只读),防 AI 重写/手编洗白 `【待补】` 绕过铁律。**R2 的核心产品决策**:手编后重评新稿(可被洗白)还是锚定原快照?+ 状态机不变量:gate-failed 不得无人工动作自动升格;`retryItem` 回流的 markFilled 前须重捕快照。
- `docs/solutions/extension-http-client-testability-injection-seam-2026-06-15.md`:两个 `llm.ts` 已用真 `fetchFn` 注入缝,可放心 mock;走 `fetchWithTimeout` 的用 `vi.mock("@51publisher/shared")`。→ E1/E4 测试直接相关。
- `docs/solutions/vitest-excludes-dist-phantom-backend-p0-2026-06-15.md`:包名 `publisher-backend`/`publisher-fill-assistant`,backend vitest 排除 dist。
- la-sealion/gemma4 endpoint:需 prompt 内指定 JSON、`json_schema` 支持不稳(已有 400 降级)、env 钉死、必须 https。→ E4 分桶依据。
- Theme C(`2026-06-15-002`):小而独立 PR;错误串被 UI 按字面消费(改 UI 文案/状态串当心组件测试字面断言)。

## Key Technical Decisions

- **3 独立 PR、按 E1→E4→E3 排序**(E2 已切出,见下)。各自行为独立、可单独回滚。
- **E1 复用 `listModels()` 不新写探针**;测试连接经后端代理(endpoint/key 在 env)。**态分辨力有限**:成功/401/超时/连不上后端可分;LLM 侧错误(LLM 不可达 vs 后端 config 错误)都返 500、文案未受控透传,合并为一态;UI 只渲染**固定文案**,不插值后端/LLM 原始错误体(防泄 endpoint/key)。
- **E4 retry 落后端 `services/llm.ts`**(贴 endpoint、能读 `Retry-After`);**控制流明确**:429/503 退避重试发生在**内层 schema 固定**的迭代内(每次重试各自新建 AbortController+timer,勿共享),退避耗尽才 `break` 到下个 model;**仅按 HTTP 状态码分桶**——gemma4 的 400/200-坏JSON 走既有 schema 降级或直接 ok:false,**不进 retry 桶**;设**总等待上限**(防上游 `Retry-After` 拉爆延迟);`callLlmForJson` 同样**仅对捕获到的 5xx/429 状态**重试,解析失败(parse/format)不重试;不破坏「不 throw」契约;退避用注入 sleep/now(勿 module-level)。
- **E3 批量撤出逻辑进 orchestrator 纯函数**(可测),**累积所有转移后单次原子 `saveBatch`**(全或无,避免半撤出);background 薄接线**默认复用单条 `RELEASE_QUARANTINE` 循环、不新增消息类型**(除非证明必要);守 save 顺序与「撤出=`needs-human-verification`→`aborted`、不自动重发、不自动升格」;批量撤出**削弱人工核验闸**,确认对话框须明确「将清除整批人工核验」。视图作 BatchView 第三 tab(最小面)。

## Open Questions

### Resolved During Planning
- 范围:**E1+E4+E3 三件**独立 PR(E2 切出);排序 E1→E4→E3。
- E1 探针:复用 `listModels()`;态分辨力有限(LLM 侧合一)。
- E4 落点:后端 services/llm.ts;仅状态码分桶、内层重试、总时长上限、日志卫生。
- E3:批量撤出进 orchestrator、单次原子 save、默认复用单条消息。

### Deferred Requirements(切出本轮,需 /ce:brainstorm)
- **R2 grounding 手编后行为 — 需产品/安全 brainstorm**。核心:GroundingStrip 现用编辑稿(非 `assembledDraftSnapshot`)算 verdict,手编洗白【待补】后实时 strip 已绿——这是潜在防幻觉铁律泄漏。真问题不止「UI 文案」,而是**实时 strip 是否应改评原稿快照**(守铁律但用户体验:改完仍红)vs **是否允许手编纳入判据**(开洗白口子)。这是铁律层决策,无 owner/SLA 不应阻塞本计划——故切出,建议单开 `/ce:brainstorm`。

### Deferred to Implementation
- E1:测试连接 handler 抽纯 helper vs 组件测——执行时按可测性定。
- E4:退避参数(基数/上限/次数)、是否解析 `Retry-After`、是否同样覆盖 `callLlmForJson`——执行时定,默认覆盖 generateDraft + callLlmForJson 但保持各自契约。
- E3:新消息类型 `RELEASE_QUARANTINE_BATCH` vs 复用循环单条——执行时按最小面定。

## Implementation Units

> 3 个独立 PR,建议 E1→E4→E3。无强阻塞依赖(E1/E4 都触后端 LLM 端点抽象但不互锁;若 E4 改了 model 枚举,E1 的连接测试需在 E4 后复跑)。原 R2/Unit E2 已切出(见 Deferred Requirements,需 brainstorm)。

- [x] **Unit E1: 设置「测试连接」按钮**

**Goal:** 设置页一键验证连通,即时反馈(态分辨力以 `listModels()` 实际可分者为准)。
**Requirements:** R1
**Dependencies:** 无
**Execution note:** 开工前先确认 `packages/extension/lib/llm.ts` 确实导出 `listModels()` 且 Settings 可 import;若无则改为调后端 `/api/v1/models`。
**Files:**
- Modify: `packages/extension/entrypoints/sidepanel/Settings.tsx`(LLM 配置卡内加按钮 + 状态显示)
- Create(建议,抽纯 helper 便于测): `packages/extension/lib/connection-test.ts`(把 `listModels()` 结果映射为固定态文案)
- Test: `packages/extension/lib/connection-test.test.ts`(纯 helper)
**Approach:** 点击 → 调 `listModels()` → 映射为**固定文案**:成功(返回非空模型列表)/ 401(token 失效,提示重登)/ 超时(「后端无响应」)/ 连不上后端(「后端不可达,检查 3001」)/ 后端可达但 LLM/配置异常(500,合并一态,**不回显原始错误体**)。按钮 loading 态。复用现成探针,不直连 LLM。**注意**:慢但活着的 LLM 可能令 20s 探针超时而误报「后端无响应」(无独立「LLM 慢」态,接受)。
**Patterns to follow:** Settings.tsx「从后端加载」按钮(`btn btn-plain btn-sm` + handler);`lib/llm.ts:listModels` 的现有错误分支;http-client 注入缝可测性 solution。
**Test scenarios:**
- Happy:`listModels` 返回非空 → 显示「连接正常 / N 个模型」。
- Error:401 → 提示 token 失效(且 `clearToken` 行为不被破坏)。
- Error:超时 → 「后端无响应」。
- Error:连不上后端 → 「后端不可达(检查 3001)」。
- Error:LLM 侧(500,含 LLM 不可达/config 错误/空列表)→ 合并一态「后端可达但 LLM/配置异常」。
- 安全:后端错误体含疑似 endpoint/key 文本时,UI 仍显示**固定文案**、不回显原始 body。
**Verification:** 各态固定文案正确、无原始错误体回显;`pnpm --filter publisher-fill-assistant test` + `compile` 绿;手动点一次真实测连接(冒烟)。

- [x] **Unit E4: LLM 429/503 退避重试(后端)**

**Goal:** LLM 过载时有限次指数退避重试,再 fallback;不波及 gemma4 格式问题。
**Requirements:** R4
**Dependencies:** 无
**Files:**
- Modify: `packages/backend/src/services/llm.ts`(`generateDraft` 的 model×schema 循环;视情况 `callLlmForJson`)
- Test: `packages/backend/src/services/llm.test.ts`
**Approach:** 在现有 `429 || >=500` 分支(:270-273)对**同一请求**做有限次指数退避重试,**重试发生在内层 schema 固定的迭代内**(每次重试各自 `new AbortController()`+timer,**勿共享**否则第二次立即 abort),退避耗尽才 `break` 到下个 model。**仅按捕获到的 HTTP 状态码分桶**:429/5xx 才重试;`useSchema && 400` 仍走既有 schema 降级 `continue`,**不**进 retry 桶。设**总等待上限**(防 `Retry-After` 拉爆延迟)。`callLlmForJson` 同样**仅对 5xx/429 状态**重试——其 parse/format 失败(gemma4 200+坏JSON)是 `ok:false` 但**不重试**;保持「不 throw、失败返 ok:false」。退避 sleep/now 注入(勿 module-level)。
- **契约定义(必守)**:`callLlmForJson` 永不 throw;重试后最终失败仍返 `{ok:false}`;返回类型/签名不变;调用方(BatchReviewPanel)无需加 try-catch。退避日志只记 model/status/attempt/delay,**不记** body/headers/URL/key。
**Execution note:** characterization-first —— 先确认 `services/llm.test.ts` 现有对 429/5xx→next-model、400→降级的断言,改造后须仍绿。
**Patterns to follow:** `services/llm.ts` 现有 `buildRequest` + AbortController/timeout idiom;后端多模型 fallback 结构。
**Test scenarios:**
- Happy:首次 200 → 不重试、正常返回。
- Error path:429 一次后 200 → 重试成功,注入 sleep 被调用 N 次。
- Error path:持续 429 超上限 → 退避耗尽后 fallback 下个 model;无下个则 `{ok:false, kind:"network"}`。
- Edge:`Retry-After` 头 → 退避据其但不超总上限。
- Edge(分桶):400 schema 错误 → 走 schema 降级,**不**触发退避(注入 sleep 调用 0 次)。
- Edge(分桶):`callLlmForJson` 200 + 非法 JSON(gemma4)→ **立即 `ok:false`、不重试**(sleep 0 次)。
- Integration:`callLlmForJson` 持续 5xx → 重试耗尽返 `ok:false`、**不 throw**(`expect(...).not.toThrow()`)。
- 安全:429 重试路径的日志/返回串不含 key/header/原始 body。
**Verification:** 新增/改造测试绿;现有 429→next-model / 400→降级断言不破;退避用注入时钟、不真 sleep;`pnpm --filter publisher-backend test` + `compile` 绿。

- [x] **Unit E3: 隔离区视图 + 批量撤出**

**Goal:** 隔离全景(needs-human-verification 条目)+ 一键批量撤出。
**Requirements:** R3
**Dependencies:** 无
**Files:**
- Modify: `packages/extension/lib/batch-orchestrator.ts`(批量撤出纯函数:累积所有转移返回一个新 Batch)
- Modify: `packages/extension/entrypoints/background.ts`(薄接线;**默认复用现有 `RELEASE_QUARANTINE` 循环 + 单次 `saveBatch`**,不新增消息类型)
- Modify: `packages/extension/entrypoints/sidepanel/BatchView.tsx`(第三 tab 内联隔离视图;**默认不新建 QuarantinePanel.tsx**,除非复杂度证明拆分必要)
- Test: `packages/extension/lib/batch-orchestrator.test.ts`(批量撤出逻辑)+ 视图组件测(`@testing-library`)
**Approach:** 批量撤出 = 把所有 `needs-human-verification` 的 `releaseQuarantine` 转移(→`aborted`+`error:"quarantine-released"`,不自动重发)**累积进一个新 Batch,再单次 `saveBatch`(全或无,避免半撤出/无回滚)**。逻辑进 orchestrator 可测纯函数。视图聚合显示隔离条目(原因/trajectory/publishUrl,复用 QuarantineContext 展示)+ 批量撤出按钮(确认对话框须明确「将清除整批人工核验闸」)。守 save 顺序(本地 PRIMARY、后端 best-effort)、不自动升格。**RuntimeMessage 范围**:新增枚举值可以,但不改既有成员语义;默认不加新成员。
**Patterns to follow:** `batch.ts:releaseQuarantine`(返回新 Batch、可累积)、`batch-orchestrator` Deps 注入;BatchView 现有 tab(`tab-btn`)+ HistoryPanel 挂载;QuarantineContext 展示。
**Test scenarios:**
- Happy:3 个隔离条目 → 批量撤出 → 全部转 `aborted`+`quarantine-released`,**`saveBatch` 恰调用一次**(原子)。
- Edge:无隔离条目 → no-op、不崩、不 save。
- Edge:混合状态批次 → 只动 `needs-human-verification`,其余 item 不变。
- Error path:单次 save 失败 → 批次状态**不变**(无部分撤出)。
- Integration:撤出后视图计数归零、不自动重发(无新 grant)、不自动升格。
- 视图:隔离条目正确渲染原因/数量;批量按钮确认文案含「清除整批人工核验」。
**Verification:** orchestrator 批量逻辑测 + 视图测绿;现有 batch 测不破;`pnpm -r test` + `compile` 绿。

> **原 Unit E2 已切出本轮** —— grounding 手编后行为触防幻觉铁律(实时 GroundingStrip 评编辑稿而非 `assembledDraftSnapshot` 本身就是潜在泄漏),需 `/ce:brainstorm` 专门决策(实时 strip 改评快照 vs 允许手编纳入判据),非本计划可单方决定。见 Deferred Requirements。

## System-Wide Impact

- **Interaction graph:** E1 仅 Settings + listModels(只读探针);E4 仅后端 services/llm.ts(LLM 调用路径);E3 batch-orchestrator + background 薄接线 + 新视图/可能新消息;E2 BatchReviewPanel(+ 若 B 则 grounding 接线)。E1/E2/E3 不改 `RuntimeMessage` 既有语义(E3 可新增类型)。
- **Error propagation:** E4 须保持 review/rewrite「不 throw、失败返 ok:false」契约;扩展 thin proxy 行为不变。
- **State lifecycle risks:** E3/E2 守「gate-failed/隔离不自动升格」「save 本地 PRIMARY」;E4 退避勿 module-level 状态(SW 重启 + 测试污染);E2 若涉状态流转须守判据快照分离(`assembledDraftSnapshot`)。
- **Unchanged invariants:** 防幻觉铁律(gate 评原稿快照)、零提交/发布闸门、注入面三处、存储结构——除非 E2 铁律决策显式改变(那需 brainstorm)。
- **Integration coverage:** 23 条 e2e 兜底;E1 真连接、E3 撤出流建议人工冒烟。

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| R2/E2 触防幻觉铁律(实时 strip 评编辑稿已是潜在泄漏) | 切出本轮 → `/ce:brainstorm`;不作无 owner 阻塞单元留在计划 |
| E4 退避与 model-fallback/gemma4 降级打架、把格式错误混进重试 | characterization-first:现有 429→next-model、400→降级断言须仍绿;**仅按 HTTP 状态码分桶**,parse 失败不重试 |
| E4 共享 AbortController 致重试请求立即 abort / 上游 Retry-After 拉爆延迟 / 日志泄密 | 每次重试各自 AbortController+timer;设总等待上限;日志只记 model/status/attempt/delay |
| E4 测试真 sleep 变慢/不稳 | 退避时钟可注入,测试快进 |
| E3 批量撤出误动非隔离条目 / 半撤出无回滚 / 削弱人工闸 | 只过滤 `needs-human-verification`;累积单次原子 save(全或无);确认对话框明确「清除整批人工核验」 |
| E1 四态靠中文串子串匹配脆弱、回显原始错误体泄密 | R1 据实降级(LLM 侧合一);UI 渲染固定文案、不插值原始 body |
| 改 UI 状态/错误文案撞组件测试字面断言 | 改前查 BatchReviewPanel.test.tsx 字面断言(Theme C 教训) |
| 3 件打包成大 PR 重蹈覆辙 | 3 独立 PR、独立验证/回滚 |

## Documentation / Operational Notes

- 每个 PR 各跑 `pnpm test` + `pnpm test:e2e` + `pnpm compile` + `pnpm lint:ci` 全绿门。
- 完成后 `/ce:compound` 沉淀(知识库近空):测试连接四态映射、429/503 退避与 gemma4 分桶、批量撤出语义、grounding 手编铁律决策。

## Sources & References

- 健检结论:本会话 2026-06-15 全面健检(Theme E 产品机会)
- 铁律必读:`docs/plans/2026-06-11-005-fix-grounding-gate-rewrite-bypass-plan.md`
- 蓝本:`docs/plans/2026-06-04-003-refactor-batch-orchestrator-plan.md`、`2026-06-15-002`(Theme C,小独立 PR 教训)
- 关键代码:`lib/llm.ts:listModels`、`backend/src/services/llm.ts:230-287`、`lib/grounding-gate.ts`、`BatchReviewPanel.tsx`、`batch.ts:releaseQuarantine`、`Settings.tsx`、`BatchView.tsx`
- solutions:extension-http-client-testability、vitest-excludes-dist;`.ai-memory` llm-credentials-updated(gemma4 怪癖)
