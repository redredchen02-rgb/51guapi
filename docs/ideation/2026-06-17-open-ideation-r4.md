---
date: 2026-06-17
topic: gossip-extraction-r4
focus: open exploration — round 4 (post-publish-era dismantling; codebase now pure extract+export)
---

# Ideation: Gossip Extraction Quality & Workflow — Round 4

## Codebase Context

**Project shape:** TS pnpm monorepo. Chrome MV3 extension (WXT + React 19) + Fastify 5 backend + shared types. Version post-refactor (all publish/form-fill/injection machinery removed as of ~2026-06-10).

**Current flow:** URL → backend scrapes → AI extracts GossipFactsBlock (当事人/事件摘要/起因/经过/结果/来源连结/发生时间/热度标签) → pending queue → operator generates draft via LLM → export JSON/Markdown/CSV. NO publishing, NO DOM injection.

**R3 ideation (2026-06-15) was entirely stale** — R3 was based on the publish-era codebase (content.ts, quill-bridge, safety-gate, FieldMapping, trajectory system). All those no longer exist. R4 starts fresh from the current codebase state.

**Key structural facts:**
- `shared/src/quality-gate.ts`: evaluateQuality() has 5 checks — body_length, facts_completeness (BUGGY: checks manga fields 作品名/集数, NOT gossip fields), title_quality, community_tone (BUGGY: checks publish-era slang 嗨嗨/51娘/安利), tags_accuracy
- `backend/src/services/metrics.ts`: 6 counters including publishAttempts (dead since publish removed)
- `gossip-fact-extractor.ts`: strict + fallback LLM paths; extractionMode not persisted to SQLite
- `pending-store.ts`: no draftId/draftedAt fields; no UNIQUE index on sourceUrl
- Extension sidepanel: GossipView (497L), PendingTopicsView (634L), App (466L)
- `telegram.ts`: alert-only, no digest
- `scheduler.ts`: cron-only, no HTTP trigger

## Ranked Ideas

### 1. Quality-gate 全面重寫（三處 correctness bug 同時修）
**Description:** (a) `checkFactsCompleteness` 的 `coreKeys` 從漫畫字段（作品名/集数/制作/漢化/無修/题材/简介）改為 GossipFactsBlock（当事人/事件摘要/起因/经过/结果）；(b) `community_tone` 的 `toneWords` 替換為吃瓜語境詞彙，移除 51娘/安利/入坑等漫畫詞；(c) `metrics.ts` 清除 `publishAttempts` 死計數器及其 Prometheus 輸出行。
**Rationale:** 現在所有吃瓜草稿在 quality-gate 眼中都「事實不完整」，分數系統性虛低，操作員無法信任評分。quality-gate 是正確性的核心基礎設施，三個 bug 同源（都是 publish-era 遺留），一次修完成本低。
**Downsides:** community_tone 適合吃瓜語境的詞彙需要判斷，可能需要幾輪調整。
**Confidence:** 95%
**Complexity:** Low
**Status:** Explored (brainstorm 2026-06-17)

### 2. URL 精確去重 + 提交冪等
**Description:** 提交前對 URL 正規化（去掉 tracking query params）+ 查重 pending-store；重複提交返回已有 pendingId 而非觸發新一次爬取 + LLM 調用。加 UNIQUE index on sourceUrl（目前缺失）。
**Rationale:** 直接省 LLM token 成本，零操作員介面改動。同一事件多站報導時自動防止 pending 堆積重複條目。
**Downsides:** URL 正規化邊界條件（不同站使用相同 URL 格式但語義不同的 edge case）需仔細測試。
**Confidence:** 88%
**Complexity:** Low
**Status:** Unexplored

### 3. draft_id 回寫 pending + 已出稿狀態追蹤
**Description:** draft 生成後回寫 `draftId` + `draftedAt` 到 PendingTopic；PendingTopicsView 顯示「已出稿」徽章；防止對同一 pending 條目重複觸發生成。
**Rationale:** 狀態閉環缺失導致重複 LLM 調用和操作員困惑。`auto-generate.ts` 備注「caller must do it」但無 caller 真的寫回，是明確的未完成設計。
**Downsides:** 需要在 background.ts GENERATE_DRAFT 路徑中加回寫邏輯；schema migration。
**Confidence:** 85%
**Complexity:** Low-Medium
**Status:** Unexplored

### 4. LLM 失敗錯誤分類
**Description:** background.ts 的 GENERATE_DRAFT 失敗路徑區分：API key 無效 / 額度耗盡（429）/ prompt 被 reject / 網路逾時；各情況返回不同 `kind` 碼和可行動的中文提示（「請檢查 API Key 設定」vs「模型暫時繁忙，請稍後重試」）。
**Rationale:** 目前生成失敗一律是通用錯誤，操作員無從判斷要改 key 還是改 prompt 還是等待。診斷性錯誤訊息是 DX 的最低成本改善。
**Downsides:** 需要覆蓋不同 LLM 端點的不同錯誤格式（OpenAI / 兼容端點各不相同）。
**Confidence:** 82%
**Complexity:** Low-Medium
**Status:** Unexplored

### 5. 持久化 extractionMode + 渠道品質儀表板
**Description:** 把 `extractionMode`（strict/fallback）和 `confidence` 寫回 SQLite（目前只在記憶體）；新增 per-channel 聚合統計端點（strict 率、平均 confidence、失敗率）；side panel 渠道管理頁展示品質評級。
**Rationale:** 讓每次抓取自動累積渠道信號，未來可設 fallback 率過高自動暫停渠道。目前對「哪個渠道品質差」毫無能見度。
**Downsides:** schema migration；渠道品質 UI 需要新視圖或擴充現有渠道管理頁。
**Confidence:** 80%
**Complexity:** Medium
**Status:** Unexplored

### 6. rejectedReason 聚合分析（把拒絕轉為訓練信號）
**Description:** 新增 `/api/v1/gossip/pending/reject-stats` 按 siteName × reason 聚合拒絕原因；Settings 頁顯示 Top 拒絕原因列表，幫助操作員識別哪個站點的萃取系統性不達標。
**Rationale:** `rejectedReason` 欄位已存在但從未被統計。操作員的每次拒絕是對 AI 品質的隱性評分，聚合後可指導 prompt 調整方向，讓人工勞動複利化。
**Downsides:** 需要操作員在拒絕時填 reason（目前 UI 是否有此交互需確認）。
**Confidence:** 78%
**Complexity:** Medium
**Status:** Unexplored

### 7. 批次 URL 提交 + SSE 進度串流
**Description:** 新增 `POST /api/v1/gossip/scrape/batch` 接受 URL 陣列；以 SSE 逐條回傳進度（submitted/extracted/failed）；後端限流防止 SSRF allowlist 被饜食性測試。
**Rationale:** 突發事件（演唱會事故、塌房）想一次丟 10 條 URL 讓系統跑，現在只能逐一點擊。批次提交讓渠道擴充速度翻倍，SSE 讓大批量不假死。
**Downsides:** SSE 在 extension sidepanel 的實作需要確認可行性（MV3 SW 生命週期限制）；需和 #2 URL 去重整合。
**Confidence:** 75%
**Complexity:** Medium
**Status:** Unexplored

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| 1 | AbortController 跨 pass 共享 timeout | micro-fix，單操作員工具極難觸發 |
| 2 | SSRF allowlist UI 查看 | 開發者可直接查 config，窄優先級 |
| 3 | 匯出格式預覽 | 格式說明清晰，非實際痛點 |
| 4 | 草稿版本歷史 | 高複雜度，推測性需求，在核心品質問題解決前過早 |
| 5 | 八卦 Web Enricher（微博/Google Trends）| 外部 API 依賴複雜，攜帶成本高 |
| 6 | 語義去重（跨 URL 同事件）| 需 embedding 或複雜啟發式，對單操作員工具過重 |
| 7 | str() 靜默降級 | TypeScript 已覆蓋大部分場景，過於細節 |
| 8 | GossipView 空欄位視覺提示 | 真實但低槓桿；#1 quality-gate 修復後評分可替代 |
| 9 | 每日 Telegram 摘要 | 功能完整但非最高槓桿，deferred |
| 10 | gossip-routes discover 失敗不計數 | 真實但窄，可在 metrics 重寫時順帶 |
| 11 | facts_completeness 空對象語義區分 | 併入 #1 quality-gate 重寫 |

## Session Log
- 2026-06-17: R4 ideation — R3 整份過時（publish era 已拆），重新掃描當前 codebase。4 frame 並行生成 31 raw ideas，去重後 23 unique，7 survived adversarial filtering。
