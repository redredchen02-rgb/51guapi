import { describe, expect, it, vi } from "vitest";
import { TemplateSiteAdapter } from "./template-adapter.js";

vi.mock("../ssrf-guard.js", () => ({
	safeFetch: vi.fn(),
}));

import { safeFetch } from "../ssrf-guard.js";

const mockSafeFetch = vi.mocked(safeFetch);

function makeResponse(body: string, status = 200): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: new Headers(),
		text: async () => body,
	} as unknown as Response;
}

const adapter = new TemplateSiteAdapter();

describe("TemplateSiteAdapter.fetchContent", () => {
	it("name 为 'template-site'", () => {
		expect(adapter.name).toBe("template-site");
	});

	it("优先 og:title，提取 og:image 作为封面", async () => {
		mockSafeFetch.mockResolvedValueOnce(
			makeResponse(
				`<html><head>
					<meta property="og:title" content="OG 标题" />
					<meta property="og:image" content="https://cdn.example.com/c.jpg" />
					<title>页面标题</title>
				</head><body><article>正文段落</article></body></html>`,
			),
		);
		const result = await adapter.fetchContent("https://example.com/a");
		expect(result.title).toBe("OG 标题");
		expect(result.coverImageUrl).toBe("https://cdn.example.com/c.jpg");
		expect(result.body).toContain("正文段落");
		expect(result.url).toBe("https://example.com/a");
	});

	it("无 og:title → 回落 <title>", async () => {
		mockSafeFetch.mockResolvedValueOnce(
			makeResponse(
				"<html><head><title>仅页面标题</title></head><body><p>正文</p></body></html>",
			),
		);
		const result = await adapter.fetchContent("https://example.com/b");
		expect(result.title).toBe("仅页面标题");
		expect(result.coverImageUrl).toBeUndefined();
	});

	it("无 og:title 也无 <title> → Untitled", async () => {
		mockSafeFetch.mockResolvedValueOnce(
			makeResponse("<html><body><p>正文内容</p></body></html>"),
		);
		expect((await adapter.fetchContent("https://example.com/c")).title).toBe(
			"Untitled",
		);
	});

	it("正文剥除 <script>/<style>，只保留可见文本", async () => {
		mockSafeFetch.mockResolvedValueOnce(
			makeResponse(
				`<html><head><title>t</title></head><body>
					<script>var x = 1;</script>
					<style>.a{color:red}</style>
					<p>真正的正文</p>
				</body></html>`,
			),
		);
		const result = await adapter.fetchContent("https://example.com/d");
		expect(result.body).toContain("真正的正文");
		expect(result.body).not.toContain("var x");
		expect(result.body).not.toContain("color:red");
	});

	it("HTTP 非 2xx → 抛出含状态码的错误", async () => {
		mockSafeFetch.mockResolvedValueOnce(makeResponse("", 404));
		await expect(adapter.fetchContent("https://example.com/e")).rejects.toThrow(
			"HTTP 404",
		);
	});

	it("正文为空 → 抛出 Empty body", async () => {
		// 无任何文本节点（含 title），剥 script/style/标签后正文为空
		mockSafeFetch.mockResolvedValueOnce(
			makeResponse("<html><head></head><body></body></html>"),
		);
		await expect(adapter.fetchContent("https://example.com/f")).rejects.toThrow(
			/Empty body/,
		);
	});
});
