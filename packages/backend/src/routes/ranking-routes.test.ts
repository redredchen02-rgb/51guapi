import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerRankingRoutes } from "./ranking-routes.js";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("../services/ranking-service.js", () => ({
	getRankedList: vi.fn(),
}));
vi.mock("../scraper/hot-search/hot-search-aggregator.js", () => ({
	scrapeAllPlatforms: vi.fn(),
}));
vi.mock("../scraper/gossip-site-store.js", () => ({
	listGossipSites: vi.fn(),
}));
vi.mock("../scraper/adapters/generic-adapter.js", () => ({
	fetchListPaged: vi.fn(),
}));
vi.mock("../scraper/channel-store.js", () => ({
	getChannelByHostname: vi.fn(),
}));
vi.mock("../scraper/pending-store.js", () => ({
	loadPendingTopic: vi.fn(),
	pendingTopicsExistingBySourceUrls: vi.fn(),
	savePendingTopic: vi.fn(),
	updatePendingTopicStatus: vi.fn(),
}));
vi.mock("../scraper/ranking-blacklist-store.js", () => ({
	addToBlacklist: vi.fn(),
}));
vi.mock("../services/draft-article-gen.js", () => ({
	generateArticleDraft: vi.fn(),
}));

// ─── Imports after mock setup ────────────────────────────────────────────────

import { fetchListPaged } from "../scraper/adapters/generic-adapter.js";
import { listGossipSites } from "../scraper/gossip-site-store.js";
import { scrapeAllPlatforms } from "../scraper/hot-search/hot-search-aggregator.js";
import {
	loadPendingTopic,
	pendingTopicsExistingBySourceUrls,
	savePendingTopic,
	updatePendingTopicStatus,
} from "../scraper/pending-store.js";
import { addToBlacklist } from "../scraper/ranking-blacklist-store.js";
import { generateArticleDraft } from "../services/draft-article-gen.js";
import { getRankedList } from "../services/ranking-service.js";

const mockGetRankedList = vi.mocked(getRankedList);
const mockScrapeAll = vi.mocked(scrapeAllPlatforms);
const mockListSites = vi.mocked(listGossipSites);
const mockFetchListPaged = vi.mocked(fetchListPaged);
const mockLoadTopic = vi.mocked(loadPendingTopic);
const mockSaveTopic = vi.mocked(savePendingTopic);
const mockUpdateStatus = vi.mocked(updatePendingTopicStatus);
const mockExistingUrls = vi.mocked(pendingTopicsExistingBySourceUrls);
const mockAddBlacklist = vi.mocked(addToBlacklist);
const mockGenArticle = vi.mocked(generateArticleDraft);

// ─── Test app factory ────────────────────────────────────────────────────────

function buildApp(): FastifyInstance {
	const app = Fastify({ logger: false });
	registerRankingRoutes(app);
	return app;
}

const EMPTY_RANKED = {
	sectionA: [],
	sectionB: [],
	freshAt: new Date().toISOString(),
};

const GOSSIP_FACTS = {
	當事人: "章子怡",
	事件摘要: "分居傳聞",
	起因: null,
	經過: null,
	結果: null,
	來源連結: "https://example.com/1",
	發生時間: null,
	熱度標籤: null,
};

const TOPIC_BASE = {
	id: "t1",
	sourceUrl: "https://example.com/1",
	siteName: "test",
	title: "章子怡分居疑雲",
	facts: GOSSIP_FACTS,
	confidence: 0.8,
	status: "pending" as const,
	domain: "gossip" as const,
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
};

const ARTICLE_MOCK = {
	ok: true,
	draft: {
		id: "art1",
		title: "章子怡",
		subtitle: "",
		category: "gossip",
		coverImageUrl: "",
		body: "...",
		tags: [],
		description: "",
		status: "draft",
		createdAt: new Date().toISOString(),
	},
};

function setLlmConfig() {
	process.env.LLM_API_KEY = "test-key";
	process.env.LLM_ENDPOINT = "https://llm.example.com/v1";
	process.env.LLM_MODEL = "test-model";
}

function clearLlmConfig() {
	delete process.env.LLM_API_KEY;
	delete process.env.LLM_ENDPOINT;
	delete process.env.LLM_MODEL;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("registerRankingRoutes", () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		vi.clearAllMocks();
		clearLlmConfig();
		app = buildApp();
		await app.ready();
	});

	afterEach(async () => {
		await app.close();
	});

	// ── GET /api/v1/ranking ──────────────────────────────────────────────────

	describe("GET /api/v1/ranking", () => {
		it("回傳 getRankedList 結果", async () => {
			mockGetRankedList.mockResolvedValueOnce(EMPTY_RANKED as never);
			const res = await app.inject({ method: "GET", url: "/api/v1/ranking" });
			expect(res.statusCode).toBe(200);
			expect(res.json().ok).toBe(true);
			expect(res.json().sectionA).toEqual([]);
			expect(mockGetRankedList).toHaveBeenCalledOnce();
		});
	});

	// ── POST /api/v1/ranking/scrape ──────────────────────────────────────────

	describe("POST /api/v1/ranking/scrape", () => {
		it("無站點、熱搜成功 → ok=true topicsDiscovered=0", async () => {
			mockScrapeAll.mockResolvedValueOnce({
				baidu: 3,
				weibo: 2,
				douyin: 0,
				total: 5,
				errors: [],
			} as never);
			mockListSites.mockResolvedValueOnce([] as never);

			const res = await app.inject({
				method: "POST",
				url: "/api/v1/ranking/scrape",
			});
			expect(res.statusCode).toBe(200);
			expect(res.json().ok).toBe(true);
			expect(res.json().hotKeywordsCount).toBe(5);
			expect(res.json().topicsDiscovered).toBe(0);
		});

		it("熱搜 throw → errors 含錯誤訊息，不崩潰", async () => {
			mockScrapeAll.mockRejectedValueOnce(new Error("network error") as never);
			mockListSites.mockResolvedValueOnce([] as never);

			const res = await app.inject({
				method: "POST",
				url: "/api/v1/ranking/scrape",
			});
			expect(res.statusCode).toBe(200);
			expect(
				res.json().errors.some((e: string) => e.includes("hot-search")),
			).toBe(true);
		});

		it("站點 discover → 新 URL 存入 pending，topicsDiscovered+1", async () => {
			mockScrapeAll.mockResolvedValueOnce({
				baidu: 0,
				weibo: 0,
				douyin: 0,
				total: 0,
				errors: [],
			} as never);
			mockListSites.mockResolvedValueOnce([
				{
					name: "site-a",
					listUrl: "https://site-a.example.com/list",
					enabled: true,
				},
			] as never);
			mockFetchListPaged.mockResolvedValueOnce([
				{ url: "https://site-a.example.com/article/1", title: "新話題" },
			] as never);
			mockExistingUrls.mockReturnValueOnce(new Set());
			mockSaveTopic.mockResolvedValueOnce({ inserted: true } as never);

			const res = await app.inject({
				method: "POST",
				url: "/api/v1/ranking/scrape",
			});
			expect(res.statusCode).toBe(200);
			expect(res.json().topicsDiscovered).toBe(1);
			expect(mockSaveTopic).toHaveBeenCalledOnce();
		});

		it("URL 已存在 → inserted=false，topicsDiscovered 不增加", async () => {
			mockScrapeAll.mockResolvedValueOnce({
				baidu: 0,
				weibo: 0,
				douyin: 0,
				total: 0,
				errors: [],
			} as never);
			mockListSites.mockResolvedValueOnce([
				{
					name: "site-b",
					listUrl: "https://site-b.example.com/list",
					enabled: true,
				},
			] as never);
			mockFetchListPaged.mockResolvedValueOnce([
				{ url: "https://site-b.example.com/old", title: "舊話題" },
			] as never);
			mockExistingUrls.mockReturnValueOnce(
				new Set(["https://site-b.example.com/old"]),
			);

			const res = await app.inject({
				method: "POST",
				url: "/api/v1/ranking/scrape",
			});
			expect(res.json().topicsDiscovered).toBe(0);
			expect(mockSaveTopic).not.toHaveBeenCalled();
		});

		it("站點 disabled → 跳過，不爬取", async () => {
			mockScrapeAll.mockResolvedValueOnce({
				baidu: 0,
				weibo: 0,
				douyin: 0,
				total: 0,
				errors: [],
			} as never);
			mockListSites.mockResolvedValueOnce([
				{
					name: "off",
					listUrl: "https://off.example.com/list",
					enabled: false,
				},
			] as never);

			const res = await app.inject({
				method: "POST",
				url: "/api/v1/ranking/scrape",
			});
			expect(res.statusCode).toBe(200);
			expect(mockFetchListPaged).not.toHaveBeenCalled();
		});
	});

	// ── POST /api/v1/ranking/hide ────────────────────────────────────────────

	describe("POST /api/v1/ranking/hide", () => {
		it("valid keyword → 200 ok=true，addToBlacklist 被呼叫", async () => {
			const res = await app.inject({
				method: "POST",
				url: "/api/v1/ranking/hide",
				payload: { keyword: "王力宏" },
			});
			expect(res.statusCode).toBe(200);
			expect(res.json().ok).toBe(true);
			expect(mockAddBlacklist).toHaveBeenCalledWith("王力宏");
		});

		it("missing keyword → 400", async () => {
			const res = await app.inject({
				method: "POST",
				url: "/api/v1/ranking/hide",
				payload: {},
			});
			expect(res.statusCode).toBe(400);
		});
	});

	// ── POST /api/v1/ranking/generate-draft/:topicId ─────────────────────────

	describe("POST /api/v1/ranking/generate-draft/:topicId", () => {
		it("topic 不存在 → 404", async () => {
			mockLoadTopic.mockResolvedValueOnce(null as never);
			const res = await app.inject({
				method: "POST",
				url: "/api/v1/ranking/generate-draft/missing",
			});
			expect(res.statusCode).toBe(404);
		});

		it("domain 非 gossip → 400", async () => {
			mockLoadTopic.mockResolvedValueOnce({
				...TOPIC_BASE,
				domain: "acg",
			} as never);
			const res = await app.inject({
				method: "POST",
				url: "/api/v1/ranking/generate-draft/t1",
			});
			expect(res.statusCode).toBe(400);
		});

		it("facts 不是 GossipFactsBlock → 400", async () => {
			mockLoadTopic.mockResolvedValueOnce({
				...TOPIC_BASE,
				facts: { title: "no 當事人 key" },
			} as never);
			const res = await app.inject({
				method: "POST",
				url: "/api/v1/ranking/generate-draft/t1",
			});
			expect(res.statusCode).toBe(400);
		});

		it("status=pending → 自動 approve，然後生成草稿", async () => {
			setLlmConfig();
			mockLoadTopic.mockResolvedValueOnce({
				...TOPIC_BASE,
				status: "pending",
			} as never);
			mockUpdateStatus.mockResolvedValueOnce({
				...TOPIC_BASE,
				status: "approved",
			} as never);
			mockGenArticle.mockResolvedValueOnce(ARTICLE_MOCK as never);

			const res = await app.inject({
				method: "POST",
				url: "/api/v1/ranking/generate-draft/t1",
			});
			expect(res.statusCode).toBe(200);
			expect(mockUpdateStatus).toHaveBeenCalledWith("t1", "approved");
		});

		it("status=rejected → 400", async () => {
			mockLoadTopic.mockResolvedValueOnce({
				...TOPIC_BASE,
				status: "rejected",
			} as never);
			const res = await app.inject({
				method: "POST",
				url: "/api/v1/ranking/generate-draft/t1",
			});
			expect(res.statusCode).toBe(400);
			expect(res.json().error).toContain("拒絕");
		});

		it("status=approved → 不呼叫 updateStatus，直接生成", async () => {
			setLlmConfig();
			mockLoadTopic.mockResolvedValueOnce({
				...TOPIC_BASE,
				status: "approved",
			} as never);
			mockGenArticle.mockResolvedValueOnce(ARTICLE_MOCK as never);

			const res = await app.inject({
				method: "POST",
				url: "/api/v1/ranking/generate-draft/t1",
			});
			expect(res.statusCode).toBe(200);
			expect(mockUpdateStatus).not.toHaveBeenCalled();
		});

		it("無 LLM 配置 → 500 kind=no-key", async () => {
			mockLoadTopic.mockResolvedValueOnce({
				...TOPIC_BASE,
				status: "approved",
			} as never);
			// clearLlmConfig 已在 beforeEach 執行
			const res = await app.inject({
				method: "POST",
				url: "/api/v1/ranking/generate-draft/t1",
			});
			expect(res.statusCode).toBe(500);
			expect(res.json().kind).toBe("no-key");
		});

		it("generateArticleDraft ok=false → 422", async () => {
			setLlmConfig();
			mockLoadTopic.mockResolvedValueOnce({
				...TOPIC_BASE,
				status: "approved",
			} as never);
			mockGenArticle.mockResolvedValueOnce({
				ok: false,
				error: "LLM failed",
				kind: "network",
			} as never);

			const res = await app.inject({
				method: "POST",
				url: "/api/v1/ranking/generate-draft/t1",
			});
			expect(res.statusCode).toBe(422);
			expect(res.json().kind).toBe("network");
		});

		it("generateArticleDraft throw → 500 (catch block)", async () => {
			setLlmConfig();
			mockLoadTopic.mockResolvedValueOnce({
				...TOPIC_BASE,
				status: "approved",
			} as never);
			mockGenArticle.mockRejectedValueOnce(new Error("boom") as never);

			const res = await app.inject({
				method: "POST",
				url: "/api/v1/ranking/generate-draft/t1",
			});
			expect(res.statusCode).toBe(500);
			expect(res.json().kind).toBe("network");
		});
	});

	// ── 缺少覆蓋的分支 (lines 38, 51, 87-88) ─────────────────────────────────

	describe("POST /api/v1/ranking/scrape — 缺少覆蓋分支", () => {
		it("listGossipSites 拋錯 → catch 回傳 [] → scrape 照常完成 (line 38)", async () => {
			mockScrapeAll.mockResolvedValueOnce({
				baidu: 0,
				weibo: 0,
				douyin: 0,
				total: 0,
				errors: [],
			} as never);
			mockListSites.mockRejectedValueOnce(new Error("DB error") as never);

			const res = await app.inject({
				method: "POST",
				url: "/api/v1/ranking/scrape",
			});
			expect(res.statusCode).toBe(200);
			expect(res.json().topicsDiscovered).toBe(0);
		});

		it("site.listUrl 非法 URL → maxPages=1 的 catch 分支 (line 51)", async () => {
			mockScrapeAll.mockResolvedValueOnce({
				baidu: 0,
				weibo: 0,
				douyin: 0,
				total: 0,
				errors: [],
			} as never);
			mockListSites.mockResolvedValueOnce([
				{
					id: "bad-url",
					name: "bad-site",
					listUrl: "not-a-valid-url",
					enabled: true,
				},
			] as never);
			mockFetchListPaged.mockResolvedValueOnce([] as never);
			mockExistingUrls.mockReturnValueOnce(new Set());

			const res = await app.inject({
				method: "POST",
				url: "/api/v1/ranking/scrape",
			});
			expect(res.statusCode).toBe(200);
			expect(mockFetchListPaged).toHaveBeenCalledWith("not-a-valid-url", 1);
		});

		it("site discover 拋錯 → errors 含站點名稱，不崩潰 (lines 87-88)", async () => {
			mockScrapeAll.mockResolvedValueOnce({
				baidu: 0,
				weibo: 0,
				douyin: 0,
				total: 0,
				errors: [],
			} as never);
			mockListSites.mockResolvedValueOnce([
				{
					id: "err-site",
					name: "err-site",
					listUrl: "https://err.example.com/list",
					enabled: true,
				},
			] as never);
			mockFetchListPaged.mockRejectedValueOnce(
				new Error("network timeout") as never,
			);

			const res = await app.inject({
				method: "POST",
				url: "/api/v1/ranking/scrape",
			});
			expect(res.statusCode).toBe(200);
			expect(
				res.json().errors.some((e: string) => e.includes("err-site")),
			).toBe(true);
		});
	});
});
