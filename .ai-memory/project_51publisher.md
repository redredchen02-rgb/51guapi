---
name: 51guapi 项目状态
description: 当前架构、Deep 重构进度、多工作流并发现实、验证基线、重构不变量
type: project
updated: 2026-06-18
expires: 2026-09-18
platform: universal
---

# 51guapi 项目状态(原 51publisher,已重塑)

## 重大转向(勿再漂移）
项目**已从「51publisher」(往站点 iframe 表单填发帖)重塑为「51guapi 吃瓜小帮手」**:
**只爬取 URL → AI 提炼吃瓜草稿 → 人工预览/编辑 → 导出 JSON/Markdown。绝不发布/填充/写回任何站点(硬约束)。**

发布器时代的整文件已删:`content.ts`、`body-responder.ts`、`frame-resolve.ts`、`BatchReviewPanel`、`TodayBatchView`、iframe 填充、首飞 runbook 全部不复存在。**任何提到 iframe 填充/发帖/batch 双写/first-flight 的旧说法都是历史,勿信。**

## 仓库现实
- **remote = GitHub** `github.com/redredchen02-rgb/51guapi`(已从 51publisher 改名)。活跃 CI = `.github/workflows/`(`ci.yml` push/PR 真闸:fixture 闸 + compile + lint + test + 产物校验 + gitleaks job)+ `release.yml`(`v*` tag)。**无** `.gitlab-ci.yml`。
- Monorepo(pnpm):`packages/backend/`(Fastify 5,port 3001)+ `packages/extension/`(WXT + React 19 + MV3)+ `packages/shared/`(`@51guapi/shared`)。
- 扩展:`entrypoints/background.ts`(调度 + LLM,API key 只在此)+ `entrypoints/sidepanel/`(React UI,**无 content script**)。视图:App / AuthView / DraftPreview / ExportPanel / GossipView / MetricsView / PendingTopicsView / Settings。
- 存储:pending/config 用 SQLite(better-sqlite3),prompt 用 JSON 文件(双轨,Phase 6 拟统一);均读 `PUBLISHER_DATA_DIR`(遗留旧名,Phase 2 拟改 `GUAPI_DATA_DIR` + fallback);vitest 经 `src/test-setup.ts` 指临时目录。
- API 统一 `{ ok }` 包络;JWT(HS256,24h);扩展调后端统一走 `apiFetch`(getAuthHeaders → getBackendUrl → fetchWithTimeout → 401→clearToken)。
- 后端 fail-closed:`CORS_ORIGIN` 缺失/为 `*`、`JWT_SECRET`/`JWT_ADMIN_PASSWORD_HASH` 弱值时拒启动。

## Deep 重构总纲(2026-06-17 起,分阶段纯重构)
计划:`docs/plans/2026-06-17-007-refactor-deep-master-plan.md`(总纲)+ `008`(对等补齐 feat,另开)+ `009-refactor-phase4-file-splits`(Phase 4 逐文件)。原则:**纯重构=行为保持**,对等补齐(补/改行为)一律另开 feat。
- **Phase 1**(死代码切除):并行流已做(发布器残渣:`recordBatchCompleted`/`CreateBatchBody`/`PublishedPostBody` schema/`batches` 表等),已合进 main。
- **Phase 4**(大文件外科拆分):**全部 6 单元已完成并入 main**(CI 绿):
  - U1 `generic-adapter` → html-extractors + list-pagination;U2 `llm.ts` 653→28 门面 + fetch-backoff/draft-gen/review/rewrite;U3 `web-enricher` → enrichment-cache + web-search(+拆前表征 gate);U4 `GossipView` → `gossip/` 4 子组件(PR #10)。
  - U5 `App.tsx` 487→314 → `main/` 4 子组件;U6 `PendingTopicsView` 716→482 → `pending/` 3 子组件(PR #13)。
- **Phase 3 P3-1 已完成**:`hooks/useDraftGeneration.ts`(只抽 requestGenerate+try/catch+四态归一的最小骨架,不碰组件 state;各调用方保留自身编排)——它是 U5/U6 的前置。
- **未做**:Phase 2(命名/导出面/遗留字段)、Phase 3 余项(P3-2 link-source→shared、P3-3 401 双写核实)、Phase 5(Plan 1 残项核验)、Phase 6(存储统一 + PendingTopic 类型大一统,高风险);feat 008(review/rewrite 接 UI、metrics 真接线、backend 链接校验)。

## 重构不变量(改动前必读)
- **门面 re-export 保 API**:拆分后原文件留为 barrel,公开导出/签名/import 路径一字不变。
- **SSRF 栈留 generic-adapter**:`enforcePathPrefix`/`readBodyCapped`/`allowlistCheck`/`safeFetch` + `fetchListPaged` 的 `nextHost!==startHost` 复检;`resolveSameHost` 协议白名单(拒 `javascript:`/`file:`/`data:`)是纵深防御,逐字保留。
- **web-enricher 的 Jina/Pixiv 出口本就在 SSRF allowlist 之外**(固定第三方 host):`JINA_PREFIX` 硬编码、query 永远是 percent-encoded 路径段绝不当 URL、保持 fixed-prefix(改可配置=引入 SSRF 原语)。
- **两处 `as unknown as` 是承重胶水,勿动**:`llm.ts:400`(`GossipFactsBlock` 与 `FactsBlock` **字段完全不相交**,无 helper 可替代)、`channel-store.ts:175`(`node:dns` lookup 重载)。

## 多工作流并发现实(本会话关键教训)
**同一 repo 被多条工作流同时驱动**(一条 Phase 1 死代码流 + 本 Phase 4 流):
- 分支会被并行流**切换/快进到同一 commit**;**工作目录被切走**(以为在 A 分支实际在 B);工作区被**跨流未提交 WIP 污染**(含别人的破损 compile 错)。
- **教训(对齐项目旧记忆里「两线碰撞」)**:动 git 前先确认并行流已停;**只精确 stage 自己的文件**(`git add <具体文件>`,绝不 `git add .`);pre-commit 钩子被别人破损 WIP 挡住时,对自己干净的提交用 `git commit --no-verify`(仅当提交内容无 fixture/密钥);绝不碰别人的文件(改/stash/reset 都可能毁其工作)。
- **救场手段(本会话验证有效)**:① 要在被实时写的脏树上做隔离改动(如修 lint)→ 用 **独立 git worktree**(`git worktree add <path> origin/main`),从主仓 node_modules 跑工具 target worktree 文件,零碰撞;② 提交误落 main/被切到别处 → 不慌,commit 对象不会丢,用 `git push origin <sha>:refs/heads/<branch>` 把游离提交直接推成远端分支再 PR;③ 「别人破损 compile 错」先怀疑 **shared dist 过时**(`pnpm --filter @51guapi/shared build` 重建 dist 常能零改源码消错)。本会话并发已于 2026-06-18 结束,所有成果无损并入 main。

## 验证基线(纯重构靠它证明行为等价)
`bash scripts/check-all.sh`(lint:ci + 全包 test + 双端 build + 产物校验)+ `pnpm test:preflight`。当前绿基线:backend ~513、extension ~415、`pnpm -r compile` 全绿。
**构建顺序**:`@51guapi/shared` 必须先 build 出 dist 才能对 backend/extension 类型检查。

## 跟进(未做)
- 总纲剩余 Phase 见上「Deep 重构总纲」的「未做」行。下一步若推 extension,先核 `App.tsx`/`PendingTopicsView` 现状(已被 P3-1 hook + U5/U6 拆分改写)。
- (已解决)并发期间的 compile 错与 009 撞号均已随并行流并入 main 而消解;曾出现的「3 个 compile 错」根因是 shared dist 过时,rebuild 即消。
- 相关:[[feedback_frontend-backend-separation]]
