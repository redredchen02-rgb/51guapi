---
title: "feat: Gossip ranking pipeline — hot search + site intersection + weighted ranking table"
type: feat
status: active
date: 2026-06-23
origin: docs/brainstorms/2026-06-23-gossip-ranking-pipeline-requirements.md
---

# feat: 吃瓜排行流水線

## Problem Frame

（see origin: `docs/brainstorms/2026-06-23-gossip-ranking-pipeline-requirements.md`）

使用者管理多個吃瓜站點，現有流程把各站抓回的選題堆進「待審選題」清單。
缺少：(1) 把站點資料與社群熱搜做交叉比對找出「真正在爆的瓜」，(2) 加權評分後以排行表呈現，讓使用者能迅速選出最值得寫的選題。

## Platform Research Decision

（研究結果，直接影響 R3 實作範圍）

| 平台 | 方案 | SSRF 域名 | Phase |
|------|------|-----------|-------|
| 百度熱搜 | `GET top.baidu.com/api/board?platform=pc&tab=realtime` — SSR JSON，只需 `Referer` header | `top.baidu.com` | Phase 1 |
| 微博熱搜 | `GET weibo.com/ajax/side/hotSearch` — 需 Sina Visitor 2-step 預熱取 SUB/SUBP cookie | `weibo.com`, `passport.weibo.com` | Phase 1 |
| 抖音熱榜 | `msToken` 由客戶端 JS 計算（HMAC），純 undici 大機率 403 | — | Phase 2 stub |
| 小紅書熱點 | `x-s`/`x-t` 簽名每次版本更新即失效，維護成本過高 | — | 跳過 |

Phase 1 實作百度 + 微博兩個真實抓取器；抖音建 stub（返回空陣列 + warn log）；小紅書不實作。

## Requirements Trace

（繼承自需求文件 R1-R14）

- R1, R2: 站點列表每個站點有「立即爬取」按鈕（已有 Zap icon + discover mutation），補充 last_discover_at / last_discover_count 回顯
- R3: 熱搜抓取器（百度 + 微博 Phase 1，抖音 Phase 2 stub）
- R4: 儲存 keyword / heat_score(0-100 正規化) / platform / rank_position / captured_at / expires_at
- R5: TTL 24h — 查詢時過濾 `expires_at < now()`
- R6: 模糊匹配：正規化字串包含（toLowerCase + trim，雙向 includes 檢查）
- R7: 四維度加權分數（見評分設計）
- R8: 加權比重透過 `.env` 設定，預設值 W1=0.4 W2=0.3 W3=0.2 W4=0.1
- R9: A 區（熱搜 ∩ 站點）+ B 區（僅熱搜）
- R10: 欄位：排名 / 話題 / 加權分 / 平台 badges / 站點覆蓋 / 首次發現時間 / 操作
- R11: 「立即抓取」按鈕：觸發所有站點 discover + 熱搜抓取
- R12: 操作：一鍵生成草稿（A 區）/ 隱藏 / 來源連結
- R13: 從排行表生成的草稿流入待審池；現有待審清單不動
- R14: 排行表過濾 ranking_blacklist 中的關鍵詞 + 已被 approved 的選題

## High-Level Technical Design

```
POST /api/v1/ranking/scrape
  ├─ gossip sites discover (existing: POST /api/v1/gossip/sites/:id/discover × N)
  └─ hot-search-aggregator
       ├─ baidu-scraper   → { keyword, heat_score, rank_position }[]
       ├─ weibo-scraper   → { keyword, heat_score, rank_position }[]
       └─ douyin-scraper  → []  (Phase 2 stub)
             ↓ pendingWriteQueue
         hot_search_keywords table (TTL = captured_at + 24h)

GET /api/v1/ranking
  └─ ranking-service.getRankedList()
       ├─ query pending_topics (domain='gossip', status='pending')
       ├─ query hot_search_keywords (not expired)
       ├─ filter out ranking_blacklist keywords
       ├─ fuzzyMatch: topics × keywords → matches[]
       ├─ computeScore per topic
       └─ split → { sectionA (∩), sectionB (hot-search only) }
```

## Scoring Formula

```
score = W1*(platformCount/4) + W2*(heatScore/100) + W3*(siteCount/totalSites) + W4*recency

recency = 1.0  if topic.created_at within 24h
          0.5  if within 48h
          0.1  otherwise

heatScore  = average heat_score(0-100) across matching platforms
platformCount = 幾個平台出現同一關鍵詞（熱搜層）+ sectionA 含 siteCount≥1
siteCount  = pending_topics 裡有幾條 source_url 的站點各別覆蓋了這個關鍵詞
```

權重 env vars（`.env.example` 新增）：
```
RANK_W1_BIG=0.4        # 大瓜（多平台出現）
RANK_W2_TRAFFIC=0.3    # 流量瓜（熱度）
RANK_W3_SITE=0.2       # 站點覆蓋
RANK_W4_RECENCY=0.1    # 新瓜（時效）
```

## Implementation Units

### U1: DB 遷移 — 三個 migration（017/018/019）+ 新/更新 stores

**Goal:** 建立 hot_search_keywords 和 ranking_blacklist 資料表，並在 gossip_sites 補充追蹤欄位

**Requirements:** R4, R5, R2

**Dependencies:** 無（先行）

**Files:**
- Modify: `packages/backend/src/migrations/runner.ts`（新增 017, 018, 019 到 MIGRATIONS 物件）
- Create: `packages/backend/src/scraper/hot-search-store.ts`
- Create: `packages/backend/src/scraper/ranking-blacklist-store.ts`
- Modify: `packages/backend/src/scraper/gossip-site-store.ts`（增加 updateDiscoverStats）
- Create: `packages/backend/src/scraper/hot-search-store.test.ts`

**Migration 017 — hot_search_keywords:**
```sql
CREATE TABLE IF NOT EXISTS hot_search_keywords (
  id           TEXT PRIMARY KEY,
  keyword      TEXT NOT NULL,
  platform     TEXT NOT NULL CHECK(platform IN ('baidu','weibo','douyin','xiaohongshu')),
  heat_score   REAL NOT NULL DEFAULT 0,     -- 0-100 正規化後
  rank_position INTEGER NOT NULL,            -- 1=最熱
  captured_at  TEXT NOT NULL,               -- ISO 8601
  expires_at   TEXT NOT NULL                -- captured_at + 24h
);
CREATE INDEX IF NOT EXISTS idx_hot_search_expires ON hot_search_keywords(expires_at);
CREATE INDEX IF NOT EXISTS idx_hot_search_platform ON hot_search_keywords(platform);
```

**Migration 018 — gossip_sites 追蹤欄位:**
```sql
ALTER TABLE gossip_sites ADD COLUMN last_discover_at TEXT DEFAULT NULL;
ALTER TABLE gossip_sites ADD COLUMN last_discover_count INTEGER DEFAULT NULL;
```

**Migration 019 — ranking_blacklist:**
```sql
CREATE TABLE IF NOT EXISTS ranking_blacklist (
  keyword    TEXT PRIMARY KEY,
  hidden_at  TEXT NOT NULL
);
```

**hot-search-store.ts 需提供:**
- `upsertHotSearchBatch(rows: HotSearchKeyword[]): void` — 使用 pendingWriteQueue，先 DELETE WHERE platform = ? AND expires_at < now()，再 INSERT OR REPLACE
- `listHotSearchKeywords(): HotSearchKeyword[]` — 過濾 expires_at > now()
- `cleanupExpired(): void` — DELETE WHERE expires_at < now()

**ranking-blacklist-store.ts 需提供:**
- `addToBlacklist(keyword: string): void` — 使用 pendingWriteQueue
- `getBlacklistSet(): Set<string>` — 返回全部 keyword 字串 Set

**gossip-site-store.ts 新增:**
- `updateDiscoverStats(id: string, count: number): void` — UPDATE gossip_sites SET last_discover_at=?, last_discover_count=? WHERE id=?；使用 pendingWriteQueue；更新 GossipSiteRow/GossipSiteConfig interface 含新欄位

**Patterns to follow:**
- 所有 SQLite 寫入走 `pendingWriteQueue`（`src/scraper/pending-db.ts` 模式）
- DB 型別：TEXT for timestamps（ISO 8601），REAL for scores，INTEGER for positions
- 測試：`initPendingDb()` + `DELETE FROM hot_search_keywords` 清空，不碰真實 data/

**Test scenarios:**
- `upsertHotSearchBatch` 寫入後 `listHotSearchKeywords` 返回同等條目（含熱度、平台）
- 過期條目（expires_at 設為過去時間）不出現在 listHotSearchKeywords
- `cleanupExpired` 後，過期條目從 DB 刪除
- `updateDiscoverStats` 後，`getGossipSite` 返回含 lastDiscoverAt + lastDiscoverCount

---

### U2: SSRF 域名擴充

**Goal:** 把百度、微博及 Weibo Visitor 預熱域名加入 SSRF 白名單

**Requirements:** R3（安全前提）

**Dependencies:** 無（可與 U1 並行）

**Files:**
- Modify: `packages/backend/.env.example`（ALLOWED_HOSTS 說明）

**Approach:**
- 在 `.env.example` 的 `ALLOWED_HOSTS` 說明後補充範例值：
  `ALLOWED_HOSTS=51cg1.com,top.baidu.com,weibo.com,passport.weibo.com`
- 不需改 ssrf-guard.ts 代碼（已動態讀取 env.ALLOWED_HOSTS + channels table）
- 使用者部署時需手動在 `~/.51guapi/.env` 加入這三個域名

**Risk:** 使用者遺忘設定 → 抓取時 safeFetch 返回 403，aggregator log error，API 返回 `{ok: false, hotKeywordsCount: 0}` 並繼續（不阻斷排行功能，只是無熱搜資料）

---

### U3: 熱搜抓取器 + 聚合器

**Goal:** 實作百度 + 微博兩個真實抓取器 + 抖音 stub + 聚合器

**Requirements:** R3, R4

**Dependencies:** U1（需 upsertHotSearchBatch），U2（SSRF 域名）

**Files:**
- Create: `packages/backend/src/scraper/hot-search/baidu-scraper.ts`
- Create: `packages/backend/src/scraper/hot-search/weibo-scraper.ts`
- Create: `packages/backend/src/scraper/hot-search/douyin-scraper.ts`
- Create: `packages/backend/src/scraper/hot-search/hot-search-aggregator.ts`
- Create: `packages/backend/src/scraper/hot-search/baidu-scraper.test.ts`
- Create: `packages/backend/src/scraper/hot-search/weibo-scraper.test.ts`

**Interface（共用）:**
```typescript
export interface HotSearchItem {
  keyword: string;
  heat_score: number;   // 0-100 正規化
  rank_position: number; // 1-N
}
export type HotSearchScraper = (fetchFn?: typeof fetch) => Promise<HotSearchItem[]>
```

**baidu-scraper.ts:**
- 端點：`GET https://top.baidu.com/api/board?platform=pc&tab=realtime`
- Headers：`{ Referer: 'https://top.baidu.com/', 'User-Agent': '...' }`
- 解析：response JSON → `data.cards[0].content` array → 取 word / hotScore / index
- heat_score 正規化：`Math.min(100, (hotScore / maxHotScore) * 100)`（max 取本批次最高值）
- fetchFn 注入（測試用）

**weibo-scraper.ts:**
- Step 1 預熱：`POST https://passport.weibo.com/visitor/genvisitor` → 取 gen_time, cpid
- Step 2 預熱：`GET https://passport.weibo.com/visitor/visitor?a=incarnate&t={gen_time}&w=2&c={cpid}&...` → 取 Set-Cookie SUB + SUBP
- Step 3 熱搜：`GET https://weibo.com/ajax/side/hotSearch` with Cookie header
- 解析：`data.data.realtime[].word` + `.num`（熱度）
- 每次呼叫做完整三步（不快取 cookie，個人工具低頻夠用）
- heat_score 正規化：`Math.min(100, (num / maxNum) * 100)`

**douyin-scraper.ts (stub):**
- 直接返回 `[]` + `log.warn('[douyin-scraper] Phase 2 stub, skipping')`
- 保留 `fetchFn` 參數以維持 interface 一致

**hot-search-aggregator.ts:**
- `scrapeAllPlatforms(fetchFn?)`: 並發呼叫 4 個 scraper（Promise.allSettled），log 各平台成功/失敗
- 為每筆結果生成 id (`${platform}-${rank_position}`)、captured_at、expires_at（+24h）
- 呼叫 `upsertHotSearchBatch(allResults)`（來自 U1）
- 返回 `{ baidu: N, weibo: N, douyin: 0, xiaohongshu: 0, total: N }`

**Patterns:**
- `safeFetch()` from ssrf-guard.ts，不直接呼叫 undici/fetch（讓 SSRF 守衛攔截）
- `fetchFn?: typeof fetch` 注入（非 `_fetchFn`）
- Promise.allSettled — 單平台失敗不阻斷其他平台

**Test scenarios:**
- baidu-scraper.test.ts：fixture JSON → 返回正確條目數 + heat_score 0-100 範圍 + rank_position 遞增
- weibo-scraper.test.ts：mock 三個 fetch 呼叫（預熱兩步 + 熱搜一步）→ 返回正確條目
- aggregator：兩個 scraper 返回 fixture、一個拋錯 → allSettled 後仍返回其他平台結果
- 所有 fetchFn 注入模式：不使用真實網路

---

### U4: 排行評分服務

**Goal:** 實作模糊匹配 + 加權評分 + A/B 分區

**Requirements:** R6, R7, R8, R9, R14

**Dependencies:** U1（需 listHotSearchKeywords, getBlacklistSet）

**Files:**
- Create: `packages/backend/src/services/ranking-service.ts`
- Create: `packages/backend/src/services/ranking-service.test.ts`

**Exports:**
```typescript
export interface RankedTopic {
  topicId: string;
  title: string;
  score: number;
  platformCount: number;
  siteCount: number;
  matchedKeywords: string[];
  sourcePlatforms: { platform: string; rankPosition: number }[];
  sourceUrls: string[];
  createdAt: string;
}

export interface RankedKeyword {
  keyword: string;
  platforms: { platform: string; rankPosition: number; heatScore: number }[];
  platformCount: number;
  avgHeatScore: number;
}

export interface RankingResult {
  sectionA: RankedTopic[];
  sectionB: RankedKeyword[];
  freshAt: string;
}
```

**fuzzyMatch(topicTitle, keyword):**
- 正規化：`str.toLowerCase().replace(/\s+/g, '')`
- 匹配條件：normalizedTitle.includes(normalizedKeyword) || normalizedKeyword.includes(normalizedTitle)
- 返回 boolean

**getRankedList():**
1. `pending_topics` WHERE domain='gossip' AND status='pending'（排除 approved/rejected/blacklisted）
2. `listHotSearchKeywords()`（從 U1）
3. `getBlacklistSet()`（從 U1）— 過濾 topic title 在黑名單、keyword 在黑名單
4. For each topic: matchedKeywords = hotKeywords.filter(k => fuzzyMatch(topic.title, k.keyword))
5. siteCount = 同一 keyword 在 pending_topics 中有幾個不同 site_name
6. computeScore per topic（見評分公式）
7. A 區 = topics with matchedKeywords.length ≥ 1，按 score DESC
8. B 區 = hotKeywords not matched by any topic，按 platformCount DESC then avgHeatScore DESC
9. 兩區均過濾 blacklistSet

**Weights from env:**
```typescript
const W1 = parseFloat(process.env.RANK_W1_BIG    ?? '0.4')
const W2 = parseFloat(process.env.RANK_W2_TRAFFIC ?? '0.3')
const W3 = parseFloat(process.env.RANK_W3_SITE    ?? '0.2')
const W4 = parseFloat(process.env.RANK_W4_RECENCY ?? '0.1')
```

**Test scenarios:**
- fuzzyMatch: 「章子怡汪峰」matches「章子怡 汪峰」（空格正規化）
- fuzzyMatch: 「王力宏離婚」matches「王力宏」（包含關係）
- fuzzyMatch: 「ABC」不 match「DEF」
- getRankedList with fixtures：兩個 topic + 三個 hotKeyword → A 區 1 條（有交集）+ B 區 2 條（無交集）
- 黑名單過濾：blacklist 中的 keyword 不出現在 B 區；對應的 topic 不出現在 A 區
- 分數正確：W1*platformCount/4 + W2*heatScore/100 + W3*siteCount/totalSites + W4*recency
- approved status 的 topic 不出現在 A 區

---

### U5: Backend 排行 API 路由

**Goal:** 新增排行相關的 4 個端點 + 更新 discover handler 儲存追蹤資料

**Requirements:** R11, R12（隱藏 + 生成草稿）, R13, R2

**Dependencies:** U1, U3, U4

**Files:**
- Create: `packages/backend/src/routes/ranking-routes.ts`
- Create: `packages/backend/src/routes/ranking-routes.test.ts`
- Modify: `packages/backend/src/app.ts`（import + register）
- Modify: `packages/backend/src/routes/gossip-routes.ts`（discover handler 呼叫 updateDiscoverStats）

**端點設計:**

`GET /api/v1/ranking`
- 呼叫 `getRankedList()`
- 返回 `{ ok: true, sectionA: RankedTopic[], sectionB: RankedKeyword[], freshAt: string }`

`POST /api/v1/ranking/scrape`
- 並發：(1) `scrapeAllPlatforms()` (2) 從 DB 取所有 enabled gossip sites，逐一呼叫 `fetchListPaged(site.listUrl, maxPages)` 並入 pending_topics
- 返回 `{ ok: true, hotKeywordsCount: N, topicsDiscovered: N, errors: string[] }`
- 注意：並發但各自獨立 try/catch，不因一個失敗整體失敗

`POST /api/v1/ranking/hide`
- Body: `{ keyword: string }`
- 呼叫 `addToBlacklist(keyword)`（來自 U1）
- 返回 `{ ok: true }`

`POST /api/v1/ranking/generate-draft/:topicId`
- 載入 topic from DB
- 若 status='pending'：先 UPDATE status='approved'（使用 pendingWriteQueue）
- 呼叫 `generateArticleDraft(topic.facts, ...)` 同現有 `/api/v1/drafts/generate-article`
- 返回 `{ ok: true, draft: ContentDraft }` 或 error
- 安全約束：只接受 domain='gossip' 且 isGossipFactsBlock(topic.facts) 為 true

**gossip-routes.ts discover handler 更新:**
```typescript
// discover 成功後加入（fresh.length 已算出）
await updateDiscoverStats(site.id, fresh.length)  // 來自 U1
```

**app.ts:**
```typescript
import { registerRankingRoutes } from './routes/ranking-routes.js'
// 在 registerGossipRoutes 之後
registerRankingRoutes(server)
```

**Test scenarios（ranking-routes.test.ts）:**
- GET /api/v1/ranking：返回 `{ok, sectionA, sectionB, freshAt}`
- POST /api/v1/ranking/scrape：mock scrapeAllPlatforms → 返回 hotKeywordsCount
- POST /api/v1/ranking/hide `{keyword: "王力宏"}`：後續 getRankedList 不包含該 keyword
- POST /api/v1/ranking/generate-draft/:topicId（topic status=pending）：auto-approve + 返回 draft
- POST /api/v1/ranking/generate-draft/:topicId（topic domain='acg'）：返回 400

---

### U6: WebUI 瓜排行頁面

**Goal:** 新增 `/gossip-rank` 路由 + 排行 API 客戶端 + Sidebar 更新

**Requirements:** R9, R10, R11, R12

**Dependencies:** U5（需 API 端點存在）

**Files:**
- Create: `packages/webui/src/routes/gossip-rank.tsx`
- Create: `packages/webui/src/api/ranking.ts`
- Modify: `packages/webui/src/components/layout/Sidebar.tsx`
- Auto-generated（不手動編輯）: `packages/webui/src/routeTree.gen.ts`

**Sidebar 更新:**
```typescript
import { TrendingUp } from "lucide-react"
// 在 "/sites" 之後加入：
{ to: "/gossip-rank", icon: TrendingUp, label: "瓜排行" }
```

**ranking.ts API 客戶端:**
```typescript
export async function getRanking(): Promise<RankingResult>
export async function triggerScrape(): Promise<ScrapeResult>
export async function hideKeyword(keyword: string): Promise<void>
export async function generateDraftFromTopic(topicId: string): Promise<ContentDraft>
```

**gossip-rank.tsx 結構:**
- 頂部：「立即抓取」按鈕（TrendingUp icon + loading state）+ 「上次更新 freshAt」
- A 區標題：「精選（站點 + 熱搜交集）」 + 條目數
- A 區 Table 欄位：排名 / 話題標題 / 加權分（1 位小數）/ 平台 badges / 站點覆蓋 / 首次發現 / 操作
- A 區操作：「生成草稿」按鈕 + 「隱藏」按鈕 + 「來源」展開（顯示 sourceUrls）
- B 區標題：「發現（僅熱搜）」 + 條目數
- B 區 Table 欄位：排名 / 關鍵詞 / 平台 badges / 平均熱度 / 操作
- B 區操作：「隱藏」按鈕
- 平台 badges：`baidu=百度` `weibo=微博` `douyin=抖音`，顏色區分，含 rankPosition tooltip
- 空狀態：「尚無資料，點擊立即抓取開始」

**資料流:**
- `useQuery(['ranking'], getRanking, { staleTime: 60_000 })`
- 立即抓取：`useMutation(triggerScrape, { onSuccess: () => qc.invalidateQueries(['ranking']) })`
- 隱藏：`useMutation(hideKeyword, { onSuccess: () => qc.invalidateQueries(['ranking']) })`
- 生成草稿：`useMutation(generateDraftFromTopic, { onSuccess: (draft) => navigate('/draft', { state: { draft } }) })`

**Patterns:**
- `createFileRoute("/gossip-rank")` — TanStack Router v1 file-based routing
- `useMutation + queryClient.invalidateQueries` 同現有 sites.tsx 模式
- `apiFetch()` from `@/lib/api-client`（現有 wrapper）
- 不手動編輯 `routeTree.gen.ts`（由 `pnpm dev:webui` / build 自動產生）

---

### U7: WebUI 站點頁面 — discover tracking 回顯

**Goal:** SiteRow 顯示「上次爬取時間」與「本次新增條目數」，修正 per-site loading 狀態

**Requirements:** R1, R2

**Dependencies:** U1（DB 欄位）, U5（gossip-routes.ts discover handler 更新）

**Files:**
- Modify: `packages/webui/src/api/gossip.ts`（更新 GossipSite 介面）
- Modify: `packages/webui/src/routes/sites.tsx`（SiteRow + discover loading state）

**gossip.ts 更新:**
```typescript
export interface GossipSite {
  id: string;
  name: string;
  listUrl: string;
  createdAt: string;
  lastDiscoverAt?: string;   // 新增
  lastDiscoverCount?: number; // 新增
}
```

**SiteRow 更新:**
1. Per-site loading state 修正：
   ```tsx
   // 舊：isDiscovering（全域共享）
   // 新：discover.isPending && discover.variables === site.id
   ```
2. 在站點名稱下方加一行 secondary text：
   ```tsx
   {site.lastDiscoverAt && (
     <span className="text-xs text-muted-foreground">
       上次 {formatRelative(site.lastDiscoverAt)} · +{site.lastDiscoverCount ?? 0} 條
     </span>
   )}
   ```
3. `formatRelative`: 使用 `Intl.RelativeTimeFormat`（無需引入 date-fns）

**注意:** backend `listGossipSites` 路由回應需包含新欄位（gossip-site-store.ts 的 `rowToSite` 函數更新後自動 snake_case → camelCase 轉換）

## System-Wide Impact

- **DB:** 新增 3 張表（hot_search_keywords / ranking_blacklist）+ 現有 2 張表加欄（gossip_sites / pending_topics status 可能被 generate-draft 端點修改）
- **SSRF:** 需使用者手動在 `~/.51guapi/.env` 擴充 ALLOWED_HOSTS（`top.baidu.com,weibo.com,passport.weibo.com`）
- **WebUI routeTree.gen.ts:** 新增 /gossip-rank 路由後自動重生成；`pnpm build:webui` 觸發
- **无副作用:** 現有待審選題頁面、草稿編輯器、渠道管理均不受影響

## Sequencing & Dependencies

```
U1 (migration + stores)
  ├── U2 (SSRF env docs)          可並行
  ├── U3 (scrapers) ─────────────┐ 可並行（依 U1）
  ├── U4 (ranking service) ──────┤ 可並行（依 U1）
  └── U7 (WebUI sites tracking)  ┘ 可並行（依 U1，U5 也需先做）

U3 + U4 ──→ U5 (backend routes)
U5 ──→ U6 (WebUI gossip-rank)
U1 + U5 ──→ U7 (WebUI sites tracking 後半 — per-site loading fix 在 U5 之後)
```

推薦執行順序（若單人循序）：U1 → U2 → U3 → U4 → U5 → U7 → U6

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Weibo Visitor System 預熱格式改版 | 中 | 每次 scrape 才呼叫（非快取），失敗時 log + 返回空陣列不阻斷整體流程 |
| 百度 API 格式變更 | 低 | 有 fixture 測試；生產失敗時 log error + 返回空陣列 |
| SSRF 未設定新域名 → 熱搜無資料 | 高（首次部署） | `.env.example` 有清楚說明；GET /api/v1/ranking 仍可工作（只是 B 區空） |
| gossip_sites 的 listUrl 域名不在渠道表 → SSRF 擋 | 低（現有站點已在渠道表） | 現有 discover 邏輯不變；ranking/scrape 端點觸發同樣流程 |
| TanStack Router routeTree.gen.ts 未重生成 | 低 | /gossip-rank 頁面不可訪問；`pnpm build:webui` 修復；文件中說明 |
| pending_topics 量大時 ranking-service 全量掃描慢 | 低（個人工具） | 現階段可接受；若需優化，後期可加 compound index(domain, status) |

## Open Questions (Deferred to Implementation)

- **Weibo heat_score 正規化基準**：`data.data.realtime[].num` 的實際數值範圍需在真實抓取時確認；可能需要 clamp 策略
- **"生成草稿"後的頁面跳轉**：`navigate('/draft', { state: { draft } })` 需確認 WebUI draft 頁面是否接受 location state 傳入預填草稿
- **B 區「來源」展開**：B 區 keyword 沒有來源 URL（只有平台 badge），目前計畫只顯示平台連結（如 `https://top.baidu.com/board?tab=realtime`）；實作時確認 UX 是否足夠

## Verification Checklist

- [ ] `pnpm test` 全綠（含 hot-search-store.test.ts + ranking-service.test.ts + ranking-routes.test.ts）
- [ ] `pnpm compile` 無型別錯誤
- [ ] GET /api/v1/ranking 返回 `{ok, sectionA: [], sectionB: []}` 在無熱搜資料時
- [ ] POST /api/v1/ranking/scrape 在 ALLOWED_HOSTS 設定正確時，返回 `hotKeywordsCount > 0`
- [ ] 瓜排行表頁面可訪問（/gossip-rank），兩區正確分隔
- [ ] 站點列表的 Zap 按鈕 per-site loading state 正確（只有被點的那個站點顯示 loading）
- [ ] 隱藏後重新整理，隱藏條目不再出現
