import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	clearHotSearchForTest,
	upsertHotSearchBatch,
} from "../scraper/hot-search-store.js";
import { getDb, initPendingDb } from "../scraper/pending-db.js";
import type { PendingTopic } from "../scraper/pending-store.js";
import { savePendingTopic } from "../scraper/pending-store.js";
import {
	addToBlacklist,
	clearBlacklistForTest,
} from "../scraper/ranking-blacklist-store.js";
import { fuzzyMatch, getRankedList } from "./ranking-service.js";

function resetDb() {
	initPendingDb();
	getDb().exec("DELETE FROM pending_topics");
}

function makeTopic(overrides: Partial<PendingTopic> = {}): PendingTopic {
	const now = new Date().toISOString();
	return {
		id: `rank-test-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
		sourceUrl: "https://test.com/a",
		siteName: "test-site",
		title: "測試標題",
		facts: {},
		confidence: 0.8,
		status: "pending",
		domain: "gossip",
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

function makeKeyword(
	keyword: string,
	platform: "baidu" | "weibo" | "douyin" | "xiaohongshu" = "baidu",
	rankPosition = 1,
	heatScore = 80,
) {
	const now = new Date();
	const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);
	return {
		id: `kw-${keyword}-${platform}-${Date.now()}`,
		keyword,
		platform,
		heatScore,
		rankPosition,
		capturedAt: now.toISOString(),
		expiresAt: expires.toISOString(),
	};
}

// fuzzyMatch 是純函數，不需要 DB — 直接測試
describe("fuzzyMatch", () => {
	it("完全包含（keyword ⊆ title）", () => {
		expect(fuzzyMatch("王力宏離婚記者會", "王力宏")).toBe(true);
	});

	it("反向包含（title ⊆ keyword）", () => {
		expect(fuzzyMatch("章子怡", "章子怡汪峰分居傳聞")).toBe(true);
	});

	it("空格正規化：去空格後包含", () => {
		expect(fuzzyMatch("章子怡汪峰", "章子怡 汪峰")).toBe(true);
		expect(fuzzyMatch("章子怡 汪峰", "章子怡汪峰")).toBe(true);
	});

	it("大小寫不敏感（英文混合）", () => {
		expect(fuzzyMatch("Jay Chou concert", "jay chou")).toBe(true);
	});

	it("無關字符：不匹配", () => {
		expect(fuzzyMatch("王力宏離婚", "周杰倫")).toBe(false);
	});

	it("空字串：不匹配", () => {
		expect(fuzzyMatch("", "王力宏")).toBe(false);
		expect(fuzzyMatch("王力宏", "")).toBe(false);
	});

	it("相同字串：匹配", () => {
		expect(fuzzyMatch("章子怡", "章子怡")).toBe(true);
	});
});

describe("getRankedList (整合測試 — 需要 DB)", () => {
	beforeEach(() => {
		resetDb();
		clearHotSearchForTest();
		clearBlacklistForTest();
	});

	afterEach(() => {
		clearHotSearchForTest();
		clearBlacklistForTest();
	});

	it("空庫時 sectionA/B 均為空陣列", async () => {
		const result = await getRankedList();
		expect(result.sectionA).toHaveLength(0);
		expect(result.sectionB).toHaveLength(0);
		expect(result.freshAt).toBeTruthy();
	});

	it("有熱搜但無匹配選題 → sectionA 空、sectionB 有關鍵詞", async () => {
		upsertHotSearchBatch([makeKeyword("章子怡", "baidu", 1, 90)]);
		await new Promise((r) => setTimeout(r, 20));

		const result = await getRankedList();
		expect(result.sectionA).toHaveLength(0);
		expect(result.sectionB.some((k) => k.keyword === "章子怡")).toBe(true);
	});

	it("選題 title 包含熱搜 keyword → 進入 sectionA，不在 sectionB", async () => {
		const topic = makeTopic({
			title: "章子怡汪峰分居疑雲",
			siteName: "news-a",
		});
		await savePendingTopic(topic);
		upsertHotSearchBatch([makeKeyword("章子怡", "baidu", 1, 80)]);
		await new Promise((r) => setTimeout(r, 20));

		const result = await getRankedList();
		expect(result.sectionA).toHaveLength(1);
		expect(result.sectionA[0].title).toBe("章子怡汪峰分居疑雲");
		expect(result.sectionA[0].matchedKeywords).toContain("章子怡");
		// keyword 已被 A 區消化，不出現在 B 區
		expect(result.sectionB.some((k) => k.keyword === "章子怡")).toBe(false);
	});

	it("黑名單關鍵詞不出現在 sectionB，匹配的選題也不進 sectionA", async () => {
		const topic = makeTopic({ title: "王力宏離婚事件", siteName: "news-b" });
		await savePendingTopic(topic);
		upsertHotSearchBatch([makeKeyword("王力宏", "baidu", 1, 70)]);
		addToBlacklist("王力宏");
		await new Promise((r) => setTimeout(r, 20));

		const result = await getRankedList();
		expect(result.sectionA).toHaveLength(0);
		expect(result.sectionB.some((k) => k.keyword === "王力宏")).toBe(false);
	});

	it("sectionA 按分數由高到低排序", async () => {
		// 建立兩條選題：一條有多平台覆蓋（分數較高），一條只有一個平台
		const topicA = makeTopic({
			title: "章子怡汪峰分居",
			siteName: "news-a",
		});
		const topicB = makeTopic({
			title: "章子怡近況",
			siteName: "news-b",
		});
		await savePendingTopic(topicA);
		await savePendingTopic(topicB);

		// 章子怡同時在 baidu 和 weibo 有熱搜（多平台→較高權重）
		upsertHotSearchBatch([
			makeKeyword("章子怡", "baidu", 1, 90),
			makeKeyword("章子怡", "weibo", 2, 70),
		]);
		await new Promise((r) => setTimeout(r, 20));

		const result = await getRankedList();
		expect(result.sectionA.length).toBeGreaterThanOrEqual(1);
		// 驗證是否遞減排序
		for (let i = 1; i < result.sectionA.length; i++) {
			expect(result.sectionA[i - 1].score).toBeGreaterThanOrEqual(
				result.sectionA[i].score,
			);
		}
	});

	it("非 gossip domain 的選題不計入 sectionA", async () => {
		// 即使 title 匹配，acg domain 不應出現在 ranking
		const acgTopic = makeTopic({
			title: "章子怡新番",
			domain: "acg",
		});
		await savePendingTopic(acgTopic);
		upsertHotSearchBatch([makeKeyword("章子怡", "baidu", 1, 80)]);
		await new Promise((r) => setTimeout(r, 20));

		const result = await getRankedList();
		// acg domain 的選題不應進入 ranking
		expect(result.sectionA.every((t) => t.title !== "章子怡新番")).toBe(true);
	});

	it("36h 前的選題 recencyScore=0.5 — 進入 sectionA（line 55）", async () => {
		const createdAt36h = new Date(
			Date.now() - 36 * 60 * 60 * 1000,
		).toISOString();
		const topic = makeTopic({
			title: "章子怡汪峰分居新消息",
			siteName: "news-36h",
			createdAt: createdAt36h,
			updatedAt: createdAt36h,
		});
		await savePendingTopic(topic);
		upsertHotSearchBatch([makeKeyword("章子怡", "baidu", 1, 80)]);
		await new Promise((r) => setTimeout(r, 20));

		const result = await getRankedList();
		expect(
			result.sectionA.some((t) => t.title === "章子怡汪峰分居新消息"),
		).toBe(true);
	});

	it(">48h 前的選題 recencyScore=0.1 — 進入 sectionA（line 56）", async () => {
		const createdAt72h = new Date(
			Date.now() - 72 * 60 * 60 * 1000,
		).toISOString();
		const topic = makeTopic({
			title: "章子怡出軌舊新聞",
			siteName: "news-72h",
			createdAt: createdAt72h,
			updatedAt: createdAt72h,
		});
		await savePendingTopic(topic);
		upsertHotSearchBatch([makeKeyword("章子怡", "weibo", 1, 80)]);
		await new Promise((r) => setTimeout(r, 20));

		const result = await getRankedList();
		expect(result.sectionA.some((t) => t.title === "章子怡出軌舊新聞")).toBe(
			true,
		);
	});

	it("sectionB 含 2+ 關鍵詞 → sort 比較子執行（line 230）", async () => {
		// 兩個無匹配選題的關鍵詞 → 都進 sectionB → comparator 觸發
		upsertHotSearchBatch([
			makeKeyword("鄭爽", "baidu", 1, 95),
			makeKeyword("張繼科", "weibo", 3, 60),
		]);
		await new Promise((r) => setTimeout(r, 20));

		const result = await getRankedList();
		expect(result.sectionB.length).toBeGreaterThanOrEqual(2);
		// avgHeatScore 高者排前：鄭爽(95) 在 張繼科(60) 之前
		const idxA = result.sectionB.findIndex((k) => k.keyword === "鄭爽");
		const idxB = result.sectionB.findIndex((k) => k.keyword === "張繼科");
		expect(idxA).toBeLessThan(idxB);
	});
});
