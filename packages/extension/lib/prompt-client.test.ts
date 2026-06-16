import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { authHeader, mockFetch } from "./__test-utils__/mock-fetch";
import { getToken, setToken } from "./auth-client";
import { createPrompt, fetchPrompts, updatePrompt } from "./prompt-client";

// 生产默认路径:不注入 fetchFn 时,客户端应回落到 shared 的 fetchWithTimeout。
// vi.mock 会被提升到模块顶部,故此处 mock 仅影响本文件全部导入。
vi.mock("@51guapi/shared", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@51guapi/shared")>();
	return {
		...actual,
		fetchWithTimeout: vi.fn(
			async () => new Response(JSON.stringify({ ok: true, prompts: [] })),
		),
	};
});

import { fetchWithTimeout } from "@51guapi/shared";

describe("prompt-client — fetchPrompts", () => {
	beforeEach(async () => {
		fakeBrowser.reset();
		await setToken("tok-abc");
	});

	it("Happy: 2xx → 解析 prompts，URL + Bearer 正确", async () => {
		const prompts = [
			{
				id: "p1",
				name: "n",
				template: "t",
				fewShotPairs: [],
				createdAt: "x",
				updatedAt: "y",
			},
		];
		const { capturedUrls, capturedInits, fn } = mockFetch({
			ok: true,
			prompts,
		});
		const result = await fetchPrompts(fn);
		expect(result.ok).toBe(true);
		expect(result.prompts).toHaveLength(1);
		expect(capturedUrls[0]).toContain("/api/v1/prompts");
		expect(authHeader(capturedInits[0])).toBe("Bearer tok-abc");
	});

	it("Error 401 → clearToken()，ok:false 带 HTTP 401", async () => {
		const { fn } = mockFetch({}, 401);
		const result = await fetchPrompts(fn);
		expect(result.ok).toBe(false);
		expect(result.error).toContain("401");
		expect(await getToken()).toBeNull();
	});

	it("Error 500 → ok:false 带 HTTP 500，不静默", async () => {
		const { fn } = mockFetch({}, 500);
		const result = await fetchPrompts(fn);
		expect(result.ok).toBe(false);
		expect(result.error).toContain("500");
	});

	it("Error 网络异常 → ok:false 带错误消息", async () => {
		const fn = (async () => {
			throw new Error("boom");
		}) as unknown as typeof fetch;
		const result = await fetchPrompts(fn);
		expect(result.ok).toBe(false);
		expect(result.error).toContain("boom");
	});

	it("Integration: 注入的 fetchFn 确实被调用（验证死参已接通）", async () => {
		const fn = vi.fn(
			async () => new Response(JSON.stringify({ ok: true, prompts: [] })),
		);
		await fetchPrompts(fn as unknown as typeof fetch);
		expect(fn).toHaveBeenCalledOnce();
	});
});

describe("prompt-client — createPrompt", () => {
	beforeEach(async () => {
		fakeBrowser.reset();
		await setToken("tok-abc");
	});

	it("Happy: 2xx → POST 命中 /prompts，携带 body", async () => {
		const { capturedUrls, capturedInits, fn } = mockFetch({ ok: true });
		const result = await createPrompt(
			{ name: "n", template: "t", fewShotPairs: [] },
			10_000,
			fn,
		);
		expect(result.ok).toBe(true);
		expect(capturedUrls[0]).toContain("/api/v1/prompts");
		expect(capturedInits[0]?.method).toBe("POST");
		expect(String(capturedInits[0]?.body)).toContain('"name":"n"');
	});

	it("Error 401 → clearToken()，ok:false", async () => {
		const { fn } = mockFetch({}, 401);
		const result = await createPrompt(
			{ name: "n", template: "t", fewShotPairs: [] },
			10_000,
			fn,
		);
		expect(result.ok).toBe(false);
		expect(await getToken()).toBeNull();
	});
});

describe("prompt-client — updatePrompt", () => {
	beforeEach(async () => {
		fakeBrowser.reset();
		await setToken("tok-abc");
	});

	it("Happy: 2xx → PUT 命中 /prompts/:id", async () => {
		const { capturedUrls, capturedInits, fn } = mockFetch({ ok: true });
		const result = await updatePrompt(
			"p1",
			{ name: "n", template: "t", fewShotPairs: [] },
			10_000,
			fn,
		);
		expect(result.ok).toBe(true);
		expect(capturedUrls[0]).toContain("/api/v1/prompts/p1");
		expect(capturedInits[0]?.method).toBe("PUT");
	});

	it("Error 500 → ok:false 带 HTTP 500", async () => {
		const { fn } = mockFetch({}, 500);
		const result = await updatePrompt(
			"p1",
			{ name: "n", template: "t", fewShotPairs: [] },
			10_000,
			fn,
		);
		expect(result.ok).toBe(false);
		expect(result.error).toContain("500");
	});
});

describe("prompt-client — 生产默认路径 (省略 fetchFn → fetchWithTimeout)", () => {
	beforeEach(async () => {
		fakeBrowser.reset();
		await setToken("tok-abc");
		vi.mocked(fetchWithTimeout).mockClear();
	});

	it("fetchPrompts 省略 fetchFn → fetchWithTimeout 被调用,timeoutMs=10_000", async () => {
		await fetchPrompts();
		expect(fetchWithTimeout).toHaveBeenCalledOnce();
		const call = vi.mocked(fetchWithTimeout).mock.calls[0];
		if (!call) throw new Error("fetchWithTimeout 未被调用");
		const [url, opts] = call as [
			string | URL | Request,
			{ timeoutMs?: number }?,
		];
		expect(String(url)).toContain("/api/v1/prompts");
		expect(opts?.timeoutMs).toBe(10_000);
	});
});
