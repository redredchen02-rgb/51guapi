import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { mockFetch } from "./__test-utils__/mock-fetch";
import { createChannel, deleteChannel, fetchChannels } from "./channel-client";

vi.mock("@51guapi/shared", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@51guapi/shared")>();
	return {
		...actual,
		fetchWithTimeout: vi.fn(
			async () => new Response(JSON.stringify({ ok: true, channels: [] })),
		),
	};
});

const CHANNEL = {
	id: "chan_1",
	hostname: "51cg1.com",
	displayName: "51cg1",
	pathPrefix: "/",
	maxDepth: 1,
	maxBytes: 5242880,
	createdBy: "operator",
	reason: "",
	createdAt: "now",
};

describe("channel-client — fetchChannels", () => {
	beforeEach(async () => {
		fakeBrowser.reset();
	});

	it("Happy: 2xx → 返回 channels,URL 正确", async () => {
		const { capturedUrls, fn } = mockFetch({
			ok: true,
			channels: [CHANNEL],
		});
		const result = await fetchChannels(fn);
		expect(result).toHaveLength(1);
		expect(result[0]?.hostname).toBe("51cg1.com");
		expect(capturedUrls[0]).toContain("/api/v1/channels");
	});

	it("Edge: ok 无 channels → 空数组", async () => {
		const { fn } = mockFetch({ ok: true });
		expect(await fetchChannels(fn)).toEqual([]);
	});

	it("Error 401 → 抛 Unauthorized", async () => {
		const { fn } = mockFetch({}, 401);
		await expect(fetchChannels(fn)).rejects.toThrow("Unauthorized");
	});
});

describe("channel-client — createChannel", () => {
	beforeEach(async () => {
		fakeBrowser.reset();
	});

	it("Happy(自用模式): POST 命中 URL,无手势头/无口令/无 confirm", async () => {
		const { capturedUrls, capturedInits, fn } = mockFetch({
			ok: true,
			channel: CHANNEL,
		});
		const result = await createChannel("51cg1.com", { reason: "吃瓜源" }, fn);
		expect(result.hostname).toBe("51cg1.com");
		expect(capturedUrls[0]).toContain("/api/v1/channels");
		expect(capturedInits[0]?.method).toBe("POST");
		const headers = capturedInits[0]?.headers as Record<string, string>;
		// 自用模式:不再发确认手势头。
		expect(headers["x-operator-confirm"]).toBeUndefined();
		const body = JSON.parse(capturedInits[0]?.body as string);
		expect(body.channel).toBe("51cg1.com");
		expect(body.reason).toBe("吃瓜源");
		// 不再上送 confirm / adminPassword。
		expect(body.confirm).toBeUndefined();
		expect(body.adminPassword).toBeUndefined();
	});

	it("Error 400(后端拒绝,如私网/同形/通配)→ 抛后端 error", async () => {
		const { fn } = mockFetch({ error: "拒绝混合脚本/同形域名" }, 400);
		await expect(createChannel("аpple.com", {}, fn)).rejects.toThrow(/同形/);
	});

	it("Error 401 → 抛 Unauthorized", async () => {
		const { fn } = mockFetch({}, 401);
		await expect(createChannel("x.com", {}, fn)).rejects.toThrow(
			"Unauthorized",
		);
	});
});

describe("channel-client — deleteChannel", () => {
	beforeEach(async () => {
		fakeBrowser.reset();
	});

	it("Happy: DELETE 命中 URL", async () => {
		const { capturedUrls, capturedInits, fn } = mockFetch({ ok: true });
		await deleteChannel("chan_1", fn);
		expect(capturedUrls[0]).toContain("/api/v1/channels/chan_1");
		expect(capturedInits[0]?.method).toBe("DELETE");
	});

	it("Error 404 → 抛 error", async () => {
		const { fn } = mockFetch({ error: "渠道不存在" }, 404);
		await expect(deleteChannel("nope", fn)).rejects.toThrow(/不存在/);
	});
});
