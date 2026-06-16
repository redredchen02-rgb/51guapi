---
title: 'feat: 阶段 0 — 前提基线 + 首飞验证(go/no-go 闸门)'
type: feat
status: active
date: 2026-06-05
origin: docs/brainstorms/2026-06-05-content-quality-and-first-flight-requirements.md
---

# 阶段 0 — 前提基线 + 首飞验证(go/no-go 闸门)

## Overview

51publisher 工程地基已过度建设(v1+plan-004+005、217 测试绿、可 build),但**产品 0% 验证**:
草稿合格率从没测过、authorized 真实发布一次没跑通。本计划**不写功能代码**,而是一份**可照做的执行 runbook**:
用现版扩展跑一批真实题材拿数据,过一道 go/no-go 闸门,**用数据决定**是否值得投入阶段 1 的源接地架构(R4–R8)。

这是 `docs/phase-0-validation-worksheet.md` 的补完执行 —— 把那份只读勘查里悬空的「草稿合格率」「首飞」两项跑完。

> 阶段 0 几乎零写码。唯一可能的代码是 **Unit 1 发现后台契约漂移时的修复**,且属 contingent(发现了才做,见该单元)。

## Problem Frame

三人评审(product/adversarial/feasibility)一致质疑核心前提:**若日常真瓶颈是「找事实」而非「幻觉」**,
源接地会把难活(找对漢化/無修连结、核对集数)推回给操作者、AI 只剩套壳,可能仍比手工慢——
那"自用每天能发"的目标不会因源接地达成。阶段 0 用最低成本(~1–2h)证实或证伪这个前提,
避免给一台没点过火的引擎继续抛光。(see origin: docs/brainstorms/2026-06-05-content-quality-and-first-flight-requirements.md)

## Requirements Trace

- R0. 重新核对后台契约(`POST /admin/webarticle/save`、字段集、选择器、Quill/layui)与 2026-06-04 实证是否一致。
- RB. 用**现版 prompt(无源接地)**在 5–10 真题材上生成草稿,逐条标质量(直接发/小改/不合格分开)+ 计时(找事实多久、从哪来、审改多久 vs 手工基线)。**这是闸门依据。**
- R2. 走通 ≥1 条 authorized 真实发布的完整端到端链路,记录摩擦点。
- GATE. 依 RB+R2 数据判 go/no-go,产出明确下一步。

成功标准(origin Success Criteria):≥1 条真发跑通且轨迹可校验;合格率(直接发+小改)≥ 拍板阈值(默认 80%);
零编造连结/事实;真实题材上源接地全流程净耗时 ≤ 手工(此条 RB 先量手工基线,阶段 1 才完整验证)。

## Scope Boundaries

- **不规划阶段 1**(R4–R8 源接地单元):仅当 GATE=go 才另起 `/ce:plan`。
- **不写功能代码**:阶段 0 是手动验证;唯一例外是 R0 发现漂移后的契约修复(contingent)。
- **不删后台测试帖**:id 110/111/112 清理是一次性运维,列在最后,非交付单元。

## Context & Research

### Relevant Code and Patterns

- 现版生成入口:Settings 的 `promptTemplate`(`{{topic}}` 注入)→ `lib/llm.ts` `buildPrompt`(RB 用**现状**,不改)。
- 批量流:side panel **≣ 批量** 视图 → 输入选题 → 「开始批量(生成+填充)」→ 审批卡(`BatchReviewPanel`)。
- 发布档位:Settings 三档 `off / dry-run / authorized`;authorized 需打字 `publish` 手势确认(`lib/safety-gate.ts`)。
- 真发链路:`lib/publish.ts` `POST /admin/webarticle/save` + `lib/publish-orchestrator.ts` dispatch;轨迹 `lib/trajectory.ts` + History tab,`verifyTrajectory()` 校验链。
- 后台事实(2026-06-04 实证):`dx-999-adm.ympxbys.xyz`,layui+jQuery,保存无 CSRF 也成功;字段 media_id/title/subtitle/type/status/description/published_at/html_content/tags[]。

### Institutional Learnings

- 坑:naive 点提交按钮会掉回原生 GET 不保存 → 必须走 `POST /save`(已在 `publish.ts` 处理,R2 验证它真的对)。
- 机械发布 < 0.5s → 瓶颈在生成质量+人审,不在点击(RB 要再验"找事实"是否才是真瓶颈)。

## Key Technical Decisions

- **RB 用现版 prompt,不预先改**:要的是"未接地"基线,以便阶段 1 改动可归因(评审指出三杠杆同时变无法归因)。
- **RB 必须计时且记"事实来源"**:这是判"找事实 vs 幻觉谁是瓶颈"的唯一证据,不可省。
- **R2 可在阶段 0 即做**:真发链路已实现,用现版内容先打通管路,与内容质量解耦。
- **闸门是硬决策点**:no-go 不进阶段 1,回 brainstorm 转向(如定向自动取链/模板化),避免沉没成本。

## Open Questions

### Resolved During Planning

- RB 样本量:5–10 条(origin 定);承认统计置信有限,作方向性判断而非精确测量。
- 合格率阈值:默认 直接发+小改 ≥80%,跑完看真实数据再拍最终值(origin Resolve-Before-Planning,可先认默认)。

### Deferred to Implementation

- R0 若发现漂移,具体修哪(选择器 / 字段 / 提交方式)取决于实际漂移内容 —— 发现后即时定。
- 「需小改」的时间界 N:RB 执行时凭手感定一个(如 < 3 分钟),全程一致即可。

## Implementation Units

> 单元 = 执行步骤,非写码任务。多数 `Test expectation: none — 手动验证程序`。

- [x] **Unit 1: R0 — 后台契约重核(前置闸)** ✅ 2026-06-05 只读勘查,契约基本一致;3 处 drift(cover_url/tags量/站名),见 worksheet ①

**Goal:** 确认真发链路赖以成立的后台契约未漂移,排除 R2 中途失败。

**Requirements:** R0

**Dependencies:** 无(须已登录 admin 后台)

**Files:**

- 只读核对,无改动;若漂移:`lib/recipe.ts`(SiteRecipe 单一数据源)/ `lib/field-mapping.ts` / `lib/selectors.ts`

**Approach(照做清单):**

1. 登录 `https://dx-999-adm.ympxbys.xyz/`,开发者工具 Network 勾 Preserve log。
2. 手动新增一条临时帖、保存,确认:仍是 `POST /admin/webarticle/save`?urlencoded?字段名(media_id/title/subtitle/type/status/description/published_at/html_content/tags[])是否一致?
3. Elements 核对正文编辑器仍是 Quill `#editor`;新增表单仍是 layui layer(`lay-event="add"`)。
4. 与 `lib/recipe.ts` / `DEFAULT_FIELD_MAPPING` 逐项对照。
5. 结果记入 worksheet 的「R0 契约核对」表;**一致 → 通过;漂移 → 先记差异,修对应单一数据源再继续**。

**Execution note:** 浏览器只读勘查为主;务必删掉本步骤建的临时帖。

**Patterns to follow:** 沿用 2026-06-04 `phase-0-validation-worksheet.md` 检查 1 的勘查法。

**Test scenarios:** Test expectation: none — 手动契约核对。若触发修复,则对应模块补/改单测(契约值变更)。

**Verification:** worksheet「R0 契约核对」全绿,或漂移已修复并通过 `pnpm test`。

---

- [x] **Unit 2: RB — 前提基线运行(闸门依据)** ✅ 2026-06-05 Claude 替身跑 5 条真题材:幻觉 100%、口吻 100% 命中、合格率 0%。见 worksheet ②

**Goal:** 拿到现版未接地的合格率 + "找事实"耗时来源,回答"幻觉 vs 找事实谁是瓶颈"。

**Requirements:** RB

**Dependencies:** 无(Unit 1 建议先做,确保链路可用;RB 只生成不必真发)

**Files:**

- 数据捕获:`docs/stage0-baseline-worksheet.md`(本计划 Unit 5 产出的模板,操作者填)

**Approach(照做清单):**

1. 选 **5–10 个本站真实题材**(贴近日常分布,**别专挑好写的**,否则基线虚高 —— 评审 residual risk)。
2. `pnpm build` 加载扩展;side panel → 批量 → 逐条/批量用**现版 prompt**生成(Settings 不动)。
3. 每条记入 worksheet:
   - **质量**:直接发 / 需小改 / 不合格(三选一,分开计;"小改"按时间界 N)。
   - **幻觉**:有无编造作品名/集数/连结(逐条 √/×;这是"幻觉是否真瓶颈"的直接证据)。
   - **计时**:为补全/核对事实花了多久、**事实从哪来**(自家 CMS?某源站?记忆?);审改花多久。
   - **手工基线**:对同题,估/记一个纯手工撰写耗时。
4. 汇总:合格率(直接发%、小改%)、幻觉发生率、单帖事实耗时中位数、净耗时 vs 手工。

**Execution note:** 纯手动;RB 不真发(避免污染 publishedTopics 与后台)。

**Patterns to follow:** origin RB 定义;沿用 `phase-0-validation-worksheet.md` 检查 3 的精神(补完它)。

**Test scenarios:** Test expectation: none — 手动数据采集。

**Verification:** worksheet 5–10 行填满,汇总四项指标齐全,足以喂入 GATE。

---

- [ ] **Unit 3: R2 — 首飞真实发布(端到端打通)**

**Goal:** 用现版内容真实发出 ≥1 条,证实 authorized 链路端到端可用,记录摩擦点。

**Requirements:** R2

**Dependencies:** Unit 1 通过(契约无漂移)

**Files:**

- 只运行,无改动;摩擦点记入 worksheet「R2 首飞日志」

**Approach(照做清单):**

1. 后台发帖页打开「添加」表单(批量填充作用于当前标签页)。
2. side panel 批量取 RB 中 1 条**合格**草稿(或单独写一条安全测试内容,status 设隐藏更稳妥)。
3. Settings 切 `authorized` → 打字 `publish` 手势 → 批准。
4. 观察:FillStatusTable 三态、`POST /save` 是否 `{code:0}`、后台列表是否真出现、与 side panel 状态一致。
5. History tab → 确认轨迹记录出现且 `verifyTrajectory()` ✓。
6. 刷新 side panel → 确认状态持久化恢复;关标签页重开 → 确认 tombstone 崩溃恢复正常。
7. 全程摩擦点(选择器漂移、Quill 真实行为、layui 提交、tab 漂移阻断)逐一记日志。

**Execution note:** authorized 真发不可撤回 → 首发建议 status=隐藏,确认无误再显示;发完若是测试内容,记得清理。

**Patterns to follow:** README「批量流程」+ shiny-wizard 计划 Step 3 流程。

**Test scenarios:** Test expectation: none — 手动端到端验证。

**Verification:** ≥1 条真实保存成功、后台可见、轨迹可校验、刷新/重启状态正确恢复;摩擦点已记录。

---

- [x] **Unit 4: GATE — go/no-go 判定** ✅ 2026-06-05 = **conditional GO**(幻觉真且严重、AI 口吻满分、缝切正确);条件:阶段 1 实测找事实成本 + 操作者完成 R2。见 worksheet ④

**Goal:** 依 RB+R2 数据做出明确决策与下一步,杜绝凭感觉进阶段 1。

**Requirements:** GATE

**Dependencies:** Unit 2 + Unit 3 完成

**Approach(判据表):**

| 信号           | 读数来源           | go 方向                             | no-go 方向                                 |
| -------------- | ------------------ | ----------------------------------- | ------------------------------------------ |
| 幻觉是否真发生 | RB 幻觉发生率      | 高(现版常编造)→ 源接地有的放矢      | 几乎不编造 → 源接地解决的是伪问题,重审前提 |
| 找事实成本     | RB 事实耗时 + 来源 | 低/可控(事实就在手边)→ 贴事实代价小 | 高(每条要满网找)→ 找事实才是真瓶颈         |
| AI 残值        | RB「小改」内容性质 | AI 真省了写作/组织功夫              | 接地后 AI 只剩套壳,净耗时 ≥ 手工           |
| 链路可用       | R2                 | 端到端通                            | 有硬阻塞 → 先修链路                        |

**判定:**

- **GATE = go**:幻觉确为瓶颈 **且** 找事实成本可控 **且** R2 通 → 进阶段 1,`/ce:plan` 规划 R4–R8(届时回答 origin 中 Deferred 的事实字段集/契约/few-shot 等)。
- **GATE = no-go**:找事实才是瓶颈 / AI 接地后只剩套壳 / 净耗时未省 → **不进源接地**,回 `/ce:brainstorm` 转向(候选:定向自动取链而非全 scrape、帖体模板化 + 单次 AI 润色、或重定"日常瓶颈"问题)。

**Test scenarios:** Test expectation: none — 决策单元。

**Verification:** worksheet 末尾写下 go/no-go 结论 + 一句理由 + 下一步命令。

---

- [x] **Unit 5: 产出 stage0 数据表模板** ✅ `docs/stage0-baseline-worksheet.md`

**Goal:** 给 Unit 1–4 一份可直接填的表,降低执行摩擦。

**Requirements:** 支撑 R0/RB/R2/GATE

**Dependencies:** 无(可最先做)

**Files:**

- Create: `docs/stage0-baseline-worksheet.md`

**Approach:** 含四块——「R0 契约核对」勾选表、「RB 基线」5–10 行表(题材/质量/幻觉√×/事实耗时/事实来源/审改耗时/手工基线)、「R2 首飞日志」摩擦点清单、「GATE 结论」判据表+结论行。

**Test scenarios:** Test expectation: none — 文档模板。

**Verification:** 模板四块齐全,字段与本计划单元一一对应。

## Risks & Dependencies

| Risk                         | Mitigation                                                               |
| ---------------------------- | ------------------------------------------------------------------------ |
| RB 题材专挑好写的 → 基线虚高 | Unit 2 明确"贴近日常分布、别挑好写的";结论标注样本偏置                   |
| 样本 5–10 统计置信弱         | 作方向性判断,不当精确测量;GATE 看的是量级差异不是小数点                  |
| 后台契约已漂移 → R2 失败     | Unit 1 前置核对,先于 R2                                                  |
| authorized 真发不可撤回      | R2 首发 status=隐藏,确认后再显示;测试内容发完清理                        |
| 操作者跳过计时只填质量       | worksheet 把计时列设为必填;无计时则 GATE 的"找事实成本"信号缺失=结论无效 |

## Documentation / Operational Notes

- 阶段 0 结果应回写 origin 需求文档(GATE 结论)+ 更新 `phase-0-validation-worksheet.md` 状态。
- **一次性运维(非单元)**:清理后台测试帖 id 110/111/112(后台搜 `TEST_勿用` 删)。

## Sources & References

- **Origin document:** [docs/brainstorms/2026-06-05-content-quality-and-first-flight-requirements.md](docs/brainstorms/2026-06-05-content-quality-and-first-flight-requirements.md)
- 前序勘查:`docs/phase-0-validation-worksheet.md`、`.kilo/plans/1780564624902-shiny-wizard.md`(Step 3 待执行)
- 相关代码:`lib/publish.ts`、`lib/publish-orchestrator.ts`、`lib/trajectory.ts`、`lib/safety-gate.ts`、`lib/recipe.ts`
