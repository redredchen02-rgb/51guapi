import { randomBytes } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PUBLIC_ROUTES, requireAuth } from "../middleware/auth-middleware.js";
import { getDb, initPendingDb, resetPendingDb } from "../scraper/pending-db.js";
import { counters, getMetrics } from "../services/metrics.js";
import { registerGossipRoutes } from "./gossip-routes.js";

// Mock generic-adapter and gossip-fact-extractor
vi.mock("../scraper/adapters/generic-adapter.js", () => ({
	fetchListPaged: vi.fn(),
	fetchContent: vi.fn(),
}));

vi.mock("../scraper/gossip-fact-extractor.js", () => ({
	gossipExtractFacts: vi.fn(),
}));

vi.mock("../scraper/channel-store.js", () => ({
	getChannelByHostname: vi.fn(() => null),
}));

import {
	fetchContent,
	fetchListPaged,
} from "../scraper/adapters/generic-adapter.js";
import { getChannelByHostname } from "../scraper/channel-store.js";
import { gossipExtractFacts } from "../scraper/gossip-fact-extractor.js";

const mockFetchList = vi.mocked(fetchListPaged);
const mockGetChannel = vi.mocked(getChannelByHostname);
const mockFetchContent = vi.mocked(fetchContent);
const mockGossipExtractFacts = vi.mocked(gossipExtractFacts);

const DATA_DIR = process.env.GUAPI_DATA_DIR!;

function cleanData() {
	initPendingDb();
	getDb().exec("DELETE FROM pending_topics; DELETE FROM gossip_sites");
	const sitesDir = join(DATA_DIR, "gossip-sites");
	if (existsSync(sitesDir)) rmSync(sitesDir, { recursive: true, force: true });
}

async function buildApp(): Promise<FastifyInstance> {
	const app = Fastify({ logger: false });
	await registerGossipRoutes(app);
	await app.ready();
	return app;
}

describe("gossip-routes", () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		resetPendingDb();
		initPendingDb();
		cleanData();
		app = await buildApp();
	});

	afterEach(async () => {
		await app.close();
		cleanData();
	});

	// ---- POST /gossip/sites ----

	it("POST /gossip/sites：有效 name + listUrl → 201 返回 site with id", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/gossip/sites",
			payload: {
				name: "測試站點",
				listUrl: "https://example-gossip.com/latest",
			},
		});
		expect(res.statusCode).toBe(201);
		const body = res.json();
		expect(body.ok).toBe(true);
		expect(body.site.id).toBeDefined();
		expect(body.site.name).toBe("測試站點");
	});

	it("POST /gossip/sites：缺 listUrl → 400", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/gossip/sites",
			payload: { name: "站點" },
		});
		expect(res.statusCode).toBe(400);
	});

	it("POST /gossip/sites：listUrl 為 IP literal → 400", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/gossip/sites",
			payload: { name: "惡意站點", listUrl: "https://192.168.1.1/list" },
		});
		expect(res.statusCode).toBe(400);
		expect(res.json().error).toMatch(/IP literal/i);
	});

	it("POST /gossip/sites：listUrl 使用 http:// → 400 + https scheme 錯誤", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/gossip/sites",
			payload: { name: "站點", listUrl: "http://example.com/list" },
		});
		expect(res.statusCode).toBe(400);
		expect(res.json().error).toMatch(/https/i);
	});

	it("POST /gossip/sites：listUrl 為 127.0.0.1 IP literal → 400", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/gossip/sites",
			payload: { name: "站點", listUrl: "https://127.0.0.1/list" },
		});
		expect(res.statusCode).toBe(400);
		expect(res.json().error).toMatch(/IP literal/i);
	});

	it("POST /gossip/sites：listUrl 無效字串 → 400", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/gossip/sites",
			payload: { name: "站點", listUrl: "not-a-url" },
		});
		expect(res.statusCode).toBe(400);
	});

	// ---- GET /gossip/sites ----

	it("GET /gossip/sites：返回站點清單", async () => {
		// 先新增一個站點
		await app.inject({
			method: "POST",
			url: "/api/v1/gossip/sites",
			payload: { name: "站點A", listUrl: "https://gossip-a.com/latest" },
		});
		const res = await app.inject({
			method: "GET",
			url: "/api/v1/gossip/sites",
		});
		expect(res.statusCode).toBe(200);
		expect(res.json().sites).toHaveLength(1);
	});

	// ---- DELETE /gossip/sites/:id ----

	it("DELETE /gossip/sites/:id：不存在 → 404", async () => {
		const res = await app.inject({
			method: "DELETE",
			url: "/api/v1/gossip/sites/nonexistent",
		});
		expect(res.statusCode).toBe(404);
	});

	it("DELETE /gossip/sites/:id：成功刪除", async () => {
		const createRes = await app.inject({
			method: "POST",
			url: "/api/v1/gossip/sites",
			payload: { name: "站點", listUrl: "https://gossip.com/latest" },
		});
		const { site } = createRes.json();
		const delRes = await app.inject({
			method: "DELETE",
			url: `/api/v1/gossip/sites/${site.id}`,
		});
		expect(delRes.statusCode).toBe(200);
	});

	// ---- POST /gossip/sites/:id/discover ----

	it("discover：mock fetchList 返回 25 條 → 全部返回（不再丟棄第 21+ 條）", async () => {
		const createRes = await app.inject({
			method: "POST",
			url: "/api/v1/gossip/sites",
			payload: { name: "站點", listUrl: "https://gossip.com/latest" },
		});
		const { site } = createRes.json();

		mockFetchList.mockResolvedValueOnce(
			Array.from({ length: 25 }, (_, i) => ({
				url: `https://gossip.com/article/${i + 1}`,
				title: `文章${i + 1}`,
			})),
		);

		const res = await app.inject({
			method: "POST",
			url: `/api/v1/gossip/sites/${site.id}/discover`,
		});
		expect(res.statusCode).toBe(200);
		expect(res.json().discovered).toHaveLength(25);
		expect(res.json().hasMore).toBe(false);
		expect(res.json().total).toBe(25);
	});

	it("discover：5 條 URL 已在 pending → 被過濾", async () => {
		const createRes = await app.inject({
			method: "POST",
			url: "/api/v1/gossip/sites",
			payload: { name: "站點", listUrl: "https://gossip.com/latest" },
		});
		const { site } = createRes.json();

		// 先用 from-url 建立 pending 記錄（mock LLM）
		process.env.LLM_ENDPOINT = "https://api.test";
		process.env.LLM_API_KEY = "test-key";
		mockFetchContent.mockResolvedValueOnce({
			title: "已存文章",
			body: "body",
			url: "https://gossip.com/article/1",
		});
		mockGossipExtractFacts.mockResolvedValueOnce({
			facts: {
				當事人: "A",
				事件摘要: "test",
				起因: null,
				經過: null,
				結果: null,
				來源連結: null,
				發生時間: null,
				熱度標籤: null,
			},
			confidence: 0.5,
			extractionMode: "strict",
		});
		await app.inject({
			method: "POST",
			url: "/api/v1/gossip/topics/from-url",
			payload: { url: "https://gossip.com/article/1", siteName: "站點" },
		});

		// discover 返回包含已存 URL 的清單
		mockFetchList.mockResolvedValueOnce([
			{ url: "https://gossip.com/article/1", title: "已存" },
			{ url: "https://gossip.com/article/2", title: "新文章" },
		]);

		const res = await app.inject({
			method: "POST",
			url: `/api/v1/gossip/sites/${site.id}/discover`,
		});
		const discovered = res.json().discovered as { url: string }[];
		expect(discovered.map((d) => d.url)).not.toContain(
			"https://gossip.com/article/1",
		);
		expect(discovered.map((d) => d.url)).toContain(
			"https://gossip.com/article/2",
		);
	});

	// ---- POST /gossip/topics/from-url ----

	it("from-url：mock fetchContent + gossipExtractFacts → PendingTopic domain='gossip' 被存入", async () => {
		process.env.LLM_ENDPOINT = "https://api.test";
		process.env.LLM_API_KEY = "test-key";

		mockFetchContent.mockResolvedValueOnce({
			title: "明星A出軌事件",
			body: "詳細報導...",
			url: "https://gossip.com/article/99",
			coverImageUrl: "https://cdn.example.com/cover.jpg",
		});
		mockGossipExtractFacts.mockResolvedValueOnce({
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
			confidence: 0.75,
			coverImageUrl: "https://cdn.example.com/cover.jpg",
			extractionMode: "strict",
		});

		const res = await app.inject({
			method: "POST",
			url: "/api/v1/gossip/topics/from-url",
			payload: { url: "https://gossip.com/article/99", siteName: "測試站" },
		});
		expect(res.statusCode).toBe(201);
		const topic = res.json().topic;
		expect(topic.domain).toBe("gossip");
		expect(topic.title).toBe("明星A出軌事件");
		expect(topic.rawContent.metadata.extractionMode).toBe("strict");
	});

	it("from-url：IP literal URL → 400", async () => {
		process.env.LLM_ENDPOINT = "https://api.test";
		process.env.LLM_API_KEY = "test-key";
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/gossip/topics/from-url",
			payload: { url: "http://10.0.0.1/article/1", siteName: "站點" },
		});
		expect(res.statusCode).toBe(400);
	});

	it("from-url：LLM 未配置 → 503", async () => {
		delete process.env.LLM_ENDPOINT;
		delete process.env.LLM_API_KEY;
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/gossip/topics/from-url",
			payload: { url: "https://gossip.com/article/1", siteName: "站點" },
		});
		expect(res.statusCode).toBe(503);
	});

	it("from-url：重複 URL → 409", async () => {
		process.env.LLM_ENDPOINT = "https://api.test";
		process.env.LLM_API_KEY = "test-key";

		const mockFacts = {
			facts: {
				當事人: "A",
				事件摘要: "test",
				起因: null,
				經過: null,
				結果: null,
				來源連結: null,
				發生時間: null,
				熱度標籤: null,
			},
			confidence: 0.5,
			extractionMode: "strict" as const,
		};
		const mockRaw = {
			title: "文章",
			body: "body",
			url: "https://gossip.com/article/dup",
		};

		mockFetchContent.mockResolvedValue(mockRaw);
		mockGossipExtractFacts.mockResolvedValue(mockFacts);

		// 第一次：成功存入
		const first = await app.inject({
			method: "POST",
			url: "/api/v1/gossip/topics/from-url",
			payload: { url: "https://gossip.com/article/dup", siteName: "站點" },
		});
		expect(first.statusCode).toBe(201);

		// 第二次：同 URL → 409
		mockFetchContent.mockResolvedValue(mockRaw);
		mockGossipExtractFacts.mockResolvedValue(mockFacts);
		const second = await app.inject({
			method: "POST",
			url: "/api/v1/gossip/topics/from-url",
			payload: { url: "https://gossip.com/article/dup", siteName: "站點" },
		});
		expect(second.statusCode).toBe(409);
	});

	it("discover：fetchList 拋出 → 500", async () => {
		const createRes = await app.inject({
			method: "POST",
			url: "/api/v1/gossip/sites",
			payload: { name: "站點", listUrl: "https://gossip.com/latest" },
		});
		const { site } = createRes.json();

		mockFetchList.mockRejectedValueOnce(new Error("network timeout"));

		const res = await app.inject({
			method: "POST",
			url: `/api/v1/gossip/sites/${site.id}/discover`,
		});
		expect(res.statusCode).toBe(500);
	});

	it("discover（U2）：渠道 maxDepth=3 → fetchListPaged 以 maxPages=3 调用", async () => {
		const createRes = await app.inject({
			method: "POST",
			url: "/api/v1/gossip/sites",
			payload: { name: "站點", listUrl: "https://gossip.com/latest" },
		});
		const { site } = createRes.json();

		// biome-ignore lint/suspicious/noExplicitAny: 测试桩仅取 maxDepth 字段
		mockGetChannel.mockReturnValueOnce({ maxDepth: 3 } as any);
		mockFetchList.mockResolvedValueOnce([
			{ url: "https://gossip.com/article/u2-depth3", title: "a" },
		]);

		const res = await app.inject({
			method: "POST",
			url: `/api/v1/gossip/sites/${site.id}/discover`,
		});
		expect(res.statusCode).toBe(200);
		expect(mockFetchList).toHaveBeenCalledWith("https://gossip.com/latest", 3);
		expect(res.json().total).toBe(1);
	});

	it("discover（U2）：无渠道记录 → maxPages=1（单页退化，不回归）", async () => {
		const createRes = await app.inject({
			method: "POST",
			url: "/api/v1/gossip/sites",
			payload: { name: "站點", listUrl: "https://gossip.com/latest" },
		});
		const { site } = createRes.json();

		mockGetChannel.mockReturnValueOnce(null);
		mockFetchList.mockResolvedValueOnce([
			{ url: "https://gossip.com/article/9", title: "a" },
		]);

		const res = await app.inject({
			method: "POST",
			url: `/api/v1/gossip/sites/${site.id}/discover`,
		});
		expect(res.statusCode).toBe(200);
		expect(mockFetchList).toHaveBeenCalledWith("https://gossip.com/latest", 1);
	});

	it("from-url：fetchContent 拋出 → 502", async () => {
		process.env.LLM_ENDPOINT = "https://api.test";
		process.env.LLM_API_KEY = "test-key";
		mockFetchContent.mockRejectedValueOnce(new Error("network error"));
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/gossip/topics/from-url",
			payload: { url: "https://gossip.com/article/new", siteName: "站點" },
		});
		expect(res.statusCode).toBe(502);
	});

	it("from-url：gossipExtractFacts 拋出 → 502", async () => {
		process.env.LLM_ENDPOINT = "https://api.test";
		process.env.LLM_API_KEY = "test-key";
		mockFetchContent.mockResolvedValueOnce({
			title: "文章",
			body: "body",
			url: "https://gossip.com/article/err",
		});
		mockGossipExtractFacts.mockRejectedValueOnce(new Error("LLM timed out"));
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/gossip/topics/from-url",
			payload: { url: "https://gossip.com/article/err", siteName: "站點" },
		});
		expect(res.statusCode).toBe(502);
	});
});

// ---- U2: recordScraperRun 接线 + /api/v1/metrics HTTP 断言 ----

function resetMetricsCounters() {
	counters.scraperRuns.success = 0;
	counters.scraperRuns.failed = 0;
}

// counters 是模块级单例，app.ts 的 metrics 路由不在本测试的 buildApp 中注册，
// 故此处单独注册一个等价的 /api/v1/metrics 路由读取同一 counters。
async function buildAppWithMetrics(): Promise<FastifyInstance> {
	const app = Fastify({ logger: false });
	await registerGossipRoutes(app);
	app.get("/api/v1/metrics", async () => getMetrics());
	await app.ready();
	return app;
}

function scraperSuccessCount(metricsText: string): number {
	const m = metricsText.match(
		/publisher_scraper_runs_total\{status="success"\}\s+(\d+)/,
	);
	return m ? Number(m[1]) : -1;
}
function scraperFailedCount(metricsText: string): number {
	const m = metricsText.match(
		/publisher_scraper_runs_total\{status="failed"\}\s+(\d+)/,
	);
	return m ? Number(m[1]) : -1;
}

const MOCK_FACTS = {
	facts: {
		當事人: "A",
		事件摘要: "test",
		起因: null,
		經過: null,
		結果: null,
		來源連結: null,
		發生時間: null,
		熱度標籤: null,
	},
	confidence: 0.5,
	extractionMode: "strict" as const,
};

describe("gossip-routes — recordScraperRun 接线（U2）", () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		resetPendingDb();
		initPendingDb();
		resetMetricsCounters();
		process.env.LLM_ENDPOINT = "https://api.test";
		process.env.LLM_API_KEY = "test-key";
		app = await buildAppWithMetrics();
	});

	afterEach(async () => {
		await app.close();
		vi.clearAllMocks();
	});

	it("成功 from-url → metrics scraper success >= 1", async () => {
		mockFetchContent.mockResolvedValueOnce({
			title: "文章",
			body: "body",
			url: "https://gossip.com/article/ok",
		});
		mockGossipExtractFacts.mockResolvedValueOnce(MOCK_FACTS);

		const post = await app.inject({
			method: "POST",
			url: "/api/v1/gossip/topics/from-url",
			payload: { url: "https://gossip.com/article/ok", siteName: "站點" },
		});
		expect(post.statusCode).toBe(201);

		const res = await app.inject({ method: "GET", url: "/api/v1/metrics" });
		expect(scraperSuccessCount(res.body)).toBeGreaterThanOrEqual(1);
	});

	it("fetchContent 失败 → metrics scraper failed >= 1", async () => {
		mockFetchContent.mockRejectedValueOnce(new Error("network error"));
		const post = await app.inject({
			method: "POST",
			url: "/api/v1/gossip/topics/from-url",
			payload: { url: "https://gossip.com/article/f1", siteName: "站點" },
		});
		expect(post.statusCode).toBe(502);

		const res = await app.inject({ method: "GET", url: "/api/v1/metrics" });
		expect(scraperFailedCount(res.body)).toBeGreaterThanOrEqual(1);
		expect(scraperSuccessCount(res.body)).toBe(0);
	});

	it("gossipExtractFacts 失败 → metrics scraper failed >= 1", async () => {
		mockFetchContent.mockResolvedValueOnce({
			title: "文章",
			body: "body",
			url: "https://gossip.com/article/f2",
		});
		mockGossipExtractFacts.mockRejectedValueOnce(new Error("LLM timed out"));
		const post = await app.inject({
			method: "POST",
			url: "/api/v1/gossip/topics/from-url",
			payload: { url: "https://gossip.com/article/f2", siteName: "站點" },
		});
		expect(post.statusCode).toBe(502);

		const res = await app.inject({ method: "GET", url: "/api/v1/metrics" });
		expect(scraperFailedCount(res.body)).toBeGreaterThanOrEqual(1);
	});

	it("409 重复 URL → scraper 计数不变（仍为首次成功的 1）", async () => {
		mockFetchContent.mockResolvedValue({
			title: "文章",
			body: "body",
			url: "https://gossip.com/article/dup2",
		});
		mockGossipExtractFacts.mockResolvedValue(MOCK_FACTS);

		const first = await app.inject({
			method: "POST",
			url: "/api/v1/gossip/topics/from-url",
			payload: { url: "https://gossip.com/article/dup2", siteName: "站點" },
		});
		expect(first.statusCode).toBe(201);

		const second = await app.inject({
			method: "POST",
			url: "/api/v1/gossip/topics/from-url",
			payload: { url: "https://gossip.com/article/dup2", siteName: "站點" },
		});
		expect(second.statusCode).toBe(409);

		const res = await app.inject({ method: "GET", url: "/api/v1/metrics" });
		// 仅首次成功计数；409 不计 success 也不计 failed
		expect(scraperSuccessCount(res.body)).toBe(1);
		expect(scraperFailedCount(res.body)).toBe(0);
	});

	it("beforeEach 重置后计数从 0 起（隔离）", async () => {
		const res = await app.inject({ method: "GET", url: "/api/v1/metrics" });
		expect(scraperSuccessCount(res.body)).toBe(0);
		expect(scraperFailedCount(res.body)).toBe(0);
	});
});

// ---- JWT 401 守護 ----

const GOSSIP_SECRET = randomBytes(48).toString("hex");

async function buildGossipAppWithAuth(): Promise<FastifyInstance> {
	const app = Fastify({ logger: false });
	app.addHook("preHandler", async (request, reply) => {
		const url = request.url.split("?")[0];
		if (PUBLIC_ROUTES.has(url)) return;
		return requireAuth(request, reply);
	});
	await registerGossipRoutes(app);
	await app.ready();
	return app;
}

describe("gossip-routes — JWT 守護", () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		process.env.JWT_SECRET = GOSSIP_SECRET;
		app = await buildGossipAppWithAuth();
	});

	afterEach(async () => {
		await app.close();
		delete process.env.JWT_SECRET;
	});

	it("無 token → GET /api/v1/gossip/sites 返回 401", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/api/v1/gossip/sites",
		});
		expect(res.statusCode).toBe(401);
	});

	it("無 token → POST /api/v1/gossip/sites 返回 401", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/gossip/sites",
			payload: { name: "test", listUrl: "https://t.com" },
		});
		expect(res.statusCode).toBe(401);
	});

	it("無 token → POST /api/v1/gossip/topics/from-url 返回 401", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/gossip/topics/from-url",
			payload: { url: "https://t.com/a", siteName: "s" },
		});
		expect(res.statusCode).toBe(401);
	});
});
