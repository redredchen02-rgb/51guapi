// @vitest-environment node
//
// 路由边界测试:证明 slots 能穿过 Fastify+TypeBox 响应序列化抵达 JSON body。
// 关键:Fastify+TypeBox 会剥除 schema 之外的响应字段 —— 服务层测试无法发现这一剥除,
// 故必须在真实 schema(GenerateDraftResponse)绑定下用 app.inject 验证(Unit 1a)。

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateDraft } from "../services/llm.js";
import { GenerateDraftResponse } from "../utils/schemas.js";

function mockFetch(payload: unknown) {
	return vi.fn(
		async () =>
			({
				ok: true,
				status: 200,
				statusText: "OK",
				json: async () => payload,
			}) as Response,
	);
}

const slotsReply = (slots: Record<string, unknown>) => ({
	choices: [{ message: { content: JSON.stringify(slots) } }],
});

// 仅注册 generate 路由,绑定真实响应 schema;通过 fetchFn 注入桩,避免真网络/鉴权。
async function buildApp(fetchFn: typeof fetch): Promise<FastifyInstance> {
	const app = Fastify();
	app.post(
		"/api/v1/drafts/generate",
		{ schema: { response: { 200: GenerateDraftResponse } } },
		async () =>
			generateDraft("主题", {
				settings: {
					endpoint: "https://api.example.com/v1/chat/completions",
					model: "gpt-4o-mini",
					fallbackModel: "",
					promptTemplate: "t",
					fewShotPairs: [],
					fieldMapping: {},
				},
				apiKey: "k",
				facts: { 作品名: "作品X", 集数: "2期", 简介: "梗概" },
				fetchFn,
				now: () => "2026-06-03T00:00:00.000Z",
				genId: () => "draft_1",
			}),
	);
	await app.ready();
	return app;
}

describe("POST /api/v1/drafts/generate — slots 序列化契约", () => {
	let app: FastifyInstance;

	afterEach(async () => {
		if (app) await app.close();
	});

	it("响应 body 含非空 slots(穿过 Fastify+TypeBox 序列化)", async () => {
		app = await buildApp(
			mockFetch(
				slotsReply({
					titleSuffix: "介紹",
					subtitle: "副标题",
					intro: "引子",
					highlights: "看点",
				}),
			),
		);
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/drafts/generate",
			payload: {},
		});
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.ok).toBe(true);
		// anti-false-green:新生成草稿必须带 slots,且字段反映模型槽位(未被静默剥除)。
		expect(body.slots).toBeDefined();
		expect(body.slots.intro).toBe("引子");
		expect(body.slots.highlights).toBe("看点");
		expect(body.slots.titleSuffix).toBe("介紹");
	});

	it("缺省 slots 的响应仍能通过 schema 校验(可选字段)", async () => {
		// 直接返回一个不带 slots 的 ok 响应,验证 Type.Optional 容忍缺省。
		const app2 = Fastify();
		app2.post(
			"/legacy",
			{ schema: { response: { 200: GenerateDraftResponse } } },
			async () => ({
				ok: true as const,
				draft: {
					id: "x",
					title: "t",
					subtitle: "",
					category: "",
					coverImageUrl: "",
					body: "",
					tags: [],
					description: "",
					postStatus: "0",
					publishedAt: "",
					mediaId: "",
					status: "draft",
					createdAt: "2026-06-03T00:00:00.000Z",
				},
			}),
		);
		await app2.ready();
		const res = await app2.inject({ method: "POST", url: "/legacy" });
		expect(res.statusCode).toBe(200);
		expect(res.json().slots).toBeUndefined();
		await app2.close();
	});
});
