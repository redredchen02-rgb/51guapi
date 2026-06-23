import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { apiFetch } from "./api-fetch";

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

	it("以 / 开头的 path → 前缀 backendUrl(默认 127.0.0.1:3002)", async () => {
		const { captured, fn } = mockFetch();
		await apiFetch("/api/v1/ping", { fetchFn: fn });
		expect(captured[0]?.url).toBe("http://127.0.0.1:3002/api/v1/ping");
	});

	it("注入默认 Content-Type,无 Authorization 头", async () => {
		const { captured, fn } = mockFetch();
		await apiFetch("/x", { fetchFn: fn });
		expect(captured[0]?.headers["Content-Type"]).toBe("application/json");
		expect(captured[0]?.headers.Authorization).toBeUndefined();
	});

	it("额外 headers 与默认头合并", async () => {
		const { captured, fn } = mockFetch();
		await apiFetch("/x", { fetchFn: fn, headers: { "X-Trace": "abc" } });
		expect(captured[0]?.headers["X-Trace"]).toBe("abc");
		expect(captured[0]?.headers["Content-Type"]).toBe("application/json");
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
