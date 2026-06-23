import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { patchPendingTopic, updatePendingStatus } from "./pending-client";

// patch/updateStatus 不接受注入 fetchFn → 走默认 fetchWithTimeout。
vi.mock("@51guapi/shared", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@51guapi/shared")>();
	return {
		...actual,
		fetchWithTimeout: vi.fn(),
	};
});

import { fetchWithTimeout } from "@51guapi/shared";

const mocked = vi.mocked(fetchWithTimeout);

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status });
}

function lastUrl(): string {
	const call = mocked.mock.calls.at(-1);
	if (!call) throw new Error("fetchWithTimeout 未被调用");
	return String(call[0]);
}

function lastInit(): RequestInit {
	return (mocked.mock.calls.at(-1)?.[1] ?? {}) as RequestInit;
}

beforeEach(async () => {
	fakeBrowser.reset();
	mocked.mockReset();
});

describe("pending-client — patchPendingTopic", () => {
	it("Happy: 2xx → true，PATCH 命中 URL（id 经 encodeURIComponent）", async () => {
		mocked.mockResolvedValueOnce(jsonResponse({ ok: true }));
		const ok = await patchPendingTopic("a b", { facts: { 作品名: "X" } });
		expect(ok).toBe(true);
		expect(lastUrl()).toContain("/api/v1/pending-topics/a%20b");
		expect(lastInit().method).toBe("PATCH");
		expect(JSON.parse(lastInit().body as string)).toEqual({
			facts: { 作品名: "X" },
		});
	});

	it("Error 401 → false", async () => {
		mocked.mockResolvedValueOnce(jsonResponse({}, 401));
		expect(await patchPendingTopic("id1", {})).toBe(false);
	});

	it("Error 500 → false", async () => {
		mocked.mockResolvedValueOnce(jsonResponse({}, 500));
		expect(await patchPendingTopic("id1", {})).toBe(false);
	});

	it("网络异常 → false（catch 吞错）", async () => {
		mocked.mockRejectedValueOnce(new Error("net"));
		expect(await patchPendingTopic("id1", {})).toBe(false);
	});
});

describe("pending-client — updatePendingStatus", () => {
	it("Happy approved: 2xx → true，body 含 status，无 rejectedReason", async () => {
		mocked.mockResolvedValueOnce(jsonResponse({ ok: true }));
		expect(await updatePendingStatus("id1", "approved")).toBe(true);
		expect(lastInit().method).toBe("PATCH");
		expect(JSON.parse(lastInit().body as string)).toEqual({
			status: "approved",
		});
	});

	it("rejected + reason → body 含 rejectedReason", async () => {
		mocked.mockResolvedValueOnce(jsonResponse({ ok: true }));
		expect(await updatePendingStatus("id1", "rejected", "quality")).toBe(true);
		expect(JSON.parse(lastInit().body as string)).toEqual({
			status: "rejected",
			rejectedReason: "quality",
		});
	});

	it("Error 401 → false", async () => {
		mocked.mockResolvedValueOnce(jsonResponse({}, 401));
		expect(await updatePendingStatus("id1", "approved")).toBe(false);
	});

	it("网络异常 → false", async () => {
		mocked.mockRejectedValueOnce(new Error("net"));
		expect(await updatePendingStatus("id1", "approved")).toBe(false);
	});
});
