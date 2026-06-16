import { randomBytes } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PUBLIC_ROUTES, requireAuth } from "../middleware/auth-middleware.js";
import { scraperConfig } from "../scraper/scraper-config.js";
import type { RawContent, SiteAdapter } from "../scraper/site-adapter.js";
import { registerScraperRoutes } from "./scraper-routes.js";

// ---- mocks ----

vi.mock("../scraper/fact-extractor.js", () => ({
	extractFacts: vi.fn(async () => ({
		facts: { 作品名: "测试作品" },
		confidence: 0.85,
		coverImageUrl: undefined,
		extractionMode: "strict" as const,
	})),
}));

vi.mock("../scraper/pending-store.js", () => ({
	savePendingTopic: vi.fn(async () => undefined),
}));

vi.mock("../scraper/web-enricher.js", () => ({
	enrichContext: vi.fn(async () => ({ queryResults: [] })),
}));

// ---- helpers ----

const MOCK_RAW: RawContent = {
	title: "测试文章",
	body: "正文内容",
	url: "https://test-site.example.com/article/1",
};

function makeMockAdapter(name: string): SiteAdapter {
	return {
		name,
		fetchContent: vi.fn(async (_url: string): Promise<RawContent> => MOCK_RAW),
	};
}

async function buildApp(): Promise<FastifyInstance> {
	const app = Fastify({ logger: false });
	await registerScraperRoutes(app);
	await app.ready();
	return app;
}

// ---- test setup ----

let app: FastifyInstance;

// 每组测试使用不同的 siteName 前缀避免 singleton 污染
let testId = 0;
function siteName() {
	return `test-site-${testId}`;
}

beforeEach(async () => {
	testId++;
	process.env.ALLOWED_HOSTS = "https://*.example.com";
	app = await buildApp();
	// 注册一个启用的测试站点
	scraperConfig.registerAdapter(makeMockAdapter(`adapter-${testId}`));
	scraperConfig.addSiteConfig({
		siteName: siteName(),
		adapterName: `adapter-${testId}`,
		url: `https://test-site.example.com`,
		cron: "0 * * * *",
		enabled: true,
	});
});

afterEach(async () => {
	await app.close();
	vi.clearAllMocks();
	delete process.env.ALLOWED_HOSTS;
});

// ================================================================
// 路由校验
// ================================================================

describe("POST /api/v1/scraper/trigger — validation", () => {
	it("缺少 siteName → 400", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/scraper/trigger",
			payload: {},
		});
		expect(res.statusCode).toBe(400);
		// TypeBox schema validation rejects empty body before handler
		expect(res.json().message).toMatch(/siteName/);
	});

	it("未知 siteName → 404", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/scraper/trigger",
			payload: { siteName: "no-such-site" },
		});
		expect(res.statusCode).toBe(404);
	});

	it("禁用站点 → 404", async () => {
		scraperConfig.registerAdapter(makeMockAdapter("adapter-disabled"));
		scraperConfig.addSiteConfig({
			siteName: "disabled-site",
			adapterName: "adapter-disabled",
			url: "https://disabled.example.com",
			cron: "0 * * * *",
			enabled: false,
		});
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/scraper/trigger",
			payload: { siteName: "disabled-site" },
		});
		expect(res.statusCode).toBe(404);
	});
});

// ================================================================
// SSRF allowlist
// ================================================================

describe("POST /api/v1/scraper/trigger — SSRF allowlist", () => {
	it("url 主机名与配置主机名相同 → 允许进入后续流程（非 400）", async () => {
		process.env.LLM_ENDPOINT = "https://api.openai.com";
		process.env.LLM_API_KEY = "test-key";
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/scraper/trigger",
			payload: {
				siteName: siteName(),
				url: "https://test-site.example.com/article/999",
			},
		});
		// 主机名一致，SSRF 检查通过；extractFacts 已 mock，应成功返回 200
		expect(res.statusCode).toBe(200);
		expect(res.json().ok).toBe(true);
		delete process.env.LLM_ENDPOINT;
		delete process.env.LLM_API_KEY;
	});

	it("url 主机名与配置主机名不同 → 400 (SSRF blocked)", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/scraper/trigger",
			payload: {
				siteName: siteName(),
				url: "https://evil.attacker.com/malicious",
			},
		});
		expect(res.statusCode).toBe(400);
		expect(res.json().error).toMatch(/hostname not allowed/i);
	});

	it("url 格式无效 → 400", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/scraper/trigger",
			payload: {
				siteName: siteName(),
				url: "not-a-valid-url",
			},
		});
		expect(res.statusCode).toBe(400);
		expect(res.json().error).toMatch(/Invalid URL/i);
	});

	it("url 含 credentials（http://evil@host/）→ 400 (SSRF credentials blocked)", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/scraper/trigger",
			payload: {
				siteName: siteName(),
				url: "https://evil.com@test-site.example.com/path",
			},
		});
		expect(res.statusCode).toBe(400);
		expect(res.json().error).toMatch(/credentials not allowed/i);
	});

	it("url 协议与配置不同（http vs https）→ 400", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/scraper/trigger",
			payload: {
				siteName: siteName(),
				url: "http://test-site.example.com/article/1",
			},
		});
		expect(res.statusCode).toBe(400);
		expect(res.json().error).toMatch(/protocol not allowed/i);
	});
});

// ================================================================
// 环境变量缺失
// ================================================================

describe("POST /api/v1/scraper/trigger — env checks", () => {
	it("LLM_ENDPOINT / LLM_API_KEY 未设置 → 500", async () => {
		const saved = {
			ep: process.env.LLM_ENDPOINT,
			key: process.env.LLM_API_KEY,
		};
		delete process.env.LLM_ENDPOINT;
		delete process.env.LLM_API_KEY;

		const res = await app.inject({
			method: "POST",
			url: "/api/v1/scraper/trigger",
			payload: { siteName: siteName() },
		});
		expect(res.statusCode).toBe(500);
		expect(res.json().error).toMatch(/LLM_ENDPOINT/);

		if (saved.ep) process.env.LLM_ENDPOINT = saved.ep;
		if (saved.key) process.env.LLM_API_KEY = saved.key;
	});
});

// ================================================================
// GET /api/v1/scraper/adapters
// ================================================================

describe("GET /api/v1/scraper/adapters", () => {
	it("返回已注册适配器列表", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/api/v1/scraper/adapters",
		});
		expect(res.statusCode).toBe(200);
		expect(res.json().ok).toBe(true);
		const names = (res.json().adapters as { name: string }[]).map(
			(a) => a.name,
		);
		expect(names).toContain(`adapter-${testId}`);
	});
});

// ---- JWT 401 守護 ----

const SCRAPER_SECRET = randomBytes(48).toString("hex");

async function buildScraperAppWithAuth(): Promise<FastifyInstance> {
	const app = Fastify({ logger: false });
	app.addHook("preHandler", async (request, reply) => {
		const url = request.url.split("?")[0];
		if (PUBLIC_ROUTES.has(url)) return;
		return requireAuth(request, reply);
	});
	await registerScraperRoutes(app);
	await app.ready();
	return app;
}

describe("scraper-routes — JWT 守護", () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		process.env.JWT_SECRET = SCRAPER_SECRET;
		app = await buildScraperAppWithAuth();
	});

	afterEach(async () => {
		await app.close();
		delete process.env.JWT_SECRET;
	});

	it("無 token → POST /api/v1/scraper/trigger 返回 401", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/scraper/trigger",
			payload: { url: "https://t.com/a", siteName: "s" },
		});
		expect(res.statusCode).toBe(401);
	});

	it("無 token → GET /api/v1/scraper/adapters 返回 401", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/api/v1/scraper/adapters",
		});
		expect(res.statusCode).toBe(401);
	});
});
