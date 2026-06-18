import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	__clearForTest,
	type EnrichedContext,
	enrichContext,
	formatEnrichmentForPrompt,
} from "./web-enricher.js";

// 修补原本缺失的隔离：每用例清空内存缓存（不碰 table flag，见 __clearForTest 注释）。
beforeEach(() => {
	__clearForTest();
});

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

// ---- Characterization 测试（拆分前置 gate；显式净增，钉死缓存语义）----
describe("enrichContext 缓存语义（characterization）", () => {
	it("内存缓存命中：同 facts 连调两次，fetchFn 只调一次", async () => {
		const fetchFn = makeFetch([{ ok: true, text: PIXIV_PAGE }]);
		const facts = { 制作: "缓存画师" };

		const first = await enrichContext({ facts, fetchFn, maxQueries: 1 });
		const second = await enrichContext({ facts, fetchFn, maxQueries: 1 });

		// 第二次命中内存缓存，不再 fetch；返回同一份数据。
		expect(fetchFn).toHaveBeenCalledTimes(1);
		expect(second).toBe(first);
	});

	it("LRU 驱逐：超 MEMORY_CACHE_SIZE 后最旧条目被逐（再查会重新 fetch）", async () => {
		// 每次调用注入“一次性”fetch（命中缓存则不消耗）。
		const callFetch = () => makeFetch([{ ok: true, text: PIXIV_PAGE }]);
		const SIZE = 500; // 与 web-enricher.ts MEMORY_CACHE_SIZE 对齐

		// 填满到 SIZE 个不同 key（key0 最先写入 = 最旧）。
		for (let i = 0; i < SIZE; i++) {
			await enrichContext({
				facts: { 制作: `画师${i}` },
				fetchFn: callFetch(),
				maxQueries: 1,
			});
		}

		// 再塞一个新 key，触发 size>=SIZE 的 LRU 驱逐，逐掉最旧的 key0。
		await enrichContext({
			facts: { 制作: "画师新" },
			fetchFn: callFetch(),
			maxQueries: 1,
		});

		// 现在重新查 key0：若被逐，会重新 fetch（fetchFn 被调用）。
		const refetch = callFetch();
		await enrichContext({
			facts: { 制作: "画师0" },
			fetchFn: refetch,
			maxQueries: 1,
		});
		expect(refetch).toHaveBeenCalledTimes(1);

		// 反证：一个仍在缓存内的近期 key（画师新）再查不会 fetch。
		const cachedRefetch = callFetch();
		await enrichContext({
			facts: { 制作: "画师新" },
			fetchFn: cachedRefetch,
			maxQueries: 1,
		});
		expect(cachedRefetch).not.toHaveBeenCalled();
	});

	it("_enrichmentTableReady 幂等：多次经 enrichContext 触发建表不报错", async () => {
		// loadFromDbCache/saveToDbCache 内部调 initEnrichmentCacheTable；
		// 多次 enrichContext（不同 key、清缓存后）都应平稳走过 DB 路径不抛。
		const facts1 = { 制作: "建表测试A" };
		const facts2 = { 制作: "建表测试B" };
		await expect(
			enrichContext({
				facts: facts1,
				fetchFn: makeFetch([{ ok: true, text: PIXIV_PAGE }]),
				maxQueries: 1,
			}),
		).resolves.toBeDefined();
		__clearForTest();
		await expect(
			enrichContext({
				facts: facts2,
				fetchFn: makeFetch([{ ok: true, text: PIXIV_PAGE }]),
				maxQueries: 1,
			}),
		).resolves.toBeDefined();
	});
});

// ---- 安全 characterization：Jina 固定出口前缀不被 query 污染 ----
describe("Jina 出口安全（characterization）", () => {
	it("按作者搜索：fetch 的 URL startsWith(JINA_PREFIX)", async () => {
		const seen: string[] = [];
		const fetchFn = vi.fn(async (url: string) => {
			seen.push(url);
			return { ok: true, text: async () => PIXIV_PAGE } as Response;
		}) as unknown as typeof fetch;
		await enrichContext({
			facts: { 制作: "出口画师/../etc" },
			fetchFn,
			maxQueries: 1,
		});
		expect(seen).toHaveLength(1);
		expect(seen[0].startsWith("https://r.jina.ai/")).toBe(true);
	});

	it("按作品名搜索：fetch 的 URL startsWith(JINA_PREFIX)", async () => {
		const seen: string[] = [];
		const fetchFn = vi.fn(async (url: string) => {
			seen.push(url);
			return { ok: true, text: async () => PIXIV_PAGE } as Response;
		}) as unknown as typeof fetch;
		await enrichContext({
			facts: { 作品名: "作品 https://evil.example/x" },
			fetchFn,
			maxQueries: 1,
		});
		expect(seen).toHaveLength(1);
		expect(seen[0].startsWith("https://r.jina.ai/")).toBe(true);
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
