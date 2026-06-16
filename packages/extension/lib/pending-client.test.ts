import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing";
import type { PendingTopic, PendingTopicsResponse } from "./pending-client";
import { fetchPendingTopics } from "./pending-client";

// 构造一条最小化的 PendingTopic stub
function makeTopic(overrides: Partial<PendingTopic> = {}): PendingTopic {
	return {
		id: "t1",
		sourceUrl: "https://example.com/1",
		siteName: "test-site",
		title: "测试选题",
		facts: {},
		confidence: 0.9,
		status: "pending",
		createdAt: "2026-06-01T00:00:00.000Z",
		updatedAt: "2026-06-01T00:00:00.000Z",
		...overrides,
	};
}

function mockFetch(
	response: PendingTopicsResponse,
	status = 200,
): { capturedUrls: string[]; fn: typeof fetch } {
	const capturedUrls: string[] = [];
	const fn = async (url: string | URL | Request) => {
		capturedUrls.push(String(url));
		return new Response(JSON.stringify(response), { status });
	};
	return { capturedUrls, fn: fn as unknown as typeof fetch };
}

describe("fetchPendingTopics — URL 查询参数构造", () => {
	beforeEach(() => {
		fakeBrowser.reset();
	});

	it("无参数调用 → URL 不含 sort_by 或 fold_threshold", async () => {
		const { capturedUrls, fn } = mockFetch({ ok: true, topics: [] });
		await fetchPendingTopics(undefined, fn);
		expect(capturedUrls[0]).not.toContain("sort_by");
		expect(capturedUrls[0]).not.toContain("fold_threshold");
	});

	it("fetchPendingTopics('pending') → URL 含 status=pending，不含排序参数", async () => {
		const { capturedUrls, fn } = mockFetch({ ok: true, topics: [] });
		await fetchPendingTopics("pending", fn);
		expect(capturedUrls[0]).toContain("status=pending");
		expect(capturedUrls[0]).not.toContain("sort_by");
		expect(capturedUrls[0]).not.toContain("fold_threshold");
	});

	it("fetchPendingTopics({ sort_by: 'score' }) → URL 含 sort_by=score，不含 fold_threshold", async () => {
		const { capturedUrls, fn } = mockFetch({ ok: true, topics: [] });
		await fetchPendingTopics({ sort_by: "score" }, fn);
		expect(capturedUrls[0]).toContain("sort_by=score");
		expect(capturedUrls[0]).not.toContain("fold_threshold");
	});

	it("fetchPendingTopics({ sort_by: 'score', fold_threshold: 0.5 }) → URL 含 sort_by=score&fold_threshold=0.5", async () => {
		const { capturedUrls, fn } = mockFetch({ ok: true, topics: [] });
		await fetchPendingTopics({ sort_by: "score", fold_threshold: 0.5 }, fn);
		expect(capturedUrls[0]).toContain("sort_by=score");
		expect(capturedUrls[0]).toContain("fold_threshold=0.5");
	});

	it("fetchPendingTopics({ sort_by: 'created_at' }) → URL 含 sort_by=created_at", async () => {
		const { capturedUrls, fn } = mockFetch({ ok: true, topics: [] });
		await fetchPendingTopics({ sort_by: "created_at" }, fn);
		expect(capturedUrls[0]).toContain("sort_by=created_at");
	});

	it("opts 对象形式:{ status, sort_by, fold_threshold } → URL 正确", async () => {
		const { capturedUrls, fn } = mockFetch({ ok: true, topics: [] });
		await fetchPendingTopics(
			{ status: "pending", sort_by: "score", fold_threshold: 0.3 },
			fn,
		);
		expect(capturedUrls[0]).toContain("status=pending");
		expect(capturedUrls[0]).toContain("sort_by=score");
		expect(capturedUrls[0]).toContain("fold_threshold=0.3");
	});

	it("opts 对象形式:仅 sort_by，无 fold_threshold → URL 只含 sort_by", async () => {
		const { capturedUrls, fn } = mockFetch({ ok: true, topics: [] });
		await fetchPendingTopics({ sort_by: "score" }, fn);
		expect(capturedUrls[0]).toContain("sort_by=score");
		expect(capturedUrls[0]).not.toContain("fold_threshold");
	});
});

describe("fetchPendingTopics — 响应解析与 folded 字段", () => {
	beforeEach(() => {
		fakeBrowser.reset();
	});

	it("后端返回 ok:true + topics → 正确返回数组", async () => {
		const topic = makeTopic();
		const { fn } = mockFetch({ ok: true, topics: [topic] });
		const result = await fetchPendingTopics(undefined, fn);
		expect(result).toHaveLength(1);
		expect(result[0]?.id).toBe("t1");
	});

	it("后端返回含 folded:true 的选题 → folded 字段保留", async () => {
		const topic = makeTopic({ folded: true, qualityScore: 0.2 });
		const { fn } = mockFetch({ ok: true, topics: [topic] });
		const result = await fetchPendingTopics(undefined, fn);
		expect(result[0]?.folded).toBe(true);
	});

	it("后端返回 folded:false → folded 字段保留", async () => {
		const topic = makeTopic({ folded: false });
		const { fn } = mockFetch({ ok: true, topics: [topic] });
		const result = await fetchPendingTopics(undefined, fn);
		expect(result[0]?.folded).toBe(false);
	});

	it("后端返回 folded 缺失 → undefined（可选字段）", async () => {
		const topic = makeTopic();
		const { fn } = mockFetch({ ok: true, topics: [topic] });
		const result = await fetchPendingTopics(undefined, fn);
		expect(result[0]?.folded).toBeUndefined();
	});

	it("后端返回 ok:false → 返回空数组", async () => {
		const { fn } = mockFetch({ ok: false, error: "unauthorized" });
		const result = await fetchPendingTopics(undefined, fn);
		expect(result).toEqual([]);
	});

	it("fetch 返回 401 → 返回空数组", async () => {
		const fn = async () => new Response("{}", { status: 401 });
		const result = await fetchPendingTopics(undefined, fn as typeof fetch);
		expect(result).toEqual([]);
	});

	it("fetch 抛出异常 → 静默返回空数组", async () => {
		const fn = async () => {
			throw new Error("network error");
		};
		const result = await fetchPendingTopics(undefined, fn as typeof fetch);
		expect(result).toEqual([]);
	});
});

it("后端返回 ok:true + topics → 正确返回数组", async () => {
	const topic = makeTopic();
	const { fn } = mockFetch({ ok: true, topics: [topic] });
	const result = await fetchPendingTopics(undefined, fn);
	expect(result).toHaveLength(1);
	expect(result[0]?.id).toBe("t1");
});

it("后端返回含 folded:true 的选题 → folded 字段保留", async () => {
	const topic = makeTopic({ folded: true, qualityScore: 0.2 });
	const { fn } = mockFetch({ ok: true, topics: [topic] });
	const result = await fetchPendingTopics(undefined, fn);
	expect(result[0]?.folded).toBe(true);
});

it("后端返回 folded:false → folded 字段保留", async () => {
	const topic = makeTopic({ folded: false });
	const { fn } = mockFetch({ ok: true, topics: [topic] });
	const result = await fetchPendingTopics(undefined, fn);
	expect(result[0]?.folded).toBe(false);
});

it("后端返回 folded 缺失 → undefined（可选字段）", async () => {
	const topic = makeTopic();
	const { fn } = mockFetch({ ok: true, topics: [topic] });
	const result = await fetchPendingTopics(undefined, fn);
	expect(result[0]?.folded).toBeUndefined();
});

it("后端返回 ok:false → 返回空数组", async () => {
	const { fn } = mockFetch({ ok: false, error: "unauthorized" });
	const result = await fetchPendingTopics(undefined, fn);
	expect(result).toEqual([]);
});

it("fetch 返回 401 → 返回空数组", async () => {
	const fn = async () => new Response("{}", { status: 401 });
	const result = await fetchPendingTopics(undefined, fn as typeof fetch);
	expect(result).toEqual([]);
});

it("fetch 抛出异常 → 静默返回空数组", async () => {
	const fn = async () => {
		throw new Error("network error");
	};
	const result = await fetchPendingTopics(undefined, fn as typeof fetch);
	expect(result).toEqual([]);
});
