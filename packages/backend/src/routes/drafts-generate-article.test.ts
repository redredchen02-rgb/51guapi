// @vitest-environment node
//
// 路由边界测试：证明 qualityWarnings 能穿过 Fastify+TypeBox 响应序列化抵达 HTTP 响应。
// 关键：Fastify+TypeBox 会剥除 schema 之外的响应字段 —— 服务层测试无法发现这一剥除，
// 故必须在真实 schema（GenerateArticleResponse）绑定下用 app.inject 验证。
// 同时覆盖：topicId 格式校验、domain 守卫、isGossipFactsBlock 守卫。

import { isGossipFactsBlock } from "@51guapi/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateArticleDraft } from "../services/draft-article-gen.js";
import {
	GenerateArticleBody,
	GenerateArticleResponse,
} from "../utils/schemas.js";

vi.mock("../services/draft-article-gen.js", () => ({
	generateArticleDraft: vi.fn(),
}));

const GOSSIP_FACTS = {
	當事人: "张三",
	事件摘要: "网传出轨",
	起因: "截图流出",
	經過: "粉丝对战",
	結果: "尚无声明",
	來源連結: "https://example.com/1",
	發生時間: "2026-06",
	熱度標籤: "出轨",
};

const MOCK_DRAFT = {
	id: "article_001",
	title: "张三疑似出轨网友热议持续发酵热度不减",
	subtitle: "",
	category: "出轨",
	coverImageUrl: "",
	body: "<!-- section:intro --><p>测试内容</p>",
	tags: ["张三", "出轨", "吃瓜"],
	description: "网传出轨",
	status: "draft" as const,
	createdAt: "2026-06-23T00:00:00Z",
};

/** 构建仅含 generate-article 路由的极简 Fastify 实例（无鉴权，仅测 schema 边界）。 */
async function buildTestApp(
	topicStore: Map<string, unknown>,
): Promise<FastifyInstance> {
	const app = Fastify();

	app.post<{ Body: { topicId: string } }>(
		"/api/v1/drafts/generate-article",
		{
			schema: {
				body: GenerateArticleBody,
				response: { 200: GenerateArticleResponse },
			},
		},
		async (request, reply) => {
			const { topicId } = request.body;
			const topic = topicStore.get(topicId) as
				| { facts: unknown; domain?: string; status?: string }
				| undefined;
			if (!topic)
				return reply
					.status(404)
					.send({ ok: false, error: `Topic ${topicId} not found.` });
			if (topic.status !== "approved")
				return reply
					.status(400)
					.send({ ok: false, error: "该选题尚未审核通过，无法生成文章。" });
			if (topic.domain !== "gossip")
				return reply
					.status(400)
					.send({ ok: false, error: "该选题不属于 gossip 管线。" });
			if (!isGossipFactsBlock(topic.facts))
				return reply
					.status(400)
					.send({ ok: false, error: "facts 不是 GossipFactsBlock。" });

			const result = await generateArticleDraft(topic.facts, {
				settings: {
					endpoint: "https://api.test.com",
					model: "gpt-4o-mini",
					promptTemplate: "",
				},
				apiKey: "test-key",
			});
			if (!result.ok)
				return reply.status(422).send({ ok: false, error: result.error });
			return result;
		},
	);

	await app.ready();
	return app;
}

describe("POST /api/v1/drafts/generate-article 路由边界", () => {
	let app: FastifyInstance;
	let topicStore: Map<string, unknown>;

	beforeEach(async () => {
		vi.clearAllMocks();
		topicStore = new Map();
		app = await buildTestApp(topicStore);
	});

	afterEach(async () => {
		await app.close();
	});

	it("topicId 缺失 → 400", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/drafts/generate-article",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.statusCode).toBe(400);
	});

	it("topicId 含空格（非法字符）→ 400", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/drafts/generate-article",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ topicId: "id with spaces" }),
		});
		expect(res.statusCode).toBe(400);
	});

	it("topicId 超长（>128 字符）→ 400", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/drafts/generate-article",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ topicId: "a".repeat(129) }),
		});
		expect(res.statusCode).toBe(400);
	});

	it("topic 不存在 → 404", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/drafts/generate-article",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ topicId: "nonexistent" }),
		});
		expect(res.statusCode).toBe(404);
	});

	it("topic.status !== 'approved' → 400 含审核提示", async () => {
		topicStore.set("t1", {
			facts: GOSSIP_FACTS,
			domain: "gossip",
			status: "pending",
		});
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/drafts/generate-article",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ topicId: "t1" }),
		});
		expect(res.statusCode).toBe(400);
		expect(res.json().error).toContain("审核");
	});

	it("topic.domain = 'acg' → 400 含 gossip 提示", async () => {
		topicStore.set("t1", { facts: GOSSIP_FACTS, domain: "acg", status: "approved" });
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/drafts/generate-article",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ topicId: "t1" }),
		});
		expect(res.statusCode).toBe(400);
		expect(res.json().error).toContain("gossip");
	});

	it("facts 缺少 當事人 key（非 GossipFactsBlock）→ 400", async () => {
		topicStore.set("t1", {
			facts: { intro: "acg format", workTitle: "work" },
			domain: "gossip",
			status: "approved",
		});
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/drafts/generate-article",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ topicId: "t1" }),
		});
		expect(res.statusCode).toBe(400);
	});

	it("generateArticleDraft ok:false → 422", async () => {
		topicStore.set("t1", {
			facts: GOSSIP_FACTS,
			domain: "gossip",
			status: "approved",
		});
		vi.mocked(generateArticleDraft).mockResolvedValue({
			ok: false,
			kind: "format",
			error: "LLM 返回格式不合法。",
		});
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/drafts/generate-article",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ topicId: "t1" }),
		});
		expect(res.statusCode).toBe(422);
	});

	it("正常路径：qualityWarnings 穿过 TypeBox schema 到达响应 body（不被剥除）", async () => {
		topicStore.set("t1", { facts: GOSSIP_FACTS, domain: "gossip", status: "approved" });
		vi.mocked(generateArticleDraft).mockResolvedValue({
			ok: true,
			draft: MOCK_DRAFT,
			qualityWarnings: ["标题偏短（18 字，建议 25-35 字）"],
		});
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/drafts/generate-article",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ topicId: "t1" }),
		});
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.ok).toBe(true);
		expect(body.draft.title).toContain("张三");
		// 关键断言：qualityWarnings 未被 TypeBox 剥除
		expect(Array.isArray(body.qualityWarnings)).toBe(true);
		expect(body.qualityWarnings).toHaveLength(1);
		expect(body.qualityWarnings[0]).toContain("标题偏短");
	});

	it("qualityWarnings 为空数组时 → 200 ok:true，qualityWarnings=[]", async () => {
		topicStore.set("t1", { facts: GOSSIP_FACTS, domain: "gossip", status: "approved" });
		vi.mocked(generateArticleDraft).mockResolvedValue({
			ok: true,
			draft: MOCK_DRAFT,
			qualityWarnings: [],
		});
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/drafts/generate-article",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ topicId: "t1" }),
		});
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.ok).toBe(true);
	});

});
