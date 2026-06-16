import { randomBytes } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

// LLM 服务被 mock，使 draft 路由的 happy/error 路径可控（不发真请求）。
vi.mock("./services/llm.js", () => ({
	generateDraft: vi.fn(),
	listModels: vi.fn(),
	reviewDraftLlm: vi.fn(),
	rewriteDraftLlm: vi.fn(),
}));

// 后台任务被 mock 为 no-op，避免 startBackgroundJobs 启动真实 cron/timer 泄漏 handle。
// 保留 scheduler.js 的其余真实导出（healthz 读取真实的 jobs 集合）。
vi.mock("./scraper/scheduler.js", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("./scraper/scheduler.js")>();
	return { ...actual, startScheduler: vi.fn() };
});
vi.mock("./services/revisit-job.js", () => ({ startRevisitJob: vi.fn() }));

import { buildApp, registerDraftRoutes, startBackgroundJobs } from "./app.js";
import { resetPendingDb } from "./scraper/pending-db.js";
import {
	generateDraft,
	listModels,
	reviewDraftLlm,
	rewriteDraftLlm,
} from "./services/llm.js";

const mockGenerate = vi.mocked(generateDraft);
const mockListModels = vi.mocked(listModels);
const mockReview = vi.mocked(reviewDraftLlm);
const mockRewrite = vi.mocked(rewriteDraftLlm);

const SAVED = {
	key: process.env.LLM_API_KEY,
	endpoint: process.env.LLM_ENDPOINT,
	model: process.env.LLM_MODEL,
};

function clearConfig() {
	delete process.env.LLM_API_KEY;
	delete process.env.LLM_ENDPOINT;
	delete process.env.LLM_MODEL;
}

function setConfig() {
	process.env.LLM_API_KEY = "test-key";
	process.env.LLM_ENDPOINT = "https://llm.example.com/v1";
	process.env.LLM_MODEL = "test-model";
}

afterAll(() => {
	for (const [k, v] of [
		["LLM_API_KEY", SAVED.key],
		["LLM_ENDPOINT", SAVED.endpoint],
		["LLM_MODEL", SAVED.model],
	] as const) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
});

// ================================================================
// buildApp — 整个应用组合根
// ================================================================

describe("buildApp", () => {
	let app: FastifyInstance;
	const SECRET = randomBytes(48).toString("hex");
	const prevSecret = process.env.JWT_SECRET;

	function validToken(): string {
		return jwt.sign({}, SECRET, { algorithm: "HS256", expiresIn: "1h" });
	}

	beforeAll(async () => {
		process.env.JWT_SECRET = SECRET;
		app = buildApp();
		await app.ready();
	});

	afterAll(async () => {
		await app.close();
		resetPendingDb(); // 关闭 buildApp 打开的 SQLite 句柄(app.ts 无 onClose hook)
		if (prevSecret === undefined) delete process.env.JWT_SECRET;
		else process.env.JWT_SECRET = prevSecret;
	});

	it("GET /api/v1/healthz（公开路由）→ 200，返回健康结构", async () => {
		const res = await app.inject({ method: "GET", url: "/api/v1/healthz" });
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.ok).toBe(true);
		expect(typeof body.uptime).toBe("number");
		expect(body.scheduler).toHaveProperty("jobCount");
		expect(body.database).toHaveProperty("healthy");
		expect(body.memory).toHaveProperty("heapUsed");
		expect(body.quality).toBeDefined();
	});

	it("GET /api/v1/metrics 无 token → 401（preHandler 全局生效，metrics 不在白名单）", async () => {
		const res = await app.inject({ method: "GET", url: "/api/v1/metrics" });
		expect(res.statusCode).toBe(401);
	});

	it("GET /api/v1/metrics 带合法 token → 200，Prometheus 文本", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/api/v1/metrics",
			headers: { authorization: `Bearer ${validToken()}` },
		});
		expect(res.statusCode).toBe(200);
		expect(res.headers["content-type"]).toContain("text/plain");
		expect(res.body).toContain("publisher_drafts_total");
	});

	it("受保护路由无 token → 401", async () => {
		const res = await app.inject({ method: "GET", url: "/api/v1/prompts" });
		expect(res.statusCode).toBe(401);
	});

	it("受保护路由带合法 token → 非 401（通过鉴权 hook）", async () => {
		const res = await app.inject({
			method: "GET",
			url: "/api/v1/prompts",
			headers: { authorization: `Bearer ${validToken()}` },
		});
		expect(res.statusCode).not.toBe(401);
	});

	it("OpenAPI 文档已注册（带 token → 200 且返回 spec）", async () => {
		// /docs/json 在全局鉴权闸后(不在 PUBLIC_ROUTES):无 token=401、带 token=200。
		// 断言 200+spec body,才能在 swagger 注册回归(404)时真正失败。
		const res = await app.inject({
			method: "GET",
			url: "/docs/json",
			headers: { authorization: `Bearer ${validToken()}` },
		});
		expect(res.statusCode).toBe(200);
		expect(res.json().info).toBeTruthy();
	});
});

// ================================================================
// registerDraftRoutes — LLM draft 路由
// ================================================================

const DRAFT = {
	id: "d1",
	title: "标题",
	subtitle: "副标题",
	category: "动画",
	coverImageUrl: "",
	body: "正文",
	tags: ["标签"],
	description: "描述",
	postStatus: "",
	publishedAt: "",
	mediaId: "",
	status: "",
	createdAt: "",
};

const SETTINGS = {
	endpoint: "https://llm.example.com/v1",
	model: "test-model",
};

function draftApp(): FastifyInstance {
	const app = Fastify({ logger: false });
	registerDraftRoutes(app);
	return app;
}

describe("registerDraftRoutes", () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		clearConfig();
		vi.clearAllMocks();
		app = draftApp();
		await app.ready();
	});

	afterEach(async () => {
		await app.close();
	});

	// ---- GET /api/v1/models ----

	it("GET /models 无 LLM 配置 → 500", async () => {
		const res = await app.inject({ method: "GET", url: "/api/v1/models" });
		expect(res.statusCode).toBe(500);
	});

	it("GET /models 配置就绪 → 200，透传 listModels 结果", async () => {
		setConfig();
		mockListModels.mockResolvedValueOnce(["m1", "m2"] as never);
		const res = await app.inject({ method: "GET", url: "/api/v1/models" });
		expect(res.statusCode).toBe(200);
		expect(res.json()).toEqual(["m1", "m2"]);
		expect(mockListModels).toHaveBeenCalledWith(
			"https://llm.example.com/v1",
			"test-key",
		);
	});

	it("GET /models 服务抛错 → 500", async () => {
		setConfig();
		mockListModels.mockRejectedValueOnce(new Error("upstream down"));
		const res = await app.inject({ method: "GET", url: "/api/v1/models" });
		expect(res.statusCode).toBe(500);
	});

	// ---- POST /api/v1/drafts/generate ----

	it("POST /drafts/generate 无配置 → 500 kind=no-key", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/drafts/generate",
			payload: { prompt: "写帖", settings: SETTINGS },
		});
		expect(res.statusCode).toBe(500);
		expect(res.json().kind).toBe("no-key");
	});

	it("POST /drafts/generate body 非法（prompt 空）→ 400", async () => {
		setConfig();
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/drafts/generate",
			payload: { prompt: "", settings: SETTINGS },
		});
		expect(res.statusCode).toBe(400);
	});

	it("POST /drafts/generate 成功 → 200，返回 draft", async () => {
		setConfig();
		mockGenerate.mockResolvedValueOnce({ ok: true, draft: DRAFT } as never);
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/drafts/generate",
			payload: { prompt: "写帖", settings: SETTINGS },
		});
		expect(res.statusCode).toBe(200);
		expect(res.json().draft.id).toBe("d1");
	});

	it("POST /drafts/generate 业务失败 ok:false → 422", async () => {
		setConfig();
		mockGenerate.mockResolvedValueOnce({
			ok: false,
			error: "bad",
			kind: "parse",
		} as never);
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/drafts/generate",
			payload: { prompt: "写帖", settings: SETTINGS },
		});
		expect(res.statusCode).toBe(422);
	});

	it("POST /drafts/generate 服务抛错 → 500 kind=network", async () => {
		setConfig();
		mockGenerate.mockRejectedValueOnce(new Error("boom"));
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/drafts/generate",
			payload: { prompt: "写帖", settings: SETTINGS },
		});
		expect(res.statusCode).toBe(500);
		expect(res.json().kind).toBe("network");
	});

	// ---- POST /api/v1/drafts/review ----

	it("POST /drafts/review 无配置 → 500", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/drafts/review",
			payload: { draft: DRAFT, settings: SETTINGS },
		});
		expect(res.statusCode).toBe(500);
	});

	it("POST /drafts/review 成功 → 200", async () => {
		setConfig();
		mockReview.mockResolvedValueOnce({ ok: true, review: {} } as never);
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/drafts/review",
			payload: { draft: DRAFT, criteriaPrompt: "标准", settings: SETTINGS },
		});
		expect(res.statusCode).toBe(200);
	});

	it("POST /drafts/review ok:false → 422", async () => {
		setConfig();
		mockReview.mockResolvedValueOnce({ ok: false, error: "x" } as never);
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/drafts/review",
			payload: { draft: DRAFT, settings: SETTINGS },
		});
		expect(res.statusCode).toBe(422);
	});

	it("POST /drafts/review 抛错 → 500", async () => {
		setConfig();
		mockReview.mockRejectedValueOnce(new Error("rev fail"));
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/drafts/review",
			payload: { draft: DRAFT, settings: SETTINGS },
		});
		expect(res.statusCode).toBe(500);
	});

	// ---- POST /api/v1/drafts/rewrite ----

	it("POST /drafts/rewrite 无配置 → 500", async () => {
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/drafts/rewrite",
			payload: { draft: DRAFT, failedDims: ["逻辑"], settings: SETTINGS },
		});
		expect(res.statusCode).toBe(500);
	});

	it("POST /drafts/rewrite failedDims 为空 → 400", async () => {
		setConfig();
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/drafts/rewrite",
			payload: { draft: DRAFT, failedDims: [], settings: SETTINGS },
		});
		expect(res.statusCode).toBe(400);
	});

	it("POST /drafts/rewrite 成功 → 200", async () => {
		setConfig();
		mockRewrite.mockResolvedValueOnce({ ok: true, draft: DRAFT } as never);
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/drafts/rewrite",
			payload: { draft: DRAFT, failedDims: ["逻辑"], settings: SETTINGS },
		});
		expect(res.statusCode).toBe(200);
	});

	it("POST /drafts/rewrite ok:false → 422", async () => {
		setConfig();
		mockRewrite.mockResolvedValueOnce({ ok: false, error: "x" } as never);
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/drafts/rewrite",
			payload: { draft: DRAFT, failedDims: ["逻辑"], settings: SETTINGS },
		});
		expect(res.statusCode).toBe(422);
	});

	it("POST /drafts/rewrite 抛错 → 500", async () => {
		setConfig();
		mockRewrite.mockRejectedValueOnce(new Error("rw fail"));
		const res = await app.inject({
			method: "POST",
			url: "/api/v1/drafts/rewrite",
			payload: { draft: DRAFT, failedDims: ["逻辑"], settings: SETTINGS },
		});
		expect(res.statusCode).toBe(500);
	});
});

// ================================================================
// startBackgroundJobs — 两条分支
// ================================================================

describe("startBackgroundJobs", () => {
	beforeEach(() => {
		clearConfig();
	});

	function fakeApp() {
		const info = vi.fn();
		return {
			app: { log: { info } } as unknown as FastifyInstance,
			info,
		};
	}

	it("LLM 配置缺失 → 跳过 scheduler（日志含 Skipped），不抛", () => {
		const { app, info } = fakeApp();
		expect(() => startBackgroundJobs(app)).not.toThrow();
		const messages = info.mock.calls.map((c) => String(c[0]));
		expect(messages.some((m) => m.includes("Skipped"))).toBe(true);
	});

	it("LLM 配置就绪 → 启动 scheduler（日志含 started），不抛", () => {
		setConfig();
		const { app, info } = fakeApp();
		expect(() => startBackgroundJobs(app)).not.toThrow();
		const messages = info.mock.calls.map((c) => String(c[0]));
		expect(messages.some((m) => m.includes("started"))).toBe(true);
	});
});
