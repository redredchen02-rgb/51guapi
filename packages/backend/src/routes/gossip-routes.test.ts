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

// 足够长且无错误页特征的有效正文，确保 from-url 通过入池前验证关(U3)的有效性硬拒
// （正文 < 80 字会被判无效）。grounding 未溯源只软标 flag、仍入池，故断言 201 的用例够用。
const LONG_BODY =
	"這是一篇足夠長的測試正文，內容詳實，涵蓋事件的起因、經過與結果。據知情人爆料，" +
	"相關細節逐一浮出水面，引發廣泛關注與討論。本段文字確保超過最小長度門檻，" +
	"以通過入池前驗證關的有效性檢查，僅供單元測試使用，並無實際八卦意義。A test";

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
			body: LONG_BODY,
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
			body: LONG_BODY,
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

	it("from-url：windowDays + 发布时间在窗外 → 200 skipped:too-old，不入池、不调提炼", async () => {
		process.env.LLM_ENDPOINT = "https://api.test";
		process.env.LLM_API_KEY = "test-key";
		mockGossipExtractFacts.mockClear();
		mockFetchContent.mockResolvedValueOnce({
			title: "旧瓜",
			body: "很久以前的报导内容",
			url: "https://gossip.com/old",
			metadata: { publishedTime: "2020-01-01T00:00:00.000Z" },
		});
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/gossip/topics/from-url",
			payload: { url: "https://gossip.com/old", siteName: "站", windowDays: 7 },
		});
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.ok).toBe(true);
		expect(body.skipped).toBe("too-old");
		// 旧瓜连 LLM 提炼都省掉（防成本放大）
		expect(mockGossipExtractFacts).not.toHaveBeenCalled();
	});

	it("from-url：windowDays + 发布时间在窗内 → 201 入池", async () => {
		process.env.LLM_ENDPOINT = "https://api.test";
		process.env.LLM_API_KEY = "test-key";
		const recent = new Date(Date.now() - 2 * 86_400_000).toISOString();
		mockFetchContent.mockResolvedValueOnce({
			title: "新瓜",
			body: LONG_BODY,
			url: "https://gossip.com/new",
			metadata: { publishedTime: recent },
		});
		mockGossipExtractFacts.mockResolvedValueOnce({
			facts: {
				當事人: "明星B",
				事件摘要: "近期事件",
				起因: null,
				經過: null,
				結果: null,
				來源連結: null,
				發生時間: null,
				熱度標籤: null,
			},
			confidence: 0.7,
			extractionMode: "strict",
		});
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/gossip/topics/from-url",
			payload: { url: "https://gossip.com/new", siteName: "站", windowDays: 7 },
		});
		expect(res.statusCode).toBe(201);
		expect(res.json().topic.domain).toBe("gossip");
	});

	it("from-url：windowDays 但发布时间缺失 → 不跳过，照常入池（留待验证关软标）", async () => {
		process.env.LLM_ENDPOINT = "https://api.test";
		process.env.LLM_API_KEY = "test-key";
		mockFetchContent.mockResolvedValueOnce({
			title: "无日期瓜",
			body: LONG_BODY,
			url: "https://gossip.com/nodate",
			// 无 metadata.publishedTime
		});
		mockGossipExtractFacts.mockResolvedValueOnce({
			facts: {
				當事人: "明星C",
				事件摘要: "事件",
				起因: null,
				經過: null,
				結果: null,
				來源連結: null,
				發生時間: null,
				熱度標籤: null,
			},
			confidence: 0.6,
			extractionMode: "strict",
		});
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/gossip/topics/from-url",
			payload: {
				url: "https://gossip.com/nodate",
				siteName: "站",
				windowDays: 7,
			},
		});
		expect(res.statusCode).toBe(201);
	});

	it("from-url：windowDays 超范围(0) → 400 schema 拒", async () => {
		process.env.LLM_ENDPOINT = "https://api.test";
		process.env.LLM_API_KEY = "test-key";
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/gossip/topics/from-url",
			payload: { url: "https://gossip.com/x", siteName: "站", windowDays: 0 },
		});
		expect(res.statusCode).toBe(400);
	});

	it("from-url：内容无效(正文过短) → 200 rejected，不入池、用户可见(U3)", async () => {
		process.env.LLM_ENDPOINT = "https://api.test";
		process.env.LLM_API_KEY = "test-key";
		mockFetchContent.mockResolvedValueOnce({
			title: "短",
			body: "太短", // < 80 → 验证关 validity hardFail
			url: "https://gossip.com/invalid",
		});
		mockGossipExtractFacts.mockResolvedValueOnce({
			facts: {
				當事人: "A",
				事件摘要: "x",
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
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/gossip/topics/from-url",
			payload: { url: "https://gossip.com/invalid", siteName: "站" },
		});
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.rejected).toBeTruthy();
		expect(body.verification.decision).toBe("reject");
	});

	it("from-url：env GOSSIP_MIN_BODY_LEN 调小 → 同样短正文不再被拒(env 调参生效)", async () => {
		process.env.LLM_ENDPOINT = "https://api.test";
		process.env.LLM_API_KEY = "test-key";
		process.env.GOSSIP_MIN_BODY_LEN = "2";
		try {
			mockFetchContent.mockResolvedValueOnce({
				title: "短",
				body: "太短",
				url: "https://gossip.com/cfg",
			});
			mockGossipExtractFacts.mockResolvedValueOnce({
				facts: {
					當事人: "A",
					事件摘要: "x",
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
			const res = await app.inject({
				method: "POST",
				url: "/api/v1/gossip/topics/from-url",
				payload: { url: "https://gossip.com/cfg", siteName: "站" },
			});
			expect(res.statusCode).toBe(201); // 不再硬拒,入池(软标)
			expect(res.json().topic.verification.decision).not.toBe("reject");
		} finally {
			delete process.env.GOSSIP_MIN_BODY_LEN;
		}
	});

	it("from-url：成功入池带 verification + contentFingerprint(U3)", async () => {
		process.env.LLM_ENDPOINT = "https://api.test";
		process.env.LLM_API_KEY = "test-key";
		mockFetchContent.mockResolvedValueOnce({
			title: "文章",
			body: LONG_BODY,
			url: "https://gossip.com/v1",
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
			confidence: 0.6,
			extractionMode: "strict",
		});
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/gossip/topics/from-url",
			payload: { url: "https://gossip.com/v1", siteName: "站" },
		});
		expect(res.statusCode).toBe(201);
		const topic = res.json().topic;
		expect(topic.verification).toBeDefined();
		expect(topic.verification.decision).toBeDefined();
		expect(topic.contentFingerprint).toBeTruthy();
	});

	it("from-url：内容指纹命中(不同 URL 同 facts) → 第二条软标 suspectedDuplicate 入池(U3)", async () => {
		process.env.LLM_ENDPOINT = "https://api.test";
		process.env.LLM_API_KEY = "test-key";
		const facts = {
			當事人: "A",
			事件摘要: "test",
			起因: null,
			經過: null,
			結果: null,
			來源連結: null,
			發生時間: null,
			熱度標籤: null,
		};
		mockFetchContent.mockResolvedValueOnce({
			title: "文章1",
			body: LONG_BODY,
			url: "https://gossip.com/dup1",
		});
		mockGossipExtractFacts.mockResolvedValueOnce({
			facts,
			confidence: 0.6,
			extractionMode: "strict",
		});
		const first = await app.inject({
			method: "POST",
			url: "/api/v1/gossip/topics/from-url",
			payload: { url: "https://gossip.com/dup1", siteName: "站" },
		});
		expect(first.statusCode).toBe(201);

		// 不同 URL、同 facts → 同内容指纹 → 软标 suspectedDuplicate(非 409,因 URL 不同)
		mockFetchContent.mockResolvedValueOnce({
			title: "文章2",
			body: LONG_BODY,
			url: "https://gossip.com/dup2",
		});
		mockGossipExtractFacts.mockResolvedValueOnce({
			facts,
			confidence: 0.6,
			extractionMode: "strict",
		});
		const second = await app.inject({
			method: "POST",
			url: "/api/v1/gossip/topics/from-url",
			payload: { url: "https://gossip.com/dup2", siteName: "站" },
		});
		expect(second.statusCode).toBe(201);
		expect(second.json().topic.verification.suspectedDuplicate).toBe(true);
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
			body: LONG_BODY,
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
			body: LONG_BODY,
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
	counters.gossipVerify.skippedOld = 0;
	counters.gossipVerify.rejected = 0;
	counters.gossipVerify.flagged = 0;
	counters.gossipVerify.suspectedDuplicate = 0;
}

function gossipVerifyCount(metricsText: string, outcome: string): number {
	const re = new RegExp(
		`guapi_gossip_verify_total\\{outcome="${outcome}"\\}\\s+(\\d+)`,
	);
	const m = metricsText.match(re);
	return m ? Number(m[1]) : -1;
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
		/guapi_scraper_runs_total\{status="success"\}\s+(\d+)/,
	);
	return m ? Number(m[1]) : -1;
}
function scraperFailedCount(metricsText: string): number {
	const m = metricsText.match(
		/guapi_scraper_runs_total\{status="failed"\}\s+(\d+)/,
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
			body: LONG_BODY,
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
			body: LONG_BODY,
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
			body: LONG_BODY,
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

	it("窗外跳过 → gossip_verify skipped_old +1", async () => {
		mockFetchContent.mockResolvedValueOnce({
			title: "旧瓜",
			body: LONG_BODY,
			url: "https://gossip.com/m-old",
			metadata: { publishedTime: "2020-01-01T00:00:00.000Z" },
		});
		await app.inject({
			method: "POST",
			url: "/api/v1/gossip/topics/from-url",
			payload: {
				url: "https://gossip.com/m-old",
				siteName: "站",
				windowDays: 7,
			},
		});
		const res = await app.inject({ method: "GET", url: "/api/v1/metrics" });
		expect(gossipVerifyCount(res.body, "skipped_old")).toBe(1);
	});

	it("无效内容硬拒 → gossip_verify rejected +1", async () => {
		mockFetchContent.mockResolvedValueOnce({
			title: "无效",
			body: "短",
			url: "https://gossip.com/m-bad",
		});
		mockGossipExtractFacts.mockResolvedValueOnce(MOCK_FACTS);
		await app.inject({
			method: "POST",
			url: "/api/v1/gossip/topics/from-url",
			payload: { url: "https://gossip.com/m-bad", siteName: "站" },
		});
		const res = await app.inject({ method: "GET", url: "/api/v1/metrics" });
		expect(gossipVerifyCount(res.body, "rejected")).toBe(1);
	});

	it("跨 URL 同内容 → gossip_verify suspected_duplicate +1", async () => {
		// 用本用例独有 facts:metrics 块 beforeEach 只重置计数、不清 pending 表(DB 文件跨用例持久),
		// 复用 MOCK_FACTS 会撞到前面用例已存的指纹,使首次调用即判重复。独有 facts 保证首次不撞库。
		const uniqueFacts = {
			...MOCK_FACTS,
			facts: {
				...MOCK_FACTS.facts,
				當事人: "DUPTEST-唯一",
				事件摘要: "唯一摘要",
			},
		};
		for (const u of ["https://gossip.com/m-d1", "https://gossip.com/m-d2"]) {
			mockFetchContent.mockResolvedValueOnce({
				title: "同瓜",
				body: LONG_BODY,
				url: u,
			});
			mockGossipExtractFacts.mockResolvedValueOnce(uniqueFacts);
		}
		await app.inject({
			method: "POST",
			url: "/api/v1/gossip/topics/from-url",
			payload: { url: "https://gossip.com/m-d1", siteName: "站" },
		});
		await app.inject({
			method: "POST",
			url: "/api/v1/gossip/topics/from-url",
			payload: { url: "https://gossip.com/m-d2", siteName: "站" },
		});
		const res = await app.inject({ method: "GET", url: "/api/v1/metrics" });
		expect(gossipVerifyCount(res.body, "suspected_duplicate")).toBe(1);
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
