import { describe, expect, it, vi } from "vitest";
import { scrapeWeibo } from "./weibo-scraper.js";

// Mock 三步驟：genvisitor → incarnate → hotsearch
// fetchFn 按呼叫順序返回不同 Response
function makeMockFetch(responses: Response[]): typeof fetch {
	let call = 0;
	return vi.fn(async () => {
		const res = responses[call++];
		if (!res) throw new Error(`unexpected fetch call #${call}`);
		return res;
	}) as unknown as typeof fetch;
}

function makeJsonResponse(body: unknown, headers?: Record<string, string>): Response {
	const h = new Headers(headers);
	return {
		ok: true,
		status: 200,
		json: async () => body,
		headers: h,
	} as unknown as Response;
}

const WEIBO_HOT_FIXTURE = {
	ok: 1,
	data: {
		realtime: [
			{ word: "王力宏離婚", num: 8000000, rank: 1 },
			{ word: "章子怡演技", num: 4000000, rank: 2 },
			{ word: "周杰倫新歌", num: 2000000, rank: 3 },
		],
	},
};

describe("weibo-scraper", () => {
	it("三步成功：返回正確條目", async () => {
		const mockFetch = makeMockFetch([
			makeJsonResponse({ data: { tid: "test-tid-123" } }),
			makeJsonResponse({}, { "set-cookie": "SUB=abc123; path=/; SUBP=def456; path=/" }),
			makeJsonResponse(WEIBO_HOT_FIXTURE),
		]);
		const items = await scrapeWeibo(mockFetch);
		expect(items).toHaveLength(3);
		expect(items[0].keyword).toBe("王力宏離婚");
		expect(items[0].rankPosition).toBe(1);
		expect(items[0].heatScore).toBe(100); // 最高者為 100
	});

	it("heat_score 正規化：最高 100，其餘按比例", async () => {
		const mockFetch = makeMockFetch([
			makeJsonResponse({ data: { tid: "tid-abc" } }),
			makeJsonResponse({}, { "set-cookie": "SUB=x; path=/" }),
			makeJsonResponse(WEIBO_HOT_FIXTURE),
		]);
		const items = await scrapeWeibo(mockFetch);
		expect(items[1].heatScore).toBeCloseTo(50, 0);
		expect(items[2].heatScore).toBeCloseTo(25, 0);
	});

	it("genvisitor 無 tid：返回空陣列", async () => {
		const mockFetch = makeMockFetch([
			makeJsonResponse({ data: {} }), // 無 tid
		]);
		const items = await scrapeWeibo(mockFetch);
		expect(items).toHaveLength(0);
	});

	it("incarnate 無 cookie：返回空陣列", async () => {
		const mockFetch = makeMockFetch([
			makeJsonResponse({ data: { tid: "tid-xyz" } }),
			makeJsonResponse({}), // 無 set-cookie
		]);
		const items = await scrapeWeibo(mockFetch);
		expect(items).toHaveLength(0);
	});

	it("hotsearch HTTP 錯誤：返回空陣列", async () => {
		const mockFetch = makeMockFetch([
			makeJsonResponse({ data: { tid: "tid-err" } }),
			makeJsonResponse({}, { "set-cookie": "SUB=ok; path=/" }),
			{ ok: false, status: 403, json: async () => ({}), headers: new Headers() } as unknown as Response,
		]);
		const items = await scrapeWeibo(mockFetch);
		expect(items).toHaveLength(0);
	});

	it("genvisitor 網路錯誤：捕捉並返回空陣列", async () => {
		const throwFetch = vi.fn(async () => {
			throw new Error("network error");
		}) as unknown as typeof fetch;
		const items = await scrapeWeibo(throwFetch);
		expect(items).toHaveLength(0);
	});
});
