---
date: 2026-06-12
topic: gossip-site-pipeline
---

# 吃瓜素材管線：用戶自定義站點爬取 + 文章生成

## Problem Frame

現有 scraper pipeline 只支援 51acgs.com 一個站點，且 FactsBlock schema 是 ACG
題材的硬碼欄位（作品名/集數/制作/漢化...），無法用於吃瓜（娛樂新聞/明星八卦）題材。

目標：讓用戶在 Sidepanel 輸入任意吃瓜站點的主站 URL，系統自動發現最新文章清單、提取吃瓜事實，並提供逐條生成文章的入口。後端 API 驅動，Sidepanel 為前端入口。

## 用戶流程

```
[Sidepanel] 設定頁籤
   ↓ 輸入主站 URL（如 https://example-gossip.com/latest）
   ↓ 點「發現資源」

[Backend] 通用爬蟲
   ↓ fetchList：掃主站，提取所有文章詳情頁 URL
   ↓ 選取最新 N 條（未曾爬取過的）

[Sidepanel] 吃瓜素材頁籤
   ↓ 顯示文章標題清單（帶縮圖/時間）
   ↓ 用戶點選一條

[Backend] 事實提取
   ↓ fetchContent → RawContent
   ↓ LLM 提取吃瓜 FactsBlock（新 schema）
   → 進入 pending_topics（狀態 pending）

[Sidepanel] 草稿生成
   ↓ 用戶確認後，呼叫現有草稿生成 API
   → Draft 進入現有發帖流程
```

## Requirements

**站點管理**
- R1. 用戶可在後端 API 新增/刪除/列出「吃瓜站點」設定，每個站點包含：主站清單頁 URL、站點名稱、啟用狀態。
- R2. 站點 URL 須通過 SSRF guard（與現有 `ssrf-guard.ts` 一致），User-submitted URL 不進 allowlist 白名單，改用寬鬆規則（只禁止私有 IP / loopback）。
- R3. Sidepanel 設定頁籤展示站點清單，支援新增/刪除操作。

**資源發現（通用 adapter）**
- R4. 新增 `generic-adapter`，透過 heuristic HTML 解析發現詳情頁 URL：提取所有 `<a href>` 並過濾符合「詳情頁路徑」特徵的連結（路徑包含數字 ID 或日期段）。
- R5. 爬取記錄去重：已進入 pending_topics 的 URL 不重複爬取（以 URL 為 unique key）。
- R6. 每次發現最多返回 20 條最新 URL，超過時只取前 20。

**吃瓜事實提取**
- R7. 新增 `GossipFactsBlock` 型別（在 `shared/` 中），欄位：`當事人`（人名/組合）、`事件摘要`、`起因`、`經過`、`結果`、`來源連結`、`發生時間`、`熱度標籤`（如「出軌」「解約」「撕逼」）。
- R8. 新增吃瓜專用的 `fact-extractor` prompt：只從原文提取，不編造，缺失欄位設 null；使用 json_schema structured output 保證格式。
- R9. `pending_topics` 需能存放 GossipFactsBlock（透過既有 JSON 存儲，不改表結構）。

**Sidepanel 前端**
- R10. 新增「吃瓜素材」頁籤（tab），展示：每個已設定站點的最新資源清單（標題 + 來源站點 + 爬取時間）。
- R11. 每條資源提供「生成文章」按鈕，點擊後觸發事實提取 + 進入 pending，並跳轉至現有草稿生成流程。
- R12. 頁籤提供「刷新」按鈕，手動觸發最新資源發現（不依賴 cron）。

**後端 API**
- R13. `POST /scraper/sites` — 新增站點設定。
- R14. `GET /scraper/sites` — 列出所有站點。
- R15. `DELETE /scraper/sites/:id` — 刪除站點。
- R16. `POST /scraper/sites/:id/discover` — 觸發資源發現，返回新發現的 URL 列表。
- R17. `POST /scraper/topics/from-url` — 對單條詳情頁 URL 執行 fetch + 吃瓜事實提取，寫入 pending_topics。

## Success Criteria

- 用戶輸入一個吃瓜站點 URL 後，能在 Sidepanel 看到至少 5 條文章標題。
- 點選一條後，吃瓜 FactsBlock 能從原文正確提取「當事人」和「事件摘要」（不為 null）。
- 草稿生成的文章使用吃瓜事實欄位，不出現 ACG 欄位（作品名/集數/漢化）。
- 對任意輸入的公開 URL，SSRF guard 能攔截私有 IP 請求。

## Scope Boundaries

- 不在此次範圍：吃瓜文章的 Quill 填充欄位映射（field-mapping 改動留給下一個計劃）。
- 不在此次範圍：cron 自動排程（手動刷新已足夠驗證流程；cron 掛鉤可後加）。
- 不在此次範圍：對每個站點寫專屬 adapter（generic-adapter 優先，不夠再補）。
- 不在此次範圍：吃瓜文章審閱/編輯 UI（沿用現有草稿編輯介面）。

## Key Decisions

- **通用 adapter 優先**：不為個別吃瓜站點寫 hardcode 解析，用 heuristic + LLM fallback，降低維護成本。如遇特定站點解析效果差，再補 per-site adapter。
- **GossipFactsBlock 為新型別**：不修改現有 FactsBlock（ACG 用途），兩套 schema 共存於 shared/。
- **SSRF 策略鬆綁**：用戶自定義站點不走 allowlist，改走「只禁私有 IP」規則，否則需要用戶手動維護白名單。
- **pending_topics 復用**：不新建資料表，GossipFactsBlock 序列化進 facts 欄位的 JSON，以 `domain` 欄位區分 ACG / gossip。

## Dependencies / Assumptions

- `ssrf-guard.ts` 可接受「私有 IP 禁止，其餘放行」的新模式（需驗證目前實作是否支援）。
- Sidepanel React 結構允許新增頁籤（目前已有 batch/settings/history，結構可擴展）。
- 吃瓜站點的清單頁結構夠規律，heuristic `<a href>` 過濾能取到詳情頁 URL（假設大多數站點有數字 ID 路徑）。

## Outstanding Questions

### Resolve Before Planning
- [影響 R2][用戶決策] 對用戶自定義 URL，SSRF 策略是「只禁私有 IP / loopback」，還是需要用戶手動加入白名單才能抓取？（涉及安全與易用性的取捨）

### Deferred to Planning
- [影響 R4][需調查] `ssrf-guard.ts` 目前的 allowlist 機制能否輕鬆加入「私有 IP 禁止」模式，或需要重構？
- [影響 R7][技術] `GossipFactsBlock` 是否放在 `shared/src/gossip-facts.ts` 獨立檔案，還是擴展現有 `facts.ts`？
- [影響 R9][技術] `pending_topics` 的 `facts` 欄位目前是 `FactsBlock` 型別，存 `GossipFactsBlock` 需要哪些型別改動？
- [影響 R10][技術] Sidepanel 頁籤架構是否有 tab registry 或需要手動在 router 中新增？

## Next Steps
→ 解決「Resolve Before Planning」中的 SSRF 策略問題，然後 `/ce:plan`
