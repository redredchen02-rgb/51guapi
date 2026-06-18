import { describe, expect, it, vi } from "vitest";
import {
	buildSearchTasks,
	executeSearchTask,
	fetchPixivByArtist,
	fetchPixivByWork,
	JINA_PREFIX,
	parseJinaContent,
} from "./web-search.js";

const PIXIV_PAGE = `Title: 花鸟画师
URL Source: https://pixiv.net/tags/%E8%8A%B1%E9%B8%9F%E7%94%BB%E5%B8%88

以工笔花鸟为主,擅长细腻笔法与传统意境。

* [关注作者](pixiv.net/en/users/123)
* [![thumbnail](pximg.net/img.jpg)](pixiv.net/en/artworks/456)
`;

function captureFetch(text: string, ok = true) {
	const seen: string[] = [];
	const fn = vi.fn(async (url: string) => {
		seen.push(url);
		return { ok, text: async () => text } as Response;
	}) as unknown as typeof fetch;
	return { fn, seen };
}

describe("parseJinaContent", () => {
	it("提取 Title 与摘要，跳过导航/图片行", () => {
		const out = parseJinaContent(PIXIV_PAGE, "https://pixiv.net/tags/x");
		expect(out).toHaveLength(1);
		expect(out[0].title).toBe("花鸟画师");
		expect(out[0].snippet).toContain("工笔");
		expect(out[0].url).toBe("https://pixiv.net/tags/x");
	});

	it("无 Title 无有效摘要时返回空数组", () => {
		expect(parseJinaContent("", "https://x")).toHaveLength(0);
	});
});

describe("Jina 出口安全：fixed-prefix 不被 query 污染", () => {
	it("fetchPixivByArtist 出口 URL startsWith(JINA_PREFIX)", async () => {
		const { fn, seen } = captureFetch(PIXIV_PAGE);
		await fetchPixivByArtist("作者/../etc/passwd", fn);
		expect(seen).toHaveLength(1);
		expect(seen[0].startsWith(JINA_PREFIX)).toBe(true);
	});

	it("fetchPixivByWork 出口 URL startsWith(JINA_PREFIX)", async () => {
		const { fn, seen } = captureFetch(PIXIV_PAGE);
		await fetchPixivByWork("作品 https://evil.example/x", fn);
		expect(seen).toHaveLength(1);
		expect(seen[0].startsWith(JINA_PREFIX)).toBe(true);
	});

	it("fetchPixivByArtist HTTP 失败时返回空数组", async () => {
		const { fn } = captureFetch("", false);
		expect(await fetchPixivByArtist("某作者", fn)).toHaveLength(0);
	});

	it("fetchPixivByWork 清洗后为空时不发请求", async () => {
		const { fn, seen } = captureFetch(PIXIV_PAGE);
		// 全为括号注释 + 波浪号，清洗后为空。
		const out = await fetchPixivByWork("（仅注释）~", fn);
		expect(out).toHaveLength(0);
		expect(seen).toHaveLength(0);
	});
});

describe("buildSearchTasks", () => {
	it("制作 + 作品名都有时生成 artist + work 两个任务", () => {
		const tasks = buildSearchTasks({ 制作: "画师(社团)", 作品名: "作品名" }, 3);
		expect(tasks).toEqual([
			{ type: "artist", query: "画师" },
			{ type: "work", query: "作品名" },
		]);
	});

	it("受 maxQueries 限制截断", () => {
		const tasks = buildSearchTasks({ 制作: "a", 作品名: "b" }, 1);
		expect(tasks).toHaveLength(1);
		expect(tasks[0].type).toBe("artist");
	});

	it("无有效字段时返回空", () => {
		expect(buildSearchTasks({}, 3)).toHaveLength(0);
	});
});

describe("executeSearchTask", () => {
	it("artist 任务委派 fetchPixivByArtist 并回填 query", async () => {
		const { fn } = captureFetch(PIXIV_PAGE);
		const out = await executeSearchTask(
			{ type: "artist", query: "花鸟画师" },
			fn,
			5000,
		);
		expect(out.query).toBe("花鸟画师");
		expect(out.results[0].title).toBe("花鸟画师");
	});
});
