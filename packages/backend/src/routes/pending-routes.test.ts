import { randomBytes } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PUBLIC_ROUTES, requireAuth } from "../middleware/auth-middleware.js";
import { getDb, initPendingDb } from "../scraper/pending-db.js";
import {
	type PendingTopic,
	savePendingTopic,
} from "../scraper/pending-store.js";
import { registerPendingRoutes } from "./pending-routes.js";

// ---- helpers ----

function resetDb() {
	initPendingDb();
	getDb().exec("DELETE FROM pending_topics");
}

function makeTopic(overrides: Partial<PendingTopic> = {}): PendingTopic {
	const now = new Date().toISOString();
	return {
		id: `test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
		sourceUrl: "https://example-site.com/article/123",
		siteName: "example-site",
		title: "测试选题",
		facts: { 作品名: "测试作品" },
		confidence: 0.8,
		status: "pending",
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

async function buildApp(): Promise<FastifyInstance> {
	const app = Fastify({ logger: false });
	await registerPendingRoutes(app);
	await app.ready();
	return app;
}

// ---- setup ----

let app: FastifyInstance;

beforeEach(async () => {
	resetDb();
	app = await buildApp();
});

afterEach(async () => {
	await app.close();
});

// ================================================================
// PATCH /api/v1/pending-topics/:id — rejectedReason 校验
// ================================================================

describe("PATCH /api/v1/pending-topics/:id — rejectedReason validation", () => {
	it('valid reason "duplicate" → 200，DB 存储该值', async () => {
		const topic = makeTopic();
		await savePendingTopic(topic);

		const res = await app.inject({
			method: "PATCH",
			url: `/api/v1/pending-topics/${topic.id}`,
			payload: { status: "rejected", rejectedReason: "duplicate" },
		});

		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.ok).toBe(true);
		expect(body.topic.status).toBe("rejected");
		expect(body.topic.rejectedReason).toBe("duplicate");
	});

	it('无效 reason "made_up" → 400', async () => {
		const topic = makeTopic();
		await savePendingTopic(topic);

		const res = await app.inject({
			method: "PATCH",
			url: `/api/v1/pending-topics/${topic.id}`,
			payload: { status: "rejected", rejectedReason: "made_up" },
		});

		expect(res.statusCode).toBe(400);
		const body = res.json();
		expect(body.error).toMatch(/made_up/);
	});

	it("无 rejectedReason → 200，rejectedReason 存储为 null/undefined", async () => {
		const topic = makeTopic();
		await savePendingTopic(topic);

		const res = await app.inject({
			method: "PATCH",
			url: `/api/v1/pending-topics/${topic.id}`,
			payload: { status: "rejected" },
		});

		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.ok).toBe(true);
		expect(body.topic.status).toBe("rejected");
		// rejectedReason 未提供时存 null，返回 JSON 中为 undefined 或缺失
		expect(body.topic.rejectedReason ?? null).toBeNull();
	});

	it("非 rejected 状态携带 rejectedReason → 200（reason 被忽略，不报错）", async () => {
		const topic = makeTopic();
		await savePendingTopic(topic);

		const res = await app.inject({
			method: "PATCH",
			url: `/api/v1/pending-topics/${topic.id}`,
			payload: { status: "approved", rejectedReason: "quality" },
		});

		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.ok).toBe(true);
		expect(body.topic.status).toBe("approved");
	});

	it("不存在的 id → 404", async () => {
		const res = await app.inject({
			method: "PATCH",
			url: "/api/v1/pending-topics/nonexistent-id",
			payload: { status: "rejected", rejectedReason: "quality" },
		});

		expect(res.statusCode).toBe(404);
	});
});

// ================================================================
// GET sort_by=score + fold_threshold (U7)
// ================================================================

describe("GET /api/v1/pending-topics — sort_by + fold_threshold (U7)", () => {
	it("无 sort_by → created_at DESC（不回归）", async () => {
		const now = new Date().toISOString();
		await savePendingTopic(
			makeTopic({
				id: "oldest",
				sourceUrl: "https://example-site.com/s/1",
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: now,
			}),
		);
		await savePendingTopic(
			makeTopic({
				id: "newest",
				sourceUrl: "https://example-site.com/s/2",
				createdAt: "2026-06-01T00:00:00.000Z",
				updatedAt: now,
			}),
		);

		const res = await app.inject({
			method: "GET",
			url: "/api/v1/pending-topics",
		});
		expect(res.statusCode).toBe(200);
		const topics = res.json().topics as { id: string }[];
		expect(topics[0].id).toBe("newest");
	});

	it("sort_by=score → score 降序（score 有值的排前面）", async () => {
		const now = new Date().toISOString();
		// 所有字段都有 → 高分
		await savePendingTopic(
			makeTopic({
				id: "high",
				sourceUrl: "https://example-site.com/s/high",
				title: "高分选题",
				rawContent: {
					title: "高分选题",
					body: "<p>正文</p>",
					url: "https://example-site.com/s/high",
				},
				coverImageUrl: "https://cdn.example.com/cover.jpg",
				createdAt: now,
				updatedAt: now,
			}),
		);
		// 缺少 body 和 cover → 低分
		await savePendingTopic(
			makeTopic({
				id: "low",
				sourceUrl: "https://example-site.com/s/low",
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
			}),
		);

		const res = await app.inject({
			method: "GET",
			url: "/api/v1/pending-topics?sort_by=score",
		});
		expect(res.statusCode).toBe(200);
		const topics = res.json().topics as { id: string; score?: number }[];
		// 高分在前
		expect(topics[0].id).toBe("high");
	});

	it("fold_threshold=0.5 → 低分项 folded=true，高分项 folded=false，所有项都在", async () => {
		const now = new Date().toISOString();
		await savePendingTopic(
			makeTopic({
				id: "rich",
				sourceUrl: "https://example-site.com/s/rich",
				title: "丰富选题",
				rawContent: {
					title: "丰富选题",
					body: "<p>正文</p>",
					url: "https://example-site.com/s/rich",
				},
				coverImageUrl: "https://cdn.example.com/c.jpg",
				createdAt: now,
				updatedAt: now,
			}),
		);
		await savePendingTopic(
			makeTopic({
				id: "sparse",
				sourceUrl: "https://example-site.com/s/sparse",
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
			}),
		);

		const res = await app.inject({
			method: "GET",
			url: "/api/v1/pending-topics?fold_threshold=0.5",
		});
		expect(res.statusCode).toBe(200);
		const topics = res.json().topics as { id: string; folded?: boolean }[];
		// 两条都在（不隐藏）
		expect(topics.length).toBe(2);
		const rich = topics.find((t) => t.id === "rich") as {
			id: string;
			folded?: boolean;
		};
		const sparse = topics.find((t) => t.id === "sparse") as {
			id: string;
			folded?: boolean;
		};
		expect(rich.folded).toBe(false);
		expect(sparse.folded).toBe(true);
	});

	it("无 fold_threshold → 响应不含 folded 字段", async () => {
		await savePendingTopic(
			makeTopic({ id: "nofold", sourceUrl: "https://example-site.com/s/nf" }),
		);
		const res = await app.inject({
			method: "GET",
			url: "/api/v1/pending-topics",
		});
		const topics = res.json().topics as Record<string, unknown>[];
		expect(topics.every((t) => !("folded" in t))).toBe(true);
	});
});

// ---- JWT 401 守護 ----

const PENDING_SECRET = randomBytes(48).toString("hex");

async function buildPendingAppWithAuth(): Promise<FastifyInstance> {
	const app = Fastify({ logger: false });
	app.addHook("preHandler", async (request, reply) => {
		const url = request.url.split("?")[0];
		if (PUBLIC_ROUTES.has(url)) return;
		return requireAuth(request, reply);
	});
	await registerPendingRoutes(app);
	await app.ready();
	return app;
}

describe("pending-routes — JWT 守護", () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		process.env.JWT_SECRET = PENDING_SECRET;
		initPendingDb();
		app = await buildPendingAppWithAuth();
	});

	afterEach(async () => {
		await app.close();
		delete process.env.JWT_SECRET;
	});

	it("無 token → GET /api/v1/pending-topics 返回 401", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/api/v1/pending-topics",
		});
		expect(res.statusCode).toBe(401);
	});

	it("無 token → PATCH /api/v1/pending-topics/:id 返回 401", async () => {
		const res = await app.inject({
			method: "PATCH",
			url: "/api/v1/pending-topics/nonexistent-id",
			payload: { status: "approved" },
		});
		expect(res.statusCode).toBe(401);
	});
});
