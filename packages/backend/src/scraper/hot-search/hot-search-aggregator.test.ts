import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	clearHotSearchForTest,
	listHotSearchKeywords,
} from "../hot-search-store.js";
import { initPendingDb } from "../pending-db.js";
import { scrapeAllPlatforms } from "./hot-search-aggregator.js";
import type { HotSearchItem } from "./types.js";

// mock 各平台 scraper — 測聚合邏輯，不測網路請求
vi.mock("./baidu-scraper.js", () => ({
	scrapeBaidu: vi.fn(),
}));
vi.mock("./weibo-scraper.js", () => ({
	scrapeWeibo: vi.fn(),
}));
vi.mock("./douyin-scraper.js", () => ({
	scrapeDouyin: vi.fn(),
}));

import { scrapeBaidu } from "./baidu-scraper.js";
import { scrapeDouyin } from "./douyin-scraper.js";
import { scrapeWeibo } from "./weibo-scraper.js";

function makeItem(keyword: string, rank: number, heat = 80): HotSearchItem {
	return { keyword, rankPosition: rank, heatScore: heat };
}

describe("scrapeAllPlatforms", () => {
	beforeEach(() => {
		initPendingDb();
		clearHotSearchForTest();
		vi.clearAllMocks();
	});

	afterEach(() => {
		clearHotSearchForTest();
	});

	it("三平台全成功 → counts 正確、keywords 入庫", async () => {
		vi.mocked(scrapeBaidu).mockResolvedValue([makeItem("章子怡", 1, 90)]);
		vi.mocked(scrapeWeibo).mockResolvedValue([
			makeItem("章子怡", 2, 70),
			makeItem("汪峰", 3, 50),
		]);
		vi.mocked(scrapeDouyin).mockResolvedValue([]);

		const result = await scrapeAllPlatforms();
		await new Promise((r) => setTimeout(r, 20)); // wait for pendingWriteQueue

		expect(result.baidu).toBe(1);
		expect(result.weibo).toBe(2);
		expect(result.douyin).toBe(0);
		expect(result.total).toBe(3);
		expect(result.errors).toHaveLength(0);

		const stored = listHotSearchKeywords();
		expect(stored).toHaveLength(3);
		expect(
			stored.some((k) => k.platform === "baidu" && k.keyword === "章子怡"),
		).toBe(true);
		expect(
			stored.some((k) => k.platform === "weibo" && k.keyword === "汪峰"),
		).toBe(true);
	});

	it("一個平台拋錯 → errors 記錄錯誤，其他平台正常入庫", async () => {
		vi.mocked(scrapeBaidu).mockRejectedValue(new Error("timeout"));
		vi.mocked(scrapeWeibo).mockResolvedValue([makeItem("王力宏", 1, 85)]);
		vi.mocked(scrapeDouyin).mockResolvedValue([makeItem("明星八卦", 1, 60)]);

		const result = await scrapeAllPlatforms();
		await new Promise((r) => setTimeout(r, 20)); // wait for pendingWriteQueue

		expect(result.baidu).toBe(0);
		expect(result.weibo).toBe(1);
		expect(result.douyin).toBe(1);
		expect(result.total).toBe(2);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain("baidu");
		expect(result.errors[0]).toContain("timeout");

		const stored = listHotSearchKeywords();
		expect(stored).toHaveLength(2);
	});

	it("全部平台失敗 → total=0、errors 三條、不入庫", async () => {
		vi.mocked(scrapeBaidu).mockRejectedValue(new Error("err1"));
		vi.mocked(scrapeWeibo).mockRejectedValue(new Error("err2"));
		vi.mocked(scrapeDouyin).mockRejectedValue(new Error("err3"));

		const result = await scrapeAllPlatforms();

		expect(result.total).toBe(0);
		expect(result.errors).toHaveLength(3);
		expect(listHotSearchKeywords()).toHaveLength(0);
	});

	it("全部平台回空陣列 → total=0、無錯誤、不入庫（不呼叫 upsert）", async () => {
		vi.mocked(scrapeBaidu).mockResolvedValue([]);
		vi.mocked(scrapeWeibo).mockResolvedValue([]);
		vi.mocked(scrapeDouyin).mockResolvedValue([]);

		const result = await scrapeAllPlatforms();

		expect(result.total).toBe(0);
		expect(result.errors).toHaveLength(0);
		expect(listHotSearchKeywords()).toHaveLength(0);
	});

	it("buildKeywords 正確設定 platform 欄位", async () => {
		vi.mocked(scrapeBaidu).mockResolvedValue([makeItem("A", 1, 70)]);
		vi.mocked(scrapeWeibo).mockResolvedValue([makeItem("B", 1, 60)]);
		vi.mocked(scrapeDouyin).mockResolvedValue([makeItem("C", 1, 50)]);

		await scrapeAllPlatforms();
		await new Promise((r) => setTimeout(r, 20)); // wait for pendingWriteQueue

		const stored = listHotSearchKeywords();
		const platforms = new Set(stored.map((k) => k.platform));
		expect(platforms).toEqual(new Set(["baidu", "weibo", "douyin"]));
	});
});
