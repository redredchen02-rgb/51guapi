import type { GossipFactsBlock, Settings } from "@51guapi/shared";
import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import rateLimit from "@fastify/rate-limit";
import { existsSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import { registerChannelRoutes } from "./routes/channel-routes.js";
import { registerGossipRoutes } from "./routes/gossip-routes.js";
import { registerPendingRoutes } from "./routes/pending-routes.js";
import { registerPreflightRoutes } from "./routes/preflight-routes.js";
import { registerPromptRoutes } from "./routes/prompt-routes.js";
import { registerScraperRoutes } from "./routes/scraper-routes.js";
import { demoAdapter } from "./scraper/adapters/demo-adapter.js";
import { getDb, initPendingDb } from "./scraper/pending-db.js";
import { jobs, startScheduler } from "./scraper/scheduler.js";
import { scraperConfig } from "./scraper/scraper-config.js";
import { seedChannelsFromEnv } from "./scraper/seed-channels.js";
import {
	generateDraft,
	listModels,
	reviewDraftLlm,
	rewriteDraftLlm,
} from "./services/llm.js";
import { getMetrics, recordDraft } from "./services/metrics.js";
import { err } from "./utils/error-response.js";
import { getLlmConfig, validateLlmConfig } from "./utils/llm-config.js";
import {
	GenerateDraftBody as GenerateDraftBodySchema,
	GenerateDraftResponse,
	HealthzResponse,
	ReviewDraftBody as ReviewDraftBodySchema,
	RewriteDraftBody as RewriteDraftBodySchema,
} from "./utils/schemas.js";

export function buildApp(): FastifyInstance {
	initPendingDb();
	// 日志:env 控制 level(默认 info);redaction 防鉴权头/密钥落日志(secret-hygiene)。
	const server = Fastify({
		genReqId: () => crypto.randomUUID(),
		bodyLimit: 1048576, // 1MB 全局 body 大小限制
		logger: {
			level: process.env.LOG_LEVEL ?? "info",
			redact: {
				paths: [
					"req.headers.authorization",
					"req.headers.cookie",
					'req.headers["x-api-key"]',
					"*.password",
					"*.token",
					"*.apiKey",
					"*.JWT_SECRET",
					"*.LLM_API_KEY",
				],
				censor: "[REDACTED]",
			},
		},
	});

	// 注册 Swagger 插件
	void server.register(import("@fastify/swagger"), {
		openapi: {
			openapi: "3.0.0",
			info: {
				title: "吃瓜小帮手 Backend API",
				description: "吃瓜小帮手 后端 API 文档",
				version: "0.1.0",
			},
			servers: [
				{
					url: "http://localhost:3002",
					description: "开发服务器",
				},
			],
		},
	});

	void server.register(import("@fastify/swagger-ui"), {
		routePrefix: "/docs",
		uiConfig: {
			docExpansion: "list",
			deepLinking: true,
		},
	});

	const corsOrigins = (process.env.CORS_ORIGIN ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s && s !== "*");
	server.register(cors, { origin: corsOrigins });
	// 全局 rate limit: 100 req/min；关键端点再通过 per-route config 加严
	server.register(rateLimit, { max: 100, timeWindow: "1 minute" });

	// CSP headers — 纵深防御,防止 XSS 在意外内容类型中执行
	server.addHook("onSend", async (_request, reply, payload) => {
		reply.header(
			"Content-Security-Policy",
			"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'",
		);
		return payload;
	});

	server.get<{
		Reply: import("@sinclair/typebox").Static<typeof HealthzResponse>;
	}>(
		"/api/v1/healthz",
		{ schema: { response: { 200: HealthzResponse } } },
		async () => {
			const schedulerRunning = jobs.size > 0;
			const dbHealthy = (() => {
				try {
					getDb().prepare("SELECT 1").get();
					return true;
				} catch {
					return false;
				}
			})();

			// 质量统计
			let quality = { avgScore: 0, passRate: 0, totalGenerations: 0 };
			try {
				const { getQualityStats } = await import(
					"./services/quality-metrics.js"
				);
				quality = await getQualityStats();
			} catch {
				// 质量统计不可用不影响健康检查
			}

			return {
				ok: true,
				uptime: Math.round(process.uptime()),
				scheduler: { running: schedulerRunning, jobCount: jobs.size },
				database: { healthy: dbHealthy },
				memory: {
					heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
				},
				quality,
			} as import("@sinclair/typebox").Static<typeof HealthzResponse>;
		},
	);

	server.get("/api/v1/metrics", async (_request, reply) => {
		reply.header("Content-Type", "text/plain; version=0.0.4");
		return getMetrics();
	});

	// Standard Prometheus scraping endpoint (without API prefix)
	server.get("/metrics", async (_request, reply) => {
		reply.header("Content-Type", "text/plain; version=0.0.4");
		return getMetrics();
	});

	// B1-U1: 运行时 env 种子渠道(默认空;DNS 异步,故 fire-and-forget 不阻塞同步 buildApp)。
	// 种子内部已逐项 try/catch warn+skip;此处 .catch() 兜底,确保任何遗漏 rejection 不冒泡成
	// unhandled rejection(Node 22 默认会因此终止进程)。
	void seedChannelsFromEnv({
		info: (m) => server.log.info(m),
		warn: (m) => server.log.warn(m),
	}).catch((e) => server.log.error(e, "[seed] 种子任务异常"));

	registerPreflightRoutes(server);
	registerScraperRoutes(server);
	registerGossipRoutes(server);
	registerChannelRoutes(server);
	registerPendingRoutes(server);
	registerPromptRoutes(server);

	scraperConfig.registerAdapter(demoAdapter);
	scraperConfig.addSiteConfig({
		siteName: "demo",
		adapterName: "demo",
		url: "https://example.com",
		enabled: false,
	});

	// Serve webui SPA in production when dist exists alongside this package.
	// Guard: only register if the dist directory is present — dev mode keeps serving from Vite.
	const webuiDist = path.resolve(
		new URL(import.meta.url).pathname,
		"../../../../webui/dist",
	);
	if (existsSync(webuiDist)) {
		server.register(staticPlugin, {
			root: webuiDist,
			prefix: "/",
		});
		// SPA fallback: all non-/api/* paths serve index.html (client-side routing).
		server.setNotFoundHandler((req, reply) => {
			if (req.url.startsWith("/api/")) {
				reply.status(404).send({ ok: false, error: "Not found" });
				return;
			}
			reply.sendFile("index.html");
		});
	}

	return server;
}

interface GenerateDraftBody {
	prompt: string;
	settings: Settings;
	facts?: GossipFactsBlock;
}

function resolveRequestSettings(
	settings: Settings,
	config: { endpoint: string; model: string },
): Settings {
	return {
		endpoint: config.endpoint.trim(),
		model: config.model,
		fallbackModel: settings.fallbackModel,
		promptTemplate: settings.promptTemplate,
		fewShotPairs: settings.fewShotPairs,
		recommendedTags: settings.recommendedTags,
		backendUrl: settings.backendUrl,
		reviewCriteriaPrompt: settings.reviewCriteriaPrompt,
		webSearchEnabled: settings.webSearchEnabled,
	};
}

export function registerDraftRoutes(app: FastifyInstance): void {
	app.get("/api/v1/models", async (request, reply) => {
		const config = getLlmConfig();
		const validation = validateLlmConfig(config);
		if (!validation.valid)
			return err(reply, 500, validation.error ?? "Unknown error");
		try {
			return await listModels(config.endpoint, config.apiKey);
		} catch (e) {
			request.log.error(e, "Failed to fetch models list");
			return err(reply, 500, "Failed to fetch models from the LLM service.");
		}
	});

	app.post<{ Body: GenerateDraftBody }>(
		"/api/v1/drafts/generate",
		{
			config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
			schema: {
				body: GenerateDraftBodySchema,
				response: { 200: GenerateDraftResponse },
			},
		},
		async (request, reply) => {
			const { prompt, settings, facts } = request.body;
			const config = getLlmConfig(settings);
			const validation = validateLlmConfig(config);
			if (!validation.valid)
				return err(reply, 500, validation.error ?? "Unknown error", "no-key");
			const resolvedSettings = resolveRequestSettings(settings, config);
			try {
				const result = await generateDraft(prompt, {
					settings: resolvedSettings,
					apiKey: config.apiKey,
					facts,
				});
				if (!result.ok) {
					recordDraft(false);
					return err(reply, 422, result.error, result.kind);
				}
				recordDraft(true);
				return result;
			} catch (e) {
				recordDraft(false);
				request.log.error(e, "Failed to generate draft via LLM");
				return err(
					reply,
					500,
					"Internal server error during draft generation.",
					"network",
				);
			}
		},
	);

	app.post<{
		Body: {
			draft: import("@51guapi/shared").ContentDraft;
			criteriaPrompt?: string;
			settings: import("@51guapi/shared").Settings;
		};
	}>(
		"/api/v1/drafts/review",
		{
			schema: {
				body: ReviewDraftBodySchema,
			},
		},
		async (request, reply) => {
			const { draft, criteriaPrompt, settings } = request.body;
			const config = getLlmConfig(settings);
			const validation = validateLlmConfig(config);
			if (!validation.valid)
				return err(reply, 500, validation.error ?? "Unknown error");
			const resolvedSettings = resolveRequestSettings(settings, config);
			try {
				const result = await reviewDraftLlm(draft, criteriaPrompt, {
					settings: resolvedSettings,
					apiKey: config.apiKey,
				});
				if (!result.ok) return err(reply, 422, result.error);
				return result;
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				return err(reply, 500, `Review failed: ${msg}`);
			}
		},
	);

	app.post<{
		Body: {
			draft: import("@51guapi/shared").ContentDraft;
			failedDims: string[];
			settings: import("@51guapi/shared").Settings;
		};
	}>(
		"/api/v1/drafts/rewrite",
		{
			schema: {
				body: RewriteDraftBodySchema,
			},
		},
		async (request, reply) => {
			const { draft, failedDims, settings } = request.body;
			const config = getLlmConfig(settings);
			const validation = validateLlmConfig(config);
			if (!validation.valid)
				return err(reply, 500, validation.error ?? "Unknown error");
			if (failedDims.length === 0)
				return err(reply, 400, "failedDims must be a non-empty array.");
			const resolvedSettings = resolveRequestSettings(settings, config);
			try {
				const result = await rewriteDraftLlm(draft, failedDims, {
					settings: resolvedSettings,
					apiKey: config.apiKey,
				});
				if (!result.ok) return err(reply, 422, result.error);
				return result;
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				return err(reply, 500, `Rewrite failed: ${msg}`);
			}
		},
	);
}

export function startBackgroundJobs(app: FastifyInstance): void {
	const llmEndpoint = process.env.LLM_ENDPOINT;
	const llmApiKey = process.env.LLM_API_KEY;
	if (llmEndpoint && llmApiKey) {
		startScheduler({
			logger: app.log,
			llmEndpoint,
			llmApiKey,
			llmModel: process.env.LLM_MODEL,
		});
		app.log.info("[scheduler] Cron scheduler started");
	} else {
		app.log.info("[scheduler] Skipped (LLM_ENDPOINT/LLM_API_KEY not set)");
	}
}
