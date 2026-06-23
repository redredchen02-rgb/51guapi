import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { savePendingTopic } from "../scraper/pending-store.js";
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
			payload: { siteName: "no-such-site", legacy: "acg" },
		});
		expect(res.statusCode).toBe(404);
	});

	it("未显式 legacy:acg → 410，避免当前吃瓜流程误用旧 FactsBlock 管线", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/scraper/trigger",
			payload: { siteName: siteName() },
		});
		expect(res.statusCode).toBe(410);
		expect(res.json()).toMatchObject({
			kind: "legacy-acg-disabled",
		});
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
			payload: { siteName: "disabled-site", legacy: "acg" },
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
				legacy: "acg",
				url: "https://test-site.example.com/article/999",
			},
		});
		// 主机名一致，SSRF 检查通过；extractFacts 已 mock，应成功返回 200
		expect(res.statusCode).toBe(200);
		expect(res.json().ok).toBe(true);
		expect(vi.mocked(savePendingTopic).mock.calls.at(-1)?.[0]).toMatchObject({
			domain: "acg",
		});
		delete process.env.LLM_ENDPOINT;
		delete process.env.LLM_API_KEY;
	});

	it("url 主机名与配置主机名不同 → 400 (SSRF blocked)", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/scraper/trigger",
			payload: {
				siteName: siteName(),
				legacy: "acg",
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
				legacy: "acg",
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
				legacy: "acg",
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
				legacy: "acg",
				url: "http://test-site.example.com/article/1",
			},
		});
		expect(res.statusCode).toBe(400);
		expect(res.json().error).toMatch(/protocol not allowed/i);
	});
});

// ================================================================
// 统一出站闸：config.url / discovery pick 来源也复检（A6-R3）
// ================================================================

describe("POST /api/v1/scraper/trigger — 统一出站闸（IP 字面 + allowlist 复检）", () => {
	it("config.url 为 IP 字面 → 403（即便该 IP 在 allowlist 内，IP-literal 仍被输入层拒）", async () => {
		// allowlist 显式放行该 IP，证明拒绝来自 IP-literal 闸而非 allowlist。
		process.env.ALLOWED_HOSTS = "https://198.51.100.7";
		scraperConfig.registerAdapter(makeMockAdapter("adapter-ipliteral"));
		scraperConfig.addSiteConfig({
			siteName: "ipliteral-site",
			adapterName: "adapter-ipliteral",
			url: "https://198.51.100.7",
			cron: "0 * * * *",
			enabled: true,
		});
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/scraper/trigger",
			payload: { siteName: "ipliteral-site", legacy: "acg" },
		});
		expect(res.statusCode).toBe(403);
		expect(res.json().error).toMatch(/IP literal/i);
	});

	it("config.url 不在 allowlist → 403（此前走 config.url 退路不复检 allowlist 的缺口）", async () => {
		process.env.ALLOWED_HOSTS = "https://*.example.com";
		scraperConfig.registerAdapter(makeMockAdapter("adapter-blocked"));
		scraperConfig.addSiteConfig({
			siteName: "blocked-site",
			adapterName: "adapter-blocked",
			url: "https://not-allowed.test",
			cron: "0 * * * *",
			enabled: true,
		});
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/scraper/trigger",
			payload: { siteName: "blocked-site", legacy: "acg" },
		});
		expect(res.statusCode).toBe(403);
		expect(res.json().error).toMatch(/blocked by SSRF allowlist/i);
	});

	it("config.url 在 allowlist 且非 IP → 过闸（到 LLM env 检查才 500，证非被出站闸拦）", async () => {
		process.env.ALLOWED_HOSTS = "https://*.example.com";
		const saved = {
			ep: process.env.LLM_ENDPOINT,
			key: process.env.LLM_API_KEY,
		};
		delete process.env.LLM_ENDPOINT;
		delete process.env.LLM_API_KEY;
		// 默认 beforeEach 注册的站点 config.url = https://test-site.example.com（在 allowlist）。
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/scraper/trigger",
			payload: { siteName: siteName(), legacy: "acg" },
		});
		// 过了出站闸 → 走到 LLM 检查 → 500（而非 403）。
		expect(res.statusCode).toBe(500);
		expect(res.json().error).toMatch(/LLM_ENDPOINT/);
		if (saved.ep) process.env.LLM_ENDPOINT = saved.ep;
		if (saved.key) process.env.LLM_API_KEY = saved.key;
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
			payload: { siteName: siteName(), legacy: "acg" },
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

describe("POST /api/v1/scraper/auto-generate — legacy gate", () => {
	it("未显式 legacy:acg → 410，避免当前吃瓜流程误用旧批量生成", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/scraper/auto-generate",
			payload: {},
		});
		expect(res.statusCode).toBe(410);
		expect(res.json()).toMatchObject({
			kind: "legacy-acg-disabled",
		});
	});
});

