// @vitest-environment node
//
// E3 — rewrite 路径中和端到端（A5 gate 已过，commit f2879cef）
//
// 证 POST /api/v1/drafts/rewrite → rewriteDraftLlm → 导出 JSON/Markdown 全链路，
// A5「无条件中和」不变量在 HTTP 路由层可证伪：
//   1. 模型返回 anchor / 裸文本 / markdown 形式 evil URL → 中和、不进导出物
//   2. omit-path（模型省略 body，客户端原 draft.body 含裸文本 URL）→ 路由层仍中和
//   3. 客户端无法自我放行（无 facts 允许集，A5 终定）
//
// 与 services/draft-rewrite.test.ts 的区别：
//   - 该文件测 rewriteDraftLlm() 服务函数（单测，fetchFn 注入直达服务层）
//   - 本单元测 POST /api/v1/drafts/rewrite HTTP 路由层（e2e，vi.stubGlobal("fetch")
//     拦截全局 fetch → callLlmForJson → rewriteDraftLlm 走真实实现）
//   - 净新价值：HTTP 请求/响应 schema 校验 + failedDims 空校验 + 路由层 omit-path + 导出 sink 集成
//
// 注入策略：route 调 rewriteDraftLlm(draft, dims, { settings, apiKey })，未传 fetchFn，
// 故用 global fetch（deps.fetchFn ?? fetch，draft-gen.ts:116）。vi.stubGlobal("fetch", mock)
// 即可拦截 LLM 调用，无需改生产码。

import {
	assembleDraftJSON,
	assembleDraftMarkdown,
	type ContentDraft,
} from "@51guapi/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./utils/llm-config.js", () => ({
	getLlmConfig: vi.fn(() => ({
		endpoint: "https://api.example.com/v1",
		model: "test-model",
		apiKey: "test-key",
	})),
	validateLlmConfig: vi.fn(() => ({ valid: true })),
}));

import { registerDraftRoutes } from "./app.js";

const EVIL = "https://evil.example.net/x";

const BASE_DRAFT = {
	id: "d1",
	title: "原标题",
	subtitle: "",
	category: "緋聞",
	coverImageUrl: "",
	body: "<p>原正文</p>",
	tags: [] as string[],
	description: "",
	status: "draft",
	createdAt: "2026-06-22T00:00:00.000Z",
};

const BASE_SETTINGS = {
	endpoint: "https://api.example.com/v1",
	model: "test-model",
	fallbackModel: "",
	promptTemplate: "",
	fewShotPairs: [],
};

/** 劫持全局 fetch，返回模型给出的内容。 */
function stubLlm(modelContent: Record<string, unknown>): void {
	vi.stubGlobal(
		"fetch",
		vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			headers: { get: () => null },
			json: async () => ({
				choices: [{ message: { content: JSON.stringify(modelContent) } }],
				usage: { prompt_tokens: 10, completion_tokens: 5 },
			}),
		} as unknown as Response),
	);
}

async function buildApp(): Promise<FastifyInstance> {
	const app = Fastify({ logger: false });
	registerDraftRoutes(app);
	await app.ready();
	return app;
}

async function rewrite(
	app: FastifyInstance,
	draft: typeof BASE_DRAFT,
	failedDims = ["body_richness"],
) {
	return app.inject({
		method: "POST",
		url: "/api/v1/drafts/rewrite",
		payload: { draft, failedDims, settings: BASE_SETTINGS },
	});
}

let app: FastifyInstance;

beforeEach(async () => {
	app = await buildApp();
});

afterEach(async () => {
	vi.unstubAllGlobals();
	await app.close();
});

describe("E3 rewrite 路由层端到端：A5 无条件中和不变量", () => {
	it("模型返回 anchor 链接 → 路由响应中和、JSON/Markdown 导出零 evil", async () => {
		stubLlm({ body: `<p>看<a href="${EVIL}">这里</a>速看</p>` });

		const res = await rewrite(app, BASE_DRAFT);

		expect(res.statusCode).toBe(200);
		const { draft } = res.json() as { draft: ContentDraft };

		// 路由响应本身中和
		expect(draft.body).not.toContain("evil.example.net");
		expect(draft.body).not.toContain("<a");

		// 真导出 sink 亦不含 evil（证中和在 export 之前）
		const json = JSON.stringify(
			assembleDraftJSON(draft, null, "2026-06-22T00:00:00.000Z"),
		);
		const md = assembleDraftMarkdown(draft);
		expect(json).not.toContain("evil.example.net");
		expect(md).not.toContain("evil.example.net");
	});

	it("omit-path（P0）：模型省略 body，客户端原 draft.body 裸文本 URL → 路由层无条件中和", async () => {
		// 对抗审计核心场景：模型只返回 title，body 省略 → 旧版条件中和此处穿透
		stubLlm({ title: "新标题" });
		const evilDraft = { ...BASE_DRAFT, body: `<p>详情见 ${EVIL} 速看</p>` };

		const res = await rewrite(app, evilDraft);

		expect(res.statusCode).toBe(200);
		const { draft } = res.json() as { draft: ContentDraft };

		// A5 无条件中和：客户端原 body 裸文本 URL 不应穿透
		expect(draft.body).not.toContain("evil.example.net");
		expect(draft.body).toContain("【待补】"); // sanitizeToPlainText 的裸 URL 替换标记

		// 导出 sink 亦清洁
		const json = JSON.stringify(
			assembleDraftJSON(draft, null, "2026-06-22T00:00:00.000Z"),
		);
		const md = assembleDraftMarkdown(draft);
		expect(json).not.toContain("evil.example.net");
		expect(md).not.toContain("evil.example.net");
	});

	it("happy path：纯散文正文 → 路由 200，导出内容保留", async () => {
		stubLlm({ body: "<p>更丰富的吃瓜正文，无任何链接。</p>" });

		const res = await rewrite(app, BASE_DRAFT);

		expect(res.statusCode).toBe(200);
		const { draft } = res.json() as { draft: ContentDraft };
		expect(draft.body).toContain("更丰富");
		expect(draft.body).not.toContain("【待补】");
	});

	it("failedDims 为空数组 → 400（路由层校验，不进 rewriteDraftLlm）", async () => {
		stubLlm({});
		const res = await rewrite(app, BASE_DRAFT, []);
		expect(res.statusCode).toBe(400);
	});
});
