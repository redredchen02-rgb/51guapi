---
date: 2026-06-17
id: "001"
type: fix
slug: quality-gate-rewrite
status: ready
requirements: docs/brainstorms/2026-06-17-quality-gate-rewrite-requirements.md
---

# Plan: Quality-Gate 全面重寫

## Goal

修正 `shared/src/quality-gate.ts` 中兩處遺留自 publish era 的 correctness bug（漫畫字段、漫畫語氣詞），並清除 `backend/src/services/metrics.ts` + `packages/extension/lib/storage.ts` 中永遠為 0 的 `publishAttempts` 死計數器，使評分系統對吃瓜草稿可信。

## Build Order Constraint

`@51guapi/shared` 必須先 build 才能讓 backend/extension 的 TypeScript 看見新型別。Unit 1 完成後執行：
```
pnpm --filter @51guapi/shared build
```
再繼續後續單元。

## Implementation Units

### Unit 1 — shared/src/quality-gate.ts（核心修正）

**目標**：R1–R6（事實完整度 + 語氣詞）

#### 1a. 修改 import（第 4 行）

```diff
-import type { FactsBlock } from "./facts.js";
+import type { GossipFactsBlock } from "./gossip-facts.js";
```

確認 `FactsBlock` 在此檔案內其他地方是否仍有引用——如已無引用，import 行可安全刪除。

#### 1b. 更新 checkFactsCompleteness 函式（第 54–69 行）

```diff
-function checkFactsCompleteness(facts: FactsBlock): QualityCheck {
-	const coreKeys = ["作品名", "集数", "制作", "漢化", "無修", "题材", "简介"];
-	const filled = coreKeys.filter((k) => {
-		const v = facts[k as keyof FactsBlock];
-		return v && v.trim().length > 0;
+function checkFactsCompleteness(facts: GossipFactsBlock): QualityCheck {
+	const coreKeys = ["當事人", "事件摘要", "起因", "經過", "結果"];
+	const filled = coreKeys.filter((k) => {
+		const v = facts[k as keyof GossipFactsBlock];
+		return v != null && v.trim().length > 0;
 	}).length;
```

> 注意：原本 `v &&` 對 `string | null` 字段在空字串 `""` 時會 falsy 行為相同，但顯式 `v != null` 更清晰且對 TypeScript strict null checks 更友善。

#### 1c. 更新 toneWords（第 92–111 行）

整塊替換 `toneWords` 陣列：

```diff
-	const toneWords = [
-		"嗨嗨",
-		"大家好",
-		"推荐",
-		"安利",
-		"宝藏",
-		"绝了",
-		"太顶了",
-		"快来看",
-		"赶紧",
-		"冲",
-		"入坑",
-		"必看",
-		"神作",
-		"良心",
-		"小伙伴们",
-		"各位",
-		"紳士",
-		"51娘",
-	];
+	const toneWords = [
+		"爆料",
+		"知情人",
+		"当事人",
+		"疑似",
+		"曝光",
+		"回应",
+		"否认",
+		"澄清",
+		"撕逼",
+		"吃瓜",
+		"坐实",
+		"目击",
+		"网传",
+		"官方",
+	];
```

#### 1d. 更新 evaluateQuality 簽名（第 149–156 行）

```diff
 export function evaluateQuality(
 	draft: ContentDraft,
-	facts?: FactsBlock,
+	facts?: GossipFactsBlock,
 	threshold: number = DEFAULT_THRESHOLD,
 ): QualityVerdict {
 	const checks: QualityCheck[] = [
 		checkBodyLength(draft.body),
-		checkFactsCompleteness(facts ?? {}),
+		checkFactsCompleteness(facts ?? { 當事人: null, 事件摘要: null, 起因: null, 經過: null, 結果: null, 來源連結: null, 發生時間: null, 熱度標籤: null }),
```

> `facts ?? {}` 對 `GossipFactsBlock` 類型不合法（`{}` 缺少 required 欄位）；改為明確的 null 初始化物件。

**完成後**：`pnpm --filter @51guapi/shared build` → `pnpm --filter @51guapi/shared test`

---

### Unit 2 — backend/src/services/llm.ts（R7-llm + 型別修正）

**目標**：更新 LLM prompt 中的 `community_tone` 描述，並修正 `LlmDeps.facts` 型別（否則 Unit 1 後 `pnpm compile` 會在第 399 行報 TypeScript 型別錯誤）。

定位方式（勿用近似行號，改用 grep）：
```bash
grep -n "DEFAULT_CRITERIA\|community_tone\|DIM_LABELS\|facts.*FactsBlock\|assembleDraft" packages/backend/src/services/llm.ts
```

#### 2a. import（第 1–6 行）

```diff
 import type {
 	ContentDraft,
-	FactsBlock,
+	GossipFactsBlock,
 	GenerateDraftResponse,
 	Settings,
 } from "@51guapi/shared";
```

#### 2b. LlmDeps interface（第 14–17 行）

```diff
 export interface LlmDeps {
 	settings: Settings;
 	apiKey: string;
-	facts?: FactsBlock;
+	facts?: GossipFactsBlock;
```

#### 2c. facts fallback（第 275 行）

```diff
-	const facts = deps.facts ?? {};
+	const facts = deps.facts ?? { 當事人: null, 事件摘要: null, 起因: null, 經過: null, 結果: null, 來源連結: null, 發生時間: null, 熱度標籤: null };
```

#### 2d. assembleDraft 呼叫（第 390 行）

`assembleDraft` 接受 `FactsBlock`（ACG 漫畫字段），gossip 管線不使用這些字段（manga fields 在 GossipFactsBlock 中不存在，結果與傳 `{}` 等效）。加 cast 以保留現有行為並消除型別錯誤：

```diff
-	const assembled = assembleDraft(slots, facts);
+	const assembled = assembleDraft(slots, facts as unknown as FactsBlock);
```

> 需同時在 import 中加回 `FactsBlock`（只做 cast 用），或改用 `as unknown as import("@51guapi/shared").FactsBlock`。最簡做法：import 兩個型別 `GossipFactsBlock, FactsBlock`。

#### 2e. DEFAULT_CRITERIA（第 520 行附近，用 grep 定位）

```diff
-2. community_tone（社区口吻）：文风贴近动漫社区，口语化接地气，不过于官方生硬。
+2. community_tone（吃瓜口吻）：用词贴近吃瓜娱乐报道，含知情人/爆料/疑似等词汇，不过于官方生硬。
```

#### 2f. DIM_LABELS（第 528 行附近，用 grep 定位）

```diff
-	community_tone: "正文风格（需更贴近动漫社区口吻，口语化接地气）",
+	community_tone: "正文风格（需更贴近吃瓜娱乐报道口吻，含爆料/疑似等词汇）",
```

**完成後**：`pnpm --filter @51guapi/backend compile`

---

### Unit 3 — backend metrics 死碼清除（R7–R10）

**目標**：清除 `publishAttempts` counter 及其 Prometheus 輸出。

先確認無其他消費端：
```bash
grep -r "publishAttempts\|recordPublishAttempt" packages/ --include="*.ts"
```
預期只命中 `metrics.ts` + `metrics.test.ts`（+ storage.ts，Unit 4 處理）。

#### 3a. metrics.ts

- 第 6 行：刪除 `publishAttempts: { success: 0, failed: 0 },`
- 第 27–30 行：刪除整個 `recordPublishAttempt()` 函式定義與 export
- 第 52–55 行：刪除 `publisher_publish_attempts_total` 的 HELP/TYPE/label×2 四行，同時刪除前面的空行（保持輸出格式整潔）

#### 3b. metrics.test.ts

- 第 7 行：從 import 中移除 `recordPublishAttempt`
- 第 17–18 行：刪除 `counters.publishAttempts.success = 0;` 和 `counters.publishAttempts.failed = 0;`
- 第 33–34 行（「全零輸出」測試）：刪除 `publisher_publish_attempts_total{status="failed"}` 的 expect
- 第 43 行（HELP/TYPE 測試）：刪除 `expect(out).toContain("# TYPE publisher_publish_attempts_total counter");`
- 第 52–53 行（「計數器遞增」測試）：刪除 `counters.publishAttempts.success = 4;` + `counters.publishAttempts.failed = 6;`
- 第 61–66 行：刪除 `publisher_publish_attempts_total{status="success"} 4` + `{status="failed"} 6` 的兩個 expect
- 第 87–92 行：刪除整個 `"recordPublishAttempt 递增正确计数器"` it block

**完成後**：`pnpm --filter @51guapi/backend test`

---

### Unit 4 — Extension storage + quality-gate.test.ts fixture（R11–R12）

#### 4a. packages/extension/lib/storage.ts

- 第 133 行：移除 `publishAttempts: { success: number; failed: number };` 欄位（從 `ExtensionCounters` interface）
- 第 138 行：移除 `defaultExtensionCounters` 函式中的 `publishAttempts: { success: 0, failed: 0 },`
- 第 150–154 行：移除 `getExtensionCounters` 中的 publishAttempts merge 區塊：
  ```ts
  publishAttempts: {
    success: stored.publishAttempts?.success ?? def.publishAttempts.success,
    failed: stored.publishAttempts?.failed ?? def.publishAttempts.failed,
  },
  ```

> 移除後 `ExtensionCounters` 只剩 `batchesCompleted: number`；`getExtensionCounters` 回傳物件簡化為 `{ batchesCompleted: ... }`。

#### 4b. packages/extension/lib/storage.test.ts

先定位確切行號：
```bash
grep -n "publishAttempts" packages/extension/lib/storage.test.ts
```
（確認在第 159/166/171/176/180/181 行附近）

移除包含這些行的 3 個 `it(...)` 測試案例（約第 155–183 行），涵蓋：
- `getExtensionCounters 返回默认对象（含 publishAttempts）` 測試
- `从 storage 读取并合并 publishAttempts` 測試
- `publishAttempts 缺少 failed 字段时用默认值填充` 測試

#### 4c. packages/backend/src/quality-gate.test.ts（R12）

**4c-i. 全域修改（適用整個檔案）**

第 1 行 import：
```diff
-import type { ContentDraft, FactsBlock } from "@51guapi/shared";
+import type { ContentDraft, GossipFactsBlock } from "@51guapi/shared";
```

第 12 行 `makeDraft` body（全局 helper，所有測試共用）：含吃瓜詞彙（≥2 個），使 `community_tone` 在新 toneWords 下仍通過：
```diff
-body: "<p>这是一篇测试文章，包含足够的内容来通过正文长度检查。嗨嗨大家好，今天给大家推荐一部宝藏作品。</p>",
+body: "<p>这是一篇测试文章，包含足够的内容来通过正文长度检查。据知情人爆料，疑似曝光相关细节，网传已坐实。</p>",
```

**4c-ii. 「全部达标时 overall >= 0.6」測試**（第 25–31 行）

第 27 行 facts fixture：
```diff
-const facts: FactsBlock = { 作品名: "测试作品", 题材: "多人群交" };
+const facts: GossipFactsBlock = { 當事人: "测试当事人", 事件摘要: "测试摘要", 起因: "起因说明", 經過: "经过描述", 結果: "结果说明", 來源連結: null, 發生時間: null, 熱度標籤: null };
```

**4c-iii. 「事实不完整时扣分」測試**（第 82–88 行）

第 84 行 facts fixture：
```diff
-const facts: FactsBlock = {};
+const facts: GossipFactsBlock = { 當事人: null, 事件摘要: null, 起因: null, 經過: null, 結果: null, 來源連結: null, 發生時間: null, 熱度標籤: null };
```

**4c-iv. 「可自定义阈值」測試**（第 90–94 行）

第 92 行：
```diff
-const result = evaluateQuality(draft, {}, 0.9);
+const result = evaluateQuality(draft, { 當事人: null, 事件摘要: null, 起因: null, 經過: null, 結果: null, 來源連結: null, 發生時間: null, 熱度標籤: null }, 0.9);
```

**完成後**：
```bash
bash scripts/check-fixture-secrets.sh   # 確認輸出中有實際掃到的檔案路徑（不只 exit 0）
pnpm test                               # 全包
pnpm compile                            # 全包類型檢查
```

---

## Verification Checklist

- [ ] `evaluateQuality` 對 5/5 gossip 字段全填的吃瓜草稿 → `facts_completeness.pass = true`
- [ ] `evaluateQuality` 對含「爆料」「曝光」的正文 → `community_tone.pass = true`
- [ ] `GET /api/v1/metrics` 不含 `publisher_publish_attempts_total` 任何標籤
- [ ] `pnpm test` 全綠（backend + extension + shared）
- [ ] `pnpm compile` 零 TypeScript 錯誤
- [ ] fixture 脫敏閘門輸出有實際掃描路徑（非假綠）

## Files Modified

| 檔案 | 操作 |
|------|------|
| `packages/shared/src/quality-gate.ts` | 修改（import + coreKeys + toneWords + 函式簽名） |
| `packages/backend/src/services/llm.ts` | 修改（import + LlmDeps.facts 型別 + facts fallback + assembleDraft cast + DEFAULT_CRITERIA + DIM_LABELS） |
| `packages/backend/src/services/metrics.ts` | 修改（刪 publishAttempts counter + 函式 + Prometheus 行） |
| `packages/backend/src/services/metrics.test.ts` | 修改（刪對應測試） |
| `packages/backend/src/quality-gate.test.ts` | 修改（fixture 換為 GossipFactsBlock + gossip 詞彙） |
| `packages/extension/lib/storage.ts` | 修改（刪 publishAttempts 欄位 + 預設值 + merge 邏輯） |
| `packages/extension/lib/storage.test.ts` | 修改（刪 publishAttempts 相關 3 個測試） |

## Do NOT Touch

- `packages/shared/src/facts.ts`（FactsBlock 原始定義）
- `packages/backend/src/scraper/` 或其他 30+ ACG pipeline 引用 FactsBlock 的檔案
- `evaluateQuality` 的整體通過門檻（DEFAULT_THRESHOLD = 0.6）
- `body_length`、`title_quality`、`tags_accuracy` 三個 check 邏輯
