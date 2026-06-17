import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchContent, fetchList, fetchListPaged } from "./generic-adapter.js";

// Mock safeFetch（保留真 SsrfError，path-prefix 强制依赖它）
vi.mock("../ssrf-guard.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../ssrf-guard.js")>()),
	safeFetch: vi.fn(),
}));

// Mock 渠道存储：测试直接控制某 host 是否有渠道记录，不碰 DB。
vi.mock("../channel-store.js", () => ({
	getChannelByHostname: vi.fn(() => null),
}));

import { getChannelByHostname } from "../channel-store.js";
import { safeFetch } from "../ssrf-guard.js";

const mockSafeFetch = vi.mocked(safeFetch);
const mockGetChannel = vi.mocked(getChannelByHostname);

beforeEach(() => {
	mockSafeFetch.mockReset();
	mockGetChannel.mockReset();
	mockGetChannel.mockReturnValue(null); // 默认无渠道记录（env-only host）
});

type ChannelLike = ReturnType<typeof getChannelByHostname>;
function channel(pathPrefix: string, maxBytes = 5 * 1024 * 1024): ChannelLike {
	return {
		id: "c1",
		hostname: "host.example",
		displayName: "h",
		pathPrefix,
		maxDepth: 1,
		maxBytes,
		createdBy: "op",
		reason: "",
		createdAt: "2026-01-01T00:00:00Z",
	} as ChannelLike;
}

// 构造一个有真 ReadableStream body 的 Response，content-length 可缺失或谎报。
function makeStreamResponse(
	chunks: Uint8Array[],
	contentLength?: number,
): Response {
	const headers = new Headers();
	if (contentLength !== undefined)
		headers.set("content-length", String(contentLength));
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const c of chunks) controller.enqueue(c);
			controller.close();
		},
	});
	return {
		ok: true,
		status: 200,
		headers,
		body,
		text: async () => new TextDecoder().decode(concat(chunks)),
	} as unknown as Response;
}

function concat(chunks: Uint8Array[]): Uint8Array {
	const total = chunks.reduce((n, c) => n + c.byteLength, 0);
	const out = new Uint8Array(total);
	let off = 0;
	for (const c of chunks) {
		out.set(c, off);
		off += c.byteLength;
	}
	return out;
}

function makeResponse(
	body: string,
	status = 200,
	contentLength?: number,
): Response {
	const headers = new Headers();
	if (contentLength !== undefined)
		headers.set("content-length", String(contentLength));
	return {
		ok: status >= 200 && status < 300,
		status,
		headers,
		text: async () => body,
		body: null,
	} as unknown as Response;
}

const LIST_HTML = `
<html><body>
  <a href="/gossip/12345">明星出軌事件</a>
  <a href="/gossip/67890.html">藝人解約風波</a>
  <a href="/news/2024/08/breaking">日期型路徑</a>
  <a href="https://other.com/gossip/111">外站連結</a>
  <a href="/about">關於我們</a>
  <a href="/gossip/12345">重複連結</a>
</body></html>
`;

const ARTICLE_HTML = `
<html>
<head>
  <meta property="og:title" content="明星A出軌B事件始末" />
  <meta property="og:description" content="明星A被拍到與B私會，前任C發文暗諷" />
  <meta property="og:image" content="https://cdn.example.com/cover.jpg" />
  <meta property="article:published_time" content="2024-08-15" />
</head>
<body><h1>明星A出軌B事件始末</h1></body>
</html>
`;

describe("generic-adapter.fetchList", () => {
	it("正確過濾詳情頁 URL，帶 anchor text", async () => {
		mockSafeFetch.mockResolvedValueOnce(makeResponse(LIST_HTML));
		const results = await fetchList("https://example.com/latest");
		expect(results.map((r) => r.url)).toContain(
			"https://example.com/gossip/12345",
		);
		expect(results.map((r) => r.url)).toContain(
			"https://example.com/gossip/67890.html",
		);
		// 外站不應出現
		expect(results.map((r) => r.url)).not.toContain(
			"https://other.com/gossip/111",
		);
		// /about 不符 detail path
		expect(results.map((r) => r.url)).not.toContain(
			"https://example.com/about",
		);
		// 重複 URL 只出現一次
		expect(
			results.filter((r) => r.url === "https://example.com/gossip/12345"),
		).toHaveLength(1);
	});

	it("anchor text 作為 title 回傳", async () => {
		mockSafeFetch.mockResolvedValueOnce(makeResponse(LIST_HTML));
		const results = await fetchList("https://example.com/latest");
		const item = results.find(
			(r) => r.url === "https://example.com/gossip/12345",
		);
		expect(item?.title).toBe("明星出軌事件");
	});

	it("超過 20 條截斷為 20", async () => {
		const manyLinks = Array.from(
			{ length: 30 },
			(_, i) => `<a href="/gossip/${i + 1}">標題${i + 1}</a>`,
		).join("\n");
		const html = `<html><body>${manyLinks}</body></html>`;
		mockSafeFetch.mockResolvedValueOnce(makeResponse(html));
		const results = await fetchList("https://example.com/latest");
		expect(results.length).toBeLessThanOrEqual(20);
	});

	it("所有 <a href> 都是外站 → 返回空陣列", async () => {
		const html =
			'<html><body><a href="https://other.com/gossip/1">外站</a></body></html>';
		mockSafeFetch.mockResolvedValueOnce(makeResponse(html));
		const results = await fetchList("https://example.com/latest");
		expect(results).toHaveLength(0);
	});

	it("safeFetch 返回非 200 → 返回空陣列", async () => {
		mockSafeFetch.mockResolvedValueOnce(makeResponse("", 503));
		const results = await fetchList("https://example.com/latest");
		expect(results).toHaveLength(0);
	});

	it("safeFetch 拋出例外 → 返回空陣列", async () => {
		mockSafeFetch.mockRejectedValueOnce(new Error("Network error"));
		const results = await fetchList("https://example.com/latest");
		expect(results).toHaveLength(0);
	});

	it("响应体超過 5 MB（流式截断）→ 返回空陣列", async () => {
		const sixMb = new Uint8Array(6 * 1024 * 1024).fill(120);
		mockSafeFetch.mockResolvedValueOnce(makeStreamResponse([sixMb]));
		const results = await fetchList("https://example.com/latest");
		expect(results).toHaveLength(0);
	});
});

describe("generic-adapter.fetchContent", () => {
	it("從 og:* meta 正確提取標題、正文、封面圖", async () => {
		mockSafeFetch.mockResolvedValueOnce(makeResponse(ARTICLE_HTML));
		const result = await fetchContent("https://example.com/gossip/12345");
		expect(result.title).toBe("明星A出軌B事件始末");
		expect(result.body).toBe("明星A被拍到與B私會，前任C發文暗諷");
		expect(result.coverImageUrl).toBe("https://cdn.example.com/cover.jpg");
		expect(result.metadata?.publishedTime).toBe("2024-08-15");
	});

	it("HTTP 4xx 時拋出含狀態碼的 Error", async () => {
		mockSafeFetch.mockResolvedValueOnce(makeResponse("", 404));
		await expect(
			fetchContent("https://example.com/gossip/99999"),
		).rejects.toThrow("HTTP 404");
	});

	it("響應體超過 5 MB（流式截断）→ 拋出 too large 錯誤", async () => {
		const sixMb = new Uint8Array(6 * 1024 * 1024).fill(120);
		mockSafeFetch.mockResolvedValueOnce(makeStreamResponse([sixMb]));
		await expect(
			fetchContent("https://example.com/gossip/12345"),
		).rejects.toThrow("too large");
	});

	it("og:* meta 缺失時 fallback 用 <title> 和 <h1>，body 可能為空", async () => {
		const html = `<html><head><title>純文字標題</title></head><body><h1>純文字標題</h1></body></html>`;
		mockSafeFetch.mockResolvedValueOnce(makeResponse(html));
		const result = await fetchContent("https://example.com/gossip/plain");
		expect(result.title).toBe("純文字標題");
		expect(result.coverImageUrl).toBeUndefined();
		// og:description 缺失時 body 為空字串，這是預期行為
		expect(typeof result.body).toBe("string");
	});
});

describe("U6 P0：渠道 path_prefix 强制", () => {
	it("有渠道记录 + path 不在 pathPrefix 内 → fetchContent 抛 SsrfError，不发起抓取", async () => {
		mockGetChannel.mockReturnValue(channel("/public/"));
		await expect(
			fetchContent("https://host.example/internal/secret"),
		).rejects.toThrow(/不在渠道.*允许的前缀/);
		expect(mockSafeFetch).not.toHaveBeenCalled();
	});

	it("有渠道记录 + path 在 pathPrefix 内 → 放行并抓取", async () => {
		mockGetChannel.mockReturnValue(channel("/public/"));
		mockSafeFetch.mockResolvedValueOnce(makeResponse(ARTICLE_HTML));
		const result = await fetchContent("https://host.example/public/x");
		expect(result.title).toBe("明星A出軌B事件始末");
		expect(mockSafeFetch).toHaveBeenCalledOnce();
	});

	it("有渠道记录 + path 越权 → fetchList 返回空且不抓取", async () => {
		mockGetChannel.mockReturnValue(channel("/public/"));
		const results = await fetchList("https://host.example/internal/list");
		expect(results).toHaveLength(0);
		expect(mockSafeFetch).not.toHaveBeenCalled();
	});

	it("无渠道记录（env allowlist host）→ 任意 path 维持现状放行（不回归）", async () => {
		mockGetChannel.mockReturnValue(null);
		mockSafeFetch.mockResolvedValueOnce(makeResponse(ARTICLE_HTML));
		const result = await fetchContent("https://env-only.example/any/deep/path");
		expect(result.title).toBe("明星A出軌B事件始末");
		expect(mockSafeFetch).toHaveBeenCalledOnce();
	});
});

describe("U6 P0：流式 max_bytes 截断（不信 content-length）", () => {
	const big = new Uint8Array(3 * 1024 * 1024).fill(120); // 3MB 'x'

	it("content-length 缺失但实际体超过 max_bytes → fetchContent 中止报错", async () => {
		mockGetChannel.mockReturnValue(channel("/", 2 * 1024 * 1024)); // 2MB 上限
		mockSafeFetch.mockResolvedValueOnce(makeStreamResponse([big])); // 无 content-length
		await expect(fetchContent("https://host.example/a")).rejects.toThrow(
			/too large/,
		);
	});

	it("content-length 谎报（远小于实际）→ 仍被流式截断", async () => {
		mockGetChannel.mockReturnValue(channel("/", 2 * 1024 * 1024));
		// 谎报 content-length=10，实际 3MB > 2MB 上限
		mockSafeFetch.mockResolvedValueOnce(makeStreamResponse([big], 10));
		await expect(fetchContent("https://host.example/a")).rejects.toThrow(
			/too large/,
		);
	});

	it("体积在 max_bytes 内 → 正常读取", async () => {
		mockGetChannel.mockReturnValue(channel("/", 5 * 1024 * 1024));
		const bytes = new TextEncoder().encode(ARTICLE_HTML);
		mockSafeFetch.mockResolvedValueOnce(makeStreamResponse([bytes]));
		const result = await fetchContent("https://host.example/a");
		expect(result.title).toBe("明星A出軌B事件始末");
	});

	it("无渠道记录时用默认 5MB 上限，超过即中止", async () => {
		mockGetChannel.mockReturnValue(null);
		const sixMb = new Uint8Array(6 * 1024 * 1024).fill(120);
		mockSafeFetch.mockResolvedValueOnce(makeStreamResponse([sixMb]));
		await expect(fetchContent("https://env-only.example/a")).rejects.toThrow(
			/too large/,
		);
	});
});

// 構造一個帶 rel="next" link 的列表頁。
function listHtmlWithNext(detailIds: number[], nextHref?: string): string {
	const links = detailIds
		.map((id) => `<a href="/gossip/${id}">標題${id}</a>`)
		.join("\n");
	const next = nextHref ? `<link rel="next" href="${nextHref}" />` : "";
	return `<html><head>${next}</head><body>${links}</body></html>`;
}

describe("generic-adapter.fetchListPaged（U1 翻頁能力）", () => {
	it("Happy：兩頁列表，page1 rel=next 指向同 host page2 → 合併去重後回兩頁詳情 URL", async () => {
		mockSafeFetch
			.mockResolvedValueOnce(
				makeResponse(
					listHtmlWithNext([1, 2], "https://example.com/latest?page=2"),
				),
			)
			.mockResolvedValueOnce(makeResponse(listHtmlWithNext([2, 3])));
		const results = await fetchListPaged("https://example.com/latest", 2);
		const urls = results.map((r) => r.url);
		expect(urls).toContain("https://example.com/gossip/1");
		expect(urls).toContain("https://example.com/gossip/2");
		expect(urls).toContain("https://example.com/gossip/3");
		// gossip/2 跨頁重複只出現一次
		expect(urls.filter((u) => u.endsWith("/gossip/2"))).toHaveLength(1);
		expect(mockSafeFetch).toHaveBeenCalledTimes(2);
	});

	it("Edge：maxPages=1 只抓首頁，即使有 next 也不跟隨", async () => {
		mockSafeFetch.mockResolvedValueOnce(
			makeResponse(
				listHtmlWithNext([1, 2], "https://example.com/latest?page=2"),
			),
		);
		const results = await fetchListPaged("https://example.com/latest", 1);
		expect(results.map((r) => r.url)).toEqual([
			"https://example.com/gossip/1",
			"https://example.com/gossip/2",
		]);
		expect(mockSafeFetch).toHaveBeenCalledOnce();
	});

	it("Edge：無 next 標記時，即使 maxPages>1 也只抓一頁", async () => {
		mockSafeFetch.mockResolvedValueOnce(makeResponse(listHtmlWithNext([1, 2])));
		const results = await fetchListPaged("https://example.com/latest", 5);
		expect(results).toHaveLength(2);
		expect(mockSafeFetch).toHaveBeenCalledOnce();
	});

	it("Edge：next 指回已訪問頁 → visited 阻止迴圈", async () => {
		// page1 的 next 指向 page1 自身（已訪問）
		mockSafeFetch
			.mockResolvedValueOnce(
				makeResponse(listHtmlWithNext([1], "https://example.com/latest")),
			)
			.mockResolvedValueOnce(
				makeResponse(listHtmlWithNext([2], "https://example.com/latest")),
			);
		const results = await fetchListPaged("https://example.com/latest", 5);
		// 起始 URL = next URL → 第二輪即被 visited 攔下，只抓一頁
		expect(results).toHaveLength(1);
		expect(mockSafeFetch).toHaveBeenCalledOnce();
	});

	it("Security：next 指向不同 host → 不跟隨（不發第二次請求）", async () => {
		mockSafeFetch.mockResolvedValueOnce(
			makeResponse(listHtmlWithNext([1], "https://evil.com/latest?page=2")),
		);
		const results = await fetchListPaged("https://example.com/latest", 5);
		expect(results).toHaveLength(1);
		expect(mockSafeFetch).toHaveBeenCalledOnce();
	});

	it("Security：next 路徑不符 channel pathPrefix → enforcePathPrefix 拒該頁，保留已抓", async () => {
		mockGetChannel.mockReturnValue(channel("/public/"));
		// page1 在 prefix 內，next 指向 prefix 外
		mockSafeFetch.mockResolvedValueOnce(
			makeResponse(
				`<html><head><link rel="next" href="https://host.example/internal/list" /></head><body><a href="/public/12345">x</a></body></html>`,
			),
		);
		const results = await fetchListPaged("https://host.example/public/list", 5);
		// 第二頁越權 → fetchListPage 回空頁、無 next → 整體停止，僅保留 page1
		expect(results.map((r) => r.url)).toEqual([
			"https://host.example/public/12345",
		]);
		// page1 抓取 + page2 enforcePathPrefix 在 fetch 前攔下（不 safeFetch）
		expect(mockSafeFetch).toHaveBeenCalledOnce();
	});

	it("Edge：累積詳情 URL 超上限（200）時截斷", async () => {
		// 每頁 20 條 + 永遠有同 host next → 靠 MAX_PAGED_URLS 截斷
		let page = 1;
		mockSafeFetch.mockImplementation(async () => {
			const base = (page - 1) * 20;
			const ids = Array.from({ length: 20 }, (_, i) => base + i + 1);
			const next = `https://example.com/latest?page=${page + 1}`;
			page += 1;
			return makeResponse(listHtmlWithNext(ids, next));
		});
		const results = await fetchListPaged("https://example.com/latest", 1000);
		expect(results.length).toBe(200);
	});

	it("?page=N pattern：無 rel=next 時用 <a href ?page=> 偵測下一頁", async () => {
		mockSafeFetch
			.mockResolvedValueOnce(
				makeResponse(
					`<html><body><a href="/gossip/1">x</a><a href="https://example.com/latest?page=2">下一頁</a></body></html>`,
				),
			)
			.mockResolvedValueOnce(
				makeResponse(`<html><body><a href="/gossip/2">y</a></body></html>`),
			);
		const results = await fetchListPaged(
			"https://example.com/latest?page=1",
			3,
		);
		expect(results.map((r) => r.url)).toEqual([
			"https://example.com/gossip/1",
			"https://example.com/gossip/2",
		]);
		expect(mockSafeFetch).toHaveBeenCalledTimes(2);
	});

	it("Security：maxPages 極大 + 詳情 URL 稀疏 + 每頁都有 next → 請求次數封頂 MAX_PAGES(50)", async () => {
		// 每頁僅 1 條詳情 URL（稀疏，MAX_PAGED_URLS=200 封不住），且永遠有同 host next。
		// 唯一硬閘是 MAX_PAGES：底層 list-fetch 實際調用次數必須 ≤ 50。
		let page = 1;
		mockSafeFetch.mockImplementation(async () => {
			const id = page;
			const next = `https://example.com/latest?page=${page + 1}`;
			page += 1;
			return makeResponse(listHtmlWithNext([id], next));
		});
		const results = await fetchListPaged("https://example.com/latest", 10000);
		// 請求次數封頂（不是只看累積 URL ≤ 200）
		expect(mockSafeFetch).toHaveBeenCalledTimes(50);
		expect(results).toHaveLength(50);
	});

	it("Security：next 為 javascript:/file:/data: → resolveSameHost 協議白名單拒，不跟隨", async () => {
		for (const evil of [
			"javascript:alert(1)",
			"file:///etc/passwd",
			"data:text/html,<a href=/gossip/9>x</a>",
		]) {
			mockSafeFetch.mockReset();
			mockSafeFetch.mockResolvedValueOnce(
				makeResponse(
					`<html><head><link rel="next" href="${evil}" /></head><body><a href="/gossip/1">x</a></body></html>`,
				),
			);
			const results = await fetchListPaged("https://example.com/latest", 5);
			// 協議白名單在 resolveSameHost 即拒 → 無下一頁 → 只發一次請求
			expect(mockSafeFetch).toHaveBeenCalledOnce();
			expect(results.map((r) => r.url)).toEqual([
				"https://example.com/gossip/1",
			]);
		}
	});
});
