// @vitest-environment node
//
// F2 e2e:证明 POST /api/v1/drafts/generate 的成功 / 失败 / 异常三路真实递增
// metrics counters,并经 GET /metrics 端到端反映。metrics.test.ts 已覆盖单元级
// recordDraft;此处补足「HTTP 路由 → counters → /metrics 输出」的端到端链路。

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/llm.js", () => ({
	generateDraft: vi.fn(),
	listModels: vi.fn(),
	reviewDraftLlm: vi.fn(),
	rewriteDraftLlm: vi.fn(),
}));
vi.mock("../utils/llm-config.js", () => ({
	getLlmConfig: vi.fn(() => ({
		endpoint: "https://api.example.com/v1",
		model: "m",
		apiKey: "k",
	})),
	validateLlmConfig: vi.fn(() => ({ valid: true })),
}));

import { registerDraftRoutes } from "../app.js";
import { generateDraft } from "../services/llm.js";
import { counters, getMetrics } from "../services/metrics.js";

const mockGenerate = vi.mocked(generateDraft);

const validBody = {
	prompt: "主题",
	settings: { endpoint: "https://api.example.com/v1", model: "m" },
};

// GenerateDraftResponse 的 draft 为必填;成功响应须回完整 draft 才能通过序列化。
const fullDraft = {
	id: "d1",
	title: "t",
	subtitle: "",
	category: "",
	coverImageUrl: "",
	body: "",
	tags: [] as string[],
	description: "",
	postStatus: "0",
	publishedAt: "",
	mediaId: "",
	status: "draft",
	createdAt: "2026-06-03T00:00:00.000Z",
};

function draftCounts(out: string): { success: number; failed: number } {
	return {
		success: Number(
			out.match(/publisher_drafts_total\{status="success"\} (\d+)/)?.[1],
		),
		failed: Number(
			out.match(/publisher_drafts_total\{status="failed"\} (\d+)/)?.[1],
		),
	};
}

async function buildApp(): Promise<FastifyInstance> {
	const app = Fastify();
	registerDraftRoutes(app);
	app.get("/metrics", async () => getMetrics());
	await app.ready();
	return app;
}

describe("POST /api/v1/drafts/generate → /metrics e2e (F2)", () => {
	let app: FastifyInstance;

	beforeEach(() => {
		counters.draftsGenerated = 0;
		counters.draftsFailed = 0;
		mockGenerate.mockReset();
	});

	afterEach(async () => {
		if (app) await app.close();
	});

	it("成功生成 → /metrics draftsGenerated +1", async () => {
		mockGenerate.mockResolvedValue({ ok: true, draft: fullDraft } as never);
		app = await buildApp();
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/drafts/generate",
			payload: validBody,
		});
		expect(res.statusCode).toBe(200);
		const m = await app.inject({ method: "GET", url: "/metrics" });
		expect(draftCounts(m.body)).toEqual({ success: 1, failed: 0 });
	});

	it("生成失败(result.ok=false)→ /metrics draftsFailed +1", async () => {
		mockGenerate.mockResolvedValue({
			ok: false,
			error: "boom",
			kind: "bad",
		} as never);
		app = await buildApp();
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/drafts/generate",
			payload: validBody,
		});
		expect(res.statusCode).toBe(422);
		const m = await app.inject({ method: "GET", url: "/metrics" });
		expect(draftCounts(m.body)).toEqual({ success: 0, failed: 1 });
	});

	it("生成抛异常 → /metrics draftsFailed +1", async () => {
		mockGenerate.mockRejectedValue(new Error("network down"));
		app = await buildApp();
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/drafts/generate",
			payload: validBody,
		});
		expect(res.statusCode).toBe(500);
		const m = await app.inject({ method: "GET", url: "/metrics" });
		expect(draftCounts(m.body)).toEqual({ success: 0, failed: 1 });
	});
});
