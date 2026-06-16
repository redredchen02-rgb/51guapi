import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { apiFetch } from "./api-fetch";
import { getToken, isAuthenticated, setToken } from "./auth-client";

interface Captured {
	url: string;
	headers: Record<string, string>;
}

function mockFetch(status = 200): {
	captured: Captured[];
	fn: typeof fetch;
} {
	const captured: Captured[] = [];
	const fn = async (url: string | URL | Request, init?: RequestInit) => {
		captured.push({
			url: String(url),
			headers: (init?.headers ?? {}) as Record<string, string>,
		});
		return new Response("{}", { status });
	};
	return { captured, fn: fn as unknown as typeof fetch };
}

describe("apiFetch", () => {
	beforeEach(() => {
		fakeBrowser.reset();
	});

	it("以 / 开头的 path → 前缀 backendUrl(默认 127.0.0.1:3001)", async () => {
		const { captured, fn } = mockFetch();
		await apiFetch("/api/v1/ping", { fetchFn: fn });
		expect(captured[0]?.url).toBe("http://127.0.0.1:3001/api/v1/ping");
	});

	it("注入 Content-Type;有 token 时注入 Authorization", async () => {
		await setToken("tok-123");
		const { captured, fn } = mockFetch();
		await apiFetch("/x", { fetchFn: fn });
		expect(captured[0]?.headers["Content-Type"]).toBe("application/json");
		expect(captured[0]?.headers.Authorization).toBe("Bearer tok-123");
	});

	it("无 token 时不注入 Authorization", async () => {
		const { captured, fn } = mockFetch();
		await apiFetch("/x", { fetchFn: fn });
		expect(captured[0]?.headers.Authorization).toBeUndefined();
	});

	it("额外 headers 与鉴权头合并", async () => {
		const { captured, fn } = mockFetch();
		await apiFetch("/x", { fetchFn: fn, headers: { "X-Trace": "abc" } });
		expect(captured[0]?.headers["X-Trace"]).toBe("abc");
		expect(captured[0]?.headers["Content-Type"]).toBe("application/json");
	});

	it("401 → 清除本地 token(fail-closed 副作用)并返回原始 Response", async () => {
		await setToken("tok-to-clear");
		expect(await isAuthenticated()).toBe(true);
		const { fn } = mockFetch(401);
		const res = await apiFetch("/x", { fetchFn: fn });
		expect(res.status).toBe(401);
		expect(await getToken()).toBeNull();
	});

	it("非 401 → 保留 token,交回 Response 由调用方处理", async () => {
		await setToken("keep");
		const { fn } = mockFetch(500);
		const res = await apiFetch("/x", { fetchFn: fn });
		expect(res.status).toBe(500);
		expect(await getToken()).toBe("keep");
	});

	it("网络错误向上抛出(不吞),让调用方决定本地 fallback", async () => {
		const fn = (async () => {
			throw new Error("network down");
		}) as unknown as typeof fetch;
		await expect(apiFetch("/x", { fetchFn: fn })).rejects.toThrow(
			"network down",
		);
	});

	it("完整 URL(http 开头)不前缀 backendUrl", async () => {
		const { captured, fn } = mockFetch();
		await apiFetch("https://other.example/y", { fetchFn: fn });
		expect(captured[0]?.url).toBe("https://other.example/y");
	});
});
