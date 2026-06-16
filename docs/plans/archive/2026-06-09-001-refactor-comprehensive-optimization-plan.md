---
date: 2026-06-09
topic: comprehensive-optimization
status: superseded
---

> **状态对账（2026-06-10）**：本「七维度大重构」计划顺序被否（大重构先于产品验证，执行到一半反让仓库更脆弱）。
> 已由 `docs/plans/2026-06-10-002-fix-stabilize-first-flight-security-plan.md`（止血→首飞→安全）重排取代。
> 本计划已落地的部分：shared 包已建并被两端一致引用（A1 完成）、Biome 已引入（A2 完成）。
> 已**回退**的部分：JSON→SQLite 统一迁移（batch/prompt 回退为 JSON，仅 pending/config 留 SQLite）。
> 其余维度（前端质量、测试大补强、运维设施）**延后**，首飞后依真实数据量再评估。

# 全面優化企劃書 — 51publisher

## 概覽

- **目標**: 一口氣解決 codebase 七個維度的技術債，從架構、品質、基礎設施到維運安全，產出更乾淨、可維護、適合生產的專案
- **交付模式**: 一輪大重構（feature branch 隔離，集中完成後合併）
- **預計工時**: 5-8 天（視實際執行速度）
- **前提**: 現有 366 單測 + 23 e2e 全綠，重構前凍結 baseline

---

## 優化七大維度

| # | 維度 | 核心問題 | 難度 | 風險 |
|---|------|----------|------|------|
| 1 | **共享封裝 (packages/shared/)** | 型別/邏輯在 backend 和 extension 間重複 | ⭐⭐⭐ | 中 — 需遷移引用 |
| 2 | **儲存層統一** | JSON files + SQLite + chrome.storage 三種儲存不一致 | ⭐⭐⭐⭐ | 高 — 需 migration 策略 |
| 3 | **API Schema 驗證** | Fastify 路由無 TypeBox type provider | ⭐⭐ | 低 — 選配，不影響現有行為 |
| 4 | **程式碼品質工具鏈** | 無 linter/formatter/pre-commit/CI type check | ⭐ | 低 — 純加工具 |
| 5 | **前端 UI 品質** | inline styles、無 Error Boundary、無 loading states | ⭐⭐ | 低 — 視覺改動 |
| 6 | **測試補強** | 缺少 e2e、整合測試、CI 型別檢查閘門 | ⭐⭐⭐ | 中 — 新增測試不影響現有 |
| 7 | **維運與安全** | rate limiting、CORS、JWT refresh、migration、日誌 | ⭐⭐⭐ | 中 — 影響生產行為 |

---

## 執行順序（建議）

### Phase A：基礎建設（Day 1-2）
建立共享 package 和開發工具鏈，這是其他優化的基礎。

### Phase B：儲存與 API 層重構（Day 3-4）
統一儲存策略、加入 TypeBox 驗證、migration 系統。

### Phase C：前端 UI 升級（Day 5）
Error Boundary、CSS 治理、UX 改進。

### Phase D：測試補強（Day 6）
補齊測試缺口、CI 加入型別檢查閘門。

### Phase E：維運安全（Day 7）
rate limiting、CORS、日誌、JWT refresh。

---

## Phase A — 基礎建設：共享封裝與開發工具鏈

### A1. 建立 `packages/shared/` workspace package

**目標**: 消除 `backend/src/shared/` 和 `extension/lib/` 之間重複的型別和邏輯。

**涉及的檔案**:

| 現有位置 (重複) | 遷移目標 |
|-----------------|----------|
| `backend/src/shared/types.ts` + `extension/lib/types.ts` | `packages/shared/src/types.ts` |
| `backend/src/shared/facts.ts` + `extension/lib/facts.ts` | `packages/shared/src/facts.ts` |
| `backend/src/shared/field-mapping.ts` + `extension/lib/field-mapping.ts` | `packages/shared/src/field-mapping.ts` |
| `backend/src/shared/post-assembler.ts` + `extension/lib/post-assembler.ts` | `packages/shared/src/post-assembler.ts` |
| `backend/src/shared/vocab.ts` + `extension/lib/vocab.ts` | `packages/shared/src/vocab.ts` |

**A1.1 建立 package 結構**

- `packages/shared/package.json` → name `@51publisher/shared`, type: module, build: tsc
- `packages/shared/tsconfig.json` → extends root tsconfig, composite: true, outDir: dist
- `pnpm-workspace.yaml` → 確認已包含 `packages/*`
- root `tsconfig.json` → 加入 `references` 指向 shared

**A1.2 遷移方式**

- 逐檔比對兩邊的 diff（利用 `diff` 指令或手動確認）
- 將共同部分遷入 `packages/shared/src/`
- 兩邊特有部分留在原地（例如 extension 的 `PENDING_TOPICS_KEY` 等常數、backend 的 `ScrapedContent` 等）
- `package.json` 中用 `"@51publisher/shared": "workspace:*"` 引用
- Backend 的 `import` 改為 `import { ContentDraft } from '@51publisher/shared'`
- Extension 同理（Vite 會自動 resolve workspace protocol）
- 刪除兩邊各自的 `types.ts`/`facts.ts`/`field-mapping.ts`/`post-assembler.ts`/`vocab.ts`

**A1.3 驗證**

- `pnpm --filter @51publisher/shared build` → dist/ 產出正確
- `pnpm --filter backend build` → 零錯誤
- `pnpm --filter extension build` → 零錯誤
- `pnpm test` → 現有測試全綠

### A2. 引入 Biome

**目標**: 統一的 linter + formatter，取代散落的手動風格約束。

- 安裝 `biome` 到 root devDependencies
- 建立 `biome.json`（或 `biome.jsonc`），設定：
  - `extends: ["recommended"]`
  - `files.include: ["packages/*/src/**"]`
  - `javascript.formatter.quoteStyle: "double"`
  - `linter.rules`: 排除過於嚴格的規則（如 `noConsole`，我們還需要 console.log 除錯）
- 加入 npm scripts:
  - `"lint": "biome check ."`
  - `"format": "biome format --write ."`
  - `"lint:ci": "biome ci ."`
- CI 中加入 `pnpm lint:ci`

**注意**: 不做大規模一鍵 `biome check --apply` — 只在執行重構時順便格式化觸及的檔案。分階段進行。

### A3. CI 型別檢查閘門

**.github/workflows/ci.yml** 新增步驟：

```yaml
- name: TypeScript check
  run: pnpm compile
```

現有 `pnpm compile` 只在 root `package.json` 定義：需確認它跑的是 `tsc --build`（利用 project references 做增量檢查）。

### A4. pre-commit hook

`.husky/pre-commit` 或透過 `simple-git-hooks`：

- `pnpm check:fixtures`（已有）
- `biome check --staged`（只檢查 staged 檔案）
- `pnpm compile`（型別檢查，確保不會 push 壞掉的型別）

**注意**: 溝通確認用戶願意裝 husky，或保持 git config `core.hooksPath` 方式（目前使用的 `scripts/git-hooks`）。

---

## Phase B — 儲存層統一與 API 層升級

### B1. SQLite Migration 系統

**目標**: 為 `pending-db.ts` 的 SQLite 實例加入正式 migration 機制，結束 `CREATE TABLE IF NOT EXISTS` 內聯做法。

**方案**: 使用 `sqlite-up`（TypeScript-first, 支援 better-sqlite3 provider）或自建輕量 migrator。

**實作**:

- `packages/backend/src/db/` 新增目錄
- `packages/backend/src/db/migrator.ts` — 包裝 sqlite-up 或自訂 migrator
- `packages/backend/src/db/migrations/` — migration 檔案（TS 或 SQL）
- 001 號 migration: 現有 `pending_topics` 表的完整 schema
- backend 啟動流程改為: `initDb()` → `runMigrations()` → `initServer()`
- 保留 `initPendingDb()` 內部遷移至 migrator

**驗證**:

- 乾淨資料庫啟動後自動執行 migration → `pending_topics` 表存在
- 已存在資料庫啟動時跳過已執行 migration
- 測試中可用 `:memory:` 資料庫執行 migration

### B2. Batch 與 Prompt 儲存遷移 (JSON → SQLite) — 評估

**目標**: 評估將 `batch-store.ts` 和 `prompt-store.ts` 從 JSON file-based 遷移到 SQLite 的 scope。

**現狀**:
- `batch-store.ts` 自身註解：`// for high concurrency, should migrate to SQLite`
- `prompt-store.ts` 同樣是 JSON file-based，`listPrompts()` O(n) IOPS

**評估項目**:
1. 資料量：目前有多少 batch/prompt 記錄？(答：開發階段，量少)
2. 並發需求：真的有高並發場景嗎？(答：MVP 階段，單人運營)
3. 遷移成本：改寫所有 store 方法 + 資料遷移腳本

**決策**: **延後到 Phase E 或後續**。當前 JSON file-based 對於單人運營場景足夠。做以下最小改動就好：
- `batch-store.ts` 和 `prompt-store.ts` 加入 Promise-based 的鎖控制（async mutex），防止並發寫入損壞
- 記錄數超過 threshold 時自動告警（提示遷移時機）

### B3. TypeBox API Schema

**目標**: 為所有 Fastify 路由加上 TypeBox type provider，獲得編譯期型別安全和自動 400 驗證。

**安裝**:
```
pnpm --filter backend add @sinclair/typebox @fastify/type-provider-typebox
```

**改法**:

1. `packages/backend/src/index.ts`:
```typescript
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'

const server = Fastify({ logger: true }).withTypeProvider<TypeBoxTypeProvider>()
```

2. 為每個 route 定義 schema（分階段進行，先從最關鍵的路由開始）:
   - Priority 1: `POST /api/v1/pending/generate` (接受用戶輸入)
   - Priority 2: `POST /api/v1/auth/login` (認證)
   - Priority 3: `POST /api/v1/pending/:id/approve` (資料寫入)

3. 每個 schema 範例:
```typescript
import { Type, Static } from '@sinclair/typebox'

const GenerateBody = Type.Object({
  topic: Type.String({ minLength: 1 }),
  facts: Type.Optional(Type.Array(Type.String())),
  fewShot: Type.Optional(Type.String()),
})

// 寫法 1: 在 handler 簽名上用泛型
server.post<{ Body: Static<typeof GenerateBody> }>('/api/v1/pending/generate', {
  schema: { body: GenerateBody },
}, async (req, reply) => {
  // req.body 型別為 Static<typeof GenerateBody>
})
```

4. 回應 schema 也加上（啟用 fast-json-stringify，提升 throughput）

### B4. 標準化錯誤回應

**目標**: 統一 API 錯誤格式，當前是鬆散的 `{ ok, error }`。

**方案**:
- 定義 ErrorResponse TypeBox schema
- 建立 `packages/backend/src/lib/errors.ts` — 標準錯誤類
- Fastify `setErrorHandler` 統一格式化錯誤輸出
- 所有路由透過 `reply.send()` 或 `throw` 標準錯誤

**回應格式**:
```typescript
// 成功
{ ok: true, data: { ... } }

// 錯誤
{ ok: false, error: { code: string, message: string, details?: any } }
```

---

## Phase C — 前端 UI 升級

### C1. Error Boundary

**目標**: 防止 React render error 導致白畫面。

**新檔案**: `packages/extension/entrypoints/sidepanel/components/ErrorBoundary.tsx`

**實作**:
- class component 實作 `componentDidCatch`
- 顯示 fallback UI（「發生錯誤，請重啟 Side Panel」+ 重新載入按鈕）
- 記錄錯誤到 `console.error`（之後可接入結構化日誌）

**包裝對象**:
- `App.tsx` 最外層
- 各獨立面板（`BatchView`, `PendingTopicsView`, `HistoryPanel`）

### C2. CSS 治理 — CSS Modules 導入

**目標**: 逐步取代 inline `React.CSSProperties` 物件。

**方案**: 使用 CSS Modules（Vite 原生支援 `.module.css`，無需額外套件）。

**優先改動的元件**:
1. `Settings.tsx` — inline styles 最嚴重，先遷移
2. `BatchView.tsx` — 複雜 UI，CSS Modules 提升可維護性
3. `PendingTopicsView.tsx` — 展開卡 + 編輯區

**不改的**: 小型單一用途元件保留 inline styles（無抽象成本）

**檔案命名**: `ComponentName.module.css` 放在同層目錄

**主題系統**: 建立 `packages/extension/entrypoints/sidepanel/styles/variables.css` — 共用 CSS 變數（顏色、間距、字型），讓所有元件引用同一組 token。

### C3. Loading States & Skeleton

**目標**: 消除資料載入時的空白/閃爍。

**實作**:
- `PendingTopicsView`: 首次載入顯示簡易 skeleton（灰色條塊模擬列表項）
- `BatchView`: 批次列表載入時顯示 spinner
- `HistoryPanel`: 歷史記錄載入中顯示 loading indicator
- 非同步請求（fetch prompts, fetch batches）統一用 `useAsync` 或自訂 hook 管理 loading/error/data 三態

### C4. App.tsx 清理

**目標**: 移除空的 `CSSProperties` 物件和不必要的程式碼。

- 找到 `const btn: React.CSSProperties = {}` 這種空宣告 → 移除
- 整理 import 排序
- 確認所有元件有正確的 key props

---

## Phase D — 測試補強

### D1. CI 加入 `pnpm compile`

**現狀**: CI (`.github/workflows/ci.yml`) 只跑 `pnpm test`，不跑型別檢查。

**改法**:
```yaml
- name: Type check
  run: pnpm compile
```

**注意**: 當前 extension 有 4 個既有 tsc error（`lib/types.ts`: `chrome.i18n` 等），需先確認這些是已知問題還是新引入。

### D2. 補齊測試缺口

**優先級 1 — 關鍵路徑 E2E**:
- `batch → approve → generate → fill → publish` 完整流程（使用真實元件掛載）
- 模擬 `PendingTopicsView` 中 approve 一個 topic → 呼叫 `POST /api/v1/batches` → 顯示在 `BatchView`

**優先級 2 — Scraper 整合測試**:
- `adapter` → `fact-extractor` → `pending-db` 串接：用 mock adapter 產出 ScrapedContent → 驗證 fact extractor 正確解析 → 驗證 pending-db 正確存入
- 使用 `better-sqlite3` 的 `:memory:` database 跑測試

**優先級 3 — UI 元件測試**:
- `PendingTopicsView`: render → 顯示 pending list → 展開詳情 → approval 流程
- `HistoryPanel`: render with mock history data
- `Settings`: render → 欄位變更 → 保存

### D3. Vitest Coverage Gate

**現狀**: 無 coverage 閘門。

**改法**: 在 `vitest.config.ts` 中加入 coverage 設定（非 blocking，用於監控趨勢）:
```typescript
test: {
  coverage: {
    provider: 'v8',
    reporter: ['text', 'lcov', 'html'],
    include: ['src/**'],
    exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
  },
}
```

CI 中加入 `pnpm test -- --coverage`，但不設定 fail threshold（初期用於 tracking，避免覆蓋率數字破壞 CI）。

---

## Phase E — 維運與安全

### E1. Rate Limiting

**安裝**: `pnpm --filter backend add @fastify/rate-limit`

**設定**:
```typescript
import rateLimit from '@fastify/rate-limit'

await server.register(rateLimit, {
  max: 100,           // 每 IP 每分鐘 100 請求
  timeWindow: '1 minute',
})
```

**更嚴格的路由**:
- `POST /api/v1/auth/login`: max 5 per minute（防暴力破解）
- `POST /api/v1/pending/generate`: max 20 per minute（防濫用 AI 生成）

### E2. CORS 收窄

**現狀**: `origin: '*'`（開發方便）。

**改法**: 
- 開發環境保持 `origin: '*'`
- 正式環境限制為 extension origin 或特定域名
- 讀取 `process.env.CORS_ORIGIN`（預設為 extension 的 origin `chrome-extension://`）
- `.env.example` 更新說明

### E3. JWT Refresh Token

**現狀**: 靜態 access token，7 天過期後需重新登入。

**方案**（MVP 化）:
- Access token: 15 分鐘（保持短有效期）
- Refresh token: 7 天（存 httpOnly cookie 或在 response body 傳遞）
- `POST /api/v1/auth/refresh` 端點
- Extension background 中：在 access token 到期前自動 refresh
- 不改登入流程（仍然 JWT）

**注意**: 由於 extension 是 SPA + background script，refresh token 不能用 httpOnly cookie（非 server-to-browser 場景），所以 refresh token 需存 chrome.storage.local。這意味著 XSS 仍有機會讀取。權衡之下：MVP 階段維持現狀（access token only, 7d expiry）可能性更高。可放在 **Phase F** 或更後。

**決策建議**: **延後**到有更多用戶時再做。目前單人運營，JWT 長有效期夠用。

### E4. 結構化日誌

**目標**: 取代散落的 `console.log()` / `console.error()`。

**方案**: 使用 `pino`（Fastify 內建 logger）。

**Backend**:
- Fastify 已內建 `logger: true`
- 所有 `console.log` / `console.error` 改為 `request.log.info()` / `request.log.error()`
- 非 request 上下文（scheduler, startup）使用 `server.log.info()`
- 日誌級別: `info`（生產）, `debug`（開發）

**Extension**:
- 建立簡單的 logger 抽象 `packages/extension/lib/logger.ts`
- 提供 `logger.info()`, `logger.error()`, `logger.warn()`
- 開發環境輸出到 console，生產環境可選擇儲存或靜默
- 統一格式: `[51publisher] [level] message {context}`

### E5. Config Routes 持久化

**現狀**: `config-routes.ts` 的 site/scraper mappings 存記憶體，重啟後遺失。

**改法**（最小改動）:
- 將 mappings 存入 `pending-db.sqlite` 的 `config` 表（或另外的 `config.json`）
- 啟動時從持久化層讀取
- `POST /api/v1/config/scraper-mapping` 寫入時同時寫記憶體 + 持久化層
- 文件加註：正式版建議遷到獨立的 `config.sqlite` 或 Redis

---

## 執行檢查清單 (逐項驗證)

### Phase A
- [ ] `packages/shared/` 可 build，產出正確的 `.d.ts` + `.js`
- [ ] Backend 所有 `import` 從 `./shared/` 改為 `@51publisher/shared`
- [ ] Extension 所有 `import` 從 `./lib/` 改為 `@51publisher/shared`
- [ ] 刪除舊的 `backend/src/shared/` 和 `extension/lib/` 的重複檔案
- [ ] `pnpm test` 全綠
- [ ] `pnpm compile` 零錯誤
- [ ] Biome installed, `pnpm lint:ci` 通過
- [ ] CI 中新增 `pnpm compile` 和 `pnpm lint:ci`
- [ ] pre-commit hook 可執行（biome check + compile）

### Phase B
- [ ] Migration 001 可對 `:memory:` database 執行
- [ ] `pending-db.ts` 載入流程改用 migrator
- [ ] 至少 3 個關鍵路由有 TypeBox schema
- [ ] 錯誤回應格式標準化
- [ ] 測試驗證 schema validation 正確

### Phase C
- [ ] ErrorBoundary 包住 App.tsx 和主要面板
- [ ] `variables.css` 存在，元件開始引用
- [ ] 優先元件（Settings, BatchView）CSS Modules 遷移完成
- [ ] Loading state 覆蓋主要資料載入點
- [ ] `App.tsx` 清理完成

### Phase D
- [ ] CI 跑 `pnpm compile`
- [ ] 至少 1 個 E2E 流程測試（batch → approve → generate → fill）
- [ ] Scraper 整合測試：adapter → fact-extractor → pending-db
- [ ] `PendingTopicsView`, `HistoryPanel`, `Settings` 元件測試
- [ ] Coverage 設定存在（不 blocking CI）

### Phase E
- [ ] Rate limiting 啟用
- [ ] CORS 收窄（production origin 限制）
- [ ] Backend console.log 改為 `request.log.info()` / `server.log.info()`
- [ ] Extension logger 抽象
- [ ] Config routes 持久化

---

## 風險與緩解

| 風險 | 影響 | 緩解 |
|------|------|------|
| `packages/shared/` 遷移時發現兩邊 types.ts 有語意 diff | 型別不一致導致編譯錯誤 | 先 `diff` 比對兩邊，手動確認每個欄位差異 |
| `pnpm-sync` 未正確同步 shared package 到 consumer | WXT 打包時拿到舊版 dist/ | 使用 `dependenciesMeta.injected: true` for extension；或在 extension build 前先 build shared |
| CI 加入 `pnpm compile` 後紅燈 | 團隊需花時間修既有 error | 先行確認 extension 4 個既有 error 是否已知；若非已知先修再開啟閘門 |
| Biome lint 掃出大量 warning | 干擾開發 | 第一階段只 check staged files；設定 low-noise rules（只開 error-level） |
| SQLite migration 與現有資料衝突 | 測試環境資料毀損 | 一律從 backup 還原測試，正式遷移前備份 |

---

## 不做的項目（明確排除）

- **Turborepo/Nx build orchestration**: 目前 monorepo 規模不需要
- **CI/CD 平台遷移**: 維持 GitHub Actions
- **Docker 化**: 暫無容器化需求
- **新框架遷移**: 不引入 Tailwind（會增加 extension bundle size）、不換框架
- **全量 TypeBox schema**: 只對關鍵路由加 schema，不強求 100% 覆蓋
- **Redis/外部快取**: 單人運營階段不需要
- **E2E 測試自動化**: 仍維持手動執行 `pnpm test:e2e`

---

## 參考資料

- Fastify 5 TypeBox: https://fastify.io/docs/latest/Reference/Type-Providers/
- WXT Shadow DOM FAQ: https://wxt.dev/guide/resources/faq.html
- sqlite-up: https://github.com/sandrinodimattia/sqlite-up
- Biome: https://biomejs.dev
- pnpm workspace protocol: https://pnpm.io/workspaces
