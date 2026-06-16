---
title: "refactor: Eliminate fewShotExamples dual-truth"
type: refactor
status: completed
date: 2026-06-16
origin: docs/brainstorms/2026-06-16-fewshot-dedup-requirements.md
---

# refactor: Eliminate fewShotExamples dual-truth

## Overview

`fewShotExamples`（string）與 `fewShotPairs`（FewShotPair[]）在儲存層、表單層、UI 層、後端 prompt-store 四處並存，造成雙真相。此重構將整個棧統一到 `fewShotPairs` 為唯一儲存格式，移除舊 string 字段及其衍生邏輯，同時移除 Settings UI 中冗餘的 textarea 編輯面（改用已存在的 FewShotPairEditor 結構化組件）。

## Problem Frame

首飛前無真實用戶資料，是清理的最佳視窗。維護者改動 fewShot 相關邏輯時需同時追蹤兩個 state，下游邏輯（prompt-assembly、測試）難以推理。（see origin: docs/brainstorms/2026-06-16-fewshot-dedup-requirements.md）

## Requirements Trace

- R0. `prompt-assembly.ts` 改讀 `deriveFewShotExamples(settings.fewShotPairs ?? [])`（先行，避免 R9 後 compile 中斷）
- R1–R3. PromptSection 移除 textarea prop；Settings.tsx 移除對應 props；刪除死碼 PromptCard / PromptManagementCard
- R4–R7b. `useSettingsForm` 移除 `fewShotExamples` 欄位、textarea→pairs useEffect、舊解析邏輯；`selectPrompt` 改讀 pairs；`savePromptToBackend` 改送 pairs
- R8. `storage.ts` `getSettings()` 移除 fewShotExamples 派生邏輯
- R9–R10. 從 `shared/src/types.ts` Settings 移除 `fewShotExamples`；重建 shared
- R11–R14. 後端 `prompt-store.ts` / `schemas.ts` / `prompt-routes.ts` 改為 fewShotPairs；lazy-on-read 遷移
- R15–R16. 更新所有受影響的測試文件

## Scope Boundaries

- `deriveFewShotExamples()` 保留（LLM prompt 組裝用）
- `FewShotPairEditor.tsx` 及其測試不動
- chrome.storage 遷移安全網不加（首飛前 YAGNI）（see origin）
- 後端遷移不做 API 版本化，直接切換（see origin）

## Context & Research

### Relevant Code and Patterns

**雙真相的四個觸點：**

| 層 | 文件 | 問題行 |
|---|---|---|
| 儲存層 | `packages/extension/lib/storage.ts` | `getSettings()` lines 86-92（派生邏輯）|
| 表單層 | `packages/extension/entrypoints/sidepanel/hooks/useSettingsForm.ts` | lines 27, 107, 115, 128-131, 150-152, 159, 174-195, 215 |
| UI 層 | `packages/extension/entrypoints/sidepanel/components/PromptSection.tsx` | lines 91, 109, 114-117（textarea 區塊）|
| HTTP 客戶端 | `packages/extension/lib/prompt-client.ts` | lines 11, 42, 72（local `PromptTemplate` interface + `createPrompt`/`updatePrompt` 參數）|
| 後端 | `packages/backend/src/scraper/prompt-store.ts` | `PromptTemplate.fewShotExamples: string` |

**關鍵算法——parse string → FewShotPair[]（useSettingsForm.ts lines 178-184）：**
```
split by /\n\n+/
for each block:
  find \n---\n separator
  if found: { input: before, output: after }
  else:     { input: "", output: block }
```
此為 `parseFewShotExamples()` 的實作算法，需在 Unit 1 提取為純函數。

**序列化算法——FewShotPair[] → string（storage.ts）：**
```typescript
deriveFewShotExamples(pairs) = pairs.map(p => `${p.input}\n---\n${p.output}`).join("\n\n")
```

**`derivedFewShotExamples` 在 hook 中的計算（lines 128-131）：**
```
if fewShotPairs.length > 0 → deriveFewShotExamples(pairs)
else → formValues.fewShotExamples   ← 此 fallback 刪除後簡化為只讀 pairs
```

**`importFewShot` 暴露鏈：**
`useSettingsForm.ts:273` → `Settings.tsx:150` (`onImportFewShot`) → `PromptSection` — 移除 textarea 後整鏈刪除。

**`selectPrompt` 回填路徑（lines 214-219）：**
```
setFormValues({...prev, fewShotExamples: tpl.fewShotExamples})
改為:
setFormValues({...prev, fewShotPairs: tpl.fewShotPairs ?? parseFewShotExamples(tpl.fewShotExamples ?? "")})
```
Lazy fallback 保留，確保在 Unit 7（後端）之前執行 Unit 5（表單）時仍能正確加載舊格式樣板。

**後端 Prompt 類型（prompt-store.ts）：**
- `PromptTemplate.fewShotExamples: string` → `fewShotPairs: FewShotPair[]`
- `PromptTemplateCreate.fewShotExamples: string` → `fewShotPairs: FewShotPair[]`
- `PromptTemplateUpdate.fewShotExamples?: string` → `fewShotPairs?: FewShotPair[]`

**測試文件中需更新的引用（非 test 文件已確認有 fewShotExamples）：**
- `storage.test.ts`, `prompt-assembly.test.ts`, `prompt-client.test.ts`, `llm.test.ts`
- `Settings.component.test.tsx`
- `hooks/useSettingsForm.test.ts`（含 `importFewShot` 測試 3 條，需刪除或改寫）
- `prompt-routes.test.ts`

### Institutional Learnings

- 後端測試模式：`src/test-setup.ts` 指向臨時目錄，JsonFileStore 讀 `PUBLISHER_DATA_DIR`，測試不碰真實 data/（見 CLAUDE.md）
- shared 包必須先 build 才能對 backend/extension 做類型檢查（build 順序：shared → backend/extension）

## Key Technical Decisions

- **`parseFewShotExamples` 放在 `storage.ts`**（而非 shared）：算法是 extension-specific 格式約定；放 shared 會增加 shared 包的職責，且後端 lazy-on-read 可從 extension-lib 獨立實現相同算法（少量複製比錯誤抽象好）（see origin: lazy-on-read 決定）
- **後端 lazy-on-read 算法獨立實作**：`prompt-store.ts` 內嵌相同 parse 邏輯（~5 行），避免 backend 依賴 extension lib
- **不用 `parseFewShotExamples` 重構 `importFewShot`，直接刪除**：`importFewShot` 的唯一用途是解析 textarea 字串；textarea 刪除後函數無存在意義，連同 `onImportFewShot` prop 一起移除
- **`derivedFewShotExamples` 保留在 hook 返回值**：下游可能仍需字串格式（`buildPrompt` 的呼叫者），但其計算簡化為 `deriveFewShotExamples(formValues.fewShotPairs)`（移除 `formValues.fewShotExamples` fallback）
- **`importBanner`/`importTruncated` 整鏈移除**：兩個欄位僅由 `importFewShot` 寫入；移除 `importFewShot` 後，它們在 FormValues、PromptSection props、Settings.tsx 傳遞、PromptSection 條件渲染中變成永遠空字串的死路——整條鏈（FormValues 欄位 + PromptSection props + 條件渲染 + Settings.tsx 傳遞）一起移除，不保留空字串殘骸
- **`prompt-client.ts` 在 Unit 5 前更新**：`prompt-client.ts` 定義了 extension 側的 `PromptTemplate` interface 及 `createPrompt`/`updatePrompt` 的 data 參數型別，均含 `fewShotExamples: string`。此更新必須在 Unit 5 的 `savePromptToBackend` 之前完成，否則 tsc 在 Unit 5 後立即報錯
- **lazy-on-read 觸發條件含空陣列**：條件改為 `(!raw.fewShotPairs || raw.fewShotPairs.length === 0) && raw.fewShotExamples`，防止「部分遷移後 fewShotPairs 為空陣列但 fewShotExamples 有值」的靜默資料丟失
- **lazy-on-read 實作位置**：在 `prompt-store.ts` 建立包裝函數（`getAllPrompts()`、`getPromptById(id)`），在包裝層對 `JsonFileStore` 返回結果做 map 遷移，不修改 `JsonFileStore` 共用基礎設施
- **`selectPrompt` 的 `tpl.fewShotExamples` 在 Unit 7 後清理**：Unit 5 的 lazy fallback `tpl.fewShotPairs ?? parseFewShotExamples(tpl.fewShotExamples ?? "")` 在 Unit 7 完成後，`PromptTemplate.fewShotExamples` 從後端類型消失，tsc 會強制報錯；Unit 7 需同步清除此讀取（fallback 改為 `tpl.fewShotPairs ?? []`）

## Open Questions

### Resolved During Planning

- **`messaging.ts:269` `buildPrompt(fewShot?: string)` 的呼叫點**：確認在 `prompt-assembly.ts` 中傳入 `settings.fewShotExamples`；R0（Unit 2）改傳 `deriveFewShotExamples(settings.fewShotPairs ?? [])`；`buildPrompt` 函數簽名不動（仍接受 string）
- **後端 lazy-on-read vs startup scan**：選 lazy-on-read，避免 scheduler 啟動時序問題（see origin）
- **`parseFewShotExamples` 是否已存在**：不存在；算法在 `importFewShot` 中，Unit 1 提取

### Deferred to Implementation

- **`importBanner` / `importTruncated` 欄位在 FormValues 中的命運**：確認 `importBanner`、`importTruncated` 是否只被 `importFewShot` useEffect 讀寫；若是，則一同刪除；若有其他讀取點，保留並在 Unit 5 清理

## High-Level Technical Design

> *以下說明各層改動的方向，供審查驗證，不是實作規格。*

```
執行順序（有依賴的必須序列）：

Unit 1  parseFewShotExamples ─────────────────────────────┐
  ↓                                                         │
Unit 2  prompt-assembly / messaging fix (R0, R7c)           │
  ↓                                                         │
Unit 3  shared types remove + rebuild (R9, R10)             │
  ↓                           ↓                             │
Unit 4  storage cleanup     Unit 7  backend migration ←─────┘
  ↓
Unit 5  form layer cleanup (includes selectPrompt, savePromptToBackend)
  ↓
Unit 6  UI layer cleanup + dead code delete
  ↓
Unit 8  test suite updates (all files)
```

**變更後的資料流：**
```
使用者 → FewShotPairEditor → fewShotPairs[] → saveSettings()
                                    ↓
                         deriveFewShotExamples()
                                    ↓
                           buildPrompt(fewShot: string)
                                    ↓
                               LLM API
```

## Implementation Units

- [ ] **Unit 1: 提取 `parseFewShotExamples` 純函數**

**Goal:** 建立 string→FewShotPair[] 的可複用純函數，作為 Unit 5（selectPrompt fallback）和 Unit 7（後端 lazy-on-read）的基礎。

**Requirements:** R14（依賴此算法）

**Dependencies:** None（第一步）

**Files:**
- Modify: `packages/extension/lib/storage.ts`
- Test: `packages/extension/lib/storage.test.ts`

**Approach:**
- 從 `useSettingsForm.ts` 的 `importFewShot` callback（lines 178-184）提取算法
- 命名：`export function parseFewShotExamples(raw: string): FewShotPair[]`
- 加在 `deriveFewShotExamples` 旁邊（兩個函數互為逆操作）
- 不加截斷邏輯（MAX_PAIRS 是 UI concern，純函數不帶 side constraint）

**Patterns to follow:**
- `deriveFewShotExamples(pairs)` 在 `storage.ts` lines 318-320 的純函數模式

**Test scenarios:**
- Happy path: `"A\n---\nB"` → `[{input: "A", output: "B"}]`
- Happy path: 兩個 block 以 `\n\n` 分隔 → 兩個 pair
- Edge case: 無 `\n---\n` 分隔符的 block → `{input: "", output: block}`
- Edge case: 空字串 `""` → `[]`
- Edge case: 只有空白行 → `[]`（filter(Boolean) 行為）

**Verification:**
- `pnpm --filter publisher-fill-assistant test` 全綠，新函數有對應測試通過

---

- [ ] **Unit 2: 修正 `prompt-assembly.ts` 及確認 `messaging.ts`（R0, R7c）**

**Goal:** 在移除 `fewShotExamples` 類型欄位之前，先讓所有讀取 `settings.fewShotExamples` 的下游呼叫點改讀 pairs，確保 Unit 3 執行後 compile 不中斷。

**Requirements:** R0, R7c

**Dependencies:** Unit 1（`parseFewShotExamples` 存在，但此 Unit 只需 `deriveFewShotExamples`，Unit 1 可並行）

**Files:**
- Modify: `packages/extension/lib/prompt-assembly.ts`（line 30）
- Verify（不改）: `packages/extension/lib/messaging.ts`（`buildPrompt` 簽名保持 `fewShot?: string`，僅呼叫點 prompt-assembly 改）

**Approach:**
- `prompt-assembly.ts:30`：`settings.fewShotExamples` → `deriveFewShotExamples(settings.fewShotPairs ?? [])`
- `messaging.ts:buildPrompt` 不動（接受 string，由呼叫者 prompt-assembly 傳入派生值）
- 確認無其他文件直接讀取 `settings.fewShotExamples`（`grep -rn "settings\.fewShotExamples"` 應只命中 prompt-assembly）

**Patterns to follow:**
- `deriveFewShotExamples` 已在 `storage.ts` 導出；prompt-assembly 已有 import

**Test scenarios:**
- Happy path: `assemblePrompt(settings, topic)` 中 `settings.fewShotPairs = [{input:"Q", output:"A"}]` → buildPrompt 收到 `"Q\n---\nA"`
- Happy path: `settings.fewShotPairs = []` → buildPrompt 收到 `""`（空字串）

**Verification:**
- `pnpm -r compile` 全綠（此時 `fewShotExamples` 尚未從類型移除，只是不讀取它）
- `pnpm test` 全綠

---

- [ ] **Unit 3: 從 shared 類型移除 `fewShotExamples` + 重建**

**Goal:** 讓 TypeScript 類型系統強制執行「Settings 不含 fewShotExamples」的約束，後續改動中 tsc 能即時報錯殘留引用。

**Requirements:** R9, R10

**Dependencies:** Unit 2（所有讀取 `settings.fewShotExamples` 的呼叫點必須先清除）

**Files:**
- Modify: `packages/shared/src/types.ts`（移除 `fewShotExamples?: string` at line 102）
- Auto-updated: `packages/shared/dist/types.d.ts`（build 後自動產生）

**Approach:**
- 移除 `Settings` interface 的 `fewShotExamples?: string` 欄位
- 移除相關 JSDoc 注釋（line 103 的 `/** 结构化 few-shot 范例列表(R11-R13);... */`）
- 保留 `fewShotPairs?: FewShotPair[]`
- `pnpm --filter @51publisher/shared build`
- 確認 `dist/types.d.ts` 同步

**Test scenarios:**
- Test expectation: none — 這是純類型刪除，無行為變更；compile 正確性由後續 units 的 `pnpm -r compile` 驗證

**Verification:**
- `pnpm --filter @51publisher/shared build` 成功
- `pnpm -r compile` 此時應出現 tsc 錯誤（告知還有哪些文件讀取 `fewShotExamples`）— 這些錯誤是後續 Units 的工作單；記錄下來確認與計劃文件吻合

---

- [ ] **Unit 4: Extension 儲存層清理（R8）**

**Goal:** 移除 `getSettings()` 中 `fewShotExamples` 的派生邏輯，讓 storage 只返回 `fewShotPairs`。

**Requirements:** R8

**Dependencies:** Unit 3（Settings 類型已移除 `fewShotExamples`，tsc 強制確認）

**Files:**
- Modify: `packages/extension/lib/storage.ts`（lines 86-92）
- Test: `packages/extension/lib/storage.test.ts`

**Approach:**
- 刪除 `getSettings()` 中的 if/else 塊（lines 86-92）
- `DEFAULT_SETTINGS` 無 `fewShotExamples`（已確認），不需另改
- `saveSettings()` 不動（傳入 Settings 對象，Settings 類型已無 fewShotExamples，自然不寫入）

**Patterns to follow:**
- `clampDailyBatchSize` 在同函數中的處理模式（只做值後處理，不派生新欄位）

**Test scenarios:**
- Happy path: `getSettings()` 在 stored 含 `fewShotPairs: [{input:"I", output:"O"}]` 時 → 返回的 Settings 含 `fewShotPairs`，不含 `fewShotExamples`
- Edge case: stored 含舊格式 `fewShotExamples: "raw"` 但無 `fewShotPairs` → 不做遷移，直接忽略（Settings 類型無此欄位，被 spread 忽略）。**理由**：首飛前無真實存量用戶資料（見 Scope Boundaries），維護者本機若有舊測試資料，清除 extension storage 即可；加入遷移邏輯屬 YAGNI。與 Unit 7 後端 lazy-on-read 的不對等是刻意決定：後端 JSON 文件由 scraper 管線生成，有更長的存活週期，遷移有防護必要；chrome.storage 只在開發測試時手動填入，不存在真實存量。
- Edge case: stored 為空 → 返回 `DEFAULT_SETTINGS`（含空 `fewShotPairs`）

**Verification:**
- `pnpm --filter publisher-fill-assistant test` 全綠
- `storage.test.ts` 中凡引用 `fewShotExamples` 的測試已全部更新或移除

---

- [ ] **Unit 4b: 更新 `prompt-client.ts`（extension 側 HTTP 客戶端）**

**Goal:** 更新 extension 側對後端 prompt API 的類型定義，確保 `savePromptToBackend`（Unit 5）呼叫 `createPrompt({ fewShotPairs })` 時 tsc 不報錯。

**Requirements:** R7b（savePromptToBackend 改送 pairs）

**Dependencies:** Unit 3（shared FewShotPair 類型），Unit 4（storage 類型已清理）

**Files:**
- Modify: `packages/extension/lib/prompt-client.ts`（lines 11, 42, 72）
- Test: `packages/extension/lib/prompt-client.test.ts`

**Approach:**
- `PromptTemplate` interface（line 11）: `fewShotExamples: string` → `fewShotPairs: FewShotPair[]`（導入 FewShotPair from `@51publisher/shared`）
- `createPrompt` data 參數（line 42）: `fewShotExamples: string` → `fewShotPairs: FewShotPair[]`
- `updatePrompt` data 參數（line 72）: `fewShotExamples?: string` → `fewShotPairs?: FewShotPair[]`

**Patterns to follow:**
- 其他 client 模組（gossip-client.ts、pending-client.ts）使用 shared 類型的 import 模式

**Test scenarios:**
- Happy path: `createPrompt({name, template, fewShotPairs: [{input:"Q", output:"A"}]})` → 請求 body 含 `fewShotPairs`，不含 `fewShotExamples`
- Happy path: `updatePrompt(id, {fewShotPairs: [...]})` → 正確 PUT 請求

**Verification:**
- `pnpm --filter publisher-fill-assistant compile` 無錯（此時 prompt-client.ts 不再含 fewShotExamples 型別）

---

- [ ] **Unit 5: Extension 表單層清理（R4–R7b + savePromptToBackend）**

**Goal:** 清除 `useSettingsForm` 中 `fewShotExamples` 的所有存在：欄位、useEffect、save/load 路徑、importFewShot 函數及整條 importBanner/importTruncated 鏈；`derivedFewShotExamples` 簡化計算；`selectPrompt` 改讀 pairs。

**Requirements:** R4, R5, R6, R7, R7b

**Dependencies:** Unit 3（Settings 類型），Unit 4（storage 已清理），Unit 4b（prompt-client 類型已更新）

**Files:**
- Modify: `packages/extension/entrypoints/sidepanel/hooks/useSettingsForm.ts`
- Test: `packages/extension/entrypoints/sidepanel/hooks/useSettingsForm.test.ts`

**Approach:**

*FormValues interface（line 27）:*
- 移除 `fewShotExamples: string`
- 移除 `importBanner: string` 和 `importTruncated: string`（`importFewShot` 是唯一寫入者，刪除 importFewShot 後兩欄位永遠為空字串，整鏈一起移除）

*初始值（line 68）:*
- 移除 `fewShotExamples: ""`

*load 路徑（lines 107, 115）:*
- 移除 `const rawExamples = s.fewShotExamples ?? ""` 及 `fewShotExamples: rawExamples`
- 直接讀 `fewShotPairs: s.fewShotPairs ?? []`

*save 路徑（lines 129-131, 150-152, 159）:*
- 移除 `fewShotPairs.length > 0 ? derive(...) : formValues.fewShotExamples` 解析條件
- 只傳 `fewShotPairs: formValues.fewShotPairs`

*`derivedFewShotExamples` 計算（lines 128-131）:*
- 簡化為 `const derivedFewShotExamples = deriveFewShotExamples(formValues.fewShotPairs)`（移除 `else formValues.fewShotExamples` fallback）

*importFewShot 函數（lines 174-195）及 hook 返回值（line 273）:*
- 移除整個 `importFewShot` callback
- 移除 return 中的 `importFewShot`
- 移除 `SettingsFormReturnValue` interface 中的 `importFewShot: () => void`（line 51）

*selectPrompt（lines 214-219）:*
- `fewShotExamples: tpl.fewShotExamples` → `fewShotPairs: tpl.fewShotPairs ?? parseFewShotExamples(tpl.fewShotExamples ?? "")`
- 導入 `parseFewShotExamples` from `../../lib/storage`（或 `lib/storage`）
- **注意**：此 lazy fallback 在 Unit 7 完成後，`PromptTemplate.fewShotExamples` 從類型消失，tsc 會強制報錯；Unit 7 清理 `tpl.fewShotExamples` 讀取（改為 `tpl.fewShotPairs ?? []`）

*savePromptToBackend（lines 222-233）:*
- 移除 `fewShotPairs.length > 0 ? derive(...) : fewShotExamples` 解析邏輯
- 直接傳 `fewShotPairs: formValues.fewShotPairs`（改用 `createPrompt({ ..., fewShotPairs })`）

**Patterns to follow:**
- `setFewShotPairs` callback 模式（lines 258-260）作為 setter 範例

**Test scenarios:**
- Happy path: `load()` 後 `formValues.fewShotPairs` 正確回填，無 `fewShotExamples` 欄位
- Happy path: `save()` 傳給 `saveSettings` 的對象只含 `fewShotPairs`，不含 `fewShotExamples`
- Happy path: `selectPrompt(id)` 時 `tpl.fewShotPairs` 存在 → 直接設 pairs
- Edge case: `selectPrompt(id)` 時 `tpl.fewShotPairs` 為 undefined + `tpl.fewShotExamples = "A\n---\nB"` → pairs = `[{input:"A", output:"B"}]`（lazy fallback 正確）
- `derivedFewShotExamples` 計算: pairs 非空 → derive 字串；pairs 空 → `""`
- 確認 `importFewShot`（原 3 條測試）已移除或重新標記為 skip

**Verification:**
- `pnpm --filter publisher-fill-assistant test` 全綠
- `SettingsFormReturnValue` interface 無 `importFewShot`

---

- [ ] **Unit 6: Extension UI 層清理（R1–R3）**

**Goal:** 移除 PromptSection 中的舊 textarea 及相關 props；清除 Settings.tsx 傳遞鏈；刪除 PR #43 後無 import 的死碼檔案。

**Requirements:** R1, R2, R3

**Dependencies:** Unit 5（hook 已不回傳 `fewShotExamples` / `importFewShot`）

**Files:**
- Modify: `packages/extension/entrypoints/sidepanel/components/PromptSection.tsx`
- Modify: `packages/extension/entrypoints/sidepanel/Settings.tsx`
- Delete: `packages/extension/entrypoints/sidepanel/settings/PromptCard.tsx`
- Delete: `packages/extension/entrypoints/sidepanel/settings/PromptManagementCard.tsx`
- Test: `packages/extension/entrypoints/sidepanel/Settings.component.test.tsx`（確認無死碼 import）

**Approach:**

*`PromptSection.tsx`:*
- 移除 props interface 中的 `fewShotExamples: string`、`setFewShotExamples`、`onImportFewShot`
- 移除 `importBanner: string`、`importTruncated: string` props（Unit 5 決策：整鏈移除）
- 移除 `<textarea>` 區塊（lines 91, 109, 114-117）：含 Reset 按鈕和 `value={fewShotExamples}` textarea
- 移除 `importTruncated` 條件渲染（line 63-65）
- 移除 `importBanner` 傳遞給子組件（line 71）

*`Settings.tsx`:*
- 移除 `fewShotExamples={formValues.fewShotExamples}`（line 140）
- 移除 `setFewShotExamples={(v) => setFormValue("fewShotExamples", v)}`（line 148）
- 移除 `onImportFewShot={hook.importFewShot}`（line 150）
- 移除 `importBanner`、`importTruncated` prop 傳遞給 PromptSection

*刪除死碼：*
- `packages/extension/entrypoints/sidepanel/settings/PromptCard.tsx`
- `packages/extension/entrypoints/sidepanel/settings/PromptManagementCard.tsx`（已確認無任何 import）

**Patterns to follow:**
- `BackendSection.tsx`、`LLMSection.tsx` 等其他 section 組件的 props 模式（簡潔 interface，只傳所需值和 handler）

**Test scenarios:**
- `Settings.component.test.tsx`：若有測試傳入 `fewShotExamples` prop，移除相關測試行
- Happy path: Settings 組件掛載後只渲染 `FewShotPairEditor`，無 `<textarea>` 存在於 DOM

**Verification:**
- `pnpm --filter publisher-fill-assistant test` 全綠
- `grep -rn "PromptCard\|PromptManagementCard" packages/extension` 結果為零（確認死碼已刪）

---

- [ ] **Unit 7: 後端 Prompt 樣板遷移（R11–R14）**

**Goal:** 後端 `prompt-store.ts` 改為儲存 `fewShotPairs: FewShotPair[]`，並加入 lazy-on-read 遷移，確保現有 JSON 文件在被讀取時自動轉換。

**Requirements:** R11, R12, R13, R14

**Dependencies:** Unit 3（`FewShotPair` 類型從 `@51publisher/shared` 引入，shared build 已完成）

**Files:**
- Modify: `packages/backend/src/scraper/prompt-store.ts`
- Modify: `packages/backend/src/utils/schemas.ts`（TypeBox schema lines 243, 250）
- Modify: `packages/backend/src/routes/prompt-routes.ts`（lines 55, 63, 102-103）
- Modify: `packages/extension/entrypoints/sidepanel/hooks/useSettingsForm.ts`（清理 `selectPrompt` 的 `tpl.fewShotExamples` 讀取，改為 `tpl.fewShotPairs ?? []`）
- Test: `packages/backend/src/routes/prompt-routes.test.ts`

**Approach:**

*`prompt-store.ts` 類型更新：*
- `import { FewShotPair } from "@51publisher/shared"`
- `PromptTemplate`: `fewShotExamples: string` → `fewShotPairs: FewShotPair[]`
- `PromptTemplateCreate`: 同上
- `PromptTemplateUpdate`: `fewShotExamples?: string` → `fewShotPairs?: FewShotPair[]`

*lazy-on-read 遷移——實作架構（`prompt-store.ts` 包裝層）：*
- 建立包裝函數 `getAllPrompts(): PromptTemplate[]` 和 `getPromptById(id): PromptTemplate | undefined`，在函數內對 `promptStore.getAll()` / `getById()` 結果做 map
- 觸發條件：`(!raw.fewShotPairs || raw.fewShotPairs.length === 0) && raw.fewShotExamples`（空陣列也觸發，防止部分遷移後靜默丟棄舊資料）
- 內嵌 parse 算法（≈5 行，與 `parseFewShotExamples` 相同邏輯，後端側獨立實作）
- 不覆寫磁碟文件（純記憶體遷移；下次 PUT /prompts 才落盤 fewShotPairs）
- `prompt-routes.ts` 改呼叫包裝函數 `getAllPrompts()` / `getPromptById()`

*Unit 7 同時清理 `selectPrompt` 的 `tpl.fewShotExamples` 讀取（`useSettingsForm.ts`）：*
- Unit 7 後 `PromptTemplate.fewShotExamples` 從類型消失，Unit 5 的 lazy fallback `tpl.fewShotExamples` 成為 tsc 錯誤
- 在此 Unit 將 `selectPrompt` 的 fallback 改為 `tpl.fewShotPairs ?? []`（後端 lazy-on-read 確保 API 永遠回傳 `fewShotPairs`）

*`schemas.ts` TypeBox 更新：*
- 移除 `fewShotExamples: Type.Optional(Type.String({ maxLength: 50000 }))`（lines 243, 250）
- 新增 `fewShotPairs: Type.Optional(Type.Array(Type.Object({ input: Type.String(), output: Type.String() })))`

*`prompt-routes.ts` 更新：*
- POST /prompts: body 改讀 `fewShotPairs`（instead of `fewShotExamples`）
- PUT /prompts/:id: 同上

**Patterns to follow:**
- `JsonFileStore<PromptTemplate>` 已在 prompt-store.ts（`const promptStore = new JsonFileStore<PromptTemplate>({...})`，line 37）
- `pending-store.ts`、`gossip-site-store.ts` 的包裝函數模式

**Test scenarios:**
- Happy path: POST /prompts `{name, template, fewShotPairs: [{input:"Q", output:"A"}]}` → 201 Created，讀回含 `fewShotPairs`
- Happy path: PUT /prompts/:id `{fewShotPairs: [...]}` → 200 OK，更新成功
- Lazy migration: JSON 含 `{fewShotExamples: "Q\n---\nA", fewShotPairs: undefined}` → GET /prompts/:id 返回 `fewShotPairs: [{input:"Q", output:"A"}]`
- Lazy migration edge case: JSON 含 `{fewShotExamples: "Q\n---\nA", fewShotPairs: []}` → 觸發遷移，返回解析後 pairs（空陣列也觸發）
- Edge case: lazy migration 時 `fewShotExamples` 為 `""` → `fewShotPairs: []`
- Error path: POST /prompts 傳舊格式 `fewShotExamples` → 422 Validation Error（schema 不接受）
- **一致性驗證**: 後端 lazy-on-read 對 `"A\n---\nB\n\nC\n---\nD"` 的輸出與 extension `parseFewShotExamples("A\n---\nB\n\nC\n---\nD")` 結果相同（`[{input:"A",output:"B"},{input:"C",output:"D"}]`）；確保兩側算法同步，若有差異以 extension 側為準

**Verification:**
- `pnpm --filter @51publisher/backend test` 全綠
- `grep -rn "fewShotExamples" packages/backend/src/` 結果為零（遷移臨時判斷 key 除外）
- `useSettingsForm.ts` 的 `selectPrompt` 不再讀取 `tpl.fewShotExamples`（改為 `tpl.fewShotPairs ?? []`）

---

- [ ] **Unit 8: 測試套件全面更新（R15–R16）**

**Goal:** 掃清所有測試文件中**在前面 Units 尚未涵蓋的殘留** `fewShotExamples` 引用（Units 1–7 各自已列出對應測試場景）；補充 `llm.test.ts`、`drafts-generate-slots.test.ts`、`Settings.component.test.tsx` 這三個未被前面 Units 明確處理的文件，確保最終 `pnpm test` 全綠。

**Requirements:** R15, R16

**Dependencies:** Units 1–7（所有實作完成）

**Files:**
- Modify: `packages/extension/lib/storage.test.ts`
- Modify: `packages/extension/lib/prompt-assembly.test.ts`
- Modify: `packages/extension/lib/prompt-client.test.ts`
- Modify: `packages/extension/lib/llm.test.ts`
- Modify: `packages/extension/entrypoints/sidepanel/Settings.component.test.tsx`
- Modify: `packages/extension/entrypoints/sidepanel/hooks/useSettingsForm.test.ts`
- Modify: `packages/backend/src/routes/prompt-routes.test.ts`
- Modify: `packages/backend/src/scraper/prompt-store.test.ts`
- Modify: `packages/backend/src/routes/drafts-generate-slots.test.ts`（line 41: `fewShotExamples: "f"`）
- Modify: `packages/backend/src/services/llm.test.ts`（line 21: `fewShotExamples: "test few shot"`）

**Approach:**
- 逐文件執行 `grep -n "fewShotExamples"` 確認殘留引用
- 將測試中的 `fewShotExamples: "..."` fixture 改為 `fewShotPairs: [...]`
- `useSettingsForm.test.ts`：移除 `importFewShot` 相關的 3 條測試（describe 含 importFewShot 的 lines 162-204）、移除 `importBanner`/`importTruncated` 相關測試
- `prompt-routes.test.ts`：補 lazy migration 路徑測試（已在 Unit 7 test scenarios 中定義）
- 確認 `describe("useSettingsForm — Unit 2: load / save / importFewShot")` 的 describe 名稱更新

**Test scenarios:**
- 驗收標準：`grep -rn "fewShotExamples" packages/ --include="*.ts" --include="*.tsx"` 輸出為零（排除 git history / 注釋中的歷史說明）

**Verification:**
- `pnpm test` 全綠（後端 ≥426、擴展 ≥918）
- `pnpm -r compile` 無錯
- `grep -rn "fewShotExamples" packages/` 輸出為零

## System-Wide Impact

- **Interaction graph:** `prompt-assembly.ts` → `buildPrompt()` in `messaging.ts` → LLM API；此鏈在 Unit 2 之後改讀 `fewShotPairs`，函數簽名不變（仍傳 string）
- **Error propagation:** `saveSettings()` 是 fire-and-forget（無錯誤傳播變更）；後端 `createPrompt()` / `updatePrompt()` 的 422 驗證錯誤路徑已在 Unit 7 測試中涵蓋
- **State lifecycle risks:** chrome.storage 中的舊 `fewShotExamples` key 在 `saveSettings()` 中不會再寫入（類型無此欄位），但舊 key 仍在 storage 中（stale data）。首飛前這個 stale key 無影響；若未來清理，在 `getSettings()` 中加一行 `storage.removeItem('fewShotExamples key')` 即可
- **API surface parity:** 後端 prompt API schema 變更（`fewShotExamples` → `fewShotPairs`），無向下相容需求（首飛前單用戶，直接切換）
- **Integration coverage:** selectPrompt 的 lazy fallback 路徑（`tpl.fewShotPairs ?? parse(tpl.fewShotExamples)`）是跨層整合點，Unit 5 的 `selectPrompt` 測試必須涵蓋此路徑
- **Unchanged invariants:** `deriveFewShotExamples()` 函數保持不動；`FewShotPairEditor.tsx` 行為不變；`addFewShotPair` / `removeLastFewShotPair` 函數不動

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Unit 3 後 `pnpm -r compile` 暴露未預期的引用點 | 預期為好事（tsc 作為路線圖）；計劃已列出已知觸點，新發現按同模式修復 |
| `importBanner` / `importTruncated` 欄位有其他讀取點，刪除引發 UI 問題 | Unit 5 開始前 grep 確認；若有其他讀取點，保留欄位但清空寫入路徑 |
| 後端 lazy-on-read 算法與 extension `parseFewShotExamples` 不一致 | 兩者算法簡單（~5 行），Unit 8 的 lazy migration 測試涵蓋此一致性；若有差異，以 extension 側為準 |
| `PromptTemplate` 類型改變導致 scraper 讀取舊格式 JSON crash | lazy-on-read 在讀取路徑上做 defensive check；若 `fewShotPairs` 為 undefined，parse string fallback 確保不 crash |

## Sources & References

- **Origin document:** [docs/brainstorms/2026-06-16-fewshot-dedup-requirements.md](docs/brainstorms/2026-06-16-fewshot-dedup-requirements.md)
- Related code: `packages/extension/lib/storage.ts` (deriveFewShotExamples, parseFewShotExamples to-add)
- Related code: `packages/extension/entrypoints/sidepanel/hooks/useSettingsForm.ts` (importFewShot algorithm)
- Related code: `packages/backend/src/scraper/prompt-store.ts` (JsonFileStore pattern)
- Previous refactor: PR #43 (Settings hook split, created PromptSection.tsx)
