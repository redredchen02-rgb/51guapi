import type { FastifyInstance } from "fastify";
import { scraperConfig } from "../scraper/scraper-config.js";
import { err } from "../utils/error-response.js";
import {
	AutoGenerateBody as AutoGenerateBodySchema,
	TriggerScrapeBody as TriggerScrapeBodySchema,
} from "../utils/schemas.js";

interface TriggerBody {
	siteName: string;
	url?: string;
	legacy?: "acg";
}

export async function registerScraperRoutes(
	app: FastifyInstance,
): Promise<void> {
	// Legacy ACG 手动抓取。当前吃瓜主流程使用 /api/v1/gossip/topics/from-url。
	app.post<{ Body: TriggerBody }>(
		"/api/v1/scraper/trigger",
		{
			config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
			schema: {
				body: TriggerScrapeBodySchema,
			},
		},
		async (_request, reply) => {
			return err(
				reply,
				410,
				"Legacy ACG scraper trigger is disabled.",
				"legacy-acg-disabled",
			);
		},
	);

	// 列出已注册的适配器
	app.get("/api/v1/scraper/adapters", async () => {
		const adapters = scraperConfig
			.listAdapters()
			.map((a: { name: string }) => ({
				name: a.name,
			}));
		return { ok: true, adapters };
	});

	// 列出已配置的站点
	app.get("/api/v1/scraper/sites", async () => {
		const sites = scraperConfig.listSiteConfigs();
		return { ok: true, sites };
	});

	// 自动批量生成草稿（含进度反馈）
	app.post<{
		Body: {
			minConfidence?: number;
			maxItems?: number;
			legacy?: "acg";
		};
	}>(
		"/api/v1/scraper/auto-generate",
		{
			schema: {
				body: AutoGenerateBodySchema,
			},
		},
		async (_request, reply) => {
			return err(
				reply,
				410,
				"Legacy ACG auto-generate is disabled.",
				"legacy-acg-disabled",
			);
		},
	);
}
