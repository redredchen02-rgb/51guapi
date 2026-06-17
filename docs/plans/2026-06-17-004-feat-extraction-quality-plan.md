---
date: 2026-06-17
type: feat
status: completed
slug: extraction-quality
---

# feat: 爬取/提煉品質強化 — 更準 + 更全

## Problem Frame

「吃瓜小幫手」核心價值是把爬到的網頁提煉成準確、完整的吃瓜草稿。一個獨立調查代理深掃提煉管線（fetchContent 提取 → gossipExtractFacts 提煉 → computeScore 評分），找出 10 個品質槓桿，收斂成**兩個根因叢集**，用戶已拍板「兩者都做」：

1. **「更準」根因 — confidence/score 只數「非空」不看「質量」**：
   - `gossip-fact-extractor` 的 confidence = 填滿字段占比，脑補與真實同分；恒非空的「來源連結」（就是原文 URL）白送 1/8 分。
   - `computeScore` 的 fieldCompleteness 用 `facts.some(非空)` → 只要 1 個字段非空就滿分，「8 事實全滿」與「只填 1 個 URL」同分，排序失真；且完全沒用手邊現成的 `topic.confidence`；freshness 用入庫時間 `createdAt` 而非事件發生時間，新爬的舊瓜恒判新鮮。
2. **「更全」根因 — 正文提取太弱**：
   - `extractBody` 優先返回 og:description（1-2 句營銷摘要），只在其缺失時才試正文容器；正文容器正則僅匹配 5 個固定 class、且遇**首個同類閉合標籤**即截斷（嵌套 div 被腰斬）。後果：餵給 LLM 的正文常只剩一句 → 起因/經過/結果 幾乎必空。
   - `fetchContent` 標題 `extractH1() || extractTitle()` 優先頁面首個 h1，常抓到站名/欄目名而非文章標題。

## Requirements Trace

| ID | 需求 | 來源 |
|----|------|------|
| R1 | confidence 剔除機械字段（來源連結）白送分；fallback 封頂放寬，不再「只要是 fallback 就腰斬」| 調查 high/medium（gossip-fact-extractor:150,33）|
| R2 | computeScore 的 fieldCompleteness 改用 gossip 8 字段真實非空占比；納入 topic.confidence 作乘數 | 調查 high（pending-store:112）|
| R3 | freshness 改以 publishedTime / 發生時間 為基準，createdAt 僅兜底 | 調查 medium（pending-store:119）|
| R4 | extractBody 重寫：正文容器優先於 og:description、括號配平不再首閉合截斷、文本密度兜底 | 調查 high（generic-adapter:136）|
| R5 | fetchContent 標題優先序修正：og:title → 容器內 h1 → `<title>` | 調查 medium-low（generic-adapter:389）|

## Scope Boundaries（非目標）

- **不做 gossip 跨源富化**（web-enricher 接 gossip）：調查列為高價值高成本，且需新查詢器 + 第二輪提煉，範圍過大，留待專門一輪。
- **不引入 cheerio/readability 重型依賴**：extractBody 用改進的原生正則 + 文本密度啟發式，保持零新依賴（與專案「零 runtime 依賴擴張」一致）。
- **不做完整 grounding 校驗**（verbatim 比對 LLM 輸出 vs 正文）：LLM 會改寫，verbatim 比對易誤殺，成本/風險高。R1 只做「機械字段剔除 + fallback 放寬」這類高信心改動；真 grounding 留作未來。
- **不動清單頁 CTA 噪聲過濾 / parseJinaContent**（低價值或僅 ACG）。

## Implementation Units

### U1 — confidence 計算改進（R1）

- [x] **Goal**：confidence 反映真實提煉質量，不被機械字段與 fallback 標籤系統性扭曲。
- **Files**：`packages/backend/src/scraper/gossip-fact-extractor.ts`（:33 FALLBACK_CONFIDENCE_CAP、:150-159 confidence 計算）；測試 `gossip-fact-extractor.test.ts`。
- **Approach**：
  1. 機械字段剔除：confidence 分母改為「非機械字段」集合——`來源連結`（就是原文 URL，LLM 幾乎總能填）從占比計算中剔除（分母 8→7，或加權 0）。`發生時間` 視情況保留（它需從正文推斷，非純機械）。執行期確認剔除集。
  2. fallback 封頂放寬：`FALLBACK_CONFIDENCE_CAP` 0.3→0.6（fallback 與 strict 同 prompt/同解析/同校驗，質量未必差，差別只是 structured-output 保證）。保留「解析失敗/字段全空時降權」的真實質量信號。
- **Execution note（test-first）**。
- **Test scenarios**：8 字段全填（含來源連結）→ confidence 不因白送的 URL 虛高；只填來源連結 → confidence 接近 0（剔除後）；fallback 模式同樣字段 → confidence 不再被腰斬到 ≤0.3（≤0.6）；strict 全空 → 0。
- **Verification**：新測試紅→綠；既有提取測試不回歸。

### U2 — computeScore 納入真實字段占比 + confidence（R2）

- [x] **Goal**：待審列表 by-score 排序能把「更全更準」的草稿頂上來。
- **Files**：`packages/backend/src/scraper/pending-store.ts`（computeScore :104-125）；測試 `pending-store.test.ts`。
- **Approach**：
  1. fieldCompleteness 的 `hasFacts` 從 `some(非空)` 改為「gossip 8 字段真實非空占比」（0..1 連續值），與 hasTitle/hasBody/hasCover 加權合成。
  2. 納入 `topic.confidence`（已在手邊）作乘數：`score = fieldCompleteness × freshnessDecay × confidenceFactor`（confidence 缺省時取 1，不懲罰舊資料）。
- **Implementation-Time Unknown**：確認 `PendingTopic` 在 computeScore 處能取到 `confidence` 欄位（調查稱「就在手邊」，執行期核 savePendingTopic 入參與 PendingTopic 型別）。
- **Execution note（characterization-first）**：先用既有 pending-store 測試捕捉現行打分，確保改動只「增加區分度」而非翻轉既有相對排序的合理案例。
- **Test scenarios**（排序有效性，調查指定的測試缺口）：構造「8 事實全滿」vs「僅 1 字段(來源連結)」兩條 topic → 斷言前者 score 顯著高於後者（當前會同分）；confidence 高的 vs 低的同完整度 → 高 confidence 勝出；缺 confidence 的舊資料不被懲罰到 0。
- **Verification**：新排序測試綠；既有 computeScore 測試調整後綠。

### U3 — freshness 用發生時間而非入庫時間（R3）

- [x] **Goal**：新鮮度信號有區分力，剛爬的 3 年前舊瓜不再恒判新鮮。
- **Files**：`packages/backend/src/scraper/pending-store.ts`（freshnessDecay :119）；computeScore 測試。
- **Approach**：freshness 基準依序取 `rawContent.metadata.publishedTime` → gossip `發生時間` → `createdAt`（兜底）。解析失敗時退回 createdAt。
- **Implementation-Time Unknown**：`發生時間` 格式多樣（如「2024-05」「2024年5月」），`Date.parse` 可能失敗——失敗即跳到下一個基準，不報錯。
- **Test scenarios**：有 publishedTime（3 年前）→ decay 顯著 <1；無 publishedTime 有 發生時間 → 用之；兩者皆無/不可解析 → 退回 createdAt（與現狀等價，不回歸）。
- **Verification**：新測試綠。

### U4 — extractBody 重寫（R4）— 最高價值

- [x] **Goal**：餵給 LLM 的正文不再被腰斬，起因/經過/結果 提得出來。
- **Files**：`packages/backend/src/scraper/adapters/generic-adapter.ts`（extractBody :136-151）；測試 `generic-adapter.test.ts`。
- **Approach**：
  1. **順序反轉**：正文容器優先；og:description / meta description 降為「容器提取為空時的兜底」。
  2. **括號配平**：匹配到正文容器開標籤後，用同類標籤計數配平找到對應閉合標籤（而非貪婪到首個 `</div>`），正確抓取嵌套容器全文。
  3. **文本密度兜底**：固定 class 都不命中時，掃描候選塊（div/article/section）選文本/標籤比最高者，剝標籤取純文本。
  4. 保留現有去標籤 + 空白歸一。
- **Execution note（test-first）**：先寫嵌套容器、有 og 但容器更全、無 og 純容器三類失敗用例。
- **Test scenarios**：嵌套 `<div class=post-content><p>..</p><div>子</div><p>尾</p></div>` → 抓全（含尾段，不在子 div 處截斷）；有 og:description 但正文容器更長 → 取容器；無 og 無已知 class → 文本密度選中正文塊；純營銷頁（只有 og）→ 退回 og:description（不回歸）。
- **Verification**：新測試綠；既有 generic-adapter 提取測試不回歸（特別是現有的 og:description 兜底案例）。

### U5 — 標題優先序修正（R5）

- [x] **Goal**：標題不再系統性錯成站名/欄目名。
- **Files**：`packages/backend/src/scraper/adapters/generic-adapter.ts`（fetchContent :389、extractTitle/extractH1）；測試。
- **Approach**：title 優先序改為 `extractOgMeta("og:title") → extractTitle(<title>) → extractH1()`。og:title 通常是最可靠的文章標題；h1 降為末位兜底（避免站名污染）。執行期確認既有測試對 title 來源的假設。
- **Execution note（test-first）**。
- **Test scenarios**：有 og:title + 站名 h1 → 取 og:title；無 og:title 有 `<title>` → 取 title；只有 h1 → 兜底取 h1。
- **Verification**：新測試綠；既有 fetchContent 測試調整後綠。

## Execution Strategy

Serial（多在同檔、有依賴）。建議序：**U1 → U2 → U3（評分三連，後端同區，characterization 守住既有排序）→ U4（最高價值、最大改動，獨立提取邏輯）→ U5（小改）**。每單元獨立 commit。U2 依賴 U1（confidence 語義變了，computeScore 才納入）。

## Dependencies / Assumptions

- 假設 `PendingTopic` / savePendingTopic 鏈能把 `confidence` 與 `rawContent.metadata.publishedTime` 帶到 computeScore（執行期核）。
- 假設 extractBody 重寫不需新依賴（原生正則 + 文本密度足夠）；若實測覆蓋率仍差，再評估是否值得引 readability（本輪不引，記 backlog）。

## Verification（全輪收尾）

```
pnpm --filter @51guapi/shared build
pnpm -r compile && pnpm -r test && pnpm lint:ci
pnpm build:extension
bash scripts/check-all.sh
```

新增測試覆蓋 R1-R5；既有提取/評分測試不回歸。

## Post-Deploy Monitoring & Validation

本工具為本地/自託管爬取-導出鏈，無生產發布面。驗證窗口：合併後一次本地 `check-all.sh` 綠燈 + 對幾個真實渠道頁手測。
- **健康信號**：同一批待審池，by-score 排序後「8 事實全的草稿」明顯排在「只有 URL 的」之上；嵌套正文站點的草稿起因/經過/結果 不再全空；標題不再出現站名。
- **失敗信號 / 回退**：某類站點正文提取較改前更差（過度抓到導航/廣告）→ 回退 U4；排序出現明顯不合理翻轉 → 回退 U2/U3。
- **Owner**：red chen。
