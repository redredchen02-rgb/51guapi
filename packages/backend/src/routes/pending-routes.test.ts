import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
		expect(body.topic.rejectedReason ?? null).toBeNull();
	});

	it("同一 PATCH 携带 facts + verified + status → 不静默丢弃局部更新", async () => {
		const topic = makeTopic({
			id: "combo",
			sourceUrl: "https://example-site.com/s/combo",
			facts: {
				當事人: "旧人物",
				事件摘要: "旧事件",
				起因: null,
				經過: null,
				結果: null,
				來源連結: null,
				發生時間: null,
				熱度標籤: "旧题材",
			},
		});
		await savePendingTopic(topic);

		const res = await app.inject({
			method: "PATCH",
			url: `/api/v1/pending-topics/${topic.id}`,
			payload: {
				status: "approved",
				verified: true,
				facts: { 當事人: "新人", 熱度標籤: "新题材" },
			},
		});

		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.topic.status).toBe("approved");
		expect(body.topic.verifiedAt).toBeTruthy();
		expect(body.topic.facts).toMatchObject({
			當事人: "新人",
			熱度標籤: "新题材",
		});
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
					// R2 后「无日期」按中性新鲜度计分；高分项须有近期发布时间方为真新鲜。
					metadata: { publishedTime: now },
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

	it("rawContent.metadata.extractionMode → API 顶层 extractionMode", async () => {
		await savePendingTopic(
			makeTopic({
				id: "mode",
				sourceUrl: "https://example-site.com/s/mode",
				rawContent: {
					title: "模式选题",
					body: "<p>正文</p>",
					url: "https://example-site.com/s/mode",
					metadata: { extractionMode: "fallback" },
				},
			}),
		);
		const res = await app.inject({
			method: "GET",
			url: "/api/v1/pending-topics",
		});
		expect(res.statusCode).toBe(200);
		const [topic] = res.json().topics as Array<{
			id: string;
			extractionMode?: string;
		}>;
		expect(topic?.id).toBe("mode");
		expect(topic?.extractionMode).toBe("fallback");
	});
});

// ================================================================
// U4/U5 — verified 人工核对 + 题材过滤/计数
// ================================================================

describe("U4/U5 verified + themes", () => {
	function gossip(overrides: Partial<PendingTopic> = {}): PendingTopic {
		return makeTopic({
			domain: "gossip",
			facts: {
				當事人: "明星A",
				事件摘要: "出軌事件",
				起因: null,
				經過: null,
				結果: null,
				來源連結: null,
				發生時間: null,
				熱度標籤: "出軌",
			},
			rawContent: {
				title: "标题",
				body: "明星A出軌事件的詳細報導，內容充足，超過最小長度門檻，僅供測試使用。",
				url: "https://x.com/g",
			},
			...overrides,
		});
	}

	it("U5 list ?theme=出軌 只返回该题材的瓜", async () => {
		await savePendingTopic(
			gossip({
				id: "g1",
				sourceUrl: "https://x.com/g1",
				facts: {
					當事人: "A",
					事件摘要: "x",
					起因: null,
					經過: null,
					結果: null,
					來源連結: null,
					發生時間: null,
					熱度標籤: "出軌",
				},
			}),
		);
		await savePendingTopic(
			gossip({
				id: "g2",
				sourceUrl: "https://x.com/g2",
				facts: {
					當事人: "B",
					事件摘要: "y",
					起因: null,
					經過: null,
					結果: null,
					來源連結: null,
					發生時間: null,
					熱度標籤: "解約",
				},
			}),
		);
		const res = await app.inject({
			method: "GET",
			url: "/api/v1/pending-topics?domain=gossip&theme=出軌",
		});
		const ids = (res.json().topics as { id: string }[]).map((t) => t.id);
		expect(ids).toContain("g1");
		expect(ids).not.toContain("g2");
	});

	it("U5 /themes 只统计已核对的吃瓜", async () => {
		await savePendingTopic(
			gossip({
				id: "v1",
				sourceUrl: "https://x.com/v1",
				verifiedAt: "2026-06-18T00:00:00.000Z",
			}),
		);
		await savePendingTopic(gossip({ id: "u1", sourceUrl: "https://x.com/u1" })); // 未核对
		const res = await app.inject({
			method: "GET",
			url: "/api/v1/pending-topics/themes",
		});
		const map = Object.fromEntries(
			(res.json().themes as { theme: string; count: number }[]).map((t) => [
				t.theme,
				t.count,
			]),
		);
		expect(map.出軌).toBe(1); // 只算已核对的 v1
	});

	it("U5 /themes 不统计已批准或已拒绝的题材池条目", async () => {
		await savePendingTopic(
			gossip({
				id: "pending-verified",
				sourceUrl: "https://x.com/pending-verified",
				verifiedAt: "2026-06-18T00:00:00.000Z",
				status: "pending",
			}),
		);
		await savePendingTopic(
			gossip({
				id: "approved-verified",
				sourceUrl: "https://x.com/approved-verified",
				verifiedAt: "2026-06-18T00:00:00.000Z",
				status: "approved",
			}),
		);
		await savePendingTopic(
			gossip({
				id: "rejected-verified",
				sourceUrl: "https://x.com/rejected-verified",
				verifiedAt: "2026-06-18T00:00:00.000Z",
				status: "rejected",
			}),
		);

		const res = await app.inject({
			method: "GET",
			url: "/api/v1/pending-topics/themes",
		});
		const map = Object.fromEntries(
			(res.json().themes as { theme: string; count: number }[]).map((t) => [
				t.theme,
				t.count,
			]),
		);
		expect(map.出軌).toBe(1);
	});

	it("U4 PATCH {verified:true} 置 verifiedAt，?verified=true 命中", async () => {
		const t = gossip({ id: "vf", sourceUrl: "https://x.com/vf" });
		await savePendingTopic(t);
		const patch = await app.inject({
			method: "PATCH",
			url: `/api/v1/pending-topics/${t.id}`,
			payload: { verified: true },
		});
		expect(patch.statusCode).toBe(200);
		expect(patch.json().topic.verifiedAt).toBeTruthy();
		const list = await app.inject({
			method: "GET",
			url: "/api/v1/pending-topics?verified=true",
		});
		expect((list.json().topics as { id: string }[]).map((x) => x.id)).toContain(
			"vf",
		);
	});

	it("U4 PATCH facts 改值 → 重跑 grounding（防 UI rewrite 旁路）", async () => {
		const t = gossip({ id: "rg", sourceUrl: "https://x.com/rg" });
		await savePendingTopic(t);
		// 改成原文不存在的人 → 重 grounding 后 當事人 未溯源
		const patch = await app.inject({
			method: "PATCH",
			url: `/api/v1/pending-topics/${t.id}`,
			payload: {
				facts: {
					當事人: "林志玲", // 原文无此人
					事件摘要: "出軌事件",
					起因: null,
					經過: null,
					結果: null,
					來源連結: null,
					發生時間: null,
					熱度標籤: "出軌",
				},
			},
		});
		expect(patch.statusCode).toBe(200);
		expect(patch.json().topic.verification.grounding.unsourced).toContain(
			"當事人",
		);
	});
});

// ================================================================
// 缺少覆蓋的分支 (lines 220, 249, 306-309)
// ================================================================

describe("POST /api/v1/pending-topics — 成功路徑 (line 220)", () => {
	it("有效 body → 201 ok=true，返回 topic with id", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/pending-topics",
			payload: {
				sourceUrl: "https://gossip.example.com/article/1",
				siteName: "gossip-site",
				title: "明星A出軌事件",
				facts: { 當事人: "明星A", 事件摘要: "出軌" },
				confidence: 0.8,
			},
		});
		expect(res.statusCode).toBe(200);
		expect(res.json().ok).toBe(true);
		expect(res.json().topic.id).toBeDefined();
		expect(res.json().topic.title).toBe("明星A出軌事件");
	});
});

describe("PATCH /api/v1/pending-topics/:id — invalid status (TypeBox schema)", () => {
	it("status 不在合法枚舉值中 → 400（TypeBox Union 先攔）", async () => {
		const topic = makeTopic();
		await savePendingTopic(topic);
		const res = await app.inject({
			method: "PATCH",
			url: `/api/v1/pending-topics/${topic.id}`,
			payload: { status: "invalid_status_xyz" },
		});
		expect(res.statusCode).toBe(400);
	});
});

describe("DELETE /api/v1/pending-topics/:id (lines 306-309)", () => {
	it("刪除存在的 topic → 200 ok=true", async () => {
		const topic = makeTopic();
		await savePendingTopic(topic);
		const res = await app.inject({
			method: "DELETE",
			url: `/api/v1/pending-topics/${topic.id}`,
		});
		expect(res.statusCode).toBe(200);
		expect(res.json().ok).toBe(true);
	});

	it("刪除不存在的 topic → 404", async () => {
		const res = await app.inject({
			method: "DELETE",
			url: "/api/v1/pending-topics/nonexistent-id",
		});
		expect(res.statusCode).toBe(404);
	});
});

// ================================================================
// GET /api/v1/pending-topics/:id — 單筆查詢 (lines 172-174)
// ================================================================

describe("GET /api/v1/pending-topics/:id", () => {
	it("存在的 topic → 200 ok=true，返回 topic", async () => {
		const topic = makeTopic();
		await savePendingTopic(topic);
		const res = await app.inject({
			method: "GET",
			url: `/api/v1/pending-topics/${topic.id}`,
		});
		expect(res.statusCode).toBe(200);
		expect(res.json().ok).toBe(true);
		expect(res.json().topic.id).toBe(topic.id);
	});

	it("不存在的 topic → 404 (line 173)", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/api/v1/pending-topics/no-such-id",
		});
		expect(res.statusCode).toBe(404);
	});
});
