---
title: "refactor: Maintainability, Test Coverage, and UI Component Splits"
type: refactor
status: completed
date: 2026-06-16
origin: docs/brainstorms/2026-06-16-maintainability-test-refactor-requirements.md
---

# Refactor: Maintainability, Test Coverage, and UI Component Splits

## Overview

填補測試缺口、清理 `fewShotExamples` 雙真相、歸位 scraper routes、拆解三個 UI god-component。全程保持測試全綠、不新增產品功能、不動安全閘門鏈。排序：A（補測試）→ B（清結構債）→ C（拆組件）。

## Problem Frame

1170 個測試全綠、`pnpm -r compile` 全綠，但可維護性有三類缺口：(1) `prompt-routes.ts` 和 `chrome-storage-utils.ts` 無單測，讓重構缺乏安全網；(2) `fewShotExamples` 雙真相讓 few-shot 編輯有隱性 bug 風險；(3) BatchReviewPanel / TodayBatchView / Settings 三個 god-component 讓每次改動都需在 500–786 行的 context 中定位。（見原始需求文件）

## Requirements Trace

- R1. `prompt-routes.ts` 補整合測試（GET / PUT / 404 / 401）
- R2. `chrome-storage-utils.ts` 補單元測試（get / set / clear）
- R3. `fewShotExamples` 雙真相清理（extension 側；後端 out of scope）
- R4. scraper routes 從 `scraper/` 歸位到 `src/routes/`
- R5. 死字段移除（YAGNI）
- R6. BatchReviewPanel.tsx 拆完（≤ 200 行父）
- R7. TodayBatchView.tsx + BatchView.tsx 重疊邏輯整合（各 ≤ 300 行）
- R8. Settings.tsx 拆為 4 個 custom hook（父 ≤ 150 行）
- Success: 全程 `pnpm -r compile` + `pnpm test` + `pnpm test:e2e` 全綠，測試數量不降

## Scope Boundaries

- 後端 `prompt-store.ts` / `prompt-routes.ts` 的 `fewShotExamples` 欄位保留（獨立 API 面，本輪 out of scope）
- `background.ts`（1133L）、`App.tsx`（633L）、`llm.ts`（643L）本輪不拆
- 安全閘門鏈、三世界模型、存儲雙軌不動
- E2E 不新增（盲區已閉合）

## Context & Research

### Relevant Code and Patterns

**Backend route test pattern（`packages/backend/src/scraper/gossip-routes.test.ts`）**
- `buildApp()` + `registerXxxRoutes(app)` + `app.ready()`
- 每個 `it` 用 `app.inject({ method, url, payload })` 打 HTTP，驗 `statusCode` + `res.json()`
- `beforeEach`：重置 DB + 清資料目錄；`afterEach`：`app.close()`

**Extension lib test pattern（`packages/extension/lib/auth-client.test.ts`）**
- 用 `fakeBrowser` from `wxt/testing`，`beforeEach(() => fakeBrowser.reset())`
- 不手動 mock `chrome` API，`fakeBrowser` 自動接管 `chrome.storage`

**fewShotExamples 現況**
- `storage.ts:63`：default value 包含 `fewShotExamples`
- `storage.ts:338-368`：`addFewShotPair` / `removeLastFewShotPair` 雙寫 `fewShotPairs` + `deriveFewShotExamples()`
- `storage.ts:101-105`：`getSettings` merge 已有「空 pairs → 清 fewShotExamples」邏輯
- `prompt-assembly.ts:30`：讀 `settings.fewShotExamples`
- `Settings.tsx:69`：有獨立 `fewShotExamples` local state + 遷移 fallback（L113-123）
- 後端 `prompt-store.ts:10` / `prompt-routes.ts:55`：`fewShotExamples` 是後端自己的欄位，與 extension 存儲無關

**batch-review/ 拆分模式（已有）**
- `ItemCard.tsx` + `ItemCard.test.tsx`、`FactsOverlay.tsx`、`sub-blocks.tsx`、`constants.ts`
- `BatchReviewPanel.tsx`（588L）沿用此模式繼續拆

**Settings.tsx 17 個 useState → 4 個 custom hook**
- `useLLMSettings`：endpoint / model / apiKey / fallbackModel / fallbackOpen
- `usePromptSettings`：promptTemplate / fewShotPairs / reviewCriteriaPrompt（+ 後端 prompts 清單）
- `useBackendSettings`：backendUrl / backendToken
- `useFieldMappingSettings`：tagsText / mappingText / dailyBatchSize
- 留在 component：testing / testResult / error / saved / importBanner / importTruncated

**useBatchOperations hook（125L）**
- 管：status / items / results / progress / start / pause / reset
- **不**管：哪條被選中、展開/收合、tab 切換、審批確認——這些 domain 狀態仍在 parent

### Institutional Learnings

- `docs/solutions/developer-experience/extension-http-client-testability-injection-seam-2026-06-15.md`：extension lib 測試用 `fakeBrowser`；若有 `fetchFn` 注入點，用可選參數 + `fetchFn ? await fetchFn(...) : await fetchWithTimeout(...)` 模式

## Key Technical Decisions

- **R3 清理只做 extension 側**：後端 `prompt-store` 的 `fewShotExamples` 是獨立 API 欄位，清理後端需要協調 API 版本，本輪 out of scope。Extension 側：storage 層停止雙寫，改在 `getSettings` 返回前派生（保持 `prompt-assembly.ts` 無需改動）；`Settings.tsx` 的 `fewShotExamples` local state 作為 Unit 8 拆分時一起移除。
- **chrome-storage-utils 測試用 fakeBrowser**：官方測試工具，比手動 mock `chrome` API 更穩定，與現有 auth-client 測試模式一致。
- **Settings.tsx 以 custom hook 拆（非子組件）**：Settings 的複雜度在 state 邏輯（17 個 useState）而非 render 結構；hook 拆分降低行數且不引入多餘 prop drilling。各 hook 各自負責 load + save，父組件純組合。
- **Unit 4（scraper routes 歸位）前置 Unit 1（prompt-routes 測試）**：先有測試，搬移後立即驗證零回歸。

## Open Questions

### Resolved During Planning

- **R3 後端是否需要同步清理**：否。後端 `fewShotExamples` 是其 API 的欄位名，與 extension 存儲層獨立。清理 extension 側雙真相不影響後端 API。
- **chrome-storage-utils 測試模式**：用 `fakeBrowser`（`wxt/testing`），無需研究新工具。
- **TodayBatchView hook vs context**：`useBatchOperations`（已有）管流程狀態，domain 狀態（選中項、展開、審批）保留在 parent；不需引入 context，沿用現有 hook 模式。
- **Settings.tsx shared state 邊界**：6 個 UI 狀態（testing / testResult / error / saved / importBanner / importTruncated）無法下沉，留在 component；其餘 11 個可按 4 個 hook 分組，不存在跨 hook 依賴。

### Deferred to Implementation

- **R7 行數目標**：TodayBatchView 786L → ≤ 300L，取決於有多少 domain 狀態可提取為 hook；若無法達到則可放寬到 ≤ 350L，需讀代碼確認。
- **R5 死字段精確清單**：`grep -n "void .* // 計劃中"` 掃全 codebase，執行時確認；可能只有 1-3 處。

## Implementation Units

依賴順序如下：

```
Unit 1 ──────────────────────────────┐
Unit 2 ──────────────────────────────┤→ Phase B (Unit 3, 4, 5) → Phase C (Unit 6 → 7, Unit 8)
```

Units 1 和 2 可並行；Unit 4 需等 Unit 1；C 組需等 A 組；Unit 8 可與 Unit 6-7 並行；Unit 7 需等 Unit 6。

---

- [ ] **Unit 1: prompt-routes.ts 整合測試**

**Goal:** 為 `packages/backend/src/scraper/prompt-routes.ts` 補完整合測試，建立後續 routes 搬移的安全網。

**Requirements:** R1

**Dependencies:** 無

**Files:**
- Create: `packages/backend/src/scraper/prompt-routes.test.ts`
- Reference: `packages/backend/src/scraper/gossip-routes.test.ts`（模式參考）

**Approach:**
- 複製 `gossip-routes.test.ts` 的 `buildApp()` + `app.inject()` 框架
- `beforeEach`：`app.ready()` + 清 `PUBLISHER_DATA_DIR`（`process.env.PUBLISHER_DATA_DIR` 指臨時目錄，與 `src/test-setup.ts` 一致）
- `afterEach`：`app.close()`
- 需確認 prompt-routes 的 DB/store 初始化函數（類比 gossip-routes 的 `resetPendingDb`）

**Patterns to follow:**
- `packages/backend/src/scraper/gossip-routes.test.ts`（整體框架）
- `packages/backend/src/routes/batch-routes.test.ts`（JWT 401 測試寫法）

**Test scenarios:**
- Happy path: `GET /api/v1/prompts` → 200 + 回傳陣列（初始空）
- Happy path: `POST /api/v1/prompts`（若有）→ 201 + 新建 prompt 物件（若 route 僅有 PUT，確認 create path）
- Happy path: `PUT /api/v1/prompts/:id`（合法 id）→ 200 + 更新後物件；`name` / `template` / `fewShotExamples` 欄位變更驗證
- Edge case: `PUT /api/v1/prompts/:id`（不存在 id）→ 404
- Error path: `PUT /api/v1/prompts/:id`（body 缺必填欄位）→ 422
- Error path: `GET /api/v1/prompts`（無 JWT token）→ 401
- Error path: `PUT /api/v1/prompts/:id`（無 JWT token）→ 401

**Verification:**
- `pnpm --filter publisher-backend test` 通過，prompt-routes.test.ts 出現於通過清單，無 skipped

---

- [ ] **Unit 2: chrome-storage-utils.ts 單元測試**

**Goal:** 為 `packages/extension/lib/chrome-storage-utils.ts` 補單元測試，建立 extension lib 安全網。

**Requirements:** R2

**Dependencies:** 無（可與 Unit 1 並行）

**Files:**
- Create: `packages/extension/lib/chrome-storage-utils.test.ts`
- Reference: `packages/extension/lib/auth-client.test.ts`（fakeBrowser 模式）

**Approach:**
- `import { fakeBrowser } from "wxt/testing"`
- `beforeEach(() => fakeBrowser.reset())`
- 直接呼叫 `chrome-storage-utils.ts` 的導出函數；不需手動 mock chrome API

**Patterns to follow:**
- `packages/extension/lib/auth-client.test.ts`

**Test scenarios:**
- Happy path: `getStorageValue("key")` → 返回先前 set 的值
- Happy path: `setStorageValue("key", value)` → `getStorageValue` 讀回相同值
- Happy path: `clearStorageValue("key")` → `getStorageValue` 返回 `undefined`（或預設值）
- Edge case: `getStorageValue("nonexistent")` → 返回 `undefined` 或函數定義的 fallback
- Edge case: `setStorageValue("key", null)`（若支持）→ 不拋錯
- Integration: set A、set B、clear A → getA 為空、getB 仍存在

**Verification:**
- `pnpm --filter publisher-fill-assistant test` 通過，`chrome-storage-utils.test.ts` 出現於通過清單

---

- [ ] **Unit 3: fewShotExamples 雙真相清理（extension 側）**

**Goal:** 停止 extension storage 層的 `fewShotExamples` 雙寫，改由 `getSettings` 在返回前派生，消除存儲層冗餘。

**Requirements:** R3

**Dependencies:** Unit 2（storage 測試需先確認現有覆蓋；`storage.test.ts` 已有充分測試，可直接做）

**Files:**
- Modify: `packages/extension/lib/storage.ts`
- Modify: `packages/extension/lib/storage.test.ts`（更新雙寫斷言）
- Reference: `packages/extension/lib/storage.ts`（`deriveFewShotExamples` 函數）

**Approach:**
- `getSettings` 返回前：加 `if (merged.fewShotPairs && merged.fewShotPairs.length > 0) merged.fewShotExamples = deriveFewShotExamples(merged.fewShotPairs)` — 確保 caller 讀到的 `fewShotExamples` 始終與 pairs 一致，無需變動 `prompt-assembly.ts`
- `addFewShotPair`（L338-354）：移除 `fewShotExamples: deriveFewShotExamples(next)` 雙寫行
- `removeLastFewShotPair`（L360-368）：移除 `fewShotExamples:` 雙寫行
- `defaultSettings`（L63）：移除 `fewShotExamples` 預設值（初始化時 pairs 空，派生結果同樣為空）
- **不動** `shared/src/types.ts` 的 `@deprecated` 類型標注（向前相容舊存儲數據）
- **不動** 後端任何文件

**Test scenarios:**
- 更新 `storage.test.ts:246`（addFewShotPair → ok:true, settings 含 pairs 但 fewShotExamples 由 getSettings 派生，非 addFewShotPair 直接寫入）— 驗證 `getSettings` 後讀取的 `fewShotExamples` 仍正確
- 更新 `storage.test.ts:265`（多條分隔符測試）— 改為驗證 `getSettings` 返回值而非 mutation 直接輸出
- 保留 `storage.test.ts:281`（removeLastFewShotPair 後 `fewShotExamples` 為 undefined）— 驗證 getSettings 空 pairs 時回傳 undefined
- Edge case: 舊存儲有 `fewShotExamples` 字串但無 `fewShotPairs` → `getSettings` 保留舊字串（向前相容）

**Verification:**
- `grep -n "fewShotExamples:" packages/extension/lib/storage.ts` 只剩 getSettings 派生那一行，不出現在 mutation 函數中
- `pnpm --filter publisher-fill-assistant test` 全綠

---

- [ ] **Unit 4: scraper routes 歸位**

**Goal:** 將四個 scraper route 文件移到 `src/routes/`，與 auth/batch/config 等模組對齊。

**Requirements:** R4

**Dependencies:** Unit 1（prompt-routes 測試完成，搬移後可立即驗證）

**Files:**
- Move: `packages/backend/src/scraper/gossip-routes.ts` → `packages/backend/src/routes/gossip-routes.ts`
- Move: `packages/backend/src/scraper/pending-routes.ts` → `packages/backend/src/routes/pending-routes.ts`
- Move: `packages/backend/src/scraper/prompt-routes.ts` → `packages/backend/src/routes/prompt-routes.ts`
- Move: `packages/backend/src/scraper/scraper-routes.ts` → `packages/backend/src/routes/scraper-routes.ts`
- Move: `packages/backend/src/scraper/gossip-routes.test.ts` → `packages/backend/src/routes/gossip-routes.test.ts`
- Move: `packages/backend/src/scraper/prompt-routes.test.ts`（Unit 1 創建的）→ `packages/backend/src/routes/prompt-routes.test.ts`
- Modify: `packages/backend/src/app.ts`（import 路徑從 `./scraper/xxx-routes` → `./routes/xxx-routes`）
- `scraper/` 保留：adapters / ssrf-guard.ts / scheduler.ts / prompt-store.ts / pending-store.ts 等非 route 文件

**Approach:**
- 純文件搬移 + import 路徑更新，不修改邏輯
- 搬移後立即跑 `pnpm compile` 驗證類型無誤

**Test expectation:** none — 移動後現有測試已覆蓋，無需新測試（搬移驗收靠既有測試）

**Verification:**
- `pnpm -r compile` 無報錯
- `pnpm --filter publisher-backend test` 全綠（所有 routes 測試通過）
- `grep -r "scraper/.*-routes" packages/backend/src/app.ts` 無命中

---

- [ ] **Unit 5: 死字段移除（YAGNI）**

**Goal:** 刪除投機性空引用（`void xxx; // 計劃中`），減少噪音。

**Requirements:** R5

**Dependencies:** 無（可任意時機執行，建議在 Unit 3-4 後）

**Files:**
- Modify: 掃描後確認（預期：`packages/extension/entrypoints/sidepanel/TodayBatchView.tsx` 或其他 sidepanel 文件）

**Approach:**
- `grep -rn "void .* // 計劃\|void .* // 预留\|void .* // future" packages/ --include="*.ts" --include="*.tsx"` 找出所有死字段
- 逐一確認無邏輯依賴後刪除，`pnpm compile` 驗證

**Test expectation:** none — 純刪除，compile 通過即驗收

**Verification:**
- `pnpm -r compile` 無 unused variable 警告
- 上述 grep 無命中

---

- [ ] **Unit 6: BatchReviewPanel.tsx 拆分完成**

**Goal:** 補完上一輪未完成的拆分——抽出 ApprovalBar 和 DiffView，父組件降至 ≤ 200 行。

**Requirements:** R6

**Dependencies:** Unit 1 + Unit 2（A 組完成）

**Files:**
- Modify: `packages/extension/entrypoints/sidepanel/BatchReviewPanel.tsx`（目標 ≤ 200 行）
- Create: `packages/extension/entrypoints/sidepanel/batch-review/ApprovalBar.tsx`
- Create: `packages/extension/entrypoints/sidepanel/batch-review/DiffView.tsx`
- Create: `packages/extension/entrypoints/sidepanel/batch-review/ApprovalBar.test.tsx`（若有行為邏輯）
- Reference: `packages/extension/entrypoints/sidepanel/batch-review/ItemCard.tsx`（模式）

**Approach:**
- 讀 BatchReviewPanel.tsx，識別審批操作區塊 → `ApprovalBar.tsx`（接收 callbacks props）
- 識別草稿對比區塊（生成前/後）→ `DiffView.tsx`（純展示，無 state）
- 父組件 state 不下沉（保持原設計）；子組件接收 props + callbacks
- 沿用 `batch-review/constants.ts` 中已有常數

**Test scenarios:**（如果 ApprovalBar 含 approve/reject 按鈕邏輯）
- Happy path: click approve → 呼叫 `onApprove` callback
- Happy path: click reject → 呼叫 `onReject` callback
- Edge case: disabled 狀態下按鈕不可點擊

**Verification:**
- `wc -l packages/extension/entrypoints/sidepanel/BatchReviewPanel.tsx` ≤ 200
- `pnpm --filter publisher-fill-assistant test` 全綠

---

- [ ] **Unit 7: TodayBatchView.tsx 與 BatchView.tsx 重疊邏輯整合**

**Goal:** 從 TodayBatchView（786L）提取子組件與 domain hook，各 view 降至 ≤ 300 行（或 ≤ 350L 若 domain 狀態難以下沉）。

**Requirements:** R7

**Dependencies:** Unit 6（BatchReviewPanel 先完成，因其為 TodayBatchView 子組件）

**Files:**
- Modify: `packages/extension/entrypoints/sidepanel/TodayBatchView.tsx`（目標 ≤ 300L）
- Modify: `packages/extension/entrypoints/sidepanel/BatchView.tsx`（目標 ≤ 300L）
- Create: `packages/extension/entrypoints/sidepanel/hooks/useTodayBatchDomain.ts`（domain state：選中 topic、審批確認、展開/收合等）
- Create: `packages/extension/entrypoints/sidepanel/hooks/useTodayBatchDomain.test.ts`

**Approach:**
- 讀 TodayBatchView.tsx 列出所有 useState；識別哪些是 batch 流程（已在 `useBatchOperations`）、哪些是 domain（選中、展開、過濾）
- 把 domain state 提取到 `useTodayBatchDomain`；`useBatchOperations` 保持不動
- 比較 TodayBatchView 和 BatchView 重疊的 state 邏輯，提取到共用 hook 或移除重複
- 大型 render 區塊（如 topic 清單行、生成結果卡）可抽為 sidepanel 頂層子組件

**Test scenarios:**
- Happy path: `useTodayBatchDomain` — 初始 `selected` 為 null；call `selectTopic(id)` → `selected === id`
- Happy path: `toggleExpand(id)` → `expanded.has(id)` 為 true；再次呼叫 → false
- Edge case: `selectTopic(null)` → `selected` 清空

**Verification:**
- `wc -l` 兩個 view 各 ≤ 300（或 ≤ 350 若有充分理由）
- `pnpm --filter publisher-fill-assistant test` 全綠（含 `useTodayBatchDomain.test.ts`）

---

- [ ] **Unit 8: Settings.tsx 拆為 4 個 custom hook**

**Goal:** 17 個 useState 重組為 4 個 custom hook，父組件降至 ≤ 150 行（純組合 + 6 個 UI 狀態）。同時移除 `fewShotExamples` local state（接 Unit 3，改從 `fewShotPairs` 派生）。

**Requirements:** R8, R3（UI 側）

**Dependencies:** Unit 1 + Unit 2（A 組完成）

**Files:**
- Modify: `packages/extension/entrypoints/sidepanel/Settings.tsx`（目標 ≤ 150 行）
- Create: `packages/extension/entrypoints/sidepanel/hooks/useLLMSettings.ts`
- Create: `packages/extension/entrypoints/sidepanel/hooks/usePromptSettings.ts`
- Create: `packages/extension/entrypoints/sidepanel/hooks/useBackendSettings.ts`
- Create: `packages/extension/entrypoints/sidepanel/hooks/useFieldMappingSettings.ts`
- Create: `packages/extension/entrypoints/sidepanel/hooks/useLLMSettings.test.ts`（至少覆蓋 load + save）

**Approach:**
- 各 hook 各自 load（`getSettings` → set state）+ expose save handler
- ⚠️ **save handler 必須先 `await getSettings()` 取最新值再 spread 自己的欄位後 `saveSettings`**——`saveSettings` 是全量覆寫，若各 hook 以 mount 時的快照 save，並發觸發會互相覆蓋。正確模式：`const current = await getSettings(); await saveSettings({ ...current, endpoint, model, apiKey })`
- `usePromptSettings`：移除 `fewShotExamples` state（L69），只保留 `fewShotPairs`；save 到 chrome storage 時不再傳 `fewShotExamplesResolved`（storage 層已在 Unit 3 改為派生）
- ⚠️ **`handleSaveToBackend`（Settings.tsx L174）**：此函數傳 `fewShotExamples` 給後端 API（非 chrome storage），移除 local state 後須改為 `deriveFewShotExamples(fewShotPairs)` 作為 payload——不能省略此修改，否則後端收到空字串
- 父 Settings.tsx：只保留 `testing / testResult / error / saved / importBanner / importTruncated` 6 個 state + 各 hook 的組合
- 各分區 UI 塊不需要改（props 來源從 local state 改為 hook return 值）

**Test scenarios:**
- Happy path: `useLLMSettings` mount → 呼叫 `getSettings`，state 填充 `endpoint / model / apiKey`
- Happy path: `saveLLM()` → 先讀 `getSettings()`，再 spread `{ endpoint, model, apiKey }` 後 `saveSettings`，其他欄位（如 `fewShotPairs`）不被覆蓋
- Edge case: `getSettings` 拋錯 → state 保持初始值，不崩潰
- Integration: `usePromptSettings.save()` 與 `useLLMSettings.save()` 幾乎同時呼叫 → 各自 `await getSettings()` 後 spread 自己的欄位 → 最終 `fewShotPairs` 和 `endpoint` 均正確保留（無互蓋）
- Happy path: `usePromptSettings` — `handleSaveToBackend` 傳 `deriveFewShotExamples(fewShotPairs)` 給後端 → 後端收到非空字串（當 pairs 非空時）

**Verification:**
- `wc -l packages/extension/entrypoints/sidepanel/Settings.tsx` ≤ 150
- `grep -n "fewShotExamples" packages/extension/entrypoints/sidepanel/Settings.tsx` 無命中
- `pnpm --filter publisher-fill-assistant test` 全綠

## System-Wide Impact

- **Interaction graph:** `prompt-assembly.ts` 讀 `settings.fewShotExamples`——Unit 3 在 `getSettings` 層派生後，`prompt-assembly.ts` 行為不變，無需改動
- **Error propagation:** scraper routes 搬移（Unit 4）不改錯誤處理邏輯；`app.ts` import 路徑更新後，啟動時路由相同
- **State lifecycle risks:** Settings.tsx 拆 hook 後各 hook 獨立 load，需注意初始化順序（全在 `useEffect` 中）和並發 `saveSettings` 衝突——各 hook 各自 save 對應欄位，不互相覆蓋
- **API surface parity:** 後端 `fewShotExamples` API 不變；extension API 無公開面
- **Integration coverage:** Unit 4 搬移後，`/api/v1/prompts` 所有既有測試（含 Unit 1 新增）需繼續通過
- **Unchanged invariants:** 安全閘門鏈（publish-orchestrator / grounding-gate / sanitize）不被觸碰；`useBatchOperations` hook 接口不變

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Unit 3 修改 `getSettings` 派生邏輯，影響 `prompt-assembly.ts` 輸出 | 現有 `llm.test.ts:46` 已覆蓋 `fewShotExamples` 路徑；Unit 3 後跑全測試確認 |
| Unit 7 行數目標無法達到（domain 狀態難以下沉） | 降級到 ≤ 350L（已在 Open Questions 標記），不為行數而強拆 |
| Unit 8 各 hook 並發 `saveSettings` 覆蓋彼此 | **已確認**：`saveSettings` 是全量覆寫。每個 hook 的 save handler 必須先 `await getSettings()` 取最新值再 spread，見 Unit 8 Approach |
| scraper routes 搬移（Unit 4）後 import cycle | 搬移後立即 `pnpm compile` 驗證，若有 cycle 退回並重整 import |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-06-16-maintainability-test-refactor-requirements.md](../brainstorms/2026-06-16-maintainability-test-refactor-requirements.md)
- Test patterns: `packages/backend/src/scraper/gossip-routes.test.ts`, `packages/extension/lib/auth-client.test.ts`
- Existing split pattern: `packages/extension/entrypoints/sidepanel/batch-review/`
- Institutional learning: `docs/solutions/developer-experience/extension-http-client-testability-injection-seam-2026-06-15.md`
