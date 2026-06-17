import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { authHeader, mockFetch } from "./__test-utils__/mock-fetch";
import { getToken, setToken } from "./auth-client";
import {
	createRemoteBatch,
	fetchBatchState,
	syncBatchItemStatus,
} from "./config-client";

describe("config-client — syncBatchItemStatus", () => {
	beforeEach(async () => {
		fakeBrowser.reset();
		await setToken("tok-123");
	});

	it("Happy: 2xx → ok:true，PATCH 命中 batch item URL + Bearer", async () => {
		const { capturedUrls, capturedInits, fn } = mockFetch({ ok: true });
		const result = await syncBatchItemStatus(
			"b1",
			"i1",
			{ status: "done" },
			fn,
		);
		expect(result.ok).toBe(true);
		expect(capturedUrls[0]).toContain("/api/v1/batches/b1/items/i1");
		expect(capturedInits[0]?.method).toBe("PATCH");
		expect(authHeader(capturedInits[0])).toBe("Bearer tok-123");
	});

	it("Error 401 → clearToken()，ok:false", async () => {
		const { fn } = mockFetch({}, 401);
		const result = await syncBatchItemStatus("b1", "i1", {}, fn);
		expect(result.ok).toBe(false);
		expect(await getToken()).toBeNull();
	});

	it("Error 500 → ok:false 带 HTTP 状态，不静默", async () => {
		const { fn } = mockFetch({}, 500);
		const result = await syncBatchItemStatus("b1", "i1", {}, fn);
		expect(result.ok).toBe(false);
		expect(result.error).toContain("500");
	});
});

describe("config-client — fetchBatchState", () => {
	beforeEach(async () => {
		fakeBrowser.reset();
		await setToken("tok-123");
	});

	it("Happy: 2xx → ok:true 含 batch", async () => {
		const { capturedUrls, fn } = mockFetch({ batch: { id: "b1" } });
		const result = await fetchBatchState("b1", fn);
		expect(result.ok).toBe(true);
		expect(result.batch).toEqual({ id: "b1" });
		expect(capturedUrls[0]).toContain("/api/v1/batches/b1");
	});

	it("Error 401 → clearToken()，ok:false", async () => {
		const { fn } = mockFetch({}, 401);
		const result = await fetchBatchState("b1", fn);
		expect(result.ok).toBe(false);
		expect(await getToken()).toBeNull();
	});
});

describe("config-client — createRemoteBatch", () => {
	beforeEach(async () => {
		fakeBrowser.reset();
		await setToken("tok-123");
	});

	it("Happy: 2xx → ok:true，POST 命中 /batches", async () => {
		const { capturedUrls, capturedInits, fn } = mockFetch({ ok: true });
		const result = await createRemoteBatch(
			{ id: "b1", tabId: 1, authorizedHost: "h", topics: [] },
			fn,
		);
		expect(result.ok).toBe(true);
		expect(capturedUrls[0]).toContain("/api/v1/batches");
		expect(capturedInits[0]?.method).toBe("POST");
	});

	it("Error 401 → clearToken()，ok:false", async () => {
		const { fn } = mockFetch({}, 401);
		const result = await createRemoteBatch(
			{ id: "b1", tabId: 1, authorizedHost: "h", topics: [] },
			fn,
		);
		expect(result.ok).toBe(false);
		expect(await getToken()).toBeNull();
	});

	it("Integration: 注入的 fetchFn 确实被调用", async () => {
		const fn = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
		await createRemoteBatch(
			{ id: "b1", tabId: 1, authorizedHost: "h", topics: [] },
			fn as unknown as typeof fetch,
		);
		expect(fn).toHaveBeenCalledOnce();
	});
});
