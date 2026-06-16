---
date: 2026-06-16
topic: maintainability-test-refactor
---

# 可維護性 + 測試補強 — 第二輪系統優化

## Problem Frame

上一輪（2026-06-15）已完成核心安全閘門、首飛向導、可觀測性（pino redact / /healthz / /metrics）、E2E 動態提交盲區閉合。目前全部 1170 個測試通過，`pnpm -r compile` 全綠。

真正殘留的缺口在**可維護性與測試覆蓋**：
- 六個 UI god-component（400-786 行），其中 BatchReviewPanel 理應在上一輪拆但仍剩 588 行
- `fewShotExamples` 雙真相（storage.ts:63 派生字串邏輯仍存在）
- scraper/ 下四個 routes 未歸位到 routes/（與其他模組不對稱）
- `prompt-routes.ts` 和 `chrome-storage-utils.ts` 無單測

受影響者是維護者（當前單人）：god-component 讓每次功能改動都需在數百行上下文中定位；雙真相會讓未來的 fewShotPairs 改動埋下 bug。

## Requirements

**A. 補測試缺口（先行，為後續重構建立安全網）**

- R1. 為 `packages/backend/src/scraper/prompt-routes.ts` 新增整合測試，覆蓋：
  - GET /prompts → 返回清單
  - PUT /prompts/:id → 更新成功
  - 404 / 422 邊界
  - JWT 認證守護（未帶 token → 401）
- R2. 為 `packages/extension/lib/chrome-storage-utils.ts` 新增單元測試，覆蓋 get / set / clear 主路徑（mock `chrome.storage.local`，與現有 auth-client 測試模式一致）。

**B. 清結構債（低風險重整）**

- R3. 清除 `fewShotExamples` 雙真相：
  - `storage.ts:63` 移除派生字串邏輯（確保 UI 全面讀 `fewShotPairs`）
  - 刪除 `@deprecated` 標記的 `fewShotExamples` 字段與相關遷移墊片
  - 更新依賴此雙真相的測試，改讀 `fewShotPairs`
- R4. scraper routes 歸位：將 `scraper/gossip-routes.ts`、`pending-routes.ts`、`prompt-routes.ts`、`scraper-routes.ts` 移到 `src/routes/`；`scraper/` 只保留 adapters / ssrf-guard / scheduler；`app.ts` import 路徑同步更新。
- R5. 刪除死字段（YAGNI）：移除如 `void postStatus; // 計劃中的字段` 之類投機性空引用，編譯後確認零報錯。

**C. UI god-component 拆分（最高努力，依賴 A 組安全網）**

- R6. 拆 `BatchReviewPanel.tsx`（588 行）：
  - 抽出 `batch-review/ItemCard.tsx`（單篇卡片展示）
  - 抽出 `batch-review/ApprovalBar.tsx`（審批操作列）
  - 抽出 `batch-review/DiffView.tsx`（草稿對比）
  - 父組件降至 ≤ 200 行，state 保留在父
- R7. 拆 `TodayBatchView.tsx`（786 行）+ 整合 `BatchView.tsx`（499 行）重疊邏輯：
  - 抽出共用 `useBatchState` hook（或 context），消除兩個 view 的 state 重複
  - 各 view 降至 ≤ 300 行
- R8. 拆 `Settings.tsx`（590 行）：
  - 按設定分區抽出子組件（如 LLMSettings / PublishSettings / SiteSettings）
  - 父組件降至 ≤ 150 行（純導航 + 共用狀態）
- R9. `App.tsx`（633 行）與 `llm.ts`（643 行）**暫緩**：
  - `App.tsx` 多為路由膠水，拆開複雜度不降反升，留待真有需求
  - `llm.ts` 是 service 層，643 行屬合理複雜度，不為拆而拆

> ⚠️ R6-R8 前置條件：R1-R2 測試已通過（A 組完成），確保重構有自動安全網。R6 硬前置於 R7（BatchReviewPanel 是 TodayBatchView 的子組件，先拆葉再拆父）。

## Success Criteria

- `pnpm -r compile` + `pnpm test` + `pnpm test:e2e` 全程全綠，重構前後測試數量不降
- `fewShotExamples` 在整個 codebase 中零引用（`grep -r fewShotExamples` 無命中）
- scraper routes 搬移後 `/api/v1/pending`、`/api/v1/gossip`、`/api/v1/prompts`、`/api/v1/scraper` 所有既有測試仍通過
- BatchReviewPanel / TodayBatchView / Settings 各父組件行數符合各自上限
- `chrome-storage-utils.ts` 與 `prompt-routes.ts` 有覆蓋主路徑 + 401 邊界的測試

## Scope Boundaries

- **不** 動安全閘門鏈、三世界模型、後端存儲雙軌
- **不** 新增產品功能
- `background.ts`（1133 行）是 entrypoint，不拆——架構複雜度在此本來就高
- `llm.ts`（643 行）、`App.tsx`（633 行）本輪不拆（理由見 R9）
- E2E 組不新增（已閉合盲區）

## Key Decisions

- **A → B → C 排序**：測試先行建立安全網，再做低風險結構整理，最後做高努力拆組件。跳過任何一步都讓後一步風險上升。
- **R9 暫緩（YAGNI）**：App.tsx 與 llm.ts 行數雖高，但結構是合理複雜度，強行拆只增加抽象層不降低認知負擔。
- **scraper routes 歸位（R4）排在 R1 之後**：R1 先有 prompt-routes 測試，搬移後能立即驗證零回歸。

## Dependencies / Assumptions

- A 組完成前不開始 C 組（前置關係，非選項）
- R6 完成前不開始 R7（BatchReviewPanel 是 TodayBatchView 的子組件）
- `fewShotExamples` 清除（R3）需先確認 UI 已全面讀 `fewShotPairs`（storage 中確認無其他消費者）

## Outstanding Questions

### Resolve Before Planning
（無阻塞規劃的產品決策）

### Deferred to Planning
- [Affects R3][Technical] 確認 `fewShotExamples` 在 UI 端的所有消費者是否已全切到 `fewShotPairs`，再決定能否安全刪除（grep 後確認）
- [Affects R7][Technical] `useBatchOperations.ts`（125 行）已存在且已建立 hook 模式；規劃時確認 TodayBatchView/BatchView 哪些剩餘 state 可移入，決定最終行數目標是否需微調
- [Affects R8][Technical] Settings.tsx 各分區的 shared state 邊界，避免拆後 props drilling 過深

## Next Steps
→ `/ce:plan` 進行結構化實施規劃，排序 **A(R1→R2) → B(R3→R4→R5) → C(R6→R7→R8)**。
