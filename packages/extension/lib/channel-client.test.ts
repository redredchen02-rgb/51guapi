import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { authHeader, mockFetch } from "./__test-utils__/mock-fetch";
import { getToken, setToken } from "./auth-client";
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
		await setToken("tok");
	});

	it("Happy: 2xx → 返回 channels,URL + Bearer 正确", async () => {
		const { capturedUrls, capturedInits, fn } = mockFetch({
			ok: true,
			channels: [CHANNEL],
		});
		const result = await fetchChannels(fn);
		expect(result).toHaveLength(1);
		expect(result[0]?.hostname).toBe("51cg1.com");
		expect(capturedUrls[0]).toContain("/api/v1/channels");
		expect(authHeader(capturedInits[0])).toBe("Bearer tok");
	});

	it("Edge: ok 无 channels → 空数组", async () => {
		const { fn } = mockFetch({ ok: true });
		expect(await fetchChannels(fn)).toEqual([]);
	});

	it("Error 401 → clearToken + 抛 Unauthorized", async () => {
		const { fn } = mockFetch({}, 401);
		await expect(fetchChannels(fn)).rejects.toThrow("Unauthorized");
		expect(await getToken()).toBeNull();
	});
});

describe("channel-client — createChannel", () => {
	beforeEach(async () => {
		fakeBrowser.reset();
		await setToken("tok");
	});

	it("Happy: POST 命中 URL,带确认手势 header + body confirm", async () => {
		const { capturedUrls, capturedInits, fn } = mockFetch({
			ok: true,
			channel: CHANNEL,
		});
		const result = await createChannel(
			"51cg1.com",
			{ reason: "吃瓜源", adminPassword: "pw" },
			fn,
		);
		expect(result.hostname).toBe("51cg1.com");
		expect(capturedUrls[0]).toContain("/api/v1/channels");
		expect(capturedInits[0]?.method).toBe("POST");
		const headers = capturedInits[0]?.headers as Record<string, string>;
		expect(headers["x-operator-confirm"]).toBe("1");
		const body = JSON.parse(capturedInits[0]?.body as string);
		expect(body.confirm).toBe(true);
		expect(body.channel).toBe("51cg1.com");
		expect(body.reason).toBe("吃瓜源");
		// step-up:口令随 body 上送,后端比对 JWT_ADMIN_PASSWORD_HASH。
		expect(body.adminPassword).toBe("pw");
	});

	it("Error 403(无口令被后端 step-up 拒)→ 抛 error", async () => {
		const { capturedInits, fn } = mockFetch(
			{ error: "需管理员口令重验", kind: "step_up_required" },
			403,
		);
		await expect(createChannel("x.com", {}, fn)).rejects.toThrow(/口令/);
		const body = JSON.parse(capturedInits[0]?.body as string);
		expect(body.adminPassword).toBeUndefined();
	});

	it("Error 400(后端拒绝,如私网/同形/通配)→ 抛后端 error", async () => {
		const { fn } = mockFetch({ error: "拒绝混合脚本/同形域名" }, 400);
		await expect(createChannel("аpple.com", {}, fn)).rejects.toThrow(/同形/);
	});

	it("Error 403(缺手势被后端拒)→ 抛 error", async () => {
		const { fn } = mockFetch({ error: "需操作者确认手势" }, 403);
		await expect(createChannel("x.com", {}, fn)).rejects.toThrow(/手势/);
	});
});

describe("channel-client — deleteChannel", () => {
	beforeEach(async () => {
		fakeBrowser.reset();
		await setToken("tok");
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
