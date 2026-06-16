---
title: "refactor: Settings.tsx hook extraction and sub-component split"
type: refactor
status: active
date: 2026-06-16
origin: docs/brainstorms/2026-06-16-settings-refactor-requirements.md
---

# refactor: Settings.tsx hook extraction and sub-component split

## Overview

Settings.tsx（613 行、23 個 useState）承擔了過多職責：表單狀態管理、驗證、三路 storage 持久化、後端同步（loadPrompts / savePromptToBackend）、連線測試。核心邏輯無測試保護，單一維護者改動驗證規則或新增欄位時風險較高。

本次重構：
1. 提取 `validateSettingsForm` 純函式（可獨立測試）
2. 提取 `useSettingsForm` hook（狀態集中、可 mock 測試）
3. 拆出 5 個 section 子組件（降低單文件體積至 ≤ 250 行）
4. 清理可替換的 spacing inline style

**沒有新功能，沒有行為改變**（除 importFewShot 讀 hook state 的一處 bug 修正，詳見 Unit 2）。

## Problem Frame

單人維護者調整驗證邏輯或新增設定欄位時，需在一個 600+ 行的混合文件中定位，且無測試保護。現有 `Settings.test.tsx` 只覆蓋兩個純函式（`parseTagsText`、`validateMapping`）；hook 邏輯、save 路徑、importFewShot 均無測試。

（詳見 origin: docs/brainstorms/2026-06-16-settings-refactor-requirements.md）

## Requirements Trace

- R1. `useSettingsForm` hook，不含 `error`/`saved` UI 狀態（留組件）
- R2. `validateSettingsForm` 純函式，錯誤訊息不含憑證值
- R4. 5 個子組件，放 `entrypoints/sidepanel/components/`
- R5. Settings.tsx 主組件只負責組裝 + 保存按鈕 + `error`/`saved` state
- R7. useSettingsForm hook 單元測試（load / save 失敗 / save 成功 / importFewShot）
- R8. validateSettingsForm 純函式測試（≥ 5 個場景，含 edge cases）
- R9. 不寫子組件 rendering 測試
- R10. Spacing inline style → 既有 `mb-*` class；其他保留 inline

## Scope Boundaries

- **不**修改 `FewShotPairEditor`、`TodayBatchView`、`BatchReviewPanel`、`App.tsx`
- **不**修改後端、shared、content script
- **不**引入 CSS Modules；不新增 CSS utility class
- `parseTagsText` / `validateMapping` 保持在 Settings.tsx 中 export（Settings.test.tsx 無需改動）
- 只修正 importFewShot 讀 hook state 的現有 bug；`selectPrompt` 覆蓋髒欄位問題及 `save()` 無 try/catch 問題標記為 Known Issues，不在本次修

## Context & Research

### Relevant Code and Patterns

- **Hook 目錄（重要）**：`entrypoints/sidepanel/hooks/`（不是 `lib/hooks/`）；現有 6 個 hook（`useAutoSave`、`useErrorHandler`、`useLoadingState` 等）
- **Hook 測試模板**：`// @vitest-environment jsdom` + `vi.mock("../../../lib/storage", ...)` + `renderHook` + `act()` from `@testing-library/react`
- **子組件目錄**：`entrypoints/sidepanel/components/`（FewShotPairEditor.tsx 在此）
- **Storage mock 標準**：`vi.mock("../../lib/storage", () => ({ getSettings: vi.fn().mockResolvedValue({...}), ... }))`
- **CSS 工具類限制**：只有 `mb-sm/mb-md/mb-lg`；`mt-*`、`ml-*` 不存在，保留 inline style
- **Vitest 環境**：無全局設定，需 jsdom 的測試文件頂部加 `// @vitest-environment jsdom`；`WxtVitest()` plugin 自動 shim `chrome.*`
- **validateSettingsForm 測試**：純函式，不需 jsdom 也不需 mock，直接 import 測試

### Institutional Learnings

- 無相關 docs/solutions/ 條目

### Key Flow Findings（spec-flow-analyzer 輸出）

**已納入計劃的修正**：
- `derivedFewShotExamples`：hook 統一暴露推導值，`save()` 和 `savePromptToBackend()` 都用這個，消除現有的 `fewShotPairs` vs `fewShotExamples` 雙真相問題
- `importFewShot()` 空狀態防護：`fewShotExamples` 為空時 no-op，避免靜默清空 pairs
- `load()` once-guard：`loadedRef` 防止 mount 後 storage resolve 覆蓋用戶已輸入的值

**Known Issues（不在本次範圍）**：
- `selectPrompt()` 靜默覆蓋未存檔編輯（現有行為）
- `save()` 三個 storage 呼叫無 try/catch，部分寫入無 rollback（現有行為）
- `testConnection()` 測試的是 stored token 而非 in-flight token（現有行為）

## Key Technical Decisions

- **hook 放 `entrypoints/sidepanel/hooks/`**，跟隨既有目錄慣例（6 個現有 hook 都在此）
- **`apiKey` / `backendToken` 不進 `formValues`**，hook 暴露 `getApiKey()` / `getBackendToken()` getter，避免進 React DevTools 序列化路徑
- **`derivedFewShotExamples` 作為 getter**：`fewShotPairs.length > 0` 時用 `deriveFewShotExamples(fewShotPairs)`，否則 fallback 到 `fewShotExamples` raw text；`save()` 和 `savePromptToBackend()` 都讀此 getter
- **Prompt 相關狀態（`prompts`、`selectedPromptId`、`promptStatus`）進 hook**，但 loading/error 狀態各 Section 自管 local state，hook 不持有 async 進度狀態
- **LLMSection 折疊面板**：ephemeral local state（`fallbackOpen`），不進 hook，每次開啟 sidepanel 重置
- **save() 直接持有三個 storage 呼叫**，不抽 facade（決策來自 brainstorm）
- **`importFewShot()` 改讀 hook state**（修正現有 bug：原版再讀 storage，在用戶改欄位後 import 會丟失未存改動）

## Open Questions

### Resolved During Planning

- **Hook 目錄應用哪個**：`entrypoints/sidepanel/hooks/`（非 `lib/hooks/`），依據現有 6 個 hook 的位置
- **`mb-*` 以外的 spacing 能否替換**：不能，`mt-*`/`ml-*` 不存在；inline style 保留
- **折疊面板展開狀態**：ephemeral local state in LLMSection，不持久化
- **Async loading state 由誰管**：各 Section 自管 local state，hook 只持有資料（`prompts`、`selectedPromptId`、`promptStatus`）

### Deferred to Implementation

- CSS utility class 的確切覆蓋範圍：實作者應在開始 R10 前掃描 CSS 文件確認哪些 `marginBottom` 有對應 class
- `validateSettingsForm` 的精確 TypeScript 參數型別：從現有欄位型別推導

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
Settings.tsx（≤ 250 行）
  ├── useSettingsForm()           ← 所有表單狀態 + handlers
  │     ├── formValues: SettingsFormValues   ← 不含 apiKey/backendToken
  │     ├── getApiKey() / getBackendToken()  ← 獨立 getter
  │     ├── derivedFewShotExamples           ← getter，供 save + savePromptToBackend 用
  │     ├── prompts / selectedPromptId / promptStatus
  │     ├── load()           → 初始化（once-guard）
  │     ├── save()           → validate + 三路 storage（回傳 string|null）
  │     ├── importFewShot()  → 讀 hook state，空則 no-op
  │     ├── loadPrompts()    → 後端 fetch
  │     ├── selectPrompt(id) → 更新 promptTemplate + fewShotExamples
  │     ├── savePromptToBackend() → 用 derivedFewShotExamples
  │     └── testConnection() → 用 getBackendToken()
  │
  ├── error: string | null    ← Settings.tsx local state（save() 回傳值）
  ├── saved: boolean           ← Settings.tsx local state
  │
  ├── <LLMSection />          ← endpoint/model/apiKey/fallback（折疊 local state）
  ├── <BackendSection />      ← backendUrl/token/test/dailyBatchSize
  ├── <PromptSection />       ← template/fewshot/prompts 管理（FewShotPairEditor 在此層）
  ├── <TagsSection />         ← tags + reviewCriteria
  └── <FieldMappingSection /> ← mappingText JSON 編輯器

validateSettingsForm(values)   ← 純函式，獨立 export，Settings.tsx 中呼叫
```

## Implementation Units

- [ ] **Unit 1: validateSettingsForm 純函式 + 測試**

**Goal:** 將 handleSave 的三段驗證邏輯抽成可獨立測試的純函式

**Requirements:** R2, R8

**Dependencies:** 無

**Files:**
- Modify: `packages/extension/entrypoints/sidepanel/Settings.tsx`（新增 export function `validateSettingsForm`，原有驗證邏輯留作呼叫點）
- Create: `packages/extension/entrypoints/sidepanel/Settings.validateSettingsForm.test.ts`

**Approach:**
- 抽取三條規則：(1) endpoint 非空但非 `https://`；(2) mappingText 非合法 JSON 或結構不符 `isValidFieldMapping`；(3) backendUrl 非空但非 `localhost`/`127.0.0.1`
- 合法 JSON 解析後重用已有的 `validateMapping(text)` 輔助（現有 export）
- 錯誤訊息為靜態中文文案，不插入 apiKey / backendToken 的值
- `handleSave` 改為呼叫 `validateSettingsForm(values)` 而非行內三段 if

**Patterns to follow:**
- `packages/extension/entrypoints/sidepanel/Settings.tsx` 現有 `validateMapping` export
- `packages/extension/entrypoints/sidepanel/Settings.test.tsx` 現有測試結構

**Test scenarios:**
- Happy path：endpoint `""`、mappingText 合法 JSON（isValidFieldMapping pass）、backendUrl `""` → 回傳 null
- Happy path：endpoint `"https://api.example.com"`、backendUrl `"http://localhost:3001"` → 回傳 null
- Happy path：backendUrl `"http://127.0.0.1:3001"` → 回傳 null（確認兩種合法 localhost 格式）
- Error path：endpoint `"http://example.com"`（非 https）→ 回傳含 "https" 的字串
- Error path：mappingText `"not json"` → 回傳含 JSON 提示的字串
- Error path：mappingText `"{}"` 合法 JSON 但 `isValidFieldMapping` 返 false → 回傳錯誤
- Error path：backendUrl `"https://remote.server.com"` → 回傳含 localhost 提示的字串
- Edge case：endpoint 非法 且 backendUrl 非法 → 回傳第一條錯誤（驗證規則優先順序：endpoint → mapping → backendUrl）
- Edge case：mappingText `""` → 回傳 null（空值跳過 JSON 驗證，與空 endpoint 一致；DEFAULT_SETTINGS 確保正常 load 後不為空，空字串只在異常路徑出現）

**Verification:**
- `npx vitest run Settings.validateSettingsForm.test.ts` 全綠
- `pnpm compile`（extension 包）無型別錯誤

---

- [ ] **Unit 2: useSettingsForm hook — 狀態、load、save、importFewShot + 測試**

**Goal:** 把 23 個表單 useState（不含 error/saved）集中到 hook；實作 load/save/importFewShot

**Requirements:** R1, R7

**Dependencies:** Unit 1（validateSettingsForm 已存在，save() 呼叫它）

**Files:**
- Create: `packages/extension/entrypoints/sidepanel/hooks/useSettingsForm.ts`
- Create: `packages/extension/entrypoints/sidepanel/hooks/useSettingsForm.test.ts`

**Approach:**
- Hook 對外 API：
  - `formValues: SettingsFormValues`（含 endpoint、model、promptTemplate、fewShotExamples、fewShotPairs、tagsText、mappingText、fallbackModel、backendUrl、reviewCriteriaPrompt、dailyBatchSize、importBanner、importTruncated）
  - `getApiKey()` / `getBackendToken()`：讀 apiKey / backendToken state（不進 formValues）
  - `derivedFewShotExamples`：`fewShotPairs.length > 0` 時 `deriveFewShotExamples(fewShotPairs)` else `fewShotExamples`
  - `load()`：`Promise.all([getSettings, getApiKey, getBackendToken])` → batch setState；用 `loadedRef` once-guard，resolve 前若已 load 則跳過
  - `save()`：呼叫 `validateSettingsForm`，驗證失敗直接回傳 string；驗證通過 → `saveSettings({ ...existing, ...formValues, fewShotExamples: derivedFewShotExamples })` → `saveApiKey` → `saveBackendToken`；回傳 null
  - `importFewShot()`：`fewShotExamples === ""` 時 no-op；否則解析 raw text，截取至 MAX_PAIRS，更新 `fewShotPairs`，清空 `importBanner`
  - `setFormValue(key, value)`：通用 setter，供子組件各欄位呼叫
- `fewShotPairs` 有 setter：`setFewShotPairs(pairs)`
- `importBanner` 在 `fewShotExamples` 非空 且 `fewShotPairs.length === 0` 時，load 後設為 `"偵測到舊格式 few-shot 範例，點擊「匯入」可轉換為新格式"`

**Patterns to follow:**
- `entrypoints/sidepanel/hooks/useAutoSave.ts`（hook 結構）
- `entrypoints/sidepanel/hooks/useErrorHandler.ts`（狀態封裝模式）
- 測試：`useAutoSave.test.ts`（vi.mock + renderHook + act 模式）

**Test scenarios:**
- Happy path：`renderHook → act(load)` → `formValues.endpoint` 等於 storage mock 回傳值
- Happy path：`load()` 呼叫 `getSettings` + `getApiKey` + `getBackendToken` 各一次
- Happy path：load 後 `fewShotExamples` 非空且 `fewShotPairs` 為空 → `importBanner` 為提示文案（非空字串）；反之（fewShotPairs 有值）→ `importBanner` 為 `""`
- Happy path：`save()` 驗證通過 → `saveSettings`/`saveApiKey`/`saveBackendToken` 各被呼叫一次，回傳 null
- Happy path：`save()` 驗證通過且 `fewShotPairs` 非空 → `saveSettings` 收到的 `fewShotExamples` 參數值等於 `deriveFewShotExamples(fewShotPairs)` 的結果（驗證雙真相修正）
- Error path：`save()` endpoint 不合法 → `saveSettings` **不**被呼叫，回傳非 null 字串
- Happy path：`importFewShot()` fewShotExamples 有兩條（`"input\n---\noutput\n\ninput2\n---\noutput2"`）→ `fewShotPairs` 更新為 2 條
- Edge case：`importFewShot()` fewShotExamples `""` → `fewShotPairs` 不改變（no-op）
- Edge case：`importFewShot()` 超過 MAX_PAIRS（8）條 → 截斷至 8 條，`importTruncated` 更新為含條數的字串
- Edge case：`load()` 呼叫兩次後，第二次 `getSettings` 不被呼叫（once-guard）；且呼叫 `load()` 前用戶已 `setFormValue("endpoint", "user-input")`，`load()` 後 `endpoint` 仍為 `"user-input"`（once-guard 的核心目的）
- Happy path：`derivedFewShotExamples` — fewShotPairs 非空時回傳 `deriveFewShotExamples(pairs)` 結果；pairs 為 `[]` 時回傳 `fewShotExamples` raw text

**Verification:**
- `npx vitest run hooks/useSettingsForm.test.ts` 全綠
- `pnpm compile`（extension 包）無型別錯誤

---

- [ ] **Unit 3: useSettingsForm hook — Prompt 管理 + testConnection**

**Goal:** 完成 hook 的後端同步部分（loadPrompts、selectPrompt、savePromptToBackend）和 testConnection

**Requirements:** R1, R7

**Dependencies:** Unit 2

**Files:**
- Modify: `packages/extension/entrypoints/sidepanel/hooks/useSettingsForm.ts`
- Modify: `packages/extension/entrypoints/sidepanel/hooks/useSettingsForm.test.ts`

**Approach:**
- Hook 新增狀態：`prompts: PromptTemplate[]`、`selectedPromptId: string`、`promptStatus: string`（這三個進 hook；loading/error 各 Section 自管 local state，不進 hook）
- `loadPrompts()`：呼叫 `fetchPrompts()`，更新 `prompts` 和 `promptStatus`（成功/失敗訊息）
- `selectPrompt(id)`：在 `prompts` 中找到模板，更新 `promptTemplate` 和 `fewShotExamples`；清空 `selectedPromptId` 當用戶手動改 `promptTemplate` 時的邏輯留 deferred
- `savePromptToBackend(name)`：用 `derivedFewShotExamples`（非 raw `fewShotExamples`）呼叫 `createPrompt`，更新 `promptStatus`；呼叫 `loadPrompts()` 刷新清單
- `testConnection()`：呼叫 `testConnection()` from `connection-test`（使用 `getBackendToken()` getter），回傳 `ConnectionTestResult`
- mock：`vi.mock("../../lib/prompt-client", ...)` 和 `vi.mock("../../lib/connection-test", ...)`

**Patterns to follow:**
- `packages/extension/lib/prompt-client.ts`（fetchPrompts / createPrompt API）
- `packages/extension/lib/connection-test.ts`（testConnection API）

**Test scenarios:**
- Happy path：`loadPrompts()` 後 `prompts` 有值，`promptStatus` 含 "已加載"
- Error path：`loadPrompts()` fetch 失敗 → `promptStatus` 含 "失敗"
- Happy path：`selectPrompt(id)` — id 存在於 `prompts` → `promptTemplate` 和 `fewShotExamples` 更新為對應模板的值
- Edge case：`selectPrompt(id)` — id 不在 `prompts` 中 → `promptTemplate` 和 `fewShotExamples` **不改變**（no-op，防幻覺靜默覆蓋）
- Happy path：`savePromptToBackend("名稱")` → `createPrompt` 被呼叫，參數含 `derivedFewShotExamples` 的值（非 stale raw text）；且 `loadPrompts()` 自動被觸發以刷新清單（驗證 `fetchPrompts` mock 在 savePromptToBackend 後也被呼叫一次）
- Happy path：`testConnection()` 成功 → 回傳 `{ status: "ok", ... }`；且 `connection-test` 模組收到的 token 參數等於 `getBackendToken()` getter 的回傳值（非 `formValues` 中的任何欄位）

**Verification:**
- `npx vitest run hooks/useSettingsForm.test.ts` 全綠（加上 Unit 2 的既有 cases）
- `pnpm compile` 無型別錯誤

---

- [ ] **Unit 4: 5 個 Section 子組件**

**Goal:** 把 Settings.tsx 的 6 個 card 拆成 5 個無副作用展示子組件

**Requirements:** R4

**Dependencies:** Unit 2、Unit 3（hook 介面已定）

**Files:**
- Create: `packages/extension/entrypoints/sidepanel/components/LLMSection.tsx`
- Create: `packages/extension/entrypoints/sidepanel/components/BackendSection.tsx`
- Create: `packages/extension/entrypoints/sidepanel/components/PromptSection.tsx`
- Create: `packages/extension/entrypoints/sidepanel/components/TagsSection.tsx`
- Create: `packages/extension/entrypoints/sidepanel/components/FieldMappingSection.tsx`

**Approach:**
- 每個子組件只接收自身所需的 props（欄位值 + 對應 setter/handler），不接收整個 hook return object
- **LLMSection**：接收 endpoint、model（setter）、getApiKey（getter）、setApiKey、fallbackModel、setFallbackModel；`fallbackOpen` 為 LLMSection local state（ephemeral）；apiKey input `type="password" autoComplete="off"`
- **BackendSection**：接收 backendUrl、backendToken（setter）、getBackendToken（getter）、dailyBatchSize（setter）、onTestConnection；loading/error 為 BackendSection local state；backendToken input `type="password" autoComplete="off"`；成功訊息 `"連線成功"`，失敗訊息 `"連線失敗，請確認 URL 和 Token"`（靜態文案，不含憑證值）
- **PromptSection**：接收 promptTemplate（setter）、fewShotExamples（setter）、fewShotPairs（setter）、importBanner、importTruncated、onImportFewShot、prompts、selectedPromptId、onLoadPrompts、onSelectPrompt、onSavePromptToBackend；loading/status 顯示 `promptStatus` prop；FewShotPairEditor 在此層呼叫
- **TagsSection**：接收 tagsText（setter）、reviewCriteriaPrompt（setter）
- **FieldMappingSection**：接收 mappingText（setter）、onResetMapping（setter 的便捷包裝）

**Patterns to follow:**
- `entrypoints/sidepanel/components/FewShotPairEditor.tsx`（同目錄、props 介面風格）
- 現有 Settings.tsx 中各 card 的 JSX 結構（直接搬移，CSS class 不變）

**Test expectation: none** — 依 R9 決策，子組件不寫 rendering 測試；行為邏輯由 hook 測試覆蓋

**Verification:**
- `pnpm compile`（extension 包）無型別錯誤
- 目視確認 5 個文件在 `components/` 目錄下

---

- [ ] **Unit 5: Settings.tsx 重組 + inline style 清理**

**Goal:** 把 Settings.tsx 縮減至 ≤ 250 行，wire hook + 子組件，清理可替換的 spacing inline style

**Requirements:** R5, R9, R10

**Dependencies:** Unit 1–4

**Files:**
- Modify: `packages/extension/entrypoints/sidepanel/Settings.tsx`
- Reference: `packages/extension/entrypoints/sidepanel/Settings.test.tsx`（確認 import 路徑未受影響）

**Approach:**
- 主組件保留：`parseTagsText` / `validateMapping` export（Settings.test.tsx 的 import 路徑不動）
- 主組件保留：`error` / `saved` 兩個 useState
- 呼叫 `useSettingsForm()` 取出所有值/handler
- `useEffect` 改為只呼叫 `hook.load()`
- `handleSave` 改為 `const err = await hook.save(); if (err) setError(err); else setSaved(true)`
- 依序渲染 5 個子組件，各傳入所需 props
- Inline style 清理：把 `style={{ marginBottom: "var(--space-*)" }}` 改為 `className="mb-sm/md/lg"`；`marginTop`、`marginLeft`、`minHeight`、`fontFamily` 等保留 inline（`mt-*`/`ml-*` 不存在）

**Patterns to follow:**
- `entrypoints/sidepanel/hooks/useAutoSave.ts`（hook 使用模式）
- 現有 Settings.tsx 的 JSX card 佈局

**Test expectation: none** — Settings.tsx 改為組裝層，無業務邏輯；現有 Settings.test.tsx 測試的純函式仍 export，test suite 保持原樣通過

**Verification:**
- `pnpm test`（extension 包）全綠（Settings.test.tsx 仍通過；useSettingsForm.test.ts 全通過）
- `Settings.tsx` 行數 ≤ 250
- `pnpm compile` 全綠
- `pnpm lint:ci` 零錯誤

## System-Wide Impact

- **Interaction graph:** Settings.tsx 的三個消費者（App.tsx `<Settings onClose />` 呼叫、`lib/storage.ts`、`lib/connection-test.ts`、`lib/prompt-client.ts`）介面不變；FewShotPairEditor 的 props 介面不變
- **Error propagation:** `save()` 驗證錯誤從 hook 回傳到 Settings.tsx → 顯示在 `error` state；storage 呼叫無 try/catch（現有行為，Known Issue）
- **State lifecycle risks:** `load()` once-guard 防止 mount race；`importFewShot()` 空狀態防護防止靜默清空 pairs
- **API surface parity:** `parseTagsText` / `validateMapping` 保持 export，Settings.test.tsx 無需改動
- **Unchanged invariants:** FewShotPairEditor props (`pairs`, `onChange`, `importBanner`, `onImport`)；hook 介面對 App.tsx 透明（App.tsx 只呼叫 `<Settings onClose />`）

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `derivedFewShotExamples` 邏輯與 handleSave 現有推導不一致 | Unit 2 直接複製 `deriveFewShotExamples(pairs)` 邏輯，加測試覆蓋推導行為 |
| 子組件 props 型別不完整導致 TypeScript 錯誤 | Unit 4 後立即跑 `pnpm compile`，在 Unit 5 之前確認無型別錯誤 |
| `mb-*` 以外 class 不存在導致視覺回歸 | Unit 5 只替換 `marginBottom`，其餘 spacing 保留 inline style |
| `Settings.test.tsx` import 路徑斷掉 | `parseTagsText` / `validateMapping` 保留在 Settings.tsx 不移動 |
| importFewShot once-guard 測試的 mock 設置 | 參考 useAutoSave.test.ts 的 `renderHook + act()` 模式 |

## Known Issues（不在本次範圍）

- `selectPrompt()` 靜默覆蓋未存檔的 `promptTemplate` / `fewShotExamples` 編輯（現有行為）
- `save()` 三個 storage 呼叫無 try/catch：`saveApiKey` 失敗後 `saveBackendToken` 不執行，storage 部分寫入無 rollback（現有行為）
- `testConnection()` 測試的是 **stored** token 而非 in-flight 的 `backendToken` 欄位值（現有行為）

## Sources & References

- **Origin document:** [docs/brainstorms/2026-06-16-settings-refactor-requirements.md](../brainstorms/2026-06-16-settings-refactor-requirements.md)
- Settings.tsx source: `packages/extension/entrypoints/sidepanel/Settings.tsx`
- Hook examples: `packages/extension/entrypoints/sidepanel/hooks/useAutoSave.ts`
- Storage API: `packages/extension/lib/storage.ts`
- Prompt client: `packages/extension/lib/prompt-client.ts`
- Connection test: `packages/extension/lib/connection-test.ts`
