import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoAdapter } from "./demo-adapter.js";

// demo 现经共用 guardedFetchHtml 出站；保留真 SsrfError，仅替换 safeFetch。
vi.mock("../ssrf-guard.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../ssrf-guard.js")>()),
	safeFetch: vi.fn(),
}));

// 无渠道记录 → enforcePathPrefix 不施加 path 约束；listChannels 空 → allowlist 仅看 env。
vi.mock("../channel-store.js", () => ({
	getChannelByHostname: vi.fn(() => null),
	listChannels: vi.fn(() => []),
}));

import { safeFetch } from "../ssrf-guard.js";

const mockSafeFetch = vi.mocked(safeFetch);

function makeResponse(body: string, status = 200): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: new Headers(),
		text: async () => body,
		body: null,
	} as unknown as Response;
}

beforeEach(() => {
	mockSafeFetch.mockReset();
	delete process.env.ALLOWED_HOSTS;
});

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

	// 回归闸：demo 必须经 guardedFetchHtml 出站（传真 fail-closed allowlistCheck 给
	// safeFetch）。若被改回裸 safeFetch（无第三参），逐跳 allowlist 复检静默丢失，本断言转红。
	it("Security：经三件套出站 → 传真 allowlistCheck 闭包（deny-by-default）", async () => {
		mockSafeFetch.mockResolvedValueOnce(makeResponse("<p>正文</p>"));
		await demoAdapter.fetchContent("https://example.com/e");
		const opts = mockSafeFetch.mock.calls[0]?.[2] as
			| { allowlistCheck?: (u: URL) => boolean }
			| undefined;
		expect(opts?.allowlistCheck).toEqual(expect.any(Function));
		expect(
			opts?.allowlistCheck?.(new URL("https://not-allowed-zzz.example/")),
		).toBe(false);
	});
});
