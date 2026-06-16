---
name: 51publisher 项目状态
description: 远端/CI 现状、架构决策、上线就绪进度、在途 PR、首飞待办
type: project
updated: 2026-06-15
expires: 2026-07-15
platform: universal
---

# 51publisher 项目状态

## 仓库现实（曾长期写错,勿再漂移）
- **remote = GitHub** `github.com/redredchen02-rgb/51publisher`(**不是** GitLab)。活跃 CI = `.github/workflows/ci.yml`(push/PR 真闸:fixture 闸 + compile + lint + test + e2e + 产物校验 + **独立 gitleaks job**)+ `release.yml`(`v*` tag)。**无** `.gitlab-ci.yml`。
- **后台是同源 iframe(2026-06-10 再勘查)**:发帖表单在 layuiAdmin 同源子 iframe 内,顶层 `querySelector` 必然落空。填充经 `lib/frame-resolve.ts` 做成 frame-agnostic(顶层优先→下钻同源 iframe),已接进 `content.ts` + `body-responder.ts`。**勿再信任「非 iframe」旧说法**(2026-06-03 快照已被推翻;CLAUDE.md/field-mapping-guide 在 PR #15 已修正)。
- 后端路由**大部分在 `app.ts` 的 `buildApp` 集中 `register*Routes`**;`index.ts` 仅在启动路径单独调 `registerDraftRoutes`。

## 2026-06-15 全面体检 + p2-hygiene 抢救（本次会话）
**体检结论**:核心(三世界模型、防幻觉事实注入、安全闸门链)健康;真问题在边缘 + 北极星缺口。**项目从未真正发布过一篇——「可上线」仍是愿望而非事实。**

**关键事故 + 处理**:本地 `refactor/p2-hygiene`(21 commit,做完 A→C→B→D + P2)**从未推送**,而远端 `main` 早已大幅前进(合并多个 PR:safety-net 加固、UI design-system 重构、onboarding、approve-handler 合并…)。两线 ~25 文件重叠,**强行 push 会摧毁远端已合并 PR**。已及时刹住,改为「盘清重叠→只整合真新」开三个 PR:
- **PR #15** `integrate/p2-salvage`:iframe 文件校正 + e2e 动态提交盲区测试 + 首飞 runbook + 体检/规划文档 + gitleaks CI job + pino 日志 redaction。
- **PR #16** `refactor/apifetch-clients`:`lib/api-fetch.ts` + pending/gossip/config/prompt 四 client 迁移(纯 DRY,−200 行样板)。
- **PR #18** `refactor/split-batch-review-panel`:BatchReviewPanel **1278→581 行**,抽 `batch-review/{ItemCard,sub-blocks,constants}`。
- 三 PR 互不冲突(都从 origin/main 切、文件域不重叠),可任意顺序合并。合并后本地 `refactor/p2-hygiene` 可删(价值已全部分流)。
- **刻意丢弃**(远端已独立做过):修 GitLab 引用、CI e2e/fixture 闸、SSRF DNS 测试、biome format、scraper routes 归位。

**测试基线(2026-06-15,各 PR 分支)**:后端 ~300、扩展 ~666–674、`pnpm -r compile` 全绿、e2e 绿。

## 待运营者亲手动作（不可逆,代码侧已就绪）—— 见 `docs/runbooks/first-flight-runbook.md`
1. **密钥轮换**:`JWT_SECRET`、`JWT_ADMIN_PASSWORD_HASH`(scrypt,`hash-password.mjs`)、`LLM_API_KEY`(**供应商控制台 revoke 旧 key** ≠ 生成新 key;若曾进 git 历史/打包产物则清史)。改 `.env` 后启动 fail-closed 会拒弱值。
2. **首飞**:dry-run → 两路径(手动 + 待审池)各 ≥1 篇真实发布 → 前台核验。
3. **CORS 收紧**(U13):排在首飞成功后;扩展 id 由 `wxt.config.ts` `EXTENSION_KEY` 固定,allowlist 用确定 origin,**绝不放宽到 `*`**(后端 fail-closed 拒 `*`)。
4. 确认 GitHub 仓库私有 → 推送。

## 项目架构
- **Monorepo**(pnpm):`packages/backend/`(Fastify 5,port 3001)+ `packages/extension/`(WXT + React 19 + MV3)+ `packages/shared/`。
- 存储双轨:batch/prompt 用 JSON 文件,pending/config 用 SQLite(better-sqlite3);均读 `PUBLISHER_DATA_DIR`,vitest 经 `src/test-setup.ts` 指临时目录。
- API 统一 `{ ok: true, ... }` / `{ ok: false, error }`。认证 JWT(HS256,24h),token 存 `chrome.storage.local` key `local:authToken`。
- **双写**:本地存储 PRIMARY(始终发生),后端同步 SECONDARY(best-effort,fail-closed);批次双写用 `withBackendSync(localSave)` 包装。
- 扩展对后端调用统一走 apiFetch(PR #16 后)= `getAuthHeaders → getBackendUrl → fetchWithTimeout → 401→clearToken`。

## 跟进（未做）
- **BatchReviewPanel 之外**的更多组件拆分、observability(per-env level / healthz 消费者)等 P2 卫生,留待真有需求再做(见 `docs/brainstorms/2026-06-15-project-optimization-iteration-requirements.md` E 组)。
- 相关:[[feedback_frontend-backend-separation]]
