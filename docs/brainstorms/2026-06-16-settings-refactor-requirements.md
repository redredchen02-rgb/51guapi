---
date: 2026-06-16
topic: settings-refactor
---

# Settings.tsx 重構 — 需求文件

## Problem Frame

`packages/extension/entrypoints/sidepanel/Settings.tsx`（613 行）是 extension 中一個大型 UI 組件，目前有 `Settings.test.tsx` 但僅覆蓋 `parseTagsText` / `validateMapping` 兩個純函式，核心 hook 邏輯與表單互動尚無測試保護。當前有 23 個散落的 `useState`、6 個邏輯上獨立的設定區塊全部混在一個組件，`handleSave` 同時負責驗證與儲存，且有約 15 處 inline style。

影響者是**單人維護者**：新增欄位或調整驗證規則時，需在一個 600+ 行檔案中定位，核心 hook 邏輯改錯了只能靠人工測試發現。

## Requirements

**A. 抽取 `useSettingsForm` hook**
- R1. 把全部表單相關 `useState`（**不含** `error` / `saved` 兩個 UI 反饋狀態，這兩個留在組件）移入 `lib/hooks/useSettingsForm.ts`，hook 對外只暴露：當前表單值（一個 state object）、`load()`（初始化讀取）、`save()`（驗證 + 儲存，回傳 `string | null`，null 表示成功）、必要的 handler（`importFewShot`、`loadPrompts`、`selectPrompt`、`savePromptToBackend`、`testConnection`）；Settings.tsx 本地維護 `error`（顯示 `save()` 回傳的 string）與 `saved`（save() 返回 null 後設 true）。
- R2. `handleSave` 的三段驗證（endpoint https / mapping JSON / backendUrl localhost）拆成純函式 `validateSettingsForm(values)`，回傳 `string | null`（錯誤訊息或 null）；錯誤訊息為靜態文案，不插入用戶輸入的憑證值（apiKey、backendToken）。

**B. 拆子組件**
- R4. 從 Settings.tsx 拆出以下 5 個子組件（放 `entrypoints/sidepanel/components/` 目錄下，與現有 `FewShotPairEditor.tsx` 並列，跟隨既有慣例）：
  - `LLMSection` — LLM endpoint / model / apiKey（`type="password" autoComplete="off"`）/ 備用 LLM 折疊面板
  - `BackendSection` — backendUrl / backendToken（`type="password" autoComplete="off"`）/ 測試連接 / dailyBatchSize
  - `PromptSection` — promptTemplate / fewShotExamples（舊格式）/ Prompt 管理（後端加載/保存）；`FewShotPairEditor` 繼續在此層被呼叫，不再拆多一層
  - `TagsSection` — recommendedTags / reviewCriteriaPrompt
  - `FieldMappingSection` — mappingText JSON 編輯器
- R5. Settings.tsx 主組件重構後只負責：組裝上述子組件、傳入 hook 的值/handler、渲染 error/saved 狀態和保存按鈕；本地維護 `error` 與 `saved` 兩個 UI 反饋 state。

**C. 測試**
- R7. 給 `useSettingsForm` 寫 vitest 單元測試，覆蓋：
  - `load()` 正確讀取並初始化各欄位
  - `save()` 驗證失敗時不呼叫 `saveSettings`，返回錯誤訊息
  - `save()` 驗證通過時呼叫 `saveSettings` + `saveApiKey` + `saveBackendToken`
  - `importFewShot()` 正確解析舊格式、截取至 MAX_PAIRS
- R8. 給 `validateSettingsForm` 寫純函式單元測試，覆蓋以下四個拒絕情境與一個通過情境：
  - 拒絕：endpoint 非空但非 `https://`
  - 拒絕：mappingText 非合法 JSON
  - 拒絕：mappingText 合法 JSON 但結構不符 `isValidFieldMapping`
  - 拒絕：backendUrl 非 `localhost` / `127.0.0.1` 地址
  - 通過：所有欄位合法（含空 endpoint 和空 backendUrl）
- R9. **不**為子組件寫 rendering 測試（避免快照鎖死）；行為測試（用戶輸入 → 狀態改變）已被 hook 測試涵蓋

**D. 樣式清理**
- R10. 把約 15 處 inline `style={{ ... }}` 中，spacing 類（`marginTop` / `marginBottom` / `marginLeft` 對應 CSS 變數的）替換為現有 CSS utility class（`mt-lg` / `mb-md` / `ml-sm` 等）；結構性樣式（`minHeight`、`fontFamily: monospace`、`fontSize: var(--font-xs)` 等一次性配置）若無對應 class 則保留 inline，不引入新 CSS 檔。

## Success Criteria
- `packages/extension/entrypoints/sidepanel/Settings.tsx` 行數明顯下降（目標 ≤ 250 行）
- `pnpm test` 全綠，且 `useSettingsForm.test.ts` + `validateSettingsForm.test.ts` 覆蓋關鍵路徑（R7 + R8 所有場景）
- `pnpm compile` 全綠
- `pnpm lint:ci` 零錯誤

## Scope Boundaries
- **不**修改其他已存在的 UI 組件（TodayBatchView / BatchReviewPanel / App.tsx）；**可**新建 `entrypoints/sidepanel/components/` 下的設定子組件
- **不**修改 `FewShotPairEditor` 組件邏輯
- **不**新增功能或修改現有行為
- **不**引入 CSS Modules（留給下一輪）
- **不**修改後端、shared、content script
- `parseTagsText` 和 `validateMapping` 保持在 `Settings.tsx` 中作為獨立 export，不移入 hook（現有 `Settings.test.tsx` 的 import 路徑無需改動）

## Key Decisions
- **hook 而非 context**：Settings 是單頁面的本地狀態，不需要跨組件共享，hook 比 context 簡單；props drilling 最多兩層（Settings.tsx → Section → FewShotPairEditor）為可接受邊界
- **拆 5 個子組件**（LLMSection / BackendSection / PromptSection / TagsSection / FieldMappingSection）：以 card 區塊為界；FewShotPairEditor 已存在於 PromptSection 層內，不算第六個新建組件
- **行數目標調整為 ≤ 250 行**（原 200 行）：5 個子組件 import + props 傳遞 + hook 解構的實際行數下，200 行過緊
- **不為子組件寫快照測試**：快照測試維護成本高，行為邏輯已被 hook 單元測試覆蓋；子組件 rendering 正確性由人工冒煙兜底
- **save() 直接持有三個 storage 呼叫**（`saveSettings` / `saveApiKey` / `saveBackendToken`）：不抽 facade，保持簡單
- **importFewShot() 改讀 hook state**（修正現有 bug）：不再讀 `getSettings()`，直接用 state 中的 `fewShotExamples`
- **PromptSection 的後端同步 handler 移進 `useSettingsForm` hook**：`handleLoadPrompts` / `handleSaveToBackend` / `prompts` / `selectedPromptId` / `promptStatus` 均由 hook 管理
- **apiKey / backendToken 以獨立 getter 持有**：不打包進 formValues，hook 暴露 `getApiKey()` / `getBackendToken()`，避免進入 DevTools 序列化路徑

## Dependencies / Assumptions
- 現有 `lib/storage.ts` API（`getSettings` / `saveSettings` 等）不改動
- 子組件目錄慣例：`entrypoints/sidepanel/components/`（依據現有 `FewShotPairEditor.tsx` 路徑）
- Spacing utility class（`mt-lg` / `mb-md` 等）已存在；結構性 inline style（minHeight / fontFamily 等）保留

## Outstanding Questions

### Resolve Before Planning
（已解決，下方記錄決策結果）

### Deferred to Planning
- [R4][Technical] LLMSection 備用 LLM 折疊面板展開狀態：建議 ephemeral local state（不持久化），由 LLMSection 自管；Planning 確認。
- [R4][Technical] 非同步操作（testConnection / loadPrompts / savePromptToBackend）的 loading/error state：建議各 Section 自管 local state，不進 hook；Planning 確認。

## Next Steps
→ `/ce:plan` 進行結構化實施規劃
