import type { FastifyInstance } from "fastify";
import { extractFacts } from "../scraper/fact-extractor.js";
import {
	type PendingTopic,
	savePendingTopic,
} from "../scraper/pending-store.js";
import { scraperConfig } from "../scraper/scraper-config.js";
import { isHostAllowed, loadSSRFAllowlist } from "../scraper/ssrf-allowlist.js";
import {
	type EnrichedContext,
	enrichContext,
} from "../scraper/web-enricher.js";
import { recordScraperRun } from "../services/metrics.js";
import { err } from "../utils/error-response.js";
import { generateId } from "../utils/generate-id.js";
import {
	AutoGenerateBody as AutoGenerateBodySchema,
	TriggerScrapeBody as TriggerScrapeBodySchema,
} from "../utils/schemas.js";

interface TriggerBody {
	siteName: string;
	url?: string;
}

export async function registerScraperRoutes(
	app: FastifyInstance,
): Promise<void> {
	// 手动触发单个站点的抓取（scraper 触发是昂贵操作，加严 rate limit）
	app.post<{ Body: TriggerBody }>(
		"/api/v1/scraper/trigger",
		{
			config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
			schema: {
				body: TriggerScrapeBodySchema,
			},
		},
		async (request, reply) => {
			const { siteName, url } = request.body;

			if (!siteName) {
				return err(reply, 400, "Missing required field: siteName");
			}

			const config = scraperConfig.getSiteConfig(siteName);
			if (!config?.enabled) {
				return err(
					reply,
					404,
					`Site config not found or disabled: ${siteName}`,
				);
			}

			const adapter = scraperConfig.getAdapter(config.adapterName);
			if (!adapter) {
				return err(reply, 500, `Adapter not registered: ${config.adapterName}`);
			}

			// List-discovery mode: if no URL supplied and config.listUrl exists, scan the list page.
			let targetUrl: string;
			if (url) {
				targetUrl = url;
			} else if (!url && config.listUrl && adapter.fetchList) {
				request.log.info(`List-discovery mode: scanning ${config.listUrl}`);
				let discovered: string[];
				try {
					discovered = await adapter.fetchList(config.listUrl);
				} catch (e) {
					request.log.error(e, `fetchList failed for ${config.listUrl}`);
					return err(
						reply,
						500,
						"Failed to fetch list. Check server logs for details.",
					);
				}
				if (discovered.length === 0) {
					return err(
						reply,
						404,
						`No articles found at list URL: ${config.listUrl}`,
					);
				}
				// Pick a random article from the discovered list.
				const randomIndex = Math.floor(Math.random() * discovered.length);
				const pick = discovered[randomIndex];
				if (!pick) {
					return err(reply, 500, "Unexpected: empty discovery result");
				}
				targetUrl = pick;
				request.log.info(
					`Discovered ${discovered.length} URLs, selected: ${targetUrl}`,
				);
			} else {
				targetUrl = config.url;
			}

			if (!targetUrl) {
				return err(reply, 400, "No URL provided and no default URL in config");
			}

			// SSRF allowlist: caller-supplied url must share hostname and protocol with the registered site config.
			// Also reject URLs with credentials (userinfo) to prevent bypass via http://evil@allowed.com/.
			if (url) {
				let parsed: URL;
				let configParsed: URL;
				try {
					parsed = new URL(url);
					configParsed = new URL(config.url);
				} catch {
					return err(reply, 400, "Invalid URL format");
				}
				if (parsed.username || parsed.password) {
					return err(reply, 400, "URL credentials not allowed");
				}
				if (parsed.hostname !== configParsed.hostname) {
					return err(
						reply,
						400,
						`URL hostname not allowed for site ${siteName}: ${parsed.hostname}`,
					);
				}
				if (parsed.protocol !== configParsed.protocol) {
					return err(
						reply,
						400,
						`URL protocol not allowed for site ${siteName}: ${parsed.protocol}`,
					);
				}

				if (!isHostAllowed(parsed, loadSSRFAllowlist())) {
					return err(
						reply,
						403,
						`URL hostname blocked by SSRF allowlist: ${parsed.hostname}`,
					);
				}
			}

			const llmEndpoint = process.env.LLM_ENDPOINT;
			const llmApiKey = process.env.LLM_API_KEY;

			if (!llmEndpoint || !llmApiKey) {
				return err(
					reply,
					500,
					"LLM_ENDPOINT and LLM_API_KEY must be set in .env",
				);
			}

			try {
				// Step 1: Fetch raw content via adapter
				request.log.info(
					`Fetching content from ${targetUrl} via adapter ${adapter.name}`,
				);
				const rawContent = await adapter.fetchContent(targetUrl);

				// Step 2: Extract facts via LLM
				request.log.info("Extracting facts via LLM");
				const { facts, confidence, coverImageUrl } = await extractFacts(
					rawContent,
					{
						endpoint: llmEndpoint,
						apiKey: llmApiKey,
						model: process.env.LLM_MODEL || "gpt-4o-mini",
					},
				);

				// Step 3: Web search enrichment
				let enrichment: EnrichedContext | undefined;
				if (process.env.ENRICHMENT_ENABLED !== "false") {
					request.log.info("Enriching via web search");
					try {
						const maxQ = Math.min(
							Math.max(
								Number(process.env.ENRICHMENT_MAX_QUERIES ?? "3") || 3,
								1,
							),
							10,
						);
						enrichment = await enrichContext({ facts, maxQueries: maxQ });
						const totalResults = enrichment.queryResults.reduce(
							(s: number, qr: { results: unknown[] }) => s + qr.results.length,
							0,
						);
						request.log.info(`Enrichment complete: ${totalResults} results`);
					} catch (enrichErr) {
						request.log.warn(`Enrichment failed (non-fatal): ${enrichErr}`);
					}
				}

				// Step 4: Save as pending topic
				const now = new Date().toISOString();
				const id = generateId("scrape");
				const pendingTopic: PendingTopic = {
					id,
					sourceUrl: targetUrl,
					siteName: config.siteName,
					title: rawContent.title,
					rawContent,
					facts,
					confidence,
					...(coverImageUrl ? { coverImageUrl } : {}),
					...(enrichment ? { enrichment } : {}),
					status: "pending",
					createdAt: now,
					updatedAt: now,
				};

				await savePendingTopic(pendingTopic);
				recordScraperRun(true);

				return { ok: true, pendingTopic };
			} catch (e) {
				recordScraperRun(false);
				request.log.error(e, `Scrape failed for ${siteName}`);
				return err(reply, 500, "Scrape failed. Check server logs for details.");
			}
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
			enableEnrichment?: boolean;
		};
	}>(
		"/api/v1/scraper/auto-generate",
		{
			schema: {
				body: AutoGenerateBodySchema,
			},
		},
		async (request, reply) => {
			const { minConfidence, maxItems, enableEnrichment } = request.body ?? {};

			const llmEndpoint = process.env.LLM_ENDPOINT;
			const llmApiKey = process.env.LLM_API_KEY;
			if (!llmEndpoint || !llmApiKey) {
				return err(reply, 500, "LLM_ENDPOINT and LLM_API_KEY must be set");
			}

			try {
				const { autoGenerateDrafts } = await import(
					"../scraper/auto-generate.js"
				);
				const result = await autoGenerateDrafts({
					minConfidence: minConfidence ?? 0.5,
					maxItems: maxItems ?? 5,
					enableEnrichment: enableEnrichment ?? true,
				});
				return {
					ok: true,
					...result,
					progress: {
						total: result.generated + result.skipped + result.errors,
						completed: result.generated,
						skipped: result.skipped,
						errors: result.errors,
					},
				};
			} catch (e) {
				request.log.error(e, "Auto-generate failed");
				return err(
					reply,
					500,
					"Auto-generate failed. Check server logs for details.",
				);
			}
		},
	);
}
