---
date: 2026-06-17
topic: quality-gate-rewrite
---

# Quality-Gate 全面重寫

## Problem Frame

`shared/src/quality-gate.ts` 和 `backend/src/services/metrics.ts` 含三處 publish-era 遺留 bug，導致吃瓜工作流的品質評分系統性失準：

1. `checkFactsCompleteness` 以舊漫畫字段（作品名/集数/制作/漢化/無修/题材/简介）評估吃瓜草稿，GossipFactsBlock 字段與之完全不重疊，所有吃瓜草稿的完整度分永遠為 0。
2. `community_tone` 的詞彙表含漫畫推廣黑話（51娘/安利/入坑/神作/宝藏），與吃瓜敘事文風無關，正確的吃瓜草稿反被懲罰。
3. `metrics.ts` 輸出 `publisher_publish_attempts_total` 計數器，但 `recordPublishAttempt()` 從未被呼叫（publish 功能已移除），永遠為 0 的死指標污染監控端點。

## Requirements

**Quality-gate 事實完整度修正**
- R1. `checkFactsCompleteness` 的 `coreKeys` 改為吃瓜核心敘事字段：`["當事人", "事件摘要", "起因", "經過", "結果"]`（5 個字段，排除 來源連結（機械字段）、發生時間、熱度標籤）。
- R2. 通過門檻維持 ratio ≥ 0.5（5 個字段中至少 3 個有值），與既有邏輯一致。
- R3. `checkFactsCompleteness` 的 `facts` 參數型別從 `FactsBlock` 更新為 `GossipFactsBlock`；`evaluateQuality` 的第二個參數型別同步更新為 `facts?: GossipFactsBlock`。回傳型別（`QualityCheck` / `QualityVerdict`）及其他呼叫方介面不變。

**Quality-gate 語氣檢查更新**
- R4. `community_tone` 的 `toneWords` 替換為吃瓜語境詞彙，例如：`["爆料", "知情人", "当事人", "疑似", "曝光", "回应", "否认", "澄清", "撕逼", "吃瓜", "坐实", "目击", "网传", "官方"]`（以簡體為主，與 LLM 輸出語言一致）。
- R5. 通過條件維持 found.length ≥ 2，score 計算方式不變。
- R6. check name（`"community_tone"`）、回傳結構不變。
- R7-llm. `backend/src/services/llm.ts` 的 `DEFAULT_CRITERIA.community_tone` 從「文风贴近动漫社区，口语化接地气」更新為吃瓜文風描述（如「用词贴近吃瓜娱乐报道，含知情人/爆料/疑似等词汇」）；`DIM_LABELS.community_tone` 從「需更贴近动漫社区口吻」更新為「需更贴近吃瓜娱乐报道口吻」。

**Metrics 死碼清除**
- R7. 移除 `metrics.ts` 的 `counters.publishAttempts` 欄位。
- R8. 移除 `recordPublishAttempt()` 函式的定義與 export。
- R9. 移除 `getMetrics()` 中輸出 `publisher_publish_attempts_total` 的三行 Prometheus 文字。
- R10. 在 `backend/src/services/metrics.test.ts` 中：移除 `recordPublishAttempt` 的 import；從 `resetCounters` helper 刪除 `counters.publishAttempts` 的兩行賦值；從「全零輸出」與「HELP/TYPE 注釋行」測試移除 `publisher_publish_attempts_total` 的 expect；移除整個 `recordPublishAttempt` 遞增測試 case。
- R11. 在 `packages/extension/lib/storage.ts` 中移除 `ExtensionCounters.publishAttempts` 欄位、`defaultExtensionCounters` 中的 publishAttempts 預設值、及 `getExtensionCounters` 合并邏輯中的對應行；在 `packages/extension/lib/storage.test.ts` 中移除 publishAttempts 相關的 3 個測試案例。

**測試 Fixture 更新**
- R12. 更新 `packages/backend/src/quality-gate.test.ts` 的「全部達標」測試：將 `facts` fixture 從漫畫字段（作品名/題材）改為 GossipFactsBlock（含當事人/事件摘要/起因/經過/結果）；將 `body` 從含漫畫社群詞彙（嗨嗨/推薦/宝藏）改為含吃瓜詞彙（爆料/曝光 等），確保 community_tone 在新 toneWords 下仍通過。

## Success Criteria
- `evaluateQuality` 對一份「當事人/事件摘要/起因/經過/結果全填（5/5，高於 ≥3/5 的通過門檻）」的吃瓜草稿，`facts_completeness.pass` 為 `true`。
- `evaluateQuality` 對含吃瓜詞彙（如「爆料」「曝光」）的草稿正文，`community_tone.pass` 為 `true`。
- `GET /api/v1/metrics` 回應不再含 `publisher_publish_attempts_total` 任何標籤。
- `pnpm test` 全綠。

## Scope Boundaries
- 不改動其他三個 checks（body_length、title_quality、tags_accuracy）。
- 不改動 `evaluateQuality` 的函式簽名或通過門檻（DEFAULT_THRESHOLD = 0.6）。
- 不新增 metrics 計數器，僅做減法。
- `quality-gate.ts` 中對 `FactsBlock` 的 import 行，若 R3 型別更新後不再需要，可移除；其他檔案（backend/extension 的 scraper、enrichment-utils 等 30+ 處）對 `FactsBlock` 的引用屬 ACG pipeline，不在本次範圍內，不得修改。

## Key Decisions
- **coreKeys 選 5 個敘事字段**：排除 來源連結（verbatim URL，機械字段，extractor 已特別剔除不計分）、發生時間（非必填）、熱度標籤（AI 推斷，非核心事實）。
- **community_tone 改詞不移除**：保留語氣檢查邏輯，詞彙表換成吃瓜文風用詞。

## Next Steps
→ `/ce:plan` for structured implementation planning
