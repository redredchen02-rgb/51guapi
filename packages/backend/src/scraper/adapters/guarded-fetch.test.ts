import { beforeEach, describe, expect, it, vi } from "vitest";
import { guardedFetchHtml } from "./guarded-fetch.js";

// 保留真 SsrfError（path-prefix 强制依赖它），仅替换 safeFetch。
vi.mock("../ssrf-guard.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../ssrf-guard.js")>()),
	safeFetch: vi.fn(),
}));

// 直接控制某 host 是否有渠道记录；listChannels 给空（allowlist 仅由 env 决定）。
vi.mock("../channel-store.js", () => ({
	getChannelByHostname: vi.fn(() => null),
	listChannels: vi.fn(() => []),
}));

import { getChannelByHostname } from "../channel-store.js";
import { safeFetch } from "../ssrf-guard.js";

const mockSafeFetch = vi.mocked(safeFetch);
const mockGetChannel = vi.mocked(getChannelByHostname);

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

function makeResponse(body: string, status = 200): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: new Headers(),
		text: async () => body,
		body: null,
	} as unknown as Response;
}

function makeStreamResponse(chunks: Uint8Array[]): Response {
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const c of chunks) controller.enqueue(c);
			controller.close();
		},
	});
	return {
		ok: true,
		status: 200,
		headers: new Headers(),
		body: stream,
		text: async () => "",
	} as unknown as Response;
}

beforeEach(() => {
	mockSafeFetch.mockReset();
	mockGetChannel.mockReset();
	mockGetChannel.mockReturnValue(null);
	delete process.env.ALLOWED_HOSTS;
});

describe("guardedFetchHtml — 三件套一次到位", () => {
	it("Happy：无渠道记录 + 2xx → 返回截断后 HTML", async () => {
		mockSafeFetch.mockResolvedValueOnce(makeResponse("<p>正文</p>"));
		const html = await guardedFetchHtml("https://example.com/a", {
			"User-Agent": "x",
		});
		expect(html).toContain("正文");
		expect(mockSafeFetch).toHaveBeenCalledOnce();
	});

	it("非 2xx → 抛出含状态码的 Error", async () => {
		mockSafeFetch.mockResolvedValueOnce(makeResponse("", 503));
		await expect(guardedFetchHtml("https://example.com/b", {})).rejects.toThrow(
			"HTTP 503",
		);
	});

	// —— allowlistCheck 接线（fail-closed 闭包必传给 safeFetch）——
	// env ALLOWED_HOSTS 未设 + listChannels 空 → 真闭包对任意 host 返回 false。
	// 若 guardedFetchHtml 漏传第三参或换成 ()=>true 桩，本断言转红。
	it("Security：把真 allowlistCheck 闭包（deny-by-default）传给 safeFetch", async () => {
		mockSafeFetch.mockResolvedValueOnce(makeResponse("<p>x</p>"));
		await guardedFetchHtml("https://example.com/c", {});
		const opts = mockSafeFetch.mock.calls[0]?.[2] as
			| { allowlistCheck?: (u: URL) => boolean }
			| undefined;
		expect(opts?.allowlistCheck).toEqual(expect.any(Function));
		expect(
			opts?.allowlistCheck?.(new URL("https://not-allowed-zzz.example/")),
		).toBe(false);
	});

	// —— enforcePathPrefix（渠道 path 越权抓取前即拒）——
	it("Security：有渠道记录 + path 越权 → 抛 SsrfError，且不发起 safeFetch", async () => {
		mockGetChannel.mockReturnValue(channel("/public/"));
		await expect(
			guardedFetchHtml("https://host.example/internal/secret", {}),
		).rejects.toThrow(/不在渠道.*允许的前缀/);
		expect(mockSafeFetch).not.toHaveBeenCalled();
	});

	// —— readBodyCapped（流式截断，不信 content-length）——
	it("Security：响应体超 maxBytes → 抛 too large", async () => {
		mockGetChannel.mockReturnValue(channel("/", 2 * 1024 * 1024)); // 2MB 上限
		const threeMb = new Uint8Array(3 * 1024 * 1024).fill(120);
		mockSafeFetch.mockResolvedValueOnce(makeStreamResponse([threeMb]));
		await expect(
			guardedFetchHtml("https://host.example/a", {}),
		).rejects.toThrow(/too large/);
	});
});
