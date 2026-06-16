---
date: 2026-06-05
plan_id: 2026-06-05-003
type: feat
status: completed
topic: structured-generation-anti-hallucination
origin: docs/brainstorms/2026-06-05-content-quality-and-first-flight-requirements.md
depth: deep
---

# feat: 程序化结构化生成防幻觉(混合方案 — 程式掌事实骨架)

## Problem Frame

阶段 1「源接地」已上线:输入事实块、prompt「只润色不造事实」契约、连结来源校验、审核区红标。
但这三道防线本质都是 **「模型先自由写整篇 body,再事后检查」** —— 模型仍**亲手打出**每一个
作品名、集数、URL,我们只是事后标红。模型只要不听话(prompt 是软约束),编造的事实/连结
就能进 body,审核区也只是「展示」不「拦截」。

本轮把顺序反过来:**让程式掌控正文的事实骨架,模型碰不到高风险栏位 —— 从流程上让它「没机会编」。**
这是 brainstorm 拍板「源接地·提前掉死」哲学的更彻底落地。

**已选定架构(混合方案,2026-06-05 用户拍板):**

- **程式掌事实骨架**:连结、作品名、集数、制作、分类、标签 —— 由程式从 `FactsBlock`/枚举
  **原样(verbatim)注入** body,模型物理上打不出这些值;缺的程式插「【待补】」。
- **模型只写口吻散文**:引子/看点等叙事槽位(51娘 口吻),且散文里**禁止出现 URL 与具体事实值**。
- 保住目前 **100% 可用的 51娘 口吻**(brainstorm 确认的唯一已验证强项),同时把**最高风险的
  连结/作品事实编造面整个移除**。

> 关系:本计划 **建立在** 阶段 1 之上,不推翻。`lib/facts.ts`(FactsBlock/解析)、
> `lib/link-source.ts`(校验)继续用;源接地的 prompt 软契约**降级为第二道防线**,
> 程式注入成为第一道(硬)防线。

## 排序前提(execution-time,务必先读)

⚠️ **阶段 1 源接地至今未用真模型验证过**(用户尚未跑那条 config→拉模型→生成 的真测)。
两条 execution-time 未知会影响本计划:

1. **用户的代理端点(inaiai 类 OpenAI 兼容代理)是否支持 `response_format: json_schema` strict?**
   多数自建代理只支持 `json_object`(松)。→ **U2 必须实现优雅降级**:试 json_schema strict,
   遇 400/不支持就回落 json_object;**真正的安全网是程式组装(U1),不是 schema**,故 strict
   只是锦上添花、非依赖。建议在动 U2 时**第一件事就探这个端点能力**(一条真请求即可)。
2. **51娘 口吻在「只给散文槽位、不给整篇自由」约束下是否仍自然?**
   过度切槽可能伤口吻。→ U5 prompt/few-shot 改造后,需用真模型跑 3–5 条肉眼比对(沿用 R8 重跑通道)。

→ **建议执行顺序**:先做 U1(纯函数组装器,零端点依赖,可完全单测先行)→ 探端点能力 →
U2/U5 →(真模型比对口吻)→ U3/U4 →(真模型零编造抽查)。

## 目标数据流(混合组装)

```
输入: 选题 + FactsBlock(作品名/集数/制作/漢化/無修/题材/简介)   ← 阶段1 已有
        │
        ▼
  buildPrompt(要求模型只回「叙事槽位」+套话,禁 URL/禁事实值)
        │
        ▼ LLM(response_format: json_schema strict ↘ 回落 json_object)
  DraftSlots = { titleSuffix?, subtitle, intro, highlights, outro? }   ← 纯口吻文本
        │
        ▼ assembleDraft(slots, facts, vocab)         ← lib/post-assembler.ts(本计划核心)
  ┌─────────────────────────────────────────────┐
  │ title    = facts.作品名(verbatim) + 套话   | 缺→【待补】       │
  │ body  ┌ [程式] 作品名/集数/制作 抬头         (facts verbatim)  │
  │       ├ [模型] intro 散文(纯文本→<p>,剥任何 <a>/URL)         │
  │       ├ [模型] highlights 散文(同上消毒)                      │
  │       ├ [程式] 漢化/無修 连结块             (facts URL verbatim)│
  │       └ 缺的 facts → [程式]【待补】占位                          │
  │ category = 命中枚举 | 不命中→默认/【待补】                       │
  │ tags     = 过滤到已知 vocab(未知丢弃)                          │
  └─────────────────────────────────────────────┘
        │
        ▼ ContentDraft(body 为已组装 HTML —— 下游 fill/Quill 路径零改动)
        │
        ▼ verifyLinks(body, factUrls)  → 组装后应恒 ✓(defense-in-depth)
        ▼ groundingGate(draft, facts)  → 残留【待补】/无来源连结 = 硬拦(发布前 fail-closed)
        │
        ▼ 审核区:展示组装预览 + 哪些事实已注入/哪些【待补】 + gate 判定
        ▼ 人审 → authorized 发
```

## 关键决策

- **组装器是纯函数、独立模块**(`lib/post-assembler.ts`),不碰 chrome/DOM,完全单测覆盖。
  「提前掉死」的逻辑集中一处,易测易审。(参照 `lib/facts.ts`/`lib/batch.ts` 的纯函数风格。)
- **模型不再回 `body`**:改回**叙事槽位**(`intro`/`highlights` 等纯文本)。body 由程式组装。
  这是消息/类型契约改动,会冲击 `llm.ts` 解析与 `llm.test.ts`(预期改测,见 U2)。
- **散文槽位强制消毒为纯文本**:即便模型在 intro 里塞了 `<a href>` 或 URL,组装器**剥成纯文本**
  (或整段拒绝)——所以连结**只可能**来自程式注入的 facts。这让连结编造面归零(非"更难")。
- **json_schema strict 是增强非依赖**:端点不支持就回落 json_object;组装器才是安全网。
- **title 也去编造面**:`title = facts.作品名(verbatim) + 模型给的套话后缀`;作品名缺→标题【待补】。
- **category 枚举严格、tags 宽松过滤**:category 是小枚举(后台 select,约个位数)→ 严格命中;
  tags 词表巨大(后台约 3912)→ 模型可提议,程式过滤到已知 vocab,未知**丢弃**(不【待补】,避免噪音)。
- **发布前硬闸**:把现有「只展示」的 grounding 检查升级为 `authorized` 发布前的 fail-closed gate
  (`off`/`dry-run` 不拦,只提示)。这是「出」侧的强制点。

## Implementation Units

### [x] U1. 正文组装器(纯函数,核心,可先行)

**新增** `lib/post-assembler.ts` · 测试 `lib/post-assembler.test.ts`

- `interface DraftSlots { titleSuffix?: string; subtitle?: string; intro: string; highlights: string; outro?: string }`
- `assembleDraft(slots: DraftSlots, facts: FactsBlock, vocab?: Vocab): { title; subtitle; body; description }`
  - **抬头块**:由 `facts.作品名/集数/制作` verbatim 组装(缺→【待补】);作品名缺则 title 标【待补】。
  - **散文块**:`sanitizeToPlainText(slots.intro/highlights)` —— 剥所有标签与裸 URL(用正则/DOM 文本),
    再包 `<p>`。**保证散文里零连结、零被注入的 HTML**。
  - **连结块**:由 `facts.漢化/無修` verbatim 输出 `漢化連結:<a href=URL>URL</a>`;缺→`漢化連結:【待补】`。
  - `description` = 由 facts.简介(verbatim)或 slots.subtitle 截断,**不**让模型自由编。
- **测试场景**:① 全事实 → 抬头/连结全 verbatim、散文被包 `<p>`;② 散文里夹 `<a>`/裸 URL → 被剥成纯文本;
  ③ 缺漢化/缺作品名 → 对应位置【待补】、title【待补】;④ 零事实 → 全骨架【待补】、仅散文有内容;
  ⑤ 输出 body 经 `verifyLinks(body, factUrls(facts))` **恒无 unsourced**;⑥ XSS 注入散文(`<script>`/`onerror`)→ 不进 body。

### [x] U2. 结构化 LLM 契约 + schema + 优雅降级

**改** `lib/llm.ts` · 测试 `lib/llm.test.ts`(预期较大改测)

- 新增 `DRAFT_SLOTS_SCHEMA`(JSON Schema,strict):字段 `intro/highlights` 必填字符串,
  `titleSuffix/subtitle/outro/category/tags` 选填;**无 body 字段**。
- `buildRequest`:`response_format` 改为 `{ type:'json_schema', json_schema:{ name, schema, strict:true } }`;
  保留把 `json_object` 作为回落的能力。
- `generateDraft`:`LlmDeps` 增 `facts?: FactsBlock`;解析 content → `DraftSlots` → **调 `assembleDraft(slots, facts, vocab)`** → `toDraft`。
- **降级逻辑**:首请求若 HTTP 400 且响应体提示不支持 `response_format`/`json_schema`,自动以
  `json_object` 重试一次(同 prompt)。失败种类沿用现有 `network`/`format`。
- **测试场景**:① 正常 → slots 解析+组装出含 facts 的 body;② 端点 400-不支持-schema → 回落 json_object 重试成功;
  ③ 回落后仍 400 → network 错误;④ 模型回了 body 字段(旧式)→ 忽略,只取 slots(向后容错);
  ⑤ 错误信息绝不含 Bearer/key(沿用既有断言)。
- ⚠️ **旧 `llm.test.ts` 中假设模型回 `body` 的用例需改写**为 slots+组装契约;这是预期 churn,非回归。

### [~] U3. 分类枚举 + 标签词表约束 — **DEFERRED**(2026-06-05,执行时决定)

**延后理由**:① 真实 category 选项值 / tag 词表(后台约 3912)**不在仓库**,且 brainstorm 明确
「不做源数据自动抓取」——没有 vocab 数据,coerce/filter 只能空表 pass-through = 死代码(YAGNI)。
② category/tags 的幻觉风险**已被 fill 时兜住**:native-select 跳过未知 option、checkbox-multi 跳过
未知标签,三态表(FillStatusTable)会标黄让操作者手填。→ 边际价值低、又卡在数据上,故延后。
**重启条件**:操作者提供真实分类/标签清单后,再建 `lib/vocab.ts`(coerceCategory/filterTags)+ 接入 toDraft。
**新增** `lib/vocab.ts` · 测试 `lib/vocab.test.ts`(或并入 post-assembler)

- `coerceCategory(raw, allowed): string` —— 命中后台 category value 枚举则用,否则回落默认/【待补】。
- `filterTags(raw: string[], vocab: Set<string>): string[]` —— 只留已知 tag,未知丢弃,去重保序。
- 词表来源:后台勘查(category select options + tag 列表),存为常量或 Settings 可覆盖字段。
  MVP 可先用 category 小枚举 + tags 直接放行(若 3912 词表抓取成本高,标记为 execution-time 决定)。
- **测试场景**:① 未知 category → 回落;② 已知子集 tags 保留、未知剔除;③ 空输入安全。

### [x] U4. 发布前 grounding 硬闸(fail-closed)

**新增** `lib/grounding-gate.ts` · 测试 `lib/grounding-gate.test.ts`;接线 `lib/publish-orchestrator.ts` / `lib/batch-orchestrator.ts`(approveBatch)

- `evaluateGrounding(draft, facts): { ok: boolean; reasons: string[] }` ——
  规则:① body/title 中残留**必填**位的【待补】(作品名/至少一条连结,阈值可配)→ block;
  ② `hasUnsourcedLink(verifyLinks(...))` → block(组装后应恒不触发,作 defense-in-depth)。
- **仅 `authorized` 档拦截**;`off`/`dry-run` 只在审核区提示、不拦(沿用 fail-closed 安全默认风格)。
- 接线点:`approveBatch` 在 `sendFill` 前(或 `orchestratePublish` 闸内)对每条求值,block 则该条
  转 error/needs-human(不 dispatch)、附 reason;不影响其它条目。
- **测试场景**:① 残留【待补】+authorized → 拦,reason 明确;② 同条 dry-run → 不拦、有提示;
  ③ 干净草稿 → 放行;④ 注入无来源连结 → 拦。

### [x] U5. Prompt / few-shot 改造(只要槽位、禁 URL/事实)

**改** `lib/storage.ts`(`DEFAULT_SETTINGS.promptTemplate` + `fewShotExamples`)· 复用 `lib/facts.ts` 渲染

- promptTemplate:删掉「以 JSON 返回 body(HTML)」,改为**要求只回叙事槽位**(intro/highlights/套话),
  明确「**正文里绝不写任何 URL、绝不写具体作品名/集数/连结 —— 这些由系统填入**」。
- fewShotExamples:示范**槽位级**口吻(纯散文,无连结),与新 schema 对齐。
- **真模型验证**(execution-time,沿用 R8 重跑通道):改完跑 3–5 条肉眼比对口吻是否仍自然。

### [x] U6. 审核区呈现升级

**改** `entrypoints/sidepanel/BatchReviewPanel.tsx`(`GroundingStrip`)

- 展示**组装预览**:哪些骨架位来自 facts(✓ verbatim)、哪些是【待补】;连结块标「程式注入(不可编造)」。
- 显示 U4 gate 判定(此条若 authorized 会否被拦 + 原因)。
- 连结来源校验保留作 defense-in-depth(组装后应恒 ✓)。

### [x] U7. 类型与接线收尾(随 U2 完成:facts 已穿到 generateDraft;DraftSlots 留在 llm/post-assembler 层,无需进 types.ts)

**改** `lib/types.ts`(若 `DraftSlots` 需跨层)· `entrypoints/background.ts`(generateDraft 回调传 `facts` 进 `LlmDeps`)

- `background.ts`:`generateDraftFn` 调用处把 `itemFacts` 传入 `generateDraft` 的 `deps.facts`(供组装)。
- 确认 `RUN_BATCH`/`BatchItem.facts` 链路(阶段1已建)端到端把 facts 送到组装点。

## Sequencing

```
U1(纯函数,先行,零端点依赖)
  └→ 探端点 json_schema 能力(1 条真请求)
        └→ U2(契约+降级)── U5(prompt/few-shot)
              └→ 真模型跑 3–5 条:验口吻 + 验组装
                    └→ U3(枚举/词表)── U4(硬闸)── U6(审核区)── U7(接线)
                          └→ 真模型零编造抽查(Success Criteria)
```

## Success Criteria

- **连结编造面归零(可证)**:任意 facts 输入下,组装出的 body 经 `verifyLinks` **恒无 unsourced 连结**
  (单测全覆盖 + 真模型抽查 N 条);body 内出现的 URL 100% 等于输入 facts 的 URL。
- **作品名/集数零编造**:抽查 N 条,抬头的作品名/集数要么 verbatim 等于输入、要么【待补】,无第三种。
- **51娘 口吻不退化**:真模型 3–5 条肉眼比对,口吻自然度 ≥ 阶段1 自由生成版(主观但记录)。
- **硬闸生效**:authorized 档下,残留必填【待补】或无来源连结的草稿**无法发布**(自动拦 + reason)。
- **下游零回归**:fill/Quill/dry-run/历史 路径不改(body 仍是 HTML 字符串);现有非 llm 测试全绿。

## Scope Boundaries(本轮不做)

- **不做源数据自动抓取**(沿用 brainstorm:事实仍手动贴)。
- **不做全模板化僵硬版**(已否决 Option 3:会伤口吻);散文仍由模型写。
- **不做连结可达性网络探测**(MV3/CORS;仅格式+来源)。
- **不重建可靠性/可观测性**(批量状态机/轨迹/恢复 封存不动)。
- **不投资多站点/配置化/对外发布**。

## Risks

- **R1 端点不支持 json_schema strict** → 已由 U2 降级 + U1 组装器安全网化解(strict 非依赖)。
- **R2 切槽伤口吻** → U5 真模型比对把关;槽位粒度保持粗(intro/highlights),不过度结构化。
- **R3 llm.test.ts 大改被误读为回归** → 计划已声明为契约改测;评审/CI 时对照本节。
- **R4 在未验证阶段1 的情况下加码** → 故排序要求「U1 先行 + 早探端点 + 早真测」,避免空中楼阁。
- **R5 description/title 仍含模型文本** → title 用 facts.作品名 verbatim+套话;description 取 facts.简介,
  把残余编造面压到「套话后缀」这种低风险处。

## 与既有代码的衔接点(快速索引)

- 组装注入点:`lib/llm.ts` `generateDraft`/`toDraft`(`LlmDeps` 加 `facts`)。
- facts 已端到端:`RUN_BATCH`(`lib/types.ts`)→ `BatchItem.facts`(`lib/batch.ts`)→
  `runBatch`/`retryItem`(`lib/batch-orchestrator.ts`,`generateDraft(topic, item.facts)`)→
  `background.ts` `generateDraftFn`。本计划只需在最末把 `facts` 也喂进 `LlmDeps`。
- 校验复用:`lib/link-source.ts` `verifyLinks`/`hasUnsourcedLink`、`lib/facts.ts` `factUrls`。
- 闸门风格参照:`lib/publish-orchestrator.ts`(fail-closed)、`lib/storage.ts` getSafetyMode。

## Next Steps

→ `/ce:work` 执行(建议从 U1 起,先把纯函数组装器与测试落地);或先跑「探端点 json_schema 能力 +
阶段1 真模型基线」这条 execution-time 探针,再进 U2。
