---
date: 2026-06-17
type: refactor
status: completed
slug: health-checkup-cleanup
---

# refactor: 健康巡檢後的死代碼清理 + 真實 bug 修復

## Problem Frame

「吃瓜小幫手」由「發帖/填表工具」大重構而來，刪了約 2 萬行發布機器。本輪先做**四維健康巡檢**（正確性 / 安全 / 可維護性 / 性能，各一個獨立 reviewer 子代理掃 main），用真實發現驅動優化，而非憑空猜。

巡檢結論：性能整體穩（無高/中問題），但浮出兩類真實工作——
1. **發布時代刪剩的孤兒死代碼**：與「不發布、不寫回任何站點」硬約束直接矛盾，且其中一條被正確性代理誤判為「快取 bug」，根因其實是「表永遠為空」。
2. **若干真實 bug 與承諾/現實不符**：1 個 P1（路徑前綴越權）、3 個 P2（CSV 公式注入、fewshot 往返損壞、discover 翻頁丟結果）、1 組死依賴+陳舊文檔。

用戶已拍板：死代碼**全刪**、FieldMapping **本輪一併下線**、修復項**全收**。

## Requirements Trace

| ID | 需求 | 來源 |
|----|------|------|
| R1 | 刪除 revisit-job + published_posts 表 + pending-store 的 publishedPenalty 死分支 | 可維護性 high + 正確性 P1（同根因）|
| R2 | 刪除 draft-diff.ts（零生產消費者）及其測試 | 可維護性 medium |
| R3 | 下線 FieldMapping 全鏈：config-routes mappings 端點 + Settings UI + DraftStatus/FieldFillResult 的 filled/published 態 | 可維護性 medium（用戶確認下線）|
| R4 | 修 enforcePathPrefix 邊界越權（startsWith 無分隔符）| 正確性 P1 |
| R5 | 修 CSV 公式注入（escapeCsv 未中和 =+-@ 起首）| 安全 P2 + 正確性 P2（雙代理確認）|
| R6 | 移除 dompurify 死依賴 + recipe.ts 裁到只剩 host + 修正 CLAUDE.md/註解對不存在的 sanitize.ts 的承諾 | 安全殘留 + 可維護性 medium |
| R7 | 修 fewshot derive/parseFewShotExamples 文本往返損壞 | 正確性 P2 |
| R8 | 修 discover 翻頁無游標（maxDepth>1 時第 21+ 條發現被丟且無法續取）| 正確性 P2 |

## Scope Boundaries（非目標）

- **不動 telegram.ts**：scheduler.ts 仍用 `sendAlert`，僅 revisit-job 對它的引用消失。telegram 留。
- **不動 extractFacts / scraper-routes / scheduler**：巡檢一度疑為死碼，已證實是**活路徑**（扩展 `pending-client.ts` 調 `/api/v1/scraper/trigger`、`/adapters`，UI 引用）。保留。
- **不動 fewshot 功能本身**：分支名 `eliminate-fewshot-dual-truth` 指已併入的舊重構；fewshot 是活功能（Settings UI + 後端 prompt-store + shared），只修 R7 的序列化 bug。
- **不做內部包名 publisher-* 改名**：牽動 CI/腳本/`--filter`，價值低、連鎖成本高，留 backlog。
- **不做 Docker 打包 / CI Node 24 升級**：留 backlog。
- **性能巡檢三條 low 不動**：當前規模（列表硬封 500、source_url 有 UNIQUE 索引、翻頁受設計約束有 50 頁閘）無實際影響，過早優化。

## Implementation Units

### U1 — 刪 revisit-job + published_posts + publishedPenalty（R1）

- [x] **Goal**：移除與「不發布」硬約束矛盾的整套發布回訪機制；順手消滅正確性 P1（getPublishedTitles 讀永空表）。
- **Files**：
  - 刪 `packages/backend/src/services/revisit-job.ts` + 其測試
  - `packages/backend/src/app.ts`：移除 import（:26）與啟動調用（:350-351）
  - `packages/backend/src/config/env-check.ts`：移除 REVISIT_ALLOWED_HOSTS 校驗（:57-62）
  - `packages/backend/src/scraper/pending-store.ts`：移除 publishedPenalty 分支 + getPublishedTitles + invalidatePublishedTitlesCache（:106-159），computeScore 簡化為 fieldCompleteness × freshnessDecay，更新注釋
  - `packages/backend/src/migrations/runner.ts`：published_posts 建表
  - `.env.example`：移除 REVISIT_* 鍵與說明
- **Approach**：先刪消費者（app/env-check/pending-store）再刪 revisit-job 本體，最後處理表。
- **Execution note（characterization-first）**：改 computeScore 前先跑既有 pending-store 測試捕捉現行打分輸出，確保移除恆 0 的 publishedPenalty 後分數不變（×1.0 等價）。
- **Implementation-Time Unknown**：published_posts 表的處理方式——migration 是 append-only，**不可改舊 migration 刪表**（會破壞已遷移 DB 的歷史）。二選一：(a) 新增一條 migration `DROP TABLE IF EXISTS published_posts`；(b) 保留空表只刪代碼。建議 (a)，但需確認 runner.ts 的 migration 機制支持遞增追加。執行期定。
- **Test scenarios**：computeScore 對同一 topic 在移除前後分數一致（characterization）；後端啟動不再註冊 `__revisit_*` cron；env-check 在無 REVISIT_* 時正常放行。
- **Verification**：`grep -rn "revisit\|published_posts\|publishedPenalty" packages/backend/src` 僅剩 migration drop（若選 a）；pnpm -r test 全綠。

### U2 — 刪 draft-diff.ts（R2）

- [x] **Goal**：移除零生產消費者的槽位 diff 模塊。
- **Files**：刪 `packages/extension/lib/draft-diff.ts` + `draft-diff.test.ts`。
- **Approach**：grep 確認非 dist/非測試引用為零後直接刪。
- **Verification**：`grep -rn "draft-diff\|computeSlotDiff" packages/extension`（排除 dist）零命中；pnpm compile 通過。

### U3 — 下線 FieldMapping 全鏈（R3）— 最大、最需謹慎

- [x] **Goal**：拆除目標站表單填充語義（填表時代產物，新架構只導出不寫回）。
- **Files**（分步，按依賴序）：
  - 後端：`packages/backend/src/routes/config-routes.ts` 的 `/api/v1/config/mappings` GET/POST + loadMappings/saveMappings
  - 扩展：`entrypoints/sidepanel/components/FieldMappingSection.tsx`、`Settings.tsx` 引用、`lib/config-client.ts` mappings 調用、`lib/storage.ts` 相關持久化
  - shared：`src/field-mapping.ts`、`src/types.ts` 的 `DraftStatus` 移除 `filled`/`published`、`FieldFillResult`（含 status `filled`）
- **Approach**：UI → client → 後端端點 → shared 類型，自上而下拆，每步 compile 守門。
- **Implementation-Time Unknown**：`DraftStatus = "draft"|"filled"|"published"` 與 `publishedAt` 等欄位可能仍被 UI/導出/storage 引用為一等公民。執行期先 grep 全部消費點，逐一評估：純導出工具是否只需 `"draft"` 單態，或保留 `"draft"|"exported"`。**這步若牽連過廣，拆成獨立子 commit 並可在本輪內回退到「只拆 config-routes + UI、暫留類型態」的保守線**。
- **Execution note**：跨三包，serial 執行，每包一個 commit。
- **Test scenarios**：Settings 頁不再渲染 FieldMappingSection 且無 console 報錯；移除 mappings 端點後 config-client 無殘留調用（401/404 路徑不被觸發）；shared 類型變更後 backend+extension compile 全綠；既有導出測試（JSON/MD/CSV）不受 DraftStatus 變更影響。
- **Verification**：`grep -rn "FieldMapping\|field_mappings\|FieldFillResult" packages`（排除 dist/coverage）僅剩刻意保留項；三包 compile + test 全綠。

### U4 — 修 enforcePathPrefix 邊界越權（R4，P1）

- [x] **Goal**：堵住 `/news` 前綴放行 `/newsletter`、`/news-admin` 的越權。
- **Files**：`packages/backend/src/scraper/adapters/generic-adapter.ts:26-40`。
- **Approach**：歸一 prefix 去尾斜杠後要求分隔符邊界：
  ```
  const norm = prefix.replace(/\/+$/, "") || "/";
  const ok = norm === "/" || path === norm || path.startsWith(norm + "/");
  ```
- **Execution note（test-first）**：先寫失敗用例 `/news` 應拒 `/newsletter`。
- **Test scenarios**：prefix `/news` → 接受 `/news`、`/news/x`，拒絕 `/newsletter`、`/news-admin`、`/newsX`；prefix `/`（root）放行全部；prefix `/news/` 末尾斜杠歸一後行為一致。
- **Verification**：新增邊界測試紅→綠；既有爬取測試不回歸。

### U5 — 修 CSV 公式注入（R5，P2，雙代理確認）

- [x] **Goal**：導出的 .csv 在 Excel/Sheets 打開時不執行來自不可信外站內容的公式。
- **Files**：`packages/shared/src/export.ts:82-89`（escapeCsv）。
- **Approach**：對 string 類型值，若以 `= + - @ \t \r` 起首，先前置單引號（或 Tab）再做現有 RFC 引號包裹；數字/score 列不誤傷。
- **Execution note（test-first）**。
- **Test scenarios**：`=HYPERLINK(...)`、`+1`、`-cmd`、`@x`、Tab/CR 起首值各自被中和；普通含逗號/引號/換行值仍正確 RFC 轉義；純數字 confidence/score 不被加引號。
- **Verification**：新增注入用例綠；既有 export 測試不回歸。

### U6 — 移除 dompurify 死依賴 + 修正 sanitize 承諾（R6）

- [x] **Goal**：消滅「承諾與現實不符」——dompurify 全 extension 僅 recipe.ts 一句註解提到，無 import；`sanitize.ts` 不存在；CLAUDE.md 卻聲稱正文走 dompurify 消毒。
- **Files**：
  - `packages/extension/package.json`：移除 `dompurify` 依賴
  - `packages/extension/lib/recipe.ts`：裁到只剩 `host`（messaging.ts 唯一消費 `DEFAULT_RECIPE.host`），刪 FieldMapping/發布配置/消毒白名單等發布時代字段與 SiteRecipe 接口
  - `CLAUDE.md`：修正「XSS 消毒：正文 HTML 經 lib/sanitize.ts 白名單消毒」——改為描述現實（draft.body 在 DraftPreview textarea 純文本展示，當前無 HTML 渲染點）
  - `packages/backend/src/routes/channel-routes.ts` 等註解若提及 sanitize.ts 一併修正
- **Decision rationale**：當前 `draft.body` 走 textarea 純文本展示，無 live XSS；故走「移除死依賴 + 修文檔」而非「補回 sanitize 層」。**未來若新增 HTML 預覽渲染，必須同步引入消毒**——此約束寫入 CLAUDE.md 安全段。
- **Verification**：`grep -rn "dompurify\|sanitize" packages/extension CLAUDE.md`（排除 dist）無懸空承諾；pnpm build:extension 通過、bundle 不再含 dompurify。

### U7 — 修 fewshot 往返損壞（R7，P2）

- [x] **Goal**：derive/parseFewShotExamples 文本序列化遇 `---` 或空行靜默損壞。
- **Files**：`packages/extension/lib/storage.ts:174-187`。
- **Approach**：fewShotPairs 已是結構化數組——存取直接走結構化對象，移除文本序列化往返；若某調用方必須文本化，改用不可能出現在內容裡的定界或顯式轉義。執行期先 grep derive/parse 的調用方確定能否直接去掉文本層。
- **Execution note（test-first）**：先寫往返一致性失敗用例（input/output 內含 `\n---\n` 與連續空行）。
- **Test scenarios**：含 `---` 行的 output 往返後不串台；含空行的 pair 不被拆成多個；正常 pair 往返不變。
- **Verification**：往返測試綠；Settings fewshot 編輯流程手測不損壞。

### U8 — 修 discover 翻頁游標（R8，P2）

- [x] **Goal**：maxDepth>1 時 fetchListPaged 算出的第 21..200 條發現不再被 `slice(0,20)` 丟棄且無法續取。
- **Files**：`packages/backend/src/routes/gossip-routes.ts:144-167`。
- **Approach（執行期二選一）**：(a) 接受 `offset`/`cursor` query 對 fresh 做 `slice(offset, offset+20)`；(b) 直接把全部 fresh 入待審池而非只回 20 條。建議 (b) 更簡單且符合「發現即入池」語義，但需確認不撐爆待審池（已有 MAX_PAGED_URLS=200 上限）。
- **Test scenarios**：maxDepth=2 且發現 40 條時，兩次 discover（或一次入池）能取全 40，不重複不丟失；hasMore/total 與實際一致。
- **Verification**：新增多頁 discover 測試綠。

## Execution Strategy

Serial 子代理（依賴與跨包，避免並行 git 爭用——前幾輪吃過 index.lock 的虧）。建議順序：**U4 → U5 → U6 → U7 → U8（純修復，低風險先落，可早 commit）→ U2（簡單刪）→ U1（死碼刪 + characterization）→ U3（最大、最謹慎，放最後）**。每單元獨立 commit。

## Dependencies / Assumptions

- 假設 published_posts 表確無任何隱藏寫入者（grep `INSERT INTO published_posts` 零命中已驗證）。
- 假設 runner.ts migration 機制支持遞增追加新 migration（U1 表處理待執行期確認）。
- U3 假設 DraftStatus 的 filled/published 態無導出相關的真實用途——執行期 grep 全消費點確認；牽連過廣時回退保守線。

## Verification（全輪收尾）

```
pnpm --filter @51guapi/shared build
pnpm -r compile && pnpm -r test && pnpm lint:ci
pnpm build:extension   # 確認 bundle 不含 dompurify
bash scripts/check-all.sh
```

全綠 + 死碼 grep 清零 + 新增測試覆蓋 R4/R5/R7/R8。

## Post-Deploy Monitoring & Validation

本工具為本地/自託管的爬取-導出鏈，無生產發布面。驗證窗口為合併後一次本地完整 `check-all.sh` 綠燈即可。重點觀察信號：後端啟動日誌不再出現 `[revisit]`；導出 CSV 用 Excel 打開不觸發公式；渠道 path_prefix 配 `/news` 時 `/newsletter` 被拒（U4 回歸哨兵）。失敗信號：任何 compile/test 紅、或 grep 仍命中已刪死碼符號 → 回退對應單元 commit。
