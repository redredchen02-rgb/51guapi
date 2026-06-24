import { describe, expect, it, vi } from "vitest";
import { scrapeBaidu } from "./baidu-scraper.js";

function mockFetchJson(body: unknown): typeof fetch {
	return vi.fn(
		async () =>
			({
				ok: true,
				status: 200,
				json: async () => body,
				headers: new Headers(),
			}) as unknown as Response,
	) as unknown as typeof fetch;
}

function mockFetchError(status: number): typeof fetch {
	return vi.fn(
		async () =>
			({
				ok: false,
				status,
				json: async () => ({}),
				headers: new Headers(),
			}) as unknown as Response,
	) as unknown as typeof fetch;
}

const BAIDU_FIXTURE = {
	data: {
		cards: [
			{
				content: [
					{ word: "王力宏離婚", hotScore: "9000000", index: 1 },
					{ word: "章子怡新劇", hotScore: "4500000", index: 2 },
					{ word: "周杰倫演唱會", hotScore: "2250000", index: 3 },
				],
			},
		],
	},
};

describe("baidu-scraper", () => {
	it("正常響應：返回正確條目數、關鍵詞、排名", async () => {
		const items = await scrapeBaidu(mockFetchJson(BAIDU_FIXTURE));
		expect(items).toHaveLength(3);
		expect(items[0].keyword).toBe("王力宏離婚");
		expect(items[0].rankPosition).toBe(1);
		expect(items[1].keyword).toBe("章子怡新劇");
		expect(items[2].keyword).toBe("周杰倫演唱會");
	});

	it("heat_score 正規化：最高項為 100，其餘按比例", async () => {
		const items = await scrapeBaidu(mockFetchJson(BAIDU_FIXTURE));
		expect(items[0].heatScore).toBe(100);
		expect(items[1].heatScore).toBeCloseTo(50, 0);
		expect(items[2].heatScore).toBeCloseTo(25, 0);
	});

	it("heat_score 在 0-100 範圍內", async () => {
		const items = await scrapeBaidu(mockFetchJson(BAIDU_FIXTURE));
		for (const item of items) {
			expect(item.heatScore).toBeGreaterThanOrEqual(0);
			expect(item.heatScore).toBeLessThanOrEqual(100);
		}
	});

	it("HTTP 錯誤：返回空陣列不拋出", async () => {
		const items = await scrapeBaidu(mockFetchError(403));
		expect(items).toHaveLength(0);
	});

	it("空 content：返回空陣列", async () => {
		const items = await scrapeBaidu(mockFetchJson({ data: { cards: [] } }));
		expect(items).toHaveLength(0);
	});

	it("fetch 拋出錯誤：捕捉並返回空陣列", async () => {
		const throwFetch = vi.fn(async () => {
			throw new Error("network error");
		}) as unknown as typeof fetch;
		const items = await scrapeBaidu(throwFetch);
		expect(items).toHaveLength(0);
	});

	it("res.json() 抛出（非法 JSON body）→ 回傳空陣列 (lines 56-57)", async () => {
		const badJsonFetch = vi.fn(async () => ({
			ok: true,
			status: 200,
			json: async () => {
				throw new SyntaxError("Unexpected token");
			},
			headers: new Headers(),
		})) as unknown as typeof fetch;
		const items = await scrapeBaidu(badJsonFetch);
		expect(items).toEqual([]);
	});

	it("過濾掉 word 為空的條目", async () => {
		const fixture = {
			data: {
				cards: [
					{
						content: [
							{ word: "有效詞", hotScore: "1000", index: 1 },
							{ word: "", hotScore: "500", index: 2 },
							{ hotScore: "200", index: 3 }, // 無 word
						],
					},
				],
			},
		};
		const items = await scrapeBaidu(mockFetchJson(fixture));
		expect(items).toHaveLength(1);
		expect(items[0].keyword).toBe("有效詞");
	});
});
