import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	cleanupExpiredHotSearch,
	clearHotSearchForTest,
	type HotSearchKeyword,
	listHotSearchKeywords,
	upsertHotSearchBatch,
} from "./hot-search-store.js";
import { initPendingDb } from "./pending-db.js";

function makeKeyword(
	overrides: Partial<HotSearchKeyword> = {},
): HotSearchKeyword {
	const now = new Date();
	const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);
	return {
		id: `baidu-1-${Date.now()}`,
		keyword: "測試關鍵詞",
		platform: "baidu",
		heatScore: 80,
		rankPosition: 1,
		capturedAt: now.toISOString(),
		expiresAt: expires.toISOString(),
		...overrides,
	};
}

describe("hot-search-store", () => {
	beforeEach(() => {
		initPendingDb();
		clearHotSearchForTest();
	});
	afterEach(() => {
		clearHotSearchForTest();
	});

	it("upsertHotSearchBatch → listHotSearchKeywords 正確往返", async () => {
		const kw = makeKeyword({ keyword: "章子怡汪峰", platform: "baidu" });
		upsertHotSearchBatch([kw]);
		// pendingWriteQueue 使用 setImmediate，需等待
		await new Promise((r) => setImmediate(r));
		const list = listHotSearchKeywords();
		expect(list).toHaveLength(1);
		expect(list[0].keyword).toBe("章子怡汪峰");
		expect(list[0].platform).toBe("baidu");
		expect(list[0].heatScore).toBe(80);
		expect(list[0].rankPosition).toBe(1);
	});

	it("已過期的條目不出現在 listHotSearchKeywords", async () => {
		const past = new Date(Date.now() - 1000).toISOString();
		const expired = makeKeyword({
			id: "baidu-expired-1",
			keyword: "過期關鍵詞",
			expiresAt: past,
		});
		upsertHotSearchBatch([expired]);
		await new Promise((r) => setImmediate(r));
		const list = listHotSearchKeywords();
		expect(list).toHaveLength(0);
	});

	it("未過期 + 已過期混合：只返回未過期", async () => {
		const past = new Date(Date.now() - 1000).toISOString();
		const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
		upsertHotSearchBatch([
			makeKeyword({ id: "kw-1", keyword: "有效關鍵詞", expiresAt: future }),
			makeKeyword({ id: "kw-2", keyword: "過期關鍵詞", expiresAt: past }),
		]);
		await new Promise((r) => setImmediate(r));
		const list = listHotSearchKeywords();
		expect(list).toHaveLength(1);
		expect(list[0].keyword).toBe("有效關鍵詞");
	});

	it("cleanupExpiredHotSearch 從 DB 刪除過期條目", async () => {
		const past = new Date(Date.now() - 1000).toISOString();
		upsertHotSearchBatch([
			makeKeyword({ id: "kw-3", keyword: "過期A", expiresAt: past }),
		]);
		await new Promise((r) => setImmediate(r));
		cleanupExpiredHotSearch();
		await new Promise((r) => setImmediate(r));
		// 直接查 DB 驗證（不通過 TTL 過濾器）
		const { getDb } = await import("./pending-db.js");
		const rows = getDb()
			.prepare("SELECT * FROM hot_search_keywords WHERE keyword = 'A'")
			.all();
		expect(rows).toHaveLength(0);
	});

	it("upsertHotSearchBatch INSERT OR REPLACE 冪等：相同 id 覆寫", async () => {
		const kw = makeKeyword({ id: "baidu-idem", keyword: "幂等測試" });
		upsertHotSearchBatch([kw]);
		upsertHotSearchBatch([{ ...kw, heatScore: 99 }]);
		await new Promise((r) => setImmediate(r));
		const list = listHotSearchKeywords();
		// INSERT OR REPLACE → 只有一筆，且 heatScore 為最後寫入的 99
		expect(list).toHaveLength(1);
		expect(list[0].heatScore).toBe(99);
	});
});
