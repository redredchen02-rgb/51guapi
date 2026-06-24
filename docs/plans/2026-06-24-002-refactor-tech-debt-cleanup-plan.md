---
title: "refactor: Post-JWT Artifact Purge, Type Deduplication, and Invariant Hardening"
type: refactor
status: active
date: 2026-06-24
deepened: 2026-06-24
---

# refactor: Post-JWT Artifact Purge, Type Deduplication, and Invariant Hardening

## Overview

JWT 移除（PR #48，v0.2.5）留下了多處殘影：死代碼文件、誤導性注解、過時警告文字。與此同時，三個包各自重複定義 `GossipSite`、`PendingTopicsResponse` 等核心類型，LLM 配置有封裝函數卻未被使用，IP 安全檢查在三個地方各行其是。本計劃一次性清理這些橫切關注點，消除維護負擔，並消滅數個潛在的靜默 bug。

**不在範圍內：** B1 多站點（blocked）、擴展 e2e（blocked）、Phase 6 存儲統一（高風險 deferred）、大函數拆解（H7/H8，獨立計劃）、DNS rebinding TOCTOU（獨立安全計劃）、WebUI 測試補全（獨立計劃）。

## Problem Frame

PR #48 刪除了 JWT 的 8 個主文件，但清理工作不徹底——`audit-log.ts`（僅 auth 場景有意義）、`schemas.ts` 中的 JWT 類型定義、誤導性注解仍殘留。同時，隨著 extension → webui 擴包，`GossipSite`、`PendingTopicsResponse` 等類型形成三份不同步的副本（欄位不一致），直接導致 WebUI 看不到 `enabled`/`updatedAt` 欄位（C4 bug）。`resolveLlmConfig()` 封裝函數已寫好但 6 個調用點全不使用，IP literal 安全檢查分散在三個文件中實現不一致。

## Requirements Trace

- R1. 所有 JWT 殘影（死代碼、誤導注解、過時警告文字）必須從代碼庫清除
- R2. `GossipSite` 類型在 3 個包中保持欄位一致，WebUI 能正確顯示 `enabled`/`updatedAt`
- R3. `PendingTopicsResponse`/`ThemeCount` 統一到 `@51guapi/shared`，消除跨包不同步
- R4. 所有 LLM 配置調用點統一使用 `resolveLlmConfig()`，不再手動兩步
- R5. IP literal 安全檢查統一由 `ssrf-guard.ts` 處理，不在路由層重複
- R6. `DEFAULT_MAX_BYTES` 唯一定義、`DEFAULT_BACKEND` URL 統一，`gpt-4o-mini` fallback 只在 `llm-config.ts` 中存在
- R7. `SettingsSchema` 覆蓋 `Settings` 接口的全部欄位，`listGossipPendingFacts` 返回類型化值

## Scope Boundaries

- 不修改任何業務邏輯或算法
- 不刪除 `template-adapter.ts`（有文檔價值）；改為加注明
- 不重構 `generateDraft`（H7）或 `from-url` 路由（H8）
- 不修改測試策略或補增 WebUI 測試
- 不動 biome 規則收緊（`noExplicitAny` 等，會產生大面 churn）

## Context & Research

### Relevant Code and Patterns

- `packages/backend/src/services/audit-log.ts` — JWT 移除後唯一 import 是自己的 test
- `packages/backend/src/utils/schemas.ts:99-113` — LoginBody / LoginResponse / AuthStatusResponse 殘留
- `packages/backend/src/routes/channel-routes.ts:21-23` — 注解仍提「有效 JWT」保護
- `packages/backend/src/config/env-check.ts:42` — 警告文字仍提「obtain a token」
- `packages/backend/src/utils/llm-config.ts:53` — `resolveLlmConfig()` 已實現，返回 `LlmConfig | null`
- `packages/backend/src/app.ts:238-388` — 5 處手動 `getLlmConfig()` + `validateLlmConfig()` 兩步
- `packages/backend/src/routes/ranking-routes.ts:134-135` — 第 6 處兩步
- `packages/extension/lib/gossip-client.ts:3` — GossipSite（有 enabled、updatedAt，無 lastDiscoverAt）
- `packages/webui/src/api/gossip.ts:3` — GossipSite（有 lastDiscoverAt、lastDiscoverCount，無 enabled/updatedAt）→ C4 bug
- `packages/backend/src/scraper/gossip-site-store.ts` — GossipSiteConfig（完整欄位）
- `packages/extension/lib/pending-client.ts:20-25` — PendingTopicsResponse / ThemeCount 定義
- `packages/webui/src/api/pending.ts:17-21` — PendingTopicsResponse / ThemeCount 副本
- `packages/backend/src/scraper/adapters/guarded-fetch.ts:14` — DEFAULT_MAX_BYTES（exported）
- `packages/backend/src/scraper/channel-store.ts:43` — DEFAULT_MAX_BYTES 私有副本
- `packages/backend/src/scraper/ssrf-guard.ts:126` — `isPublicUnicastIp()` 在 DNS 解析後對已解析 IP 調用，不在 URL hostname 輸入層做 IP literal 偵測（decimal/octal IPv4 由 Node.js `new URL()` 在輸入時歸一化為 dotted-quad，現有流程已有效覆蓋）
- `packages/backend/src/routes/scraper-routes.ts:35-43` — IP literal 用 `isIP()`（同上）
- `packages/backend/src/routes/gossip-routes.ts:40-65` — IP literal 用 regex 較完整，但形成第三份實現
- `packages/backend/src/scraper/pending-store.ts` — `listGossipPendingFacts` 返回 `unknown[]`
- `packages/backend/src/utils/schemas.ts:12` — SettingsSchema 有 6 欄位，其中 3 個（`facts`/`fewShot`/`extraInstructions`）在 `Settings` 接口不存在（幽靈欄位）；`Settings` 接口實際有 9 個欄位，缺 6 個於 schema

### Institutional Learnings

- JWT 移除（PR #48）刪了 8 個主文件但未做 dead code sweep，本計劃補完
- shared dist 過時是常見陷阱：改 shared 後必須先 `pnpm --filter @51guapi/shared build` 再編譯其他包
- 類型向 shared 遷移時需精確 stage，不要 `git add .`（參考並發安全教訓）

### External References

- TypeBox 文檔：Schema 應與 TS 類型同步，AJV `removeAdditional` 開啟時會靜默丟字段

## Key Technical Decisions

- **刪 audit-log.ts 連同其 test**：test 只測試死代碼，保留無意義。全刪更乾淨。
- **GossipSite 遷入 shared 時保留所有欄位（正確欄位名為 `listUrl`，非 `url`）**：extension 的 `enabled`/`updatedAt` + webui 的 `lastDiscoverAt?`/`lastDiscoverCount?` + 共同的 `id`/`name`/`listUrl`/`createdAt`，合併為一個 canonical 類型。`lastDiscoverAt` 和 `lastDiscoverCount` 為 optional（後端可能尚未寫入）。各消費方只用自己需要的欄位，TypeScript 不報多餘欄位錯誤。C4 修復驗收標準：不只是 compile 通過，還需確認 WebUI GossipSitesView 的 enabled toggle 和 updatedAt 能正確渲染（需人工確認 UI 行為）。
- **不把 PendingTopicsResponse 遷入 shared 的 REST 層**：只搬 TS 類型定義；實際 HTTP 請求邏輯（apiFetch、錯誤處理）仍各包各自維護（extension 和 webui 打包隔離，統一 HTTP 層是獨立決策）。
- **resolveLlmConfig() 返回 null 時使用固定 error string**：現有測試（`app.test.ts:217,581`；`ranking-routes.test.ts:398`）只斷言 `.kind === "no-key"`，不斷言 error message 字串本身。因此 null 路徑可安全改為固定字串（如 `"LLM is not configured. Check .env file."`），不再需要二次呼叫 `validateLlmConfig()` 取 message。這讓 `resolveLlmConfig()` 真正成為單點入口；犧牲原始診斷信息（「Please check .env file」→ 更通用提示）是已知取捨，可接受。
- **IP literal 整合：路由層的真正目的是「防 IP 直連繞過 hostname allowlist」，而非「阻止私網 IP」**：Node.js `new URL()` 已自動把 decimal/hex/octal IPv4 歸一化為 dotted-quad，ssrf-guard 的 `isPrivateIp()` 對私網 IP literal 已有效。路由層重複邏輯可安全移除，但**必須保留 gossip-routes 的 `https:` only 校驗**（ssrf-guard 允許 `http:`，兩者語義不同）。刪路由層 IP check 後，gossip-routes 的相關測試斷言（期望 `400` + 含 `"IP literal"` 的 message）需一併更新：新的錯誤訊息來自 ssrf-guard 的 `SsrfError`，message 和 status code 格式不同。
- **template-adapter.ts 加注解標記而非刪除**：它有 SSRF 約束文檔、guardedFetchHtml 範例等對新開發者有價值的說明；改為在文件頂部加 `// DEV-ONLY SCAFFOLD` 注解並移出 vitest coverage 範圍。

## Open Questions

### Resolved During Planning

- **audit-log.ts 的 test 是否要保留？** 不保留。test 本身測的是死代碼，刪掉更乾淨。
- **GossipSite 遷移後 backend 是否需要改 gossip-site-store 的 GossipSiteConfig？** 不需要。backend 的 `GossipSiteConfig` 是存儲層類型，可繼續存在；`GossipSite` 是 API 響應類型，遷入 shared 供 extension 和 webui 消費即可。
- **PUBLISHER_DATA_DIR 是否需要改？** 已完成（data-dir.ts 已全用 GUAPI_DATA_DIR），不在本計劃。
- **migration runner 事務包裹？** 已在 runner.ts:209 實現（`const applyOne = db.transaction(...)`），不在本計劃。

### Deferred to Implementation

- `registerDraftRoutes` 是否應併入 `buildApp()`：現有設計讓 test 可按需注入，是有意的。執行時確認是否需要調整。
- `template-adapter.ts` 的 test 覆蓋：移出 coverage scope 的具體 vitest exclude 配置，實現時決定。

## High-Level Technical Design

> *以下說明各 Unit 的組織方式，是審查方向指引，非實作規格。*

```
Phase 1 (U1, U2) ─── 純刪除與文字修正，最低風險，獨立可並行
    │
    ▼
Phase 2 (U3, U4) ─── shared 新增類型導出 → extension/webui 更新 import
    │
    ▼
Phase 3 (U5, U6) ─── LLM config + constant 歸一，app.ts 最大改動點
    │
    ▼
Phase 4 (U7, U8) ─── Schema 補欄位 + IP literal 安全強化（各自獨立）
```

Phase 1 和 Phase 2 可並行開始；Phase 3 最好在 Phase 1 後（shared dist 先 build）；Phase 4 完全獨立。

## Implementation Units

- [ ] **U1: Post-JWT Dead Code — audit-log + JWT schemas**

**Goal:** 刪除 `audit-log.ts` 及其 test；從 `schemas.ts` 移除 `LoginBody`、`LoginResponse`、`AuthStatusResponse` 三個死導出。

**Requirements:** R1

**Dependencies:** None

**Files:**
- Delete: `packages/backend/src/services/audit-log.ts`
- Delete: `packages/backend/src/services/audit-log.test.ts`
- Modify: `packages/backend/src/utils/schemas.ts` — 移除 lines 99-113（三個 JWT TypeBox 類型）

**Approach:**
- 在刪除前 grep 確認無 non-test import（`audit-log.ts` 目前只有 `audit-log.test.ts` import 它）
- 刪除前先將 `audit-log.test.ts` 中唯一的 `vi.mock('node:fs')` ESM mock 模式摘要至 `docs/solutions/esm-mock-node-fs.md`（此為整個 codebase 唯一一例，刪後無法再查）
- `schemas.ts` 的修改僅移除三個 export const；其餘 schemas 不動

**Patterns to follow:**
- `packages/backend/src/utils/schemas.ts` 現有 schema 格式

**Test scenarios:**
- Happy path: `pnpm compile` 全綠，`pnpm test` 無 import 錯誤
- Edge case: grep `audit-log` 後無殘餘 TS import（除 CHANGELOG 等文檔）
- Edge case: grep `LoginBody\|LoginResponse\|AuthStatusResponse` 全倉 TS 文件無引用
- Integration: 啟動 backend server，`/docs`（Swagger）正常生成無報錯（確認 JWT schemas 刪除後 swagger spec 不引用已刪除類型）

**Verification:**
- `pnpm compile` 通過，`pnpm test` 通過；Swagger `/docs` 頁面可正常加載

---

- [ ] **U2: Stale Comment Cleanup — JWT comment + env-check token warning**

**Goal:** 修正 `channel-routes.ts:21-23` 誤寫「有效 JWT」的注解；更新 `env-check.ts:42` 中「can obtain a token」的過時警告文字。

**Requirements:** R1

**Dependencies:** None

**Files:**
- Modify: `packages/backend/src/routes/channel-routes.ts:21-23`
- Modify: `packages/backend/src/config/env-check.ts:42`

**Approach:**
- `channel-routes.ts`：注解應改為描述「mutation-pin 寫入閘」或直接移除 JWT 相關說明
- `env-check.ts`：警告文字改為「Anyone who can reach this host can call any API without authentication.」（去掉 token 說法）；**必須保留** `ALLOW_NONLOOPBACK_AUTH=true` opt-in 的說明段落（這是現存的非 loopback 啟用機制，替換文字不能刪它）

**Test scenarios:**
- Happy path: env-check.ts 的現有測試 (`env-check.test.ts`) 仍然通過

**Verification:**
- grep "JWT\|token" in channel-routes.ts 無業務上下文殘留

---

- [ ] **U3: GossipSite 類型統一遷入 @51guapi/shared**

**Goal:** 在 `@51guapi/shared` 建立 canonical `GossipSite` 類型，包含全部欄位（`id`, `name`, `listUrl`, `createdAt`, `enabled`, `updatedAt`, `lastDiscoverAt?`, `lastDiscoverCount?`）；extension 和 webui 改從 shared import；修復 C4（WebUI 看不到 enabled/updatedAt）。注意：欄位名是 `listUrl`，不是 `url`（代碼三處均用 `listUrl`）。

**Requirements:** R2

**Dependencies:** None（shared 先 build）

**Files:**
- Modify: `packages/shared/src/` — 新增或更新類型導出文件（如 `api-types.ts`）
- Modify: `packages/extension/lib/gossip-client.ts` — 移除本地 GossipSite 定義，改 import
- Modify: `packages/webui/src/api/gossip.ts` — 移除本地 GossipSite 定義，改 import
- Test: `packages/shared/src/` 對應測試（純類型導出可無 unit test，但需 compile 驗證）

**Approach:**
- `GossipSite` 欄位為 extension 已有欄位 ∪ webui 已有欄位，全部 optional 或 required 根據後端 API 實際返回決定
- backend 的 `GossipSiteConfig`（存儲層）不改；後端路由將 GossipSiteConfig 映射為 GossipSite 的行為不變
- shared build 後確認 `dist/` 已更新再編譯 extension/webui

**Patterns to follow:**
- `packages/shared/src/` 現有 export 模式（如 `gossip-facts.ts`、`article-assembler.ts`）

**Test scenarios:**
- Happy path: `pnpm compile` 全通
- Edge case: extension 和 webui 各自不再有 GossipSite 本地定義（grep 確認）
- Integration: WebUI GossipSitesView 渲染後 enabled toggle 正確顯示（需人工確認 UI 行為，不只 compile 通過）；updatedAt 欄位能在 UI 中可見

**Verification:**
- `pnpm compile` 通過；grep `interface GossipSite` 只在 shared/src 有一個定義；人工確認 WebUI enabled toggle 可見

---

- [ ] **U4: PendingTopicsResponse / ThemeCount 遷入 @51guapi/shared**

**Goal:** 消除 extension 和 webui 中兩份相同的 `PendingTopicsResponse`、`ThemeCount` 類型定義；遷入 shared。

**Requirements:** R3

**Dependencies:** U3（可並行，但最好 shared 一起改）

**Files:**
- Modify: `packages/shared/src/` — 添加 PendingTopicsResponse / ThemeCount 導出
- Modify: `packages/extension/lib/pending-client.ts:20-25` — 移除本地定義，改 import
- Modify: `packages/webui/src/api/pending.ts:17-21` — 移除本地定義，改 import

**Approach:**
- 兩份定義**不一致**（extension: `topics?: PendingTopic[]` optional + `error?: string`；webui: `topics: PendingTopic[]` required + `total?: number`）；canonical 定義採聯集型：`{ ok: boolean; topics?: PendingTopic[]; total?: number; error?: string }` — 全部 optional 是最安全的聯集，符合「收縮接收，寬鬆返回」原則
- 如後端 API 在正常路徑必然返回 topics（非 null），可在文件 comment 標注 `topics` 只在錯誤時缺席，但 TS 類型保持 optional 以避免消費端強型別破壞

**Patterns to follow:**
- U3 的 shared 遷移方式

**Test scenarios:**
- Happy path: `pnpm compile` 通過
- Edge case: grep `PendingTopicsResponse\|ThemeCount` 只在 shared/src 有定義

**Verification:**
- `pnpm compile` 通過；兩包各只 import 不再定義

---

- [ ] **U5: resolveLlmConfig() 全面採用 — 替換 6 個手動兩步調用**

**Goal:** 用 `resolveLlmConfig()` 替換 `app.ts` 中 5 處和 `ranking-routes.ts` 中 1 處的手動 `getLlmConfig()` + `validateLlmConfig()` 兩步調用。`scheduler.ts` 和 `gossip-fact-extractor.ts` 中的 `"gpt-4o-mini"` fallback 屬於不同模式，單獨處理（見下）。

**Requirements:** R4, R6 (partial)

**Dependencies:** U1（schemas 已清理）

**Files:**
- Modify: `packages/backend/src/app.ts:238,261,306,340,387` — 5 處替換
- Modify: `packages/backend/src/routes/ranking-routes.ts:134-135` — 1 處替換
- *scheduler.ts / gossip-fact-extractor.ts 不在本 unit 範圍（見「架構說明」）*

**Approach:**
- `resolveLlmConfig()` 返回 `LlmConfig | null`；null 時回固定錯誤字串（`"LLM is not configured. Check LLM_API_KEY and LLM_ENDPOINT in .env."`），不再二次呼叫 `validateLlmConfig()`
- 替換模式：`const config = getLlmConfig(); const validation = validateLlmConfig(config); if (!validation.valid) { err(reply, 500, validation.error ?? "Unknown error", "no-key"); return; }` → `const config = resolveLlmConfig(); if (!config) { err(reply, 500, "LLM is not configured...", "no-key"); return; }`
- 現有測試只斷言 `.kind === "no-key"`，不斷言 error message 字串，因此此替換不會破壞現有測試
- `ranking-routes.ts:137-142` 有不同 fallback 字串（`"LLM config error"`），改後統一

**架構說明（scheduler.ts 為何不同）：** `scheduler.ts` 走的是**依賴注入模式**（`SchedulerDeps.llmModel?: string` 由 `app.ts:startScheduler()` 從 `process.env.LLM_MODEL` 注入），不直接呼叫 `getLlmConfig()`。`deps.llmModel || 'gpt-4o-mini'` 是注入層的 fallback；`getLlmConfig()` 本身也有相同 default，兩者功能等價但路徑不同。若要清理 scheduler.ts，應在注入點調整，不應直接刪 `|| 'gpt-4o-mini'`（否則 `model: undefined` 會靜默傳入）。`gossip-fact-extractor.ts:99` 的 default 是函式參數 default，同理屬不同模式。這兩處的清理作為 defer 項目，不阻礙本 unit。

**Patterns to follow:**
- `packages/backend/src/utils/llm-config.ts:53` 中 resolveLlmConfig 的現有簽名與返回值

**Test scenarios:**
- Happy path: LLM 配置完整時路由正常返回
- Error path: LLM_API_KEY 未設時路由返回正確錯誤（現有 app.test.ts 中相關測試必須通過）
- Happy path: 現有所有 e2e test 通過（gossip-pipeline-e2e.test.ts 等）

**Verification:**
- `pnpm test` 全通；grep `getLlmConfig.*validateLlmConfig` 無兩步連用的 non-test 匹配

---

- [ ] **U6: Constant 去重 — DEFAULT_MAX_BYTES + DEFAULT_BACKEND URL**

**Goal:** 消除 `DEFAULT_MAX_BYTES` 的 `channel-store.ts` 私有副本（改 import guarded-fetch 的 export）。`DEFAULT_BACKEND` URL 統一暫緩（見「暫緩說明」）。

**Requirements:** R6 (partial: constants)

**Dependencies:** None

**Files:**
- Modify: `packages/backend/src/scraper/channel-store.ts:43` — 移除本地 DEFAULT_MAX_BYTES，改 import

**Approach:**
- `DEFAULT_MAX_BYTES`：`guarded-fetch.ts` 已 export，直接 import 即可

**暫緩說明（DEFAULT_BACKEND URL 不在本 unit 範圍）：** `extension/lib/backend-url.ts` 和 `webui/src/lib/api-client.ts` 在不同 package，要共享常數需在 `@51guapi/shared` 新增 export 並引入跨包依賴。兩者值有差異（`127.0.0.1` vs `localhost`）在 IPv6-only 環境下有語義差別，且 webui dev 模式走 Vite proxy，不依賴這個值。引入跨包依賴的代價高於好處，defer 至有明確需求時再評估。

**Test scenarios:**
- Happy path: `pnpm compile` 通過
- Edge case: grep `DEFAULT_MAX_BYTES` 在 channel-store.ts 中無本地定義

**Verification:**
- `pnpm compile` + `pnpm test` 通過

---

- [ ] **U7: SettingsSchema 雙向修正 + listGossipPendingFacts 返回類型修復**

**Goal:** 使 `SettingsSchema`（TypeBox）與 `Settings` 接口（9 個欄位）雙向對齊：移除 3 個幽靈欄位（`facts`/`fewShot`/`extraInstructions`）+ 新增 6 個缺失欄位；修復 `listGossipPendingFacts` 返回 `unknown[]` 的 unsafe cast。

**Requirements:** R7

**Dependencies:** None（可在任何時間點做）

**Files:**
- Modify: `packages/backend/src/utils/schemas.ts:12` — SettingsSchema 雙向修正（見 Approach）
- Modify: `packages/backend/src/scraper/pending-store.ts` — `listGossipPendingFacts` 返回 `GossipFactsBlock[]` + 必要的 type guard

**Approach:**
- `SettingsSchema` 雙向修正：
  1. **先確認** `facts`、`fewShot`、`extraInstructions` 這 3 個幽靈欄位是否仍被 extension 端實際發送（grep extension 代碼）。若無發送者，直接從 schema 刪除；若 extension 仍發送，需同步加入 `Settings` interface 並評估語義。
  2. **再新增**缺失欄位：`fallbackModel?`、`fewShotPairs?`、`recommendedTags?`、`backendUrl?`、`reviewCriteriaPrompt?`、`webSearchEnabled?`（`Settings` interface 共 9 個欄位，非 12，計劃前文說法有誤）。
  3. `backendUrl` 欄位在 Fastify logger redact 路徑中未覆蓋（`*.apiKey` 有覆蓋），新增後確認是否需要同步加入 redact 設定。
  4. optional 欄位用 `Type.Optional()`
- `listGossipPendingFacts`：採用 **parse-or-filter** 策略（不改變現有行為）——格式錯誤的 row 被過濾而非拋錯（現有 `pending-store.test.ts:663` 驗證「格式錯誤 row 被靜默過濾」語義必須保留）。改為返回 `GossipFactsBlock[]` 並在 row mapping 時用 `safeJsonParse` + 類型守衛過濾無效項，而非 throw

**Patterns to follow:**
- `packages/backend/src/utils/schemas.ts` 現有 TypeBox 欄位定義風格
- `packages/backend/src/scraper/pending-store.ts` 中的 `safeJsonParse` 模式

**Test scenarios:**
- Happy path: `pnpm compile` 通過
- Edge case: 若 SettingsSchema + `removeAdditional` 被開啟，12 欄位全部保留
- Error path: `listGossipPendingFacts` 對格式錯誤的 DB row 靜默過濾（不拋出），返回陣列不含 null，`Array.isArray(result) === true`（`pending-store.test.ts:663` 語義保留）

**Verification:**
- TS 編譯無 unsafe cast 警告；現有 settings 相關測試通過

---

- [ ] **U8: IP Literal 檢查統一通過 ssrf-guard**

**Goal:** 移除 `gossip-routes.ts` 和 `scraper-routes.ts` 中的重複 IP literal 檢查邏輯，統一依賴 `ssrf-guard.ts` 的 `assertUrlSafe()`。同時保留 `gossip-routes` 的 `https:` only 校驗（ssrf-guard 允許 http，語義不同）。

**Requirements:** R5

**Dependencies:** None

**Background:** Node.js `new URL()` 已自動把 decimal/hex/octal IPv4 歸一化為 dotted-quad，因此 ssrf-guard 的 `isPrivateIp()` 對各種私網 IP literal 已有效。**注意：** `ssrf-guard.test.ts:101` 明確測試 `assertUrlSafe('https://1.1.1.1/')` 會**成功通過**——公網 IP literal 不被 `assertUrlSafe` 阻止。公網 IP literal 的阻斷依賴下游 `isHostAllowed()` 拒絕非 domain 的 hostname。移除路由層 IP check 前，**必須先確認** `isHostAllowed('1.1.1.1')` 在 ssrf-allowlist.ts 中返回 `false`（allowlist 只含 domain 名稱，故應拒絕）。若驗證通過，路由層 IP check 才屬防禦縱深冗餘而非唯一防線。

**Files:**
- Modify: `packages/backend/src/routes/gossip-routes.ts:40-65` — 移除 `isIpLiteral()` 自定義 IP 邏輯；保留或內聯 `protocol !== "https:"` 校驗
- Modify: `packages/backend/src/routes/scraper-routes.ts:35-43` — 移除 IP literal 檢查，路由直接把 URL 傳入 ssrf-guard 的現有流程
- Modify: `packages/backend/src/routes/gossip-routes.test.ts` — 更新 IP literal 測試的期望 status code 和 error message（原期望 `400` + "IP literal"，整合後 ssrf-guard 拋 SsrfError，status/message 格式不同）
- Test: `packages/backend/src/scraper/ssrf-guard.test.ts` — 確認現有 private IPv4/IPv6 測試涵蓋 loopback（127.0.0.1）、link-local（169.254.x.x）、private（10.x/192.168.x）；必要時補充

**Approach:**
- 操作順序：**先** grep `isHostAllowed` 確認它對純 IP hostname（如 `'1.1.1.1'`）返回 `false` → 再確認 ssrf-guard.test.ts 已覆蓋私網 IP → 更新 gossip-routes.test.ts 期望值 → 再刪路由層 IP check
- `gossip-routes` 的 `https:` only 校驗**必須保留**，不能委託給 ssrf-guard（ssrf-guard 接受 http）
- 不需要在 ssrf-guard.ts 新增任何邏輯；decimal IPv4 已被 Node.js URL parser 歸一化，現有代碼已覆蓋
- `POST /sites/:id/discover`（`gossip-routes.ts:156`）直接呼叫 `fetchListPaged(site.listUrl)` 而未經 `parseUrl()`，繞過 IP literal 和 https-only 校驗；需在同 unit 補修（新增 parseUrl 驗證步驟或在 fetchListPaged 入口加 guard）

**Patterns to follow:**
- `packages/backend/src/scraper/ssrf-guard.ts` 現有 `isPrivateIp` 邏輯
- 現有 `ssrf-guard.test.ts` 的 test 格式

**Test scenarios:**
- Happy path: 合法 https URL（allowlist 中的域名）通過 gossip-routes
- Error path: `http://` URL 傳入 gossip-routes 返回 400（https-only 校驗仍有效）
- Error path: `http://127.0.0.1/` 傳入路由被 ssrf-guard 阻斷（私網 loopback）
- Error path: `http://192.168.1.1/` 傳入路由被 ssrf-guard 阻斷（私網 RFC1918）
- Error path: `http://2130706433/` — Node.js URL 歸一化為 `127.0.0.1`，ssrf-guard 阻斷（驗證歸一化有效）
- Error path: `POST /sites/:id/discover` 傳入 `http://` listUrl（DB 中已存）應返回 400（https-only 保護 discover endpoint）
- Error path: 公網 IP literal（如 `https://1.1.1.1/`）傳入 gossip-routes 被 allowlist 拒絕（確認 `isHostAllowed` 對純 IP hostname 返回 false）
- Integration: 現有 gossip-pipeline-e2e.test.ts 全部通過（整合後路由功能不退化）

**Verification:**
- gossip-routes/scraper-routes 無本地 IP regex 或 `isIpLiteral` 邏輯；gossip-routes https-only 仍有效；`pnpm test` 全通

---

- [ ] **U9: template-adapter.ts 加 DEV-ONLY 標記 + 移出 Coverage**

**Goal:** 為 `template-adapter.ts` 加顯式「開發腳手架，非生產代碼」標注；確保 vitest coverage 報告不將其列為未覆蓋死碼。

**Requirements:** （技術債清理，無直接 R 對應）

**Dependencies:** None

**Files:**
- Modify: `packages/backend/src/scraper/adapters/template-adapter.ts` — 頂部加 `// DEV SCAFFOLD: Copy this file to create a new site adapter. Not imported by production code.`
- Modify: `packages/backend/vitest.config.ts` (or coverage config) — exclude template-adapter.ts from coverage

**Approach:**
- 一行 comment + 一行 exclude 配置；不移動文件、不刪除

**Test scenarios:**
- Test expectation: none — pure documentation/config change

**Verification:**
- coverage 報告中 template-adapter.ts 不再出現為未覆蓋行

## System-Wide Impact

- **Interaction graph:** U3/U4 改動 `@51guapi/shared` 的公開 export，所有 import 它的包需 `pnpm -r build` 拓撲序重新編譯
- **Error propagation:** U5 的 resolveLlmConfig 替換後，LLM 配置無效時錯誤路徑語義不變，但 error message 字串應檢查是否仍可讀
- **State lifecycle risks:** U7 的 listGossipPendingFacts 加 parse 保護後，格式損壞的 DB row 由靜默返回 `unknown` 變為靜默過濾並返回 `GossipFactsBlock[]`（語義不變，僅類型強化）；現有調用方不受影響，`pending-store.test.ts:663` 的「過濾不拋錯」斷言作為回歸門控
- **API surface parity:** U3 修復 GossipSite 類型後，extension 和 webui 的 enabled toggle 邏輯需確認正確運作（不只是類型通過）
- **Integration coverage:** U8 整合後，gossip-routes e2e test（`gossip-pipeline-e2e.test.ts`）作為集成驗證跑一遍
- **Unchanged invariants:** SSRF allowlist 邏輯、mutation-pin 守衛、`assertUrlSafe` 的現有阻斷行為在 U8 後必須完整保留

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| shared 類型遷移後 dist 過時，導致 extension/backend 編譯看舊類型 | 每次改 shared 後先 `pnpm --filter @51guapi/shared build` |
| U5 resolveLlmConfig null 路徑 error message 與現有測試斷言不符 | 先讀 app.test.ts 中相關 error message 斷言再改 |
| U8 整合 IP 檢查時不小心移除了 gossip-routes 的十進制 IPv4 檢測能力 | 先把 gossip-routes 的 regex 寫成 ssrf-guard 的 test case，再刪路由層邏輯 |
| SettingsSchema 補欄位後若有 `additionalProperties: false` 設定，線上保存的 settings 可能被截斷 | 確認後端 schema 驗證選項；默認 TypeBox 不開 removeAdditional |
| 並行 agent 或 Claude 會話同時改 shared 包 | 改前確認無其他工作流在跑，精確 stage 文件 |

## Sources & References

- Related code: `packages/backend/src/services/audit-log.ts`
- Related code: `packages/backend/src/utils/llm-config.ts:53`
- Related code: `packages/backend/src/scraper/ssrf-guard.ts`
- Related PRs/issues: #48（JWT 移除）, #80（generic-adapter 最新）
- Research: 本計劃由 repo-research-analyst + learnings-researcher 掃描輸出（2026-06-24）
