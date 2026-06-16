import type { FastifyInstance } from "fastify";
import {
	fetchContent,
	fetchList,
} from "../scraper/adapters/generic-adapter.js";
import {
	type ExtractedGossipFacts,
	gossipExtractFacts,
} from "../scraper/gossip-fact-extractor.js";
import {
	deleteGossipSite,
	type GossipSiteCreate,
	getGossipSite,
	listGossipSites,
	saveGossipSite,
} from "../scraper/gossip-site-store.js";
import type { PendingTopic } from "../scraper/pending-store.js";
import {
	pendingTopicExistsBySourceUrl,
	savePendingTopic,
} from "../scraper/pending-store.js";
import { err } from "../utils/error-response.js";
import { generateId } from "../utils/generate-id.js";
import {
	GossipFromUrlBody as GossipFromUrlBodySchema,
	GossipSiteCreate as GossipSiteCreateSchema,
	GossipSiteParams as GossipSiteParamsSchema,
} from "../utils/schemas.js";

/** 返回 400 如果 hostname 是 IP literal（IPv4、decimal-encoded IPv4 或 IPv6）。 */
function isIpLiteral(hostname: string): boolean {
	// IPv4 dotted-quad
	if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true;
	// Decimal-encoded IPv4 (e.g. 2130706433 → 127.0.0.1)
	if (/^\d+$/.test(hostname) && BigInt(hostname) <= 0xffffffffn) return true;
	// IPv6 含冒號
	if (hostname.includes(":")) return true;
	// IPv6 帶中括號
	if (/^\[.*\]$/.test(hostname)) return true;
	return false;
}

function parseUrl(
	raw: string,
): { url: URL; error?: undefined } | { error: string; url?: undefined } {
	try {
		const u = new URL(raw);
		if (u.protocol !== "https:" && u.protocol !== "http:") {
			return { error: "URL must use http or https scheme" };
		}
		if (isIpLiteral(u.hostname)) {
			return { error: "IP literal URLs are not allowed" };
		}
		return { url: u };
	} catch {
		return { error: "Invalid URL" };
	}
}

interface SiteParams {
	id: string;
}

interface FromUrlBody {
	url: string;
	siteName: string;
}

export async function registerGossipRoutes(
	app: FastifyInstance,
): Promise<void> {
	// POST /api/v1/gossip/sites — 新增站點設定
	app.post<{ Body: GossipSiteCreate }>(
		"/api/v1/gossip/sites",
		{ schema: { body: GossipSiteCreateSchema } },
		async (request, reply) => {
			const { name, listUrl } = request.body ?? {};
			if (!name || !listUrl) {
				return err(reply, 400, "Missing required fields: name, listUrl");
			}
			if (name.length > 200)
				return err(reply, 400, "name too long (max 200 chars)");

			const parsed = parseUrl(listUrl);
			if (parsed.error) {
				return err(reply, 400, `Invalid listUrl: ${parsed.error}`);
			}
			const now = new Date().toISOString();
			const site = {
				id: generateId("site"),
				name,
				listUrl,
				enabled: true,
				createdAt: now,
				updatedAt: now,
			};
			await saveGossipSite(site);
			reply.code(201);
			return { ok: true, site };
		},
	);

	// GET /api/v1/gossip/sites — 列出站點
	app.get("/api/v1/gossip/sites", async () => {
		const sites = await listGossipSites();
		return { ok: true, sites };
	});

	// DELETE /api/v1/gossip/sites/:id — 刪除站點
	app.delete<{ Params: SiteParams }>(
		"/api/v1/gossip/sites/:id",
		{
			schema: {
				params: GossipSiteParamsSchema,
			},
		},
		async (request, reply) => {
			const site = await getGossipSite(request.params.id);
			if (!site) return err(reply, 404, "Site not found");
			await deleteGossipSite(request.params.id);
			return { ok: true };
		},
	);

	// POST /api/v1/gossip/sites/:id/discover — 觸發資源發現
	app.post<{ Params: SiteParams }>(
		"/api/v1/gossip/sites/:id/discover",
		{ schema: { params: GossipSiteParamsSchema } },
		async (request, reply) => {
			const site = await getGossipSite(request.params.id);
			if (!site) return err(reply, 404, "Site not found");
			if (!site.enabled) return err(reply, 400, "Site is disabled");

			let discovered: Awaited<ReturnType<typeof fetchList>>;
			try {
				discovered = await fetchList(site.listUrl);
			} catch (e) {
				request.log.error(e, "fetchList failed");
				return err(reply, 500, "Failed to fetch list");
			}

			// 去重：已存在 pending_topics 的 URL 過濾掉
			const fresh: typeof discovered = [];
			for (const item of discovered) {
				if (!(await pendingTopicExistsBySourceUrl(item.url))) {
					fresh.push(item);
				}
			}

			const page = fresh.slice(0, 20);
			return {
				ok: true,
				discovered: page,
				hasMore: fresh.length > 20,
				total: fresh.length,
			};
		},
	);

	// POST /api/v1/gossip/topics/from-url — 單條 URL 事實提取 → pending
	app.post<{ Body: FromUrlBody }>(
		"/api/v1/gossip/topics/from-url",
		{
			schema: {
				body: GossipFromUrlBodySchema,
			},
		},
		async (request, reply) => {
			const { url, siteName } = request.body ?? {};
			if (!url || !siteName) {
				return err(reply, 400, "Missing required fields: url, siteName");
			}
			if (siteName.length > 200)
				return err(reply, 400, "siteName too long (max 200 chars)");
			const parsed = parseUrl(url);
			if (parsed.error) {
				return err(reply, 400, `Invalid url: ${parsed.error}`);
			}

			const llmEndpoint = process.env.LLM_ENDPOINT;
			const llmApiKey = process.env.LLM_API_KEY;
			if (!llmEndpoint || !llmApiKey) {
				return err(
					reply,
					503,
					"LLM not configured (LLM_ENDPOINT / LLM_API_KEY missing)",
				);
			}

			let rawContent: Awaited<ReturnType<typeof fetchContent>>;
			try {
				rawContent = await fetchContent(url);
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				return err(reply, 502, `Failed to fetch URL: ${msg}`);
			}

			let extracted: ExtractedGossipFacts;
			try {
				extracted = await gossipExtractFacts(rawContent, {
					endpoint: llmEndpoint,
					apiKey: llmApiKey,
					model: process.env.LLM_MODEL,
				});
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				return err(reply, 502, `Fact extraction failed: ${msg}`);
			}

			const now = new Date().toISOString();
			const topic: PendingTopic = {
				id: generateId("pending"),
				sourceUrl: url,
				siteName,
				title: rawContent.title,
				rawContent,
				facts: extracted.facts,
				confidence: extracted.confidence,
				status: "pending",
				coverImageUrl: extracted.coverImageUrl,
				domain: "gossip",
				createdAt: now,
				updatedAt: now,
			};

			const { inserted } = await savePendingTopic(topic);
			if (!inserted) {
				return err(reply, 409, "URL already exists in pending topics");
			}
			reply.code(201);
			return { ok: true, topic };
		},
	);
}
