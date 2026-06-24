import crypto from "node:crypto";
import { isGossipFactsBlock } from "@51guapi/shared";
import type { FastifyInstance } from "fastify";
import { fetchListPaged } from "../scraper/adapters/generic-adapter.js";
import { getChannelByHostname } from "../scraper/channel-store.js";
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
import { err } from "../utils/error-response.js";
import { resolveLlmConfig } from "../utils/llm-config.js";

export function registerRankingRoutes(app: FastifyInstance): void {
	// GET /api/v1/ranking — 返回加權排行表（A 區交集 + B 區僅熱搜）
	app.get("/api/v1/ranking", async (_request, _reply) => {
		const result = await getRankedList();
		return { ok: true, ...result };
	});

	// POST /api/v1/ranking/scrape — 一鍵觸發所有站點爬取 + 4 平台熱搜抓取
	app.post("/api/v1/ranking/scrape", async (request, _reply) => {
		const errors: string[] = [];
		let topicsDiscovered = 0;

		// 並發：熱搜抓取 + 所有站點 discover
		const [hotResult, sites] = await Promise.all([
			scrapeAllPlatforms().catch((e) => {
				errors.push(`hot-search: ${e}`);
				return { baidu: 0, weibo: 0, douyin: 0, total: 0, errors: [] };
			}),
			listGossipSites().catch(() => []),
		]);

		// 每個啟用站點：discover 新 URL → 存入 pending_topics（輕量 stub，無 LLM）
		const enabledSites = sites.filter((s) => s.enabled);
		await Promise.all(
			enabledSites.map(async (site) => {
				try {
					let maxPages = 1;
					try {
						const hostname = new URL(site.listUrl).hostname;
						maxPages = getChannelByHostname(hostname)?.maxDepth ?? 1;
					} catch {
						maxPages = 1;
					}
					const discovered = await fetchListPaged(site.listUrl, maxPages);
					const existingUrls = pendingTopicsExistingBySourceUrls(
						discovered.map((d) => d.url),
					);
					const fresh = discovered.filter((d) => !existingUrls.has(d.url));

					for (const item of fresh) {
						const title = item.title ?? new URL(item.url).hostname;
						const now = new Date().toISOString();
						const { inserted } = await savePendingTopic({
							id: crypto.randomUUID(),
							sourceUrl: item.url,
							siteName: site.name,
							title,
							rawContent: { title, body: "", url: item.url },
							facts: {
								當事人: title,
								事件摘要: null,
								起因: null,
								經過: null,
								結果: null,
								來源連結: item.url,
								發生時間: null,
								熱度標籤: null,
							},
							confidence: 0,
							status: "pending",
							domain: "gossip",
							createdAt: now,
							updatedAt: now,
						});
						if (inserted) topicsDiscovered++;
					}
				} catch (e) {
					errors.push(`site ${site.name}: ${e}`);
					request.log.warn(e, `[ranking/scrape] site ${site.name} failed`);
				}
			}),
		);

		return {
			ok: true,
			hotKeywordsCount: hotResult.total,
			topicsDiscovered,
			errors: [...errors, ...hotResult.errors],
		};
	});

	// POST /api/v1/ranking/hide — 將關鍵詞或話題標題加入黑名單
	app.post<{ Body: { keyword: string } }>(
		"/api/v1/ranking/hide",
		async (request, reply) => {
			const { keyword } = request.body ?? {};
			if (!keyword || typeof keyword !== "string")
				return err(reply, 400, "keyword is required");
			addToBlacklist(keyword.trim());
			return { ok: true };
		},
	);

	// POST /api/v1/ranking/generate-draft/:topicId
	// 從排行表一鍵生成草稿：自動 approve（若還是 pending）→ generateArticleDraft
	app.post<{ Params: { topicId: string } }>(
		"/api/v1/ranking/generate-draft/:topicId",
		{ config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
		async (request, reply) => {
			const { topicId } = request.params;
			const topic = await loadPendingTopic(topicId);
			if (!topic) return err(reply, 404, `Topic ${topicId} not found.`);
			if (topic.domain !== "gossip")
				return err(reply, 400, "只支援 gossip 類型選題");
			if (!isGossipFactsBlock(topic.facts))
				return err(reply, 400, "選題 facts 不是有效的 GossipFactsBlock");

			// 若還是 pending，自動 approve（從排行表觸發視同已篩選確認）
			if (topic.status === "pending") {
				await updatePendingTopicStatus(topicId, "approved");
			} else if (topic.status === "rejected") {
				return err(reply, 400, "選題已被拒絕，無法生成草稿");
			}

			const config = resolveLlmConfig();
			if (!config)
				return err(reply, 500, "LLM is not configured. Check LLM_API_KEY and LLM_ENDPOINT in .env.", "no-key");

			try {
				const result = await generateArticleDraft(topic.facts, {
					settings: {
						endpoint: config.endpoint,
						model: config.model,
						promptTemplate: "",
					},
					apiKey: config.apiKey,
				});
				if (!result.ok) return err(reply, 422, result.error, result.kind);
				return result;
			} catch (e) {
				request.log.error(e, "Failed to generate draft from ranking");
				return err(
					reply,
					500,
					"Internal error during draft generation.",
					"network",
				);
			}
		},
	);
}
