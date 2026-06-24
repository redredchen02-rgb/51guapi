---
title: "fix: Correct webui dist path in backend static serving"
type: fix
status: active
date: 2026-06-23
---

# fix: Correct webui dist path in backend static serving

## Overview

後端在 `app.ts` 計算 webui dist 目錄時，多了一個 `..`，導致 `existsSync` 失敗 → 靜態檔案不掛載 → `setNotFoundHandler` 不設定 → 所有非 `/api/` 路由回 404。

## Problem Frame

用戶開啟 `http://localhost:3002/` 看到 Fastify 原生 404（`{"message":"Not Found"}`），WebUI 完全無法使用。

根本原因在 `packages/backend/src/app.ts:190`：

```
path.resolve(<app.ts path>, "../../../../webui/dist")
```

從 `src/app.ts`（或 `dist/app.js`）出發，4 個 `..` 跳到倉庫根目錄 `GTTPUB/`，再接 `webui/dist` = `GTTPUB/webui/dist`（不存在）。

正確需要 3 個 `..`：`src/app.ts` → `backend/` → `packages/` → `packages/webui/dist` ✓

## Requirements Trace

- R1. 訪問 `http://localhost:3002/` 及任意 SPA 路由，應返回 webui `index.html`
- R2. `/api/` 開頭的路由不受影響，依然正常返回 API 回應

## Scope Boundaries

- 僅修正路徑字串，不改任何 API 邏輯
- 不重建 webui dist（`packages/webui/dist/` 已存在）

## Context & Research

### Relevant Code and Patterns

- `packages/backend/src/app.ts:188-205` — 靜態服務掛載 + SPA fallback
- `packages/webui/dist/` — 已有 build 產物（`index.html` + `assets/`）

### Root Cause (Verified)

```js
// Node.js path.resolve 驗證
path.resolve('.../packages/backend/src/app.ts', '../../../../webui/dist')
// → .../GTTPUB/webui/dist        ← 不存在 ✗

path.resolve('.../packages/backend/src/app.ts', '../../../webui/dist')
// → .../GTTPUB/packages/webui/dist ← 正確 ✓
```

兩種執行模式（`tsx src/`、`node dist/`）用 3 個 `..` 均正確解析至 `packages/webui/dist`。

## Key Technical Decisions

- **改路徑字串，不改 path 計算方式**：現有 `path.resolve` + `import.meta.url` 方式正確，問題僅在 `..` 數量。改最小、最安全。

## Implementation Units

- [ ] **Unit 1: 修正 webuiDist 路徑**

**Goal:** 讓 `existsSync(webuiDist)` 在 dev 與 prod 模式下均返回 `true`

**Requirements:** R1, R2

**Dependencies:** 無

**Files:**
- Modify: `packages/backend/src/app.ts`（第 190 行）

**Approach:**
- 將 `"../../../../webui/dist"` 改為 `"../../../webui/dist"`
- 僅改此一個字串，其餘不動

**Patterns to follow:**
- `app.ts:188-205` 的現有結構保持不變

**Test scenarios:**
- Test expectation: none — 靜態服務掛載邏輯屬啟動階段副作用，無單元測試覆蓋；以手動驗證為準

**Verification:**
- 啟動後端（`pnpm dev:backend`），curl `http://localhost:3002/` 返回 HTML（非 JSON 404）
- 瀏覽器開啟 `http://localhost:3002/pending` 正確載入 WebUI
- `curl http://localhost:3002/api/v1/healthz` 依然正常返回 JSON

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| dist 執行模式路徑不同 | 已驗證：3 個 `..` 從 `dist/app.js` 同樣解析至 `packages/webui/dist` |
| webui dist 需重建 | 已確認 `packages/webui/dist/` 存在且含 `index.html`，無需重建 |
