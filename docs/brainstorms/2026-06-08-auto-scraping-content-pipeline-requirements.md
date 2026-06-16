---
date: 2026-06-08
topic: auto-scraping-content-pipeline
---

# Auto-Scraping Content Pipeline

## Summary

在 backend 上增加定时爬取管线，将外部来源内容自动提取为结构化事实（FactsBlock）并存入待审池，扩展侧通过批量审核 UI 审核/编辑后进入现有生成→填充→发布流程。目标：将一条帖从 1 小时人工缩减为几分钟审核。

---

## Problem Frame

当前发一条帖的流程完全手动：运营者找资源站获取作品信息（名称、集数、制作、连结等），整理成事实，输入扩展，AI 生成草稿，审核，填充，发布。运营者反馈「一个帖整个流程要花我一小时」。

其中找事实和整理素材约占 40–50 分钟，瓶颈在「采集→结构化」这一段。产品已有程序化生成管道（post-assembler）、批量编排（batch-orchestrator）、安全门控（publish-orchestrator），但事实的输入仍然完全依赖人工整理。

自动化的核心价值是砍掉这 40–50 分钟的采集整理时间，保留已有的人工审核闸门（质量不降级）。

---

## Actors

- A1. **运营者（Operator）**：在扩展侧批量审核待审选题，编辑事实，批准或驳回。最终发布动作仍由人工确认。
- A2. **抓取调度器（Scraper Scheduler）**：后端定时任务，按配置的 cron 表达式触发站点适配器执行抓取。
- A3. **站点适配器（Site Adapter）**：每个目标站点一个，实现统一接口。负责从特定站点结构提取原始内容（标题、正文、元数据、链接等）。
- A4. **事实提取器（Fact Extractor）**：LLM 驱动，将适配器产出的原始内容映射到 FactsBlock 结构化字段。复用现有 llm.ts 的 OpenAI 兼容调用模式。
- A5. **现有生成管线（Post Generator）**：已有 post-assembler + batch-orchestrator，待审选题批准后进入此管道。

---

## Key Flows

- F1. **定时抓取 → 入待审池**
  - **Trigger:** cron 定时器到期
  - **Actors:** A2, A3, A4
  - **Steps:**
    1. Scheduler 读取已启用的站点适配器列表
    2. 遍历每个适配器，调用 `fetch()` 获取原始页面内容
    3. 适配器解析页面结构、提取原始字段（标题、正文片段、元数据、链接等）
    4. 原始内容传给 Fact Extractor，调用 LLM 提取事实 → FactsBlock
    5. Fact Extractor 返回置信度分数
    6. 达到置信度阈值 → 存入待审池；未达到 → 标记需人工介入（raw content 保留可查）
  - **Outcome:** 新选题出现在扩展的待审列表中
  - **Covered by:** R1, R2, R3, R6, R7, R8, R9

- F2. **批量审核 → 发布**
  - **Trigger:** 运营者打开扩展的待审视图
  - **Actors:** A1, A5
  - **Steps:**
    1. 扩展从 backend 拉取待审选题列表
    2. 每条显示：来源 URL、提取结果、置信度、原文摘要
    3. 运营者多选，可展开单条编辑事实字段
    4. 运营者点「批准」→ 选题进入 batch-orchestrator
    5. 走现有生成→填充→审核→发布流程（dry-run 或 authorized）
  - **Outcome:** 批准选题完成发布或进入发布队列
  - **Covered by:** R10, R11, R12, R13, R14, R15

- F3. **新增站点适配器**
  - **Trigger:** 开发者需要接入新内容来源
  - **Actors:** 开发者
  - **Steps:**
    1. 创建适配器文件，实现统一接口（`fetchContent(url): RawContent`）
    2. 在 `scraper-config.ts` 中注册站点信息（url、cron、启用状态）
    3. 本地测试适配器 + 提取效果
    4. 重启后端服务（或适配器热加载生效）
  - **Outcome:** 新站点在下一次抓取周期自动生效
  - **Covered by:** R2, R17

---

## Requirements

**抓取基础设施**

- R1. Backend 支持以可配置 cron 表达式执行定时抓取任务，无需手动触发。
- R2. 每个目标站点对应一个独立的适配器模块，适配器实现统一接口（`SiteAdapter`），包含 `fetchContent(url): RawContent` 和可选的 `parseMetadata()`。
- R3. 抓取后的原始页面内容（raw HTML/JSON）持久化保留，供调试、审查和事实提取重试使用。
- R4. 抓取器遵守来源站的 `robots.txt`，支持配置 per-adapter 的请求频率和并发上限。
- R5. 抓取失败自动重试（指数退避，最多 3 次），失败信息写入日志和可观测性指标。

**事实提取**

- R6. 提取结果必须映射到现有 `FactsBlock` 结构（作品名/集数/制作/漢化/無修/题材/简介），无映射的字段留空。
- R7. 事实提取复用现有 `llm.ts` 的 LLM 代理模式（JSON structured output + fallback 机制），不引入额外 LLM 依赖。
- R8. 每次提取附带置信度分数（0–1），低于配置阈值（默认 0.6）的选题进入待审池时标记为「低置信度，需人工介入」，原始内容一并保留。

**待审选题池**

- R9. Backend 存储已提取的选题为「pending」状态，支持标记为 approved / rejected / pending。
- R10. 扩展侧提供待审视图组件，通过 backend API 拉取待审选题列表，支持翻页/搜索/按站点筛选。
- R11. 每条待审选题展示：来源 URL、提取结果（FactsBlock）、置信度分数、原始内容摘要、状态、抓取时间。

**批量审核与发布**

- R12. 待审视图支持多选：勾选多条后一键批准/驳回。
- R13. 运营者可以展开单条记录，直接编辑 FactsBlock 字段值，编辑后覆盖提取结果。
- R14. 批准的选题进入现有 batch-orchestrator 管道的 `runBatch()`，走已有的生成→填充→审核→发布流程（`approveBatch`），不新建发布路径。
- R15. 驳回的选题进入 rejected 状态（保留记录），运营者可填写驳回原因（可选）。

**运维与可观测性**

- R16. 每次抓取任务的执行结果（成功数/失败数/耗时/提取置信度分布）写入结构化日志，可在 backend 日志中查询。
- R17. 新增或修改适配器不需要修改抓取调度器核心代码——适配器注册为配置项（JSON / env），非侵入式热加载（至少支持服务重启生效）。
- R18. 运营者可以手动触发单站立即抓取（跳过下次 cron 等待），用于应急上线或补充。

---

## Acceptance Examples

- AE1. **Covers R1, R9, R10.** 给定一个已配置站点适配器和 cron 表达式 `0 */2 * * *`，等待定时触发后，扩展的待审视图中出现新的选题条目。
- AE2. **Covers R6, R8, R11.** 给定一个内容结构不完整的来源页，提取置信度 = 0.35，该选题出现在待审池中并显示黄色置信度警告，下方附带原始 HTML 摘要。
- AE3. **Covers R12, R13, R14.** 给定待审池中 5 条选题，运营者勾选其中 3 条，展开第 2 条手动修正 FactsBlock 的「作品名」字段，点「批准」，3 条进入 batch-orchestrator 开始生成。
- AE4. **Covers R2, R17.** 给定一个新的来源站 type=forum，开发者创建 `adapters/forum-adapter.ts` 实现 `SiteAdapter`，在配置中添加记录后重启服务，下次抓取周期该适配器被执行。

---

## Success Criteria

- 时间压缩：一条帖从采集事实到进入待审池的平均耗时从 40–50 分钟（人工）降到 <1 分钟（自动）。
- 提取质量：≥80% 的自动提取选题无需人工编辑事实字段即可直接批准。衡量方式：批准事件中 `facts_edited: false` 的比例。
- 适配器可扩展：新站点从开发到上线 ≤ 1 工作日（含事实提取调优）。

---

## Scope Boundaries

- **不接入**第三方发布平台（仅限自家站点），已有 publish-orchestrator 不变。
- **不做**全自动无审核发布——始终保留人工审核闸门（方案 A 终态推迟）。
- **不做**通用 web agent（任意网站、任意任务的爬取框架）。
- **不做**浏览器反检测工程（Cloudflare bypass / 指纹伪装等——如目标站点需要，作为独立项目评估）。
- **不做**社交平台 feed 接入（Twitter/RSS/社区动态流等——后续可增加适配器类型）。
- **不做**backend 部署自动化，搭建独立部署方案已在 [release-readiness-gap-list 计划](2026-06-05-release-readiness-gap-list-requirements.md) 中。
- **不做**非 LLM 的纯规则提取方案（不适合目标站点的结构化多样性），LLM 提取的 token 成本纳入规划考量。
- **适配器非热加载：** 新增适配器需要重启 backend（如有热加载需求作为后续优化）。

---

## Key Decisions

- **抓取跑在 backend 而非 extension：** 扩展受 MV3 限制（service worker 生命周期不可控、无法运行 Playwright/cheerio），backend 可安装完整爬取工具栈，适合定时任务。
- **SiteAdapter 插件模式而非通用爬虫：** 每个目标站点一个适配器，初始投入是单站级而非全站级，单站失效不波及全局。
- **LLM 提取而非规则解析：** 目标站点结构各异、频繁改版，写正则/XPath 维护成本高。用 LLM 提取泛化性更好，提取置信度作为安全阀。
- **待审池存 backend 而非 extension storage：** 扩展的 chrome.storage 不适合持久化大量待审记录，且 backend 需要写权限（状态变更）。扩展通过 API 只读拉取。

---

## Dependencies / Assumptions

- Backend 需持续运行（或至少有定时触发环境，如 cron / systemd timer）。
- Backend 已部署并可从扩展网络访问（当前 backend 为 localhost:3001——假设后续部署方案会解决此问题）。
- LLM proxy（OpenAI 兼容 endpoint）已有足够配额支撑定时提取的额外 token 消耗。
- 现有 batch-orchestrator 在真实内容上已验证可执行一条完整发帖流程——此假设**尚未验证**，建议推进前先用真实题材跑通一次端到端，暴露潜在集成问题。
- 目标来源站的可爬性未验证——无 Cloudflare/登录墙/captcha 等反爬措施。一旦目标站确定，需先手动验证。

---

## Outstanding Questions

### Resolve Before Planning

- **目标站点是哪些？** 规划前需要确定首批接入的 1–2 个来源站，否则适配器接口设计无法锚定。
- **待审池存储选型：** Backend 目前无数据库依赖。待审池用 SQLite（零运维）vs 文件系统 + JSON 序列化 vs 后续加 SQLite 依赖——需规划时根据站级规模决定。

### Deferred to Planning

- [Needs research] **提取用 LLM 模型的 token 成本估算：** 单条提取约消耗多少 token，按每日抓取量推算月成本。
- [Technical] **适配器接口的 RawContent 类型定义：** 需涵盖 text/html、JSON API、列表页 vs 详情页等场景，在适配器中做归一化还是提取器做归一化。
- [Technical] **Backend 定时任务库选择：** `node-cron`（零依赖）vs `bull`（持久化队列），取决于是否需要分布式/断线恢复。
