import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { setToken } from "./auth-client";
import { testConnection } from "./connection-test";

// listModels 经 getToken/getBackendUrl + 注入 fetchFn 打 /api/v1/models。
// 这里注入 fetchFn 模拟各种后端响应,验证 testConnection 的固定态映射。

function mockFetch(
	handler: (url: string) => Response | Promise<Response>,
): typeof fetch {
	return ((url: string) =>
		Promise.resolve(handler(url))) as unknown as typeof fetch;
}

beforeEach(async () => {
	fakeBrowser.reset();
	await setToken("test-token");
});

describe("testConnection", () => {
	it("Happy: 后端返非空模型列表 → ok + 模型数", async () => {
		const fn = mockFetch(
			() =>
				new Response(JSON.stringify({ ok: true, models: ["m1", "m2"] }), {
					status: 200,
				}),
		);
		const r = await testConnection(fn);
		expect(r.status).toBe("ok");
		expect(r.modelCount).toBe(2);
		expect(r.message).toContain("2");
	});

	it("Edge: 后端返空模型列表 → llm-error(LLM 可达但无模型)", async () => {
		const fn = mockFetch(
			() =>
				new Response(JSON.stringify({ ok: true, models: [] }), { status: 200 }),
		);
		const r = await testConnection(fn);
		expect(r.status).toBe("llm-error");
	});

	it("Error: 401 → unauthorized", async () => {
		const fn = mockFetch(() => new Response("", { status: 401 }));
		const r = await testConnection(fn);
		expect(r.status).toBe("unauthorized");
	});

	it("Error: 连不上后端(fetch reject)→ backend-unreachable", async () => {
		const fn = (() =>
			Promise.reject(
				new TypeError("Failed to fetch"),
			)) as unknown as typeof fetch;
		const r = await testConnection(fn);
		expect(r.status).toBe("backend-unreachable");
	});

	it("Error: 超时(AbortError)→ timeout", async () => {
		const fn = (() => {
			const e = new Error("aborted");
			e.name = "AbortError";
			return Promise.reject(e);
		}) as unknown as typeof fetch;
		const r = await testConnection(fn);
		expect(r.status).toBe("timeout");
	});

	it("安全: 后端 500 含疑似 endpoint/key 的错误体 → llm-error 且固定文案,不回显原始体", async () => {
		const leak = "https://la-sealion.inaiai.com/v1 key=sk-secret123";
		const fn = mockFetch(
			() => new Response(JSON.stringify({ error: leak }), { status: 500 }),
		);
		const r = await testConnection(fn);
		expect(r.status).toBe("llm-error");
		expect(r.message).not.toContain("la-sealion");
		expect(r.message).not.toContain("sk-secret");
	});
});
