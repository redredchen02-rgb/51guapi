import { describe, expect, it, vi } from "vitest";
import {
	type EnrichedContext,
	enrichContext,
	formatEnrichmentForPrompt,
} from "./web-enricher.js";

function makeFetch(responses: Array<{ ok: boolean; text: string }>) {
	let idx = 0;
	return vi.fn(async () => {
		const r = responses[idx++] ?? { ok: false, text: "" };
		return {
			ok: r.ok,
			text: async () => r.text,
		} as Response;
	});
}

const PIXIV_PAGE = `Title: 花鸟画师
URL Source: https://pixiv.net/tags/%E8%8A%B1%E9%B8%9F%E7%94%BB%E5%B8%88

以工笔花鸟为主,擅长细腻笔法与传统意境。

* [关注作者](pixiv.net/en/users/123)
* [![thumbnail](pximg.net/img.jpg)](pixiv.net/en/artworks/456)
`;

describe("enrichContext", () => {
	it("返回空结果当 facts 无有效字段", async () => {
		const fetchFn = makeFetch([]);
		const ctx = await enrichContext({ facts: {}, fetchFn, maxQueries: 2 });
		expect(ctx.queryResults).toHaveLength(0);
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it("按作者名搜索 pixiv", async () => {
		const fetchFn = makeFetch([{ ok: true, text: PIXIV_PAGE }]);
		const ctx = await enrichContext({
			facts: { 制作: "花鸟画师" },
			fetchFn,
			maxQueries: 1,
		});
		expect(ctx.queryResults).toHaveLength(1);
		expect(ctx.queryResults[0].query).toBe("花鸟画师");
		expect(ctx.queryResults[0].results[0].title).toBe("花鸟画师");
		expect(ctx.queryResults[0].results[0].snippet).toContain("工笔");
	});

	it("HTTP 失败时静默降级返回空结果", async () => {
		const fetchFn = makeFetch([{ ok: false, text: "" }]);
		const ctx = await enrichContext({
			facts: { 制作: "某作者" },
			fetchFn,
			maxQueries: 1,
		});
		expect(ctx.queryResults[0].results).toHaveLength(0);
	});

	it("fetch 抛出异常时静默降级", async () => {
		const fetchFn = vi.fn(async () => {
			throw new Error("network error");
		}) as unknown as typeof fetch;
		const ctx = await enrichContext({
			facts: { 制作: "某作者" },
			fetchFn,
			maxQueries: 1,
		});
		expect(ctx.queryResults[0].results).toHaveLength(0);
	});

	it("同时搜索作者 + 作品名", async () => {
		const fetchFn = makeFetch([
			{ ok: true, text: PIXIV_PAGE },
			{ ok: true, text: PIXIV_PAGE },
		]);
		const ctx = await enrichContext({
			facts: { 制作: "花鸟画师", 作品名: "山水之间" },
			fetchFn,
			maxQueries: 3,
			timeoutMs: 5000,
		});
		expect(ctx.queryResults).toHaveLength(2);
	});
});

describe("formatEnrichmentForPrompt", () => {
	it("有结果时生成参考文本", () => {
		const ctx: EnrichedContext = {
			queryResults: [
				{
					query: "花鸟画师",
					results: [
						{
							title: "pixiv 作者页",
							snippet: "以工笔花鸟为主",
							url: "https://pixiv.net/tags/abc",
						},
					],
				},
			],
			collectedAt: "2026-06-12T00:00:00.000Z",
		};
		const text = formatEnrichmentForPrompt(ctx);
		expect(text).toContain("网络参考资料");
		expect(text).toContain("花鸟画师");
		expect(text).toContain("工笔花鸟");
	});

	it("无结果时返回空字符串", () => {
		const ctx: EnrichedContext = {
			queryResults: [{ query: "x", results: [] }],
			collectedAt: "2026-06-12T00:00:00.000Z",
		};
		expect(formatEnrichmentForPrompt(ctx)).toBe("");
	});

	it("超长内容被截断至 2000 字符", () => {
		const longSnippet = "x".repeat(3000);
		const ctx: EnrichedContext = {
			queryResults: [
				{
					query: "q",
					results: [
						{ title: "t", snippet: longSnippet, url: "https://example.com" },
					],
				},
			],
			collectedAt: "",
		};
		const text = formatEnrichmentForPrompt(ctx);
		expect(text.length).toBeLessThanOrEqual(2020);
		expect(text).toContain("已截断");
	});
});
