---
title: "feat: Complete Auto-Scraping Content Pipeline"
type: feat
status: active
date: 2026-06-09
origin: docs/brainstorms/2026-06-08-auto-scraping-content-pipeline-requirements.md
---

# feat: Complete Auto-Scraping Content Pipeline

## Overview

后端 scraper 基础设施（scheduler、site-adapter 接口、fact-extractor、pending-routes、PendingTopicsView）已全部就位，仅剩六个具体缺口需要补全：

1. **G3** — `field-mapping.ts` 缺失 `cover_url`（后台字段漂移）
2. **G4** — `fillCheckboxMulti` 对 LLM 自由文字标签无匹配时直接 `degrade`，需加子串兜底匹配
3. **SQLite 迁移** — `pending-store.ts` 当前是 JSON 文件（O(N) 全扫），迁移到 `better-sqlite3` 以支持过滤/翻页查询
4. **51acgs.com 适配器** — 唯一未实现的真实 `SiteAdapter`，需要 DOM 分析后实现
5. **Scheduler 重试** — `scheduler.ts` catch block 只打 log，不重试（R5 要求指数退避最多 3 次）
6. **fact-extractor fallback** — `json_schema strict` 无降级，LLM 代理返回 400 会直接抛出

（see origin: docs/brainstorms/2026-06-08-auto-scraping-content-pipeline-requirements.md）

**注：** 所有六个缺口均在本计划范围内。"Deferred to Implementation" 仅指实现时动态确定的技术细节（如 DOM 选择器、字段来源），非推迟到未来计划的内容。

## Problem Frame

运营者当前发一条帖需要 40–50 分钟手工整理事实素材。产品已有完整的程序化生成管道（post-assembler + batch-orchestrator）和安全门控（publish-orchestrator）。核心瓶颈是「采集→结构化」段落完全依赖人工。本计划的价值是让这一段完全自动化，同时保留人工审核闸门，不降低内容质量。

（see origin: Problem Frame 节）

## Requirements Trace

- **R1** — 可配置 cron 定时抓取 → Unit 4（cron 站点注册）；Unit 5 处理失败重试，不负责调度注册
- **R2** — SiteAdapter 统一接口 + fetchContent → Unit 4
- **R3** — 原始页面内容持久化 → Unit 3（SQLite raw_content_body 列）
- **R4** — robots.txt 遵守 + per-adapter 频率限制 → Unit 4 approach 注
- **R5** — 抓取失败指数退避最多 3 次 → Unit 5
- **R6** — 提取结果映射到 FactsBlock → Unit 6（提高成功率）+ Unit 4
- **R7** — 复用 llm.ts LLM 代理模式 → Unit 6
- **R8** — 置信度分数 + 低置信度标记 → 已有，Unit 3（SQLite 中保留 confidence 列）
- **R9** — backend 存 pending 状态 → Unit 3（SQLite 替代 JSON 文件）
- **R10** — 扩展侧翻页/搜索/按站点筛选 → Unit 3（SQLite 支持 WHERE / LIMIT）
- **R11–R15** — 待审视图、多选批准/驳回、编辑、接入 batch-orchestrator → PendingTopicsView 已就位，Unit 3 提供数据层
- **R17** — 适配器配置化注册，重启生效 → Unit 4 approach
- **R18** — 手动触发单站 → scraper-routes.ts `POST /api/v1/scraper/trigger` 已就位
- **G3 / field drift** — cover_url 字段 → Unit 1
- **G4 / tag normalization** — tag 自由文字兜底匹配 → Unit 2

## Scope Boundaries

- 不做适配器热加载（重启生效即可，见原始文档）
- 不做 robots.txt 解析库集成（只加配置项 `respectRobots: true`，适配器自行遵守）
- 不做提前的 51acgs.com DOM 分析设计（选择器由实现者在首次部署时现场观测确定，属运行期发现，非推迟到未来计划）
- 不迁移已存在的 JSON 文件数据到 SQLite（pending 池是新数据，无历史迁移需求）
- 不改 batch-orchestrator / publish-orchestrator 逻辑
- 不改 PendingTopicsView UI（已就位）

## Context & Research

### Relevant Code and Patterns

- **Scraper 基础设施**（全部已就位）：
  - `packages/backend/src/scraper/site-adapter.ts` — `SiteAdapter` 接口
  - `packages/backend/src/scraper/scraper-config.ts` — 适配器注册和站点配置单例
  - `packages/backend/src/scraper/adapters/demo-adapter.ts` — 适配器模板（fetch HTML + regex 提取）
  - `packages/backend/src/scraper/fact-extractor.ts` — `extractFacts()` LLM 调用，置信度 = 填充字段数/总字段数
  - `packages/backend/src/scraper/scheduler.ts` — `node-cron` 定时任务，`SchedulerDeps` 注入模式
  - `packages/backend/src/scraper/pending-store.ts` — 当前 JSON 文件实现，O(N) 全扫
  - `packages/backend/src/scraper/pending-routes.ts` — CRUD + 状态更新路由
  - `packages/backend/src/scraper/scraper-routes.ts` — 手动触发 / 适配器列表

- **填充层（G3/G4 修改目标）**：
  - `packages/extension/lib/field-mapping.ts` — `DEFAULT_FIELD_MAPPING`，当前无 `coverUrl`
  - `packages/extension/lib/types.ts` — `FieldKey` 联合类型
  - `packages/extension/lib/fillers.ts:31-42` — category filler（`normalizeCategory` 已在 backend `llm.ts:224` 完成，extension 直接消费结果，无需改）
  - `packages/extension/lib/fillers.ts:58-81` — `fillCheckboxMulti`，tag 精确匹配，无兜底

- **LLM 代理模式**：
  - `packages/backend/src/llm.ts` — `chatCompletionsUrl()`，`json_schema` strict + `json_object` fallback 已在 draft generation 实现，但 `fact-extractor.ts` 未复用此 fallback 模式
  - `packages/extension/lib/llm.ts` — 扩展侧，apiKey 只在 background

- **持久化模式**：`data/<type>/*.json` 每条一文件，`batch-store.ts` 同样模式，可作 SQLite 迁移参考
- **扩展端待审视图**：`packages/extension/entrypoints/sidepanel/PendingTopicsView.tsx` + `pending-client.ts` 已就位，API 通信走 `http://127.0.0.1:3001`

### Institutional Learnings

- `fact-extractor.ts` 的置信度是「填充字段数 / 总字段数」，非模型自报置信度——对字段填了但填错无防护，但可重现。
- `json_schema strict` 对部分 LLM 代理不被支持，400 时 `fact-extractor.ts` 当前会直接抛出。
- `scheduler.ts` 目前无 retry，catch block 只 log。
- 发布消息路径铁律：`side panel → background → content`，apiKey 只在 background（本计划 backend 路径不受此限制）。
- `better-sqlite3` 是同步 API，在 Fastify async handler 里正常工作，但 ESM + native module 需要注意 pnpm workspace 下的 `node_modules` 解析。

### External References

- [better-sqlite3 API docs](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md) — 主要用 `.prepare().run()` / `.prepare().all()` 模式
- 参见 `docs/plans/2026-06-05-003-feat-structured-generation-anti-hallucination-plan.md` U2 节 — json_schema → json_object 降级设计（已设计但未在 fact-extractor 实现）

## Key Technical Decisions

- **SQLite 而非继续 JSON 文件（仅限 pending-store.ts）**：用户明确选择，理由是 R10 要求按站点筛选/翻页，JSON 文件全扫不适合。`batch-store.ts` 等其他 JSON 存储保持原样，SQLite 仅替换 `pending-store.ts`。`better-sqlite3` 同步 API 在 Fastify async handler 中正常工作，但 tsc 编译产物的 ESM/CJS 兼容性需在实现时验证（见 Deferred to Implementation）。
- **`pending-store.ts` 保持相同函数签名**：`pending-routes.ts` 不变，仅替换数据层实现，降低改动面。
- **DB 文件位置**：`packages/backend/data/pending.db`（与现有 `data/pending/` 目录同级，跟随 `.gitignore` 排除）。
- **适配器注册在 `index.ts` 而非独立配置文件**：与现有 `demo-adapter.ts` 注册模式一致，保持一致性，适配器热加载作后续优化。
- **tag 兜底用子串匹配而非 LLM 二次调用**：精确匹配 → 子串包含 → 跳过，不引入额外 LLM 延迟，误匹配风险可控（"成人動畫" 无子串命中时自然跳过）。
- **fact-extractor fallback 复用 llm.ts 已有 400-catch 模式**：不重造，参考 `packages/backend/src/llm.ts` draft generation 的降级逻辑。

## Open Questions

### Resolved During Planning

- **目标站点**：首批仅 51acgs.com（自家站点，无反爬风险）。
- **待审池存储**：SQLite（better-sqlite3），非 JSON 文件，支持过滤/翻页。
- **category 归一化**：G4 中 category 已在 backend `llm.ts:224` 的 `normalizeCategory` 处理，extension 直接消费结果，无需改 fillers.ts 的 category 路径。

### Deferred to Implementation

- **51acgs.com DOM 结构**：需要在实现时现场访问站点，分析列表页和详情页 HTML 结构，确定选择器。计划无法预定 XPath/CSS selector。
- **`cover_url` 填充值来源**：`draft.coverImageUrl` 还是 `facts.coverUrl`？需实现时确认 backend draft 生成是否产出 coverImageUrl 字段，若无则 valueFor('coverUrl') 返回空字符串（hidden input 可以为空）。
- **51acgs.com cron 频率**：几小时一次抓取？站点更新频率未知，建议实现时先配 `0 */6 * * *`（每 6 小时），观察后调整。

## High-Level Technical Design

> *这是方向性示意，不是实现规范。实现时以代码为准，不要照抄。*

```
scraper pipeline (已有) + gaps to close:

  scheduler.ts
  ├── 每次 cron 触发
  │   ├── [NEW] 指数退避 retry wrapper (Unit 5)
  │   └── → site-adapter.fetchContent()
  │            └── [NEW] acgs51-adapter.ts (Unit 4)
  │
  fact-extractor.ts
  ├── [NEW] json_schema strict → 400 → json_object fallback (Unit 6)
  └── → extractFacts() → FactsBlock + confidence
  
  pending-store.ts
  └── [REPLACE] JSON files → SQLite better-sqlite3 (Unit 3)
      └── same function signatures, routes unchanged

fill pipeline (extension):
  field-mapping.ts
  └── [ADD] coverUrl entry (Unit 1)
  
  fillers.ts:fillCheckboxMulti
  └── [ADD] substring fallback after exact match (Unit 2)
```

## Implementation Units

```
Unit 1 (G3)    Unit 2 (G4)    Unit 3 (SQLite)    Unit 5 (retry)    Unit 6 (fallback)
    │               │                │                  │                  │
    └───────────────┘                └──────────────────┘                  │
                                              │                            │
                                         Unit 4 (51acgs adapter)          │
                                         (depends on Unit 3 for store)    │
```

---

- [x] **Unit 1: G3 — 补充 cover_url 字段映射**

**Goal:** 让 extension 填充层识别并填写后台新增的 `cover_url` hidden input 字段，消除字段漂移。

**Requirements:** G3（字段漂移修复）；间接支持 R6（FactsBlock 结构完整性）

**Dependencies:** 无

**Files:**
- Modify: `packages/extension/lib/types.ts` — 将 `'coverUrl'` 加入 `FieldKey` 联合类型
- Modify: `packages/extension/lib/field-mapping.ts` — 在 `DEFAULT_FIELD_MAPPING` 加 `coverUrl` 条目，含 selector（`input[name="cover_url"]` 或观察真实 DOM 后确定）
- Modify: `packages/extension/lib/fillers.ts` — `valueFor()` 加 `case 'coverUrl'`，返回 `draft.coverImageUrl ?? ''`
- Modify: `packages/backend/src/shared/field-mapping.ts` — backend 侧同步加 `coverUrl` 条目（两份独立定义，需同步）
- Test: `packages/extension/tests/e2e/` — 在 fixture HTML 里加 `cover_url` hidden input，验证 fillForm 能写入该字段

**Approach:**
- `cover_url` 是 hidden input，用现有 `fillInput()` 路径（`input[type="hidden"]` 可被 `element.value = x` 设值）
- 实现时先检查 fixture HTML 里 `cover_url` 的真实 name attribute，选择器可能是 `input[name="cover_url"]`
- `valueFor('coverUrl')` 的返回值来源在 deferred questions 里已说明，实现时确认

**Patterns to follow:** `packages/extension/lib/field-mapping.ts` 现有字段条目格式；`fillers.ts` 的 `valueFor()` switch-case 结构

**Test scenarios:**
- Happy path: fixture HTML 含 `input[name="cover_url"]`，fillForm 执行后该 input.value 被写入（非空时）
- Edge case: `draft.coverImageUrl` 为 undefined → valueFor 返回 `''`，hidden input 不报错，form 正常提交
- Integration: 端到端 fixture 测试不因新字段报 `unknown field` 错误

**Verification:**
- `vitest run` 在 extension 包通过，无新的 `unknown field` 警告
- fixture 测试中 cover_url input 的 value 被正确写入

---

- [x] **Unit 2: G4 — tag fillCheckboxMulti 子串兜底匹配**

**Goal:** LLM 输出的自由文字 tag（如"成人動畫"、"校園/日常"）在精确匹配失败后，通过子串包含做兜底，减少 degrade 丢标签的情况。

**Requirements:** G4（分类映射修复）；支持 R6（FactsBlock 字段有效映射）

**Dependencies:** 无

**Files:**
- Modify: `packages/extension/lib/fillers.ts:58-81` — `fillCheckboxMulti()` 内加降级链
- Test: `packages/extension/__tests__/fillers.test.ts`（如存在）或新建单元测试

**Approach:**
- 降级链：① `byLabel.get(tag.trim())` 精确匹配 → ② 遍历 `byLabel` keys，找 `key.includes(tag) || tag.includes(key)` 的首个命中 → ③ 无命中则跳过
- 子串逻辑用小写比对（`tag.toLowerCase()`, `key.toLowerCase()`），避免繁简/大小写假阴性
- "成人動畫" 对抗测试：后台无含该字串的 checkbox，应自然跳过，不乱选
- "校園/日常" → 命中 "校園" checkbox（如存在）

**Patterns to follow:** `fillers.ts` 现有 `fillCheckboxMulti` 结构

**Test scenarios:**
- Happy path: tag = "奇幻" 精确匹配 → checkbox 被勾选
- Happy path: tag = "校園/日常"，精确无命中，子串含 "校園"，"校園" checkbox 被勾选
- Edge case: tag = "成人動畫"，后台无含此字的 checkbox → 静默跳过，其他 tag 不受影响
- Edge case: tag 为空字符串 → 跳过，不报错
- Integration: 多 tag 输入，部分精确命中、部分子串命中、部分无命中，结果互不干扰

**Verification:**
- `vitest run` 通过
- 手动用真实草稿 + E2E fixture 验证 tag 命中率提升（不再 degrade = 0）

---

- [x] **Unit 3: 迁移 pending-store 到 SQLite**

**Goal:** 替换 `pending-store.ts` 的 JSON 文件实现为 `better-sqlite3`，保持相同函数签名，支持过滤/翻页/按站点查询。

**Requirements:** R9（状态管理）、R10（筛选/翻页）、R3（原始内容持久化）

**Dependencies:** 无（独立数据层）

**Files:**
- Modify: `packages/backend/package.json` — 添加 `better-sqlite3` 依赖（及 `@types/better-sqlite3`）
- Modify: `packages/backend/src/scraper/pending-store.ts` — 完全重写内部实现，函数签名不变
- Create: `packages/backend/src/scraper/pending-db.ts` — DB 初始化（CREATE TABLE IF NOT EXISTS、建索引）
- Modify: `packages/backend/src/index.ts` — 服务启动时调用 `initPendingDb()`
- Test: `packages/backend/src/scraper/pending-store.test.ts`

**Approach:**
- DB 文件路径：`packages/backend/data/pending.db`（`.gitignore` 已排除 `data/` 目录，确认）
- 表结构：

  ```
  pending_topics (
    id TEXT PRIMARY KEY,
    source_url TEXT NOT NULL,
    site_name TEXT NOT NULL,
    adapter_name TEXT,              -- nullable until PendingTopic type is updated
    raw_content_title TEXT,
    raw_content_body TEXT,
    facts TEXT NOT NULL,        -- JSON 序列化的 FactsBlock
    confidence REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    rejection_reason TEXT,
    facts_edited INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
  ```
- 索引：`(status, created_at DESC)`、`(site_name, status)`（支持 R10 按站点筛选）
- `listPendingTopics(filter?)` 接受可选 `{ siteFilter?, status?, page?, pageSize? }` 参数（对 routes 层是新增可选项，不破坏现有调用）
- `better-sqlite3` 同步 API 在 Fastify async handler 里直接调用（无 await），符合现有 store 调用风格

**Patterns to follow:** `packages/backend/src/batch-store.ts` 的 CRUD 模式作为参考风格；`better-sqlite3` `.prepare().run()` / `.prepare().all()` 标准用法

**Test scenarios:**
- Happy path: savePendingTopic → listPendingTopics 能查到，字段完整
- Happy path: updatePendingStatus('approved') → 状态变更，updated_at 刷新
- Happy path: listPendingTopics({ siteFilter: '51acgs' }) → 只返回该站点的记录
- Happy path: 翻页参数 page=2, pageSize=10 返回正确的第二页
- Edge case: 重复 id 的 savePendingTopic → 报错（PRIMARY KEY 约束）
- Edge case: 空 DB（无记录）时 listPendingTopics → 返回空数组，不抛出
- Error path: DB 文件路径无写权限 → initPendingDb 抛出有意义的错误，Fastify 启动失败并打印路径

**Verification:**
- `vitest run` 在 backend 包通过
- `pending-routes.ts` 无改动下，手动触发 GET /api/v1/pending-topics 返回 200（空列表）

---

- [x] **Unit 4: 51acgs.com 站点适配器**

**Goal:** 实现针对 51acgs.com 的 `SiteAdapter`，并注册配置，使下次 cron 周期自动生效。

**Requirements:** R1、R2、R4、R17

**Dependencies:** Unit 3（SQLite 存储就位，savePendingTopic 可用）

**Files:**
- Create: `packages/backend/src/scraper/adapters/acgs51-adapter.ts`
- Modify: `packages/backend/src/index.ts` — 注册适配器 + 添加站点配置
- Test: `packages/backend/src/scraper/adapters/51acgs-adapter.test.ts` — 用本地 HTML fixture 单测（离线）

**Approach:**
- 实现 `SiteAdapter` 接口：`fetchContent(url: string): Promise<RawContent>`
- 抓取模式：先从列表页（如 `/admin/webarticle/list` 或公开列表）获取最近 N 篇文章 URL，再逐篇获取详情页
- DOM 结构分析是**执行时任务**（deferred）：实现时现场访问 51acgs.com 确定选择器
- 遵守 R4：在 adapter 配置中加 `requestDelay: 1000`（ms），适配器 `fetchContent` 内 sleep 延迟
- User-Agent：随机选一个合理的浏览器 UA，避免被识别为 bot（51acgs 是自家站点，这只是礼貌性做法）
- 注册：`scraperConfig.registerAdapter(acgsAdapter)` + `scraperConfig.addSiteConfig({ siteName: '51acgs', ..., cron: '0 */6 * * *', enabled: true })` — cron 表达式实现时可按需调整

**Patterns to follow:** `packages/backend/src/scraper/adapters/demo-adapter.ts` — 完整适配器模板；`scraper-config.ts` 的注册 API

**Test scenarios:**
- Happy path: 给定一份 51acgs.com 详情页的本地 HTML fixture，`fetchContent(url)` 返回包含 `title`、`body`、`url` 的 `RawContent`
- Edge case: 目标页返回 404 → fetchContent 抛出含状态码的 Error，外层 scheduler retry 可捕获
- Edge case: DOM 结构变化，选择器无命中 → `body` 为空字符串，fact-extractor 会返回低置信度，进入待审池标记「低置信度」

**Verification:**
- 单测通过（fixture 离线）
- 手动触发 `POST /api/v1/scraper/trigger` 后，`GET /api/v1/pending-topics` 出现新选题
- Fastify 启动日志显示 `51acgs` 适配器已注册 + cron 已调度

---

- [x] **Unit 5: Scheduler 指数退避重试**

**Goal:** 抓取任务失败时自动重试（指数退避，最多 3 次），失败信息写入日志，满足 R5。

**Requirements:** R5（失败重试）

**Dependencies:** 无（独立改 scheduler.ts）

**Files:**
- Modify: `packages/backend/src/scraper/scheduler.ts` — 在 `runScrapeJob()` 内加 retry wrapper
- Test: `packages/backend/src/scraper/scheduler.test.ts`（如存在）或 `packages/backend/src/scraper/retry.test.ts`

**Approach:**
- 提取 `withRetry(fn, maxAttempts, baseDelayMs)` 纯函数（放 `scheduler.ts` 或独立 `packages/backend/src/scraper/retry.ts`）
- 退避公式：`delay = baseDelayMs * 2^(attempt-1) + jitter`，`baseDelayMs = 1000`（1s, 2s, 4s）
- jitter：`Math.random() * 200ms`，避免并发重试叠加（thundering herd）
- 每次失败 attempt 打 warn 级别日志含 `{ siteId, attempt, error: err.message }`
- 最终失败打 error 日志含 `{ siteId, totalAttempts, error }`
- 不影响其他站点的调度（单站失败不 throw 到外层 cron handler）

**Patterns to follow:** `packages/backend/src/scraper/scheduler.ts` 现有 `SchedulerDeps` 注入风格；`packages/backend/src/llm.ts` 的错误处理风格

**Test scenarios:**
- Happy path: fn 第一次成功 → 调用一次，无 delay
- Happy path: fn 前两次抛出、第三次成功 → 调用三次，最终 resolved
- Error path: fn 三次都抛出 → 最终 rejected，打 error 日志，不向外传播（scheduler catch 处理）
- Edge case: jitter 不为负（随机值始终 ≥ 0）
- Integration: scheduler 中单个站点连续失败 → 其他站点的 cron 任务不受影响

**Verification:**
- `vitest run` 通过（mock 计时器验证 delay 调用次数）
- Fastify 日志中可见 retry warn 条目

---

- [x] **Unit 6: fact-extractor json_schema → json_object 降级**

**Goal:** 当 LLM 代理不支持 `json_schema strict`（返回 400）时，自动降级到 `json_object` 模式重试，提高提取成功率，满足 R7。

**Requirements:** R7（复用 llm.ts 代理模式，含 fallback）

**Dependencies:** 无（独立改 fact-extractor.ts）

**Files:**
- Modify: `packages/backend/src/scraper/fact-extractor.ts` — 在 LLM 调用处加 400-catch + json_object 重试
- Test: `packages/backend/src/scraper/fact-extractor.test.ts`（已有或新建）

**Approach:**
- 参考 `packages/backend/src/llm.ts` 中 draft generation 的降级模式（`response_format: { type: 'json_schema', ... }` → catch 400 → `response_format: { type: 'json_object' }`）
- `json_object` 模式下，system prompt 需明确要求输出合法 JSON 且字段名与 FactsBlock 一致（在 prompt 里加 JSON 格式示例）
- `json_object` 回来后仍需 JSON.parse + 映射到 FactsBlock + 置信度计算
- 降级时在日志打 info 级别条目 `{ endpoint, mode: 'json_object_fallback' }`

**Patterns to follow:** `packages/backend/src/llm.ts` 的 `json_schema → json_object` 降级代码（已有，参照实现）

**Test scenarios:**
- Happy path: LLM 返回合法 json_schema 结果 → 正常解析 FactsBlock
- Happy path: LLM 首次返回 400（strict 不支持）→ 自动重试 json_object 模式 → 解析成功
- Error path: json_object 模式也失败（LLM 返回 500）→ extractFacts 抛出，scheduler retry 接管
- Edge case: json_object 模式返回 JSON 但字段全为空 → 置信度 = 0，进入待审池标记低置信度

**Verification:**
- `vitest run` 通过（mock fetch 返回 400 后切换到 json_object 的场景）
- 与不支持 strict 的 LLM 代理测试时，不再直接抛出 400 错误

---

## System-Wide Impact

- **Interaction graph:** `pending-store.ts` 改为 SQLite 后，`pending-routes.ts`、`scheduler.ts`、`scraper-routes.ts` 都调用了 pending-store 的函数——函数签名不变，但需整体回归所有涉及待审池的路由
- **Error propagation:** Unit 5 retry wrapper 捕获单站失败，防止 throw 到 node-cron 层造成任务中止；Unit 6 fallback 防止 400 冒泡到 scheduler 导致选题丢失
- **State lifecycle risks:** SQLite 文件首次创建（`initPendingDb()`）若在测试环境随意创建会留下 DB 文件——测试应使用 in-memory DB（`:memory:`）或在 afterEach 删除 DB 文件
- **API surface parity:** `listPendingTopics` 新增 filter 参数是**可选扩展**，不破坏现有调用；`pending-routes.ts` 可逐步接入新参数支持翻页
- **Integration coverage:** Unit 4 的 51acgs 适配器 → fact-extractor → pending-store 的全链路需要在本地运行 backend 时手动验证一次（端对端路径）
- **Unchanged invariants:** `batch-orchestrator`、`publish-orchestrator`、`post-assembler` 完全不变；扩展端 `PendingTopicsView` 和 `pending-client.ts` 不变；路由签名 `/api/v1/pending-topics` 不变

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| 51acgs.com DOM 结构未知，可能频繁变动 | 适配器只依赖稳定的内容区域选择器，避免依赖导航 DOM；fact-extractor 低置信度作为降级安全阀 |
| `better-sqlite3` native module 在 pnpm workspace 下 node_modules 解析问题 | 安装时指定 `--build-from-source`（如需）；或使用 `pnpm add better-sqlite3 --filter backend` 确保作用域正确 |
| SQLite DB 文件在测试中产生副作用 | 所有 pending-store 单测使用 `:memory:` DB；`.gitignore` 确认 `data/pending.db` 已排除 |
| batch-orchestrator 端对端集成未验证（来自 requirements 文档警告） | Unit 4 完成后先手动跑一次「抓取→审核→批准→batch」全链路，再放 cron 自动运行 |
| tag 子串兜底匹配误选率 | 小写比对降低假阳性；"成人" 等高歧义词会因为精确匹配失败 + 子串匹配多命中而跳过（用首个命中规则控制），实现后用真实草稿抽查 |

## Documentation / Operational Notes

- `pending.db` 文件需加入 `.gitignore`（确认 `data/` 是否已在 ignore 规则中）
- 51acgs.com 适配器上线前建议先在 staging 环境（或关闭 enabled 状态）下手动触发测试，避免产生大量低质量待审记录
- `BACKEND_BASE` hardcoded 为 `127.0.0.1:3001`，部署到非本机时需改环境变量（超出本计划范围）

## Sources & References

- **Origin document:** [docs/brainstorms/2026-06-08-auto-scraping-content-pipeline-requirements.md](../brainstorms/2026-06-08-auto-scraping-content-pipeline-requirements.md)
- **Gap list (G3/G4):** [docs/brainstorms/2026-06-05-release-readiness-gap-list-requirements.md](../brainstorms/2026-06-05-release-readiness-gap-list-requirements.md)
- **Structured generation plan (fact-extractor fallback 设计参考):** [docs/plans/2026-06-05-003-feat-structured-generation-anti-hallucination-plan.md](2026-06-05-003-feat-structured-generation-anti-hallucination-plan.md)
- **scraper 子系统代码：** `packages/backend/src/scraper/`
- **G3/G4 相关代码：** `packages/extension/lib/field-mapping.ts`、`packages/extension/lib/fillers.ts:31-82`
