import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { authHeader, mockFetch } from "./__test-utils__/mock-fetch";
import { getToken, setToken } from "./auth-client";
import {
	createGossipSite,
	deleteGossipSite,
	discoverGossipSite,
	fetchGossipSites,
	fetchGossipTopicFromUrl,
} from "./gossip-client";

// 生产默认路径:不注入 fetchFn 时,客户端应回落到 shared 的 fetchWithTimeout。
// vi.mock 提升到模块顶部,仅影响本文件全部导入。
vi.mock("@51guapi/shared", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@51guapi/shared")>();
	return {
		...actual,
		fetchWithTimeout: vi.fn(
			async () => new Response(JSON.stringify({ ok: true, sites: [] })),
		),
	};
});

import { fetchWithTimeout } from "@51guapi/shared";

const SITE = {
	id: "s1",
	name: "site",
	listUrl: "https://x.test/list",
	enabled: true,
	createdAt: "a",
	updatedAt: "b",
};

describe("gossip-client — fetchGossipSites", () => {
	beforeEach(async () => {
		fakeBrowser.reset();
		await setToken("tok-g");
	});

	it("Happy: 2xx → 返回 sites，URL + Bearer 正确", async () => {
		const { capturedUrls, capturedInits, fn } = mockFetch({
			ok: true,
			sites: [SITE],
		});
		const result = await fetchGossipSites(fn);
		expect(result).toHaveLength(1);
		expect(result[0]?.id).toBe("s1");
		expect(capturedUrls[0]).toContain("/api/v1/gossip/sites");
		expect(authHeader(capturedInits[0])).toBe("Bearer tok-g");
	});

	it("Edge: ok:true 无 sites → 空数组", async () => {
		const { fn } = mockFetch({ ok: true });
		expect(await fetchGossipSites(fn)).toEqual([]);
	});

	it("Error 401 → clearToken() 且抛 Unauthorized", async () => {
		const { fn } = mockFetch({}, 401);
		await expect(fetchGossipSites(fn)).rejects.toThrow("Unauthorized");
		expect(await getToken()).toBeNull();
	});

	it("Error 500 → 抛出后端 error 消息（不静默吞）", async () => {
		const { fn } = mockFetch({ error: "boom" }, 500);
		await expect(fetchGossipSites(fn)).rejects.toThrow("boom");
	});

	it("Integration: 注入的 fetchFn 确实被调用", async () => {
		const fn = vi.fn(
			async () => new Response(JSON.stringify({ ok: true, sites: [] })),
		);
		await fetchGossipSites(fn as unknown as typeof fetch);
		expect(fn).toHaveBeenCalledOnce();
	});
});

describe("gossip-client — createGossipSite", () => {
	beforeEach(async () => {
		fakeBrowser.reset();
		await setToken("tok-g");
	});

	it("Happy: 2xx → 返回 site，POST 命中 URL", async () => {
		const { capturedUrls, capturedInits, fn } = mockFetch({
			ok: true,
			site: SITE,
		});
		const result = await createGossipSite("site", "https://x.test/list", fn);
		expect(result?.id).toBe("s1");
		expect(capturedUrls[0]).toContain("/api/v1/gossip/sites");
		expect(capturedInits[0]?.method).toBe("POST");
	});

	it("Error 401 → clearToken()，返回 null", async () => {
		const { fn } = mockFetch({}, 401);
		const result = await createGossipSite("n", "u", fn);
		expect(result).toBeNull();
		expect(await getToken()).toBeNull();
	});

	it("Error 500 → 抛出错误", async () => {
		const { fn } = mockFetch({ error: "bad" }, 500);
		await expect(createGossipSite("n", "u", fn)).rejects.toThrow("bad");
	});
});

describe("gossip-client — deleteGossipSite", () => {
	beforeEach(async () => {
		fakeBrowser.reset();
		await setToken("tok-g");
	});

	it("Happy: 2xx → DELETE 命中 URL，无抛", async () => {
		const { capturedUrls, capturedInits, fn } = mockFetch({ ok: true });
		await expect(deleteGossipSite("s1", fn)).resolves.toBeUndefined();
		expect(capturedUrls[0]).toContain("/api/v1/gossip/sites/s1");
		expect(capturedInits[0]?.method).toBe("DELETE");
	});

	it("Error 401 → clearToken() 且抛 Unauthorized", async () => {
		const { fn } = mockFetch({}, 401);
		await expect(deleteGossipSite("s1", fn)).rejects.toThrow("Unauthorized");
		expect(await getToken()).toBeNull();
	});
});

describe("gossip-client — discoverGossipSite", () => {
	beforeEach(async () => {
		fakeBrowser.reset();
		await setToken("tok-g");
	});

	it("Happy: 2xx → 返回 discovered 数组", async () => {
		const { capturedUrls, fn } = mockFetch({
			ok: true,
			discovered: [{ url: "https://x.test/1" }],
		});
		const result = await discoverGossipSite("s1", fn);
		expect(result).toHaveLength(1);
		expect(capturedUrls[0]).toContain("/api/v1/gossip/sites/s1/discover");
	});

	it("Error 401 → clearToken()，返回空数组", async () => {
		const { fn } = mockFetch({}, 401);
		expect(await discoverGossipSite("s1", fn)).toEqual([]);
		expect(await getToken()).toBeNull();
	});

	it("Error 500 → 抛出错误", async () => {
		const { fn } = mockFetch({ error: "x" }, 500);
		await expect(discoverGossipSite("s1", fn)).rejects.toThrow("x");
	});
});

describe("gossip-client — fetchGossipTopicFromUrl", () => {
	beforeEach(async () => {
		fakeBrowser.reset();
		await setToken("tok-g");
	});

	it("Happy: 2xx → 返回 topic", async () => {
		const { capturedUrls, fn } = mockFetch({
			ok: true,
			topic: { id: "t1", title: "T" },
		});
		const result = await fetchGossipTopicFromUrl(
			"https://x.test/1",
			"site",
			fn,
		);
		expect(result.id).toBe("t1");
		expect(capturedUrls[0]).toContain("/api/v1/gossip/topics/from-url");
	});

	it("Error 401 → clearToken() 且抛 Unauthorized", async () => {
		const { fn } = mockFetch({}, 401);
		await expect(
			fetchGossipTopicFromUrl("https://x.test/1", "site", fn),
		).rejects.toThrow("Unauthorized");
		expect(await getToken()).toBeNull();
	});

	it("Error 409 → 抛 DUPLICATE_URL", async () => {
		const { fn } = mockFetch({}, 409);
		await expect(
			fetchGossipTopicFromUrl("https://x.test/1", "site", fn),
		).rejects.toThrow("DUPLICATE_URL");
	});

	it("Edge: ok:true 无 topic → 抛 Empty response", async () => {
		const { fn } = mockFetch({ ok: true });
		await expect(
			fetchGossipTopicFromUrl("https://x.test/1", "site", fn),
		).rejects.toThrow("Empty response");
	});
});

describe("gossip-client — 生产默认路径 (省略 fetchFn → fetchWithTimeout)", () => {
	const mocked = vi.mocked(fetchWithTimeout);

	beforeEach(async () => {
		fakeBrowser.reset();
		await setToken("tok-g");
		mocked.mockClear();
	});

	function jsonResponse(body: unknown): Response {
		return new Response(JSON.stringify(body));
	}

	function lastCall(): [string | URL | Request, { timeoutMs?: number }?] {
		const call = mocked.mock.calls[0];
		if (!call) throw new Error("fetchWithTimeout 未被调用");
		return call as [string | URL | Request, { timeoutMs?: number }?];
	}

	it("省略 fetchFn → 各函数命中 fetchWithTimeout,timeoutMs 分档正确 (10s/30s/60s)", async () => {
		// 默认 10_000 档:fetchGossipSites
		mocked.mockResolvedValueOnce(jsonResponse({ ok: true, sites: [] }));
		await fetchGossipSites();
		expect(mocked).toHaveBeenCalledOnce();
		{
			const [url, opts] = lastCall();
			expect(String(url)).toContain("/api/v1/gossip/sites");
			expect(opts?.timeoutMs).toBe(10_000);
		}

		// discoverGossipSite → 30_000
		mocked.mockClear();
		mocked.mockResolvedValueOnce(jsonResponse({ ok: true, discovered: [] }));
		await discoverGossipSite("s1");
		expect(mocked).toHaveBeenCalledOnce();
		{
			const [url, opts] = lastCall();
			expect(String(url)).toContain("/api/v1/gossip/sites/s1/discover");
			expect(opts?.timeoutMs).toBe(30_000);
		}

		// fetchGossipTopicFromUrl → 60_000
		mocked.mockClear();
		mocked.mockResolvedValueOnce(
			jsonResponse({ ok: true, topic: { id: "t1", title: "T" } }),
		);
		await fetchGossipTopicFromUrl("https://x.test/1", "site");
		expect(mocked).toHaveBeenCalledOnce();
		{
			const [url, opts] = lastCall();
			expect(String(url)).toContain("/api/v1/gossip/topics/from-url");
			expect(opts?.timeoutMs).toBe(60_000);
		}
	});
});
