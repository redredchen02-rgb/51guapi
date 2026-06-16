---
date: 2026-06-16
topic: fewshot-dedup
---

# fewShotExamples 雙真相消除

## Problem Frame

`fewShotExamples`（string）是 FewShot 的舊格式，`fewShotPairs`（FewShotPair[]）是新格式。兩者目前**並存於三個層**：

1. **儲存層**：`saveSettings()` 同時寫入 chrome.storage，`getSettings()` 讀時從 `fewShotPairs` 派生 `fewShotExamples`（`storage.ts:86-92`）
2. **表單層**：`useSettingsForm.ts` 同時持有兩個 state，存在 textarea→pairs 的反向 useEffect sync（`lines 175-195`）
3. **UI 層**：`PromptSection.tsx` 同時渲染 `FewShotPairEditor`（pairs）和 `<textarea>`（string）——雙 UI 並存

後端 prompt-store 也以 `fewShotExamples: string` 儲存已保存的 Prompt 樣板，導致從後端加載樣板時仍帶回舊格式。

受影響者：維護者（單人）。雙真相讓 fewShot 相關改動必須同時追蹤兩個 state，下游邏輯（prompt-assembly、測試）難以推理。首飛前無真實用戶資料，是清理的最佳視窗。

## Requirements

**A. 前置修正 — 先讓 compile 保持可過**

- R0. 在移除任何類型前，先修 `prompt-assembly.ts:30`：改為 `deriveFewShotExamples(settings.fewShotPairs ?? [])`（移除 `settings.fewShotExamples` 讀取）。這是 R10 的先決條件，否則 R10 刪除欄位後整個 monorepo compile 中斷。

**B. UI 層 — 移除舊 textarea，只留 FewShotPairEditor**

- R1. 從 `PromptSection.tsx` 移除 `fewShotExamples` prop 及其對應的 `<textarea>` 區塊（`lines 91, 109, 114-117`）；組件 props interface 只保留 `fewShotPairs: FewShotPair[]` 及相關 handler。
- R2. 從 `Settings.tsx` 移除傳遞 `fewShotExamples` / `setFewShotExamples` 給 `PromptSection` 的 props（`lines 140, 148`）。
- R3. 刪除死碼：`settings/PromptCard.tsx` 與 `settings/PromptManagementCard.tsx`（PR #43 Settings 重構後已無任何 import，已確認）。

**C. 表單層 — 清除 fewShotExamples 在 useSettingsForm 中的存在**

- R4. 從 `useSettingsForm.ts` 的 `FormValues` interface 移除 `fewShotExamples: string`（`line 27`）。
- R5. 移除 `useSettingsForm.ts` 的 textarea→pairs 反向 useEffect（`lines 175-195`）；FewShotPairEditor 已直接更新 `fewShotPairs`，不再需要字串同步。
- R6. 清理 save 路徑中的解析邏輯：移除「若 `fewShotPairs` 非空則派生 `fewShotExamples`」的條件判斷（`lines 129-131`, `150-152`, `159`）；只儲存 `fewShotPairs`。
- R7. load 路徑中移除讀取 `fewShotExamples` 的行（`lines 107, 115`）；直接讀 `fewShotPairs`。
- R7b. 更新後端樣板加載路徑（`lines 214-230`）：改讀 `tpl.fewShotPairs`。
- R7c. 確認 `messaging.ts` 中 `buildPromptPayload(fewShot?: string)` 的呼叫點：若仍傳 `settings.fewShotExamples`，改傳 `deriveFewShotExamples(settings.fewShotPairs ?? [])`；若 fewShot 參數本身已改為接受 pairs，則同步更新 interface。

**D. 儲存層 — 只清派生邏輯**

- R8. 移除 `storage.ts` `getSettings()` 中的 `fewShotExamples` 派生邏輯（`lines 86-92`）。無需加入 chrome.storage 遷移安全網——首飛前無真實用戶資料，若維護者本機有測試資料，清除瀏覽器 storage 即可。

**E. 共享類型 — 從 Settings 類型移除 fewShotExamples**

- R9. 從 `packages/shared/src/types.ts` 的 `Settings` interface 移除 `fewShotExamples?: string`（`line 102`）；FewShotPair 類型保留。
- R10. 重新 build shared 包，確保 `dist/types.d.ts` 同步更新。

**F. 後端 Prompt 樣板 — 改為儲存 fewShotPairs**

- R11. 更新 `prompt-store.ts` 的 `Prompt` / `PromptTemplate` interface：以 `fewShotPairs: FewShotPair[]` 取代 `fewShotExamples: string`；FewShotPair 從 `@51publisher/shared` 引入。
- R12. 更新 `schemas.ts` 的 TypeBox schema（`lines 243, 250`）：移除 `fewShotExamples`，新增 `fewShotPairs: Type.Optional(Type.Array(...))`。
- R13. 更新 `prompt-routes.ts`（`lines 55, 63, 102-103`）：request body 接受 `fewShotPairs`，不接受 `fewShotExamples`。
- R14. 後端 Prompt JSON 遷移採 **lazy-on-read**：在 `prompt-store.ts` 讀取路徑上，若 JSON 含 `fewShotExamples` 字串但無 `fewShotPairs`，自動 parse 並回填 `fewShotPairs`（不做 startup scan，避免 scheduler 啟動時序問題）。

**G. 測試更新**

- R15. 更新所有引用 `fewShotExamples` 的測試，改讀 `fewShotPairs`：
  - `storage.test.ts`
  - `prompt-assembly.test.ts`
  - `prompt-client.test.ts`
  - `llm.test.ts`
  - `Settings.component.test.tsx`
- R16. `prompt-routes.test.ts` 補一個 PUT /prompts/:id 接受 `fewShotPairs` 的成功路徑測試，並補一個 lazy 遷移路徑：讀取含舊 `fewShotExamples` 的 JSON 能正確回傳 `fewShotPairs`。

## Success Criteria

- `grep -rn "fewShotExamples" packages/` 除 CHANGELOG / git history 外全部為零
- `pnpm test` 全綠（後端 426+、擴展 918+ 或更多）
- `pnpm -r compile` 無錯
- `PromptSection` 只渲染 `FewShotPairEditor`，無 textarea
- 後端已存的 Prompt 樣板在 R15 遷移後可正確加載回 `fewShotPairs`

## Scope Boundaries

- `deriveFewShotExamples()` 函數本身**保留**（`prompt-assembly.ts` + `messaging.ts` 仍需在組裝 LLM prompt 字串時調用它）；只移除觸發點在 storage/form/UI 層的呼叫
- `FewShotPairEditor.tsx` 及其 tests 不動
- `App.tsx`、`llm.ts` 本輪不拆（已在 maintainability-test-refactor 需求文件中標記暫緩）
- 不加 chrome.storage 遷移安全網（首飛前無用戶，YAGNI）

## Key Decisions

- **不做 API 版本化**：項目首飛前，後端 prompt API 改 fewShotPairs 字段直接切換，無需 v2
- **保留 deriveFewShotExamples**：字串格式是 LLM 接收 few-shot 的格式，只是不應再作為儲存/編輯面
- **後端遷移採 lazy-on-read**：避免 startup scan 引入 scheduler 時序問題；lazy 方案更易測試
- **不加 chrome.storage 遷移路徑**：維護者本機若有舊測試資料，清除瀏覽器 extension storage 即可，不值得為此入 codebase

## Dependencies / Assumptions

- 執行順序：R0（prompt-assembly 修正）→ R9/R10（shared 類型）→ R1-R8（extension）→ R11-R14（backend）→ R15-R16（測試）
- R14 的 lazy parse 邏輯需要一個 `parseFewShotExamples(raw: string): FewShotPair[]` 純函數；實作者從 `useSettingsForm.ts` 的 `importFewShot` callback（lines 174-195）提取算法，放入 `storage.ts` 或 `shared/`

## Outstanding Questions

### Deferred to Planning

- [Affects R7c][Needs research] `messaging.ts:269` `buildPromptPayload()` 的 `fewShot?: string` 參數：確認呼叫點是否已改傳 `deriveFewShotExamples()` 的輸出，或仍傳 `settings.fewShotExamples`；依結果決定修 interface 還是只改呼叫點

## Next Steps

→ `/ce:plan` 進行結構化實施規劃
