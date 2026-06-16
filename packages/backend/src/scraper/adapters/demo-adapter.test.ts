import { describe, expect, it, vi } from "vitest";
import { demoAdapter } from "./demo-adapter.js";

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

describe("demoAdapter.fetchContent", () => {
	it("name 为 'demo'", () => {
		expect(demoAdapter.name).toBe("demo");
	});

	it("提取 <title> 与剥标签后的正文", async () => {
		mockSafeFetch.mockResolvedValueOnce(
			makeResponse(
				"<html><head><title>  标题文本  </title></head><body><p>正文 <b>内容</b></p></body></html>",
			),
		);
		const result = await demoAdapter.fetchContent("https://example.com/a");
		expect(result.title).toBe("标题文本");
		expect(result.body).toContain("正文");
		expect(result.body).toContain("内容");
		expect(result.body).not.toContain("<");
		expect(result.url).toBe("https://example.com/a");
	});

	it("无 <title> → 回落 Untitled", async () => {
		mockSafeFetch.mockResolvedValueOnce(
			makeResponse("<html><body><p>只有正文</p></body></html>"),
		);
		const result = await demoAdapter.fetchContent("https://example.com/b");
		expect(result.title).toBe("Untitled");
	});

	it("HTTP 非 2xx → 抛出含状态码的错误", async () => {
		mockSafeFetch.mockResolvedValueOnce(makeResponse("", 503));
		await expect(
			demoAdapter.fetchContent("https://example.com/c"),
		).rejects.toThrow("HTTP 503");
	});

	it("正文为空（纯标签/空白）→ 抛出 Empty body", async () => {
		// 无任何文本节点（含 title），剥标签后正文为空
		mockSafeFetch.mockResolvedValueOnce(
			makeResponse("<html><head></head><body></body></html>"),
		);
		await expect(
			demoAdapter.fetchContent("https://example.com/d"),
		).rejects.toThrow(/Empty body/);
	});
});
