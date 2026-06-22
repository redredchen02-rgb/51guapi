---
date: 2026-06-22
topic: project-maturity-and-multisite-reuse
---

# 项目成熟化 + 多站点可配置复用（A + B1）

> 来源：2026-06-22 一次 12 子系统并行代码勘察（13 agents，78 条代码核实发现，~15 条最高影响项已逐一回核源码）。完整审计原文见会话工作流 `guapi-maturity-audit`。

## Problem Frame

51guapi（吃瓜小帮手）地基扎实——SSRF 把 IP 钉死防 DNS 重绑、密钥 fail-closed、防幻觉架构、应用层测试量大——但项目正卡在「从『发布器』改成『吃瓜助手』拆到一半」的状态：死代码、废 schema、空心可观测、以及**主文档还在教已删除的发帖功能、README 谎称有不存在的 XSS 消毒器**，后两者直接打脸项目招牌的「绝不写回」安全承诺。同时它被焊死成单租户单题材：种子域名写进会 `DELETE` channels 表的迁移、爬取规则是全局常量、换个站点结构就静默抓空只能改源码。

成熟度评分（1=差 5=优）：安全 4、正确性 3、可维护 3、测试 3、构建/CI 3、**可复用 2、产品化 2、文档 2、可观测 2**。

操作者（单人自用）要的是两件事：**(A) 把现在这个自用工具做成熟、可信、干净**；**(B1) 不改源码就能接入更多「吃瓜同类」站点**。本文档锁定这两件事的需求与边界。

## Scope Tiers（本轮做什么 / 不做什么）

```
┌─ 本轮范围 ───────────────────────────────────────────────┐
│  A  地基（必做，先行，工作量见拆分）                       │
│     · 安全诚实与补洞   · 改版瓦砾清理   · 核心流程修 bug   │
│     · 可观测说真话     · 版本/构建/测试可复现  · 文档诚实  │
│                                                          │
│  B1 多站点同类可配置（A 之后，风险中，集中在后端爬取层）   │
│     · 爬取规则(详情页/正文容器/翻页) → 每渠道可配置        │
│     · 种子域名移出破坏性迁移 → env 运行时种子(默认空)     │
└──────────────────────────────────────────────────────────┘
┌─ 明确不做（本轮非目标）─────────────────────────────────┐
│  B2  shared 词表/事实键解耦成可注入 PRESET（多题材）→ 延后│
│  C   非开发者分发：扩展上架/.crx、后端 Docker 成品 → 延后 │
│  D   把 @51guapi/shared 发布成独立 npm 公共库 → 延后      │
│  ✗  任何放松 SSRF 锚点 / 「绝不写回」硬约束的改动         │
└──────────────────────────────────────────────────────────┘
```

## Requirements

ID 按主题分组；每条引用代表性文件，便于 planning 定位。删除类需求一律**行为保持**：安全核心（SSRF / 密钥 fail-closed / 防幻觉）是不变量，清理不得改其行为。

### A. 安全诚实与补洞（Phase A）
- **R1.** 删除 README 中不存在的「白名单 XSS 消毒器」声明与 `post-assembler.ts` 里悬空的 `sanitizeBody(DOMPurify)` 注释，如实写明现状（`draft.body` 在 textarea 以纯文本展示、无 HTML 渲染）。**约束前置**：未来若新增正文 HTML 预览渲染，必须同步引入白名单消毒层，否则即引入存储型 XSS。（`README.md`、`packages/shared/src/post-assembler.ts`、`DraftPreview.tsx`）
- **R2.** 让 `/drafts/rewrite` 路径与 `generateDraft` 一样强制执行防幻觉的 grounding / 链接校验——任何模型写出的正文路径都不得放过未经校验的事实/链接。**验收**：rewrite 输出 body 必须通过与 `generateDraft` 相同的 `hasUnsourcedLink(verifyLinks(body, gossipFactUrls(facts)))` 闸，并补一条回归测试（喂入含未注源 `<a href>` 的 rewrite 应被拒）。（`packages/backend/src/services/draft-rewrite.ts`、`draft-gen.ts`）
- **R3.** 让「每跳 allowlistCheck」对所有已注册 adapter 不可绕过：**具体改法**——demo / template（copy-me 脚手架，先修它）改成 `safeFetch(url, { allowlistCheck })`，让每个复制出来的新 adapter 天生继承每跳 allowlist 复检；并把路由层 host 校验也覆盖 `config.url` 与列表发现选中的 URL，而非只校验调用方传入的 url。补测试：断言已注册 demo adapter 对非 allowlist host 及非 allowlist 重定向目标均被拒。（`adapters/demo-adapter.ts`、`adapters/template-adapter.ts`、`scraper/ssrf-guard.ts`、`routes/scraper-routes.ts`）
- **R4.** 给免密登录加非环回（non-loopback）守卫，**与现有 CORS/JWT_SECRET 同款 fail-closed**：当 `HOST` 解析为非环回地址且无显式 env opt-in（如 `ALLOW_NONLOOPBACK_AUTH=true`）时，服务**启动即拒绝**（而非仅告警或仅在请求时拒发 token），同时关掉启动期与请求期两条路径；默认安全。（`routes/auth-routes.ts`、`config/env-check.ts`、`index.ts`）

### B. 改版瓦砾清理（Phase A，行为保持）
- **R5.** 删除 JSON→SQLite 统一后遗留的死存储代码：`JsonFileStore`、`config-store`、以及先建后删的过时迁移。（`utils/json-store.ts`、`services/config-store.ts`、`migrations/runner.ts`）
- **R6.** 处理 ACG/pixiv 富化子栈（`web-enricher`/`web-search`/`enrichment-cache`）——它硬编码 pixiv 字段、对吃瓜事实键 no-op 且默认开启。**注意（审稿更正）**：它并非纯死代码——`EnrichedContext` 被 `pending-store` 引用并以 SQLite `enrichment` 列持久化，且 live 的 `scraper-routes` 仍调 `enrichContext`。因此「移除」是一次需 schema 迁移（drop/null `enrichment` 列）+ 改 live 路由的协同改动，**不是行为保持式删除**；「默认禁用但保留挂钩」与「grep 返回空」二者不可兼得。决策见 Key Decisions（默认倾向彻底删除）。（`scraper/web-search.ts`、`web-enricher.ts`、`enrichment-cache.ts`、`pending-store.ts`、`routes/scraper-routes.ts`）
- **R7.** 清理扩展端死代码/死 UI：只写不读的 `backendToken` 字段、SW 端已死的 API-key 管线及其失真注释、与 `components/` 重复的死 `settings/` 目录、`ExtensionCounters`/`batchesCompleted`、与「绝不注入」硬约束冲突且不可用的「填入当前页」快捷键、残留的 batch 标签。（`lib/storage.ts`、`entrypoints/background.ts`、`sidepanel/settings/*`、`KeyboardShortcutsHelp.tsx`）
- **R8.** 把未使用的 ACG facts 模块/键移出 shared 公开导出（或彻底从 live 吃瓜路径切断）。**注意（审稿更正）**：原稿所称「`Draft` 上两个同名 `category` 字段（数字码 vs 字符串）语义碰撞」经核对**不存在**——`ContentDraft.category` 是单一字符串字段，全仓 grep `category: number`/`categoryCode`/`categoryId` 无果（ACG 数字码已在早前清理中移除）。本条只保留「移除未使用 ACG facts 键」这一真实项。（`shared/src/facts.ts`、`index.ts`、`types.ts`）
- **R9.** 改写或删除描述已删发布器产品的过时文档：`install-and-usage.md`、`ops-runbook.md`、引用已删 `hash-password.mjs` 的 `release-checklist.md` 与 `first-flight-runbook.md`；preflight 的 `RED_RESIDUALS` 同步成 export-only 现实。（`docs/install-and-usage.md`、`docs/ops-runbook.md`、`scripts/preflight/checks/index.ts`）

### C. 核心流程正确性（Phase A）
- **R10.** 修核心流程用户可见 bug：进度条卡 10%（stale closure）、SW 30s 超时短于请求 60s 超时（导致 UI 报重试而请求仍在跑、可能重复扣 LLM 费）、`FewShotPairEditor` 用可变文本当 React key 的碰撞、快捷键帮助弹窗 Esc 失效、`normalizeUrl` 的 query 顺序/fragment 敏感导致 grounding gate 误判来源链接为「非来源」。（`App.tsx`、`lib/messaging.ts`、`lib/llm.ts`、`FewShotPairEditor.tsx`、`shared/src/link-source.ts`）
- **R11.** 给 from-url 摄取端点加**显式类型判别字段**（discriminant）与响应 schema。**注意（审稿更正）**：三种结局当前已可由 `topic`/`skipped`/`rejected` 字段是否存在来区分，并非全部 `ok:true` 无从区分；真实缺口是缺一个显式 discriminant + 可生成客户端的响应 schema，而非重建区分逻辑。（`routes/gossip-routes.ts`）

### D. 可观测说真话（Phase A）
- **R12.** 让对外宣称的 health 反映现实。**注意（审稿更正）**：`/metrics` 的 Prometheus counters（`recordDraft`/`recordScraperRun`/`recordGossipVerify`）**已从生产路径递增**（app.ts/scheduler.ts/scraper-routes.ts/gossip-routes.ts 共约 16 处），`publisher_` 前缀在源码中**已改成 `guapi_`**（仅 metrics.test.ts 残留旧名负断言）——**勿重复接线**（scheduler 与 routes 已都调 `recordScraperRun`，再加会双计）。真正未接的只有 `recordQuality`（`/healthz` 质量面板读侧已接、写侧零调用）——这是唯一「接真」目标（**已决：本轮接真**，把 `recordQuality` 接进生产路径，使 `/healthz` 质量面板真实反映）。（`services/quality-metrics.ts`、`app.ts`）
- **R13.** 把已写好且有测试、却接在「无处」的 preflight 自检接进 CI / `check-all.sh` / `ship.sh`，使其真正成为闸门。（`package.json`、`.github/workflows/ci.yml`、`scripts/check-all.sh`）
- **R14.**（已决：本轮接真）把扩展端 error-log + operation-history 从「仅内存」改为持久化到 `chrome.storage`，使日志面板真实可用。（`hooks/useErrorLogger.ts`、`hooks/useOperationHistory.ts`）

### E. 版本 / 构建 / 测试可复现（Phase A）
- **R15.** 采用合法 3 段 SemVer，并同步 root + 三个包 + 构建出的 manifest + git tag（复用既有 version-sync 工具）；消除 `0.2.2.1` 与包内 `0.2.2` 的错位。（`VERSION`、`package.json`、`packages/*/package.json`）
- **R16.** 给 `packages/shared` 加 `test` 脚本 + 最小 vitest config，并为其安全关键纯核心（`post-assembler`、`gossip-verify`、`link-source`、`export`）补 co-located 测试，使 `pnpm -r test` 不再静默跳过 1616 行。**注意（审稿更正）**：误放在 `extension/lib/` 下、实际 import 自 `@51guapi/shared` 的测试不止 2 个——约 10/20 个（export、link-source、post-assembler、facts、llm、channel-client、gossip-client、pending-client.actions、prompt-client、background-handlers）；归位/统计范围按此评估。（`packages/shared/package.json`、`packages/shared/src/*`）
- **R17.** 修构建可复现性：CI `setup-node` 改读 `.nvmrc`（Node 20，而非现行 22）；root 加 `engines`/`packageManager`；统一已分叉的产物校验逻辑（`ci.yml` 查文件 vs `check-all.sh` 查目录）。（`.github/workflows/ci.yml`、`scripts/check-all.sh`、`.nvmrc`）
- **R18.**（已决：本轮做）启用覆盖率阈值（coverage-v8 已装）——至少给 shared + scraper 设地板。（`packages/*/vitest.config.ts`、`.github/workflows/ci.yml`）
- **R19.** 清理 config 漂移：`.env.example` 重复的 `ENRICHMENT_MAX_QUERIES` 行、留空 `JWT_SECRET`（现行弱占位值必触发 fail-closed 首启失败）、`CORS_ORIGIN` 鸡生蛋问题（setup 默认填入钉死的扩展 ID 消除二次配置）、`.gitignore` 无锚点裸名项、renovate `config:base`→`config:recommended`。（`packages/backend/.env.example`、`scripts/setup.mjs`、`.gitignore`、`renovate.json`）
- **R20.** 给 `packages/shared` 补一份 README，说明这个内核包的用途与导出。（`packages/shared/`）

### F. B1 — 多站点同类可配置（Phase A 之后）
- **R21.** 给 `Channel` 记录加可选的「每渠道爬取覆盖」：详情页 URL 模式、正文容器选择器、翻页方案，**缺省回退到今天的全局默认**——使一个 HTML 结构不同的同类新站点，能在 UI/API 加配置接入而无需改源码。**注意（审稿更正，风险中非低）**：要覆盖的全局默认是模块级常量与**不接收 channel 参数**的纯函数——`DETAIL_PATH_RE`、`CONTENT_CONTAINER_KEYWORDS`、`extractBody(html)`、`detectNextPageUrl(html, base)`；贯通需跨 `generic-adapter`+`html-extractors`+`list-pagination` 改函数签名（把 channel 覆盖项传进去）+ channels 表 schema 迁移存选择器，回退到现有常量。非「加一层就好」的纯叠加。（`scraper/adapters/generic-adapter.ts`、`html-extractors.ts`、`list-pagination.ts`、`channel-store.ts`）
- **R22.** 把种子爬取域名（`51cg1.com`）从迁移里挪走，改为 env 门控的运行时种子、默认空（保留 fail-closed SSRF）；运行时种子须**幂等且只增**（`INSERT ... ON CONFLICT DO NOTHING`，绝不 `DELETE`）。**注意（审稿更正，关键）**：那条 `DELETE FROM channels` 在迁移 014，`_migrations` 账本**按名只进**、014 在操作者库上**早已应用**——直接改 014 的 SQL 既不会对操作者重跑、又会**悄悄改变全新 clone 的行为**，故**禁止原地编辑 014**；修复须是一条**新的前向迁移**（如 016）。已被删除的渠道无法靠本次改动恢复（见 Resolve Before Planning）。补测试：在 pre-014 与已迁移两种库上跑全套迁移，断言 N 个操作者渠道全数存活。（`migrations/runner.ts`）
- **R23.** 在侧边栏渠道管理 UI 暴露 R21 的每渠道配置（增/改覆盖项），同时保留新渠道的人工确认手势（防 prompt 注入自开渠道的不变量）不变。**安全约束**：每渠道覆盖项必须被约束在该渠道已 allowlist 的 hostname + path_prefix 内——详情页模式与翻页方案不得解析到此外的 host/path，每个派生 URL 仍过每跳 `allowlistCheck` 与 `enforcePathPrefix`（防 SSRF 放大）；并明确「编辑既有渠道的覆盖项」是否也需同款人工确认手势。UI 交互/IA 细节见 Deferred to Planning。（`sidepanel/` 渠道管理组件、`channel-store.ts`）
- **R24.** 把重复的 `MECHANICAL_FACT_KEYS` / 核心事实键清单收敛到单一来源（shared）供提取器与 store 共用——这是支撑复用的小幅去硬编码，**不触碰词表解耦（仍属 B1，非 B2）**。（`gossip-fact-extractor.ts`、`pending-store.ts`、`shared/src`）

> 其余审计中的低优先项（god-component `PendingTopicsView` 拆分、export 格式补齐、三处 URL 提取重复、backoff 无墙钟预算、CI 重复构建等）**不纳入本轮**，除非 planning 判定它们阻塞 A/B1。

## Success Criteria

- **干净可复现**：全新 clone → `pnpm install && pnpm -r test` 会真正跑到 shared 测试（不再静默跳过）且全绿；`pnpm -r compile` 绿；`bash scripts/check-all.sh` 绿；preflight 在 CI/闸门中实际运行。
- **版本自洽**：版本是合法 SemVer，且 root == 三包 == 构建 manifest == git tag 一致。
- **文档诚实**：没有任何文档描述已删的发布器产品；README 的安全声明与代码一致（无虚假 XSS 消毒声明）；release 文档不再引用已删脚本。
- **瓦砾清零**：grep 已删死模块（`JsonFileStore`、`config-store`、`batchesCompleted`、死 `settings/` 目录）返回空（连同清理残留**注释引用**，如 `gossip-site-store`/`prompt-store` 里提及 JsonFileStore 的注释）。**注意**：pixiv 富化（R6）涉 SQLite `enrichment` 列与 live `scraper-routes`，非纯 grep 可删，其「清零」以 R6 的协同迁移为准。
- **硬约束全程成立**：no-publish、SSRF fail-closed、防幻觉在**所有**模型写出路径（含 rewrite）仍成立；rewrite 现已执行 grounding。并补一组**特征化测试**（characterization test）锁住安全核心：每跳 `allowlistCheck` 拒非 allowlist 重定向、`enforcePathPrefix` 拒同 host 越权路径、rewrite 拒未注源链接——这组测试在每次删除/迁移**前后都必须通过**，使「行为保持」可证伪而非口头断言。
- **B1 可复用验证**：用**操作者已选定的那个真实第二站**（detail-path / 正文容器 / 翻页方案不同于全局默认），仅通过 UI/API 加每渠道配置即成功发现列表并抓到正文，无需改源码；且该路径的每跳 allowlist 复检仍生效。
- **日常回路可用**（操作者体感，非仅仓库洁净）：一次代表性的「URL→爬取→提炼→预览→导出」跑通——进度条到 100%、无假重试/重复扣费、grounding 接受合法来源链接——证明日用回路可靠，而不只是代码变干净。
- **数据不丢**：迁移变更后，操作者既有渠道/待审数据（`packages/backend/data`）完好。

## Key Decisions

- **A 是 B1 的前置**：先把地基（清债/诚实/修 bug/可复现）做完，再做 B1。B1 主要改动在后端爬取层（R21 需改 `generic-adapter`/`html-extractors`/`list-pagination` 函数签名 + channels schema 迁移，**风险中**），R23 另涉扩展端渠道 UI；均**不动 shared 词表**（B2 仍延后）。
- **B1 = 带回退的每渠道配置**：所有新配置项缺省回退到当前全局默认，确保零行为变化地引入可配置性。
- **富化子栈非纯死代码**：R6 的富化有 live 引用（pending_store 的 `enrichment` 列 + scraper-routes），「彻底删除」须配 schema 迁移与改路由，「默认禁用挂钩」则与「grep 清零」互斥——二选一留待 planning（默认倾向彻底删除以缩小审计面与第三方出口）。
- **可观测本轮接真**：R12 真正未接的仅 `recordQuality`（counters 与 `guapi_` 前缀已就绪，勿重复接线）；**已决接真**——接 `recordQuality`（R12）+ 扩展日志持久化（R14）+ 启用覆盖率门（R18）。
- **删除即不变量保持**：大量删除/迁移改动必须保持安全核心（SSRF / 密钥 / 防幻觉）行为；这些是不变量，不是被清理对象。**且须由特征化测试证伪**（见 Success Criteria），不靠口头断言。
- **A 的工作量长尾**：A 含约 20 条需求，**非均匀「数天」**；R6（schema 耦合）、R16（为 1616 行安全核心补新测试）、R22（新前向迁移 + 双库测试）是长杆，planning 应按簇（安全 R1-R4 / 瓦砾 R5-R9 / 正确性 R10-R11 / 可观测 R12-R14 / 构建测试 R15-R20）拆工作量，勿用单一时间盒挤掉安全关键删除的验证。

## Dependencies / Assumptions

- 单操作者、自用、后端跑在本机环回（port 3002）；不引入多租户/多操作者鉴权。
- 既有本地数据（`packages/backend/data` 的 channels/pending）必须在清理与迁移改动中存活。
- 审计发现皆有代码出处，~15 条最高影响项已回核；部分低/中优先项未独立复核——planning 在执行删除前应对「某模块是否真无引用」做点对点 grep 复核。
- 复用既有工具链：preflight、`check-all.sh`、`ship.sh`、launchd 安装脚本均为**真实仓库资产**。**注意**：`version-sync` 是用户**全局 Claude skill，非仓库脚本**（仓库内 grep 无果）；R15 须提供仓库内的同步步骤/脚本，勿计划调用不存在的仓库工具。

## Outstanding Questions

### Resolve Before Planning
- 无剩余阻塞项——三项已在本次 brainstorm 决议（见下「本次决议」）。

### 本次决议（2026-06-22）
- **B1 保留**：操作者**已有一个具体想接入的第二个同类站点**，故 B1 成立；R21 的每渠道配置 schema 应由**那个真站的 HTML** 塑形，验收对真站跑（非合成页）。
- **R18 启用**：本轮**做**覆盖率阈值门（至少 shared + scraper 地板）。
- **R12/R14 接真**：本轮**接真**——接 `recordQuality` 进生产路径 + 扩展日志持久化到 `chrome.storage`（counters/`guapi_` 前缀已就绪，勿重复接线）。

### Deferred to Planning
- [Affects R21][User input] 操作者提供那个**真实目标站的 URL / HTML 样本**，使 R21 的 detail-path / 正文容器 / 翻页 config schema 由真站塑形。
- [Affects R6][Technical] 富化：彻底删除（含 drop `enrichment` 列迁移 + 改 scraper-routes）vs 保留禁用挂钩？默认删除。
- [Affects R22][Technical] 已被 014 删掉的渠道是否需要可恢复，还是只防未来？014 已应用、账本只进，修复须新迁移而非改 014。
- [Affects R21/R23][Technical] 每渠道配置的 schema 形状与存储/迁移；`generic-adapter` helpers 现不接收 channel 参数，贯通须改签名；覆盖项须约束在 allowlist host/path_prefix 内。
- [Affects R23][Design] 非技术操作者如何输入选择器/正则（原始文本框 vs 引导选取 vs 从当前页粘贴）；覆盖项编辑入口的 IA 放置；保存后「抓空/容器未匹配」与既有「无新素材」空态如何区分；编辑既有渠道覆盖项是否也要人工确认手势。
- [Affects R5/R7/R8][Needs research] 删除前对各「死模块」做无引用复核（含**注释引用**），避免误删仍被引用项。

## Next Steps

三个待决项已在本次 brainstorm 决议（**B1 保留、R18 做、可观测接真**）。→ `/ce:plan` 把本文档转成分阶段实施计划（A 先行；B1 用操作者选定的真站塑形 R21 config schema；每阶段补特征化测试并跑 `check-all.sh` + preflight 验证行为等价）。规划 B1 前需操作者提供那个真站的 URL/HTML 样本。
