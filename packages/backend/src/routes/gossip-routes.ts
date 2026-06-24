import { isWithinWindow, verifyCrawledTopic } from "@51guapi/shared";
import type { FastifyInstance } from "fastify";
import {
	fetchContent,
	fetchListPaged,
} from "../scraper/adapters/generic-adapter.js";
import { getChannelByHostname } from "../scraper/channel-store.js";
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
	updateDiscoverStats,
} from "../scraper/gossip-site-store.js";
import {
	loadVerifyConfig,
	resolveWindowDays,
} from "../scraper/gossip-verify-config.js";
import type { PendingTopic } from "../scraper/pending-store.js";
import {
	pendingTopicExistsByFingerprint,
	pendingTopicsExistingBySourceUrls,
	savePendingTopic,
} from "../scraper/pending-store.js";
import { recordGossipVerify, recordScraperRun } from "../services/metrics.js";
import { err } from "../utils/error-response.js";
import { generateId } from "../utils/generate-id.js";
import {
	GossipFromUrlBody as GossipFromUrlBodySchema,
	GossipSiteCreate as GossipSiteCreateSchema,
	GossipSiteParams as GossipSiteParamsSchema,
} from "../utils/schemas.js";

// https-only 校驗：gossip 渠道只允許 https 爬取（ssrf-guard 允許 http，語義不同）。
// IP literal 保護由下游 ssrf-guard 統一處理（私網 IP 在 DNS 解析後攔截，
// 公網 IP literal 被 allowlist 按 hostname 精確匹配拒絕）。
function parseUrl(
	raw: string,
): { url: URL; error?: undefined } | { error: string; url?: undefined } {
	try {
		const u = new URL(raw);
		if (u.protocol !== "https:") {
			return { error: "URL must use https scheme" };
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
	/** 时间窗（天）；抓取后发布时间早于 now-windowDays 则跳过不入池。 */
	windowDays?: number;
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

			// SEC-001 修復：DB 中 listUrl 可能在限制收緊前入庫（如 http:// 渠道），
			// 必須在 fetchListPaged 之前過 parseUrl，確保 https-only 等校驗生效。
			const parsedListUrl = parseUrl(site.listUrl);
			if (parsedListUrl.error) {
				return err(reply, 400, `Invalid site listUrl: ${parsedListUrl.error}`);
			}

			// 翻页页数上限取自 listUrl host 对应渠道的 maxDepth；无渠道则 1（单页，与 v0.1 等价）。
			let maxPages = 1;
			try {
				const hostname = new URL(site.listUrl).hostname;
				maxPages = getChannelByHostname(hostname)?.maxDepth ?? 1;
			} catch {
				maxPages = 1;
			}

			let discovered: Awaited<ReturnType<typeof fetchListPaged>>;
			try {
				discovered = await fetchListPaged(site.listUrl, maxPages);
			} catch (e) {
				request.log.error(e, "fetchListPaged failed");
				return err(reply, 500, "Failed to fetch list");
			}

			// 去重：单次批量 IN(...) 查询代替逐 URL .get()，O(n)→O(1) DB roundtrip。
			const existingUrls = pendingTopicsExistingBySourceUrls(
				discovered.map((i) => i.url),
			);
			const fresh = discovered.filter((i) => !existingUrls.has(i.url));

			// 回全部 fresh:fetchListPaged 内部已有 MAX_PAGED_URLS=200 硬上限兜底。
			// 不再 slice(0,20)——旧实现把第 21+ 条发现静默丢弃且无游标可续取
			// (maxDepth>1 翻页成果白算)。discover 是「待选素材」预览,呈现全部已发现项。
			// 記錄此次 discover 的時間和新增條目數（migration 018 新欄位）。
			updateDiscoverStats(site.id, fresh.length);
			return {
				ok: true,
				discovered: fresh,
				hasMore: false,
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
			// 请求显式 windowDays 优先;否则回退 env GOSSIP_WINDOW_DAYS_DEFAULT(都没有=不过滤)。
			const windowDays = resolveWindowDays(request.body?.windowDays);
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
				recordScraperRun(false);
				return err(reply, 502, `Failed to fetch URL: ${msg}`);
			}

			// 时间窗硬守(U1/R1):发布时间在窗外 → 不入池,明确反馈(用户主动点的,不静默吞)。
			// 放在提炼前,旧瓜连 LLM 调用都省掉(防成本放大)。发布时间缺失/不可解析 → unknown,
			// 不在此跳过,照常入池,留待 U3 验证关软标「时间未知」交人工。
			const publishedTime = rawContent.metadata?.publishedTime;
			if (windowDays != null) {
				const fw = isWithinWindow(publishedTime, windowDays, Date.now());
				if (!fw.unknown && !fw.ok) {
					recordGossipVerify("skipped_old");
					// A11/R11:显式 outcome 判别字段(客户端据此区分四结局,不靠字段存在性嗅探)。
					return {
						ok: true,
						outcome: "skipped" as const,
						skipped: "too-old",
						publishedTime,
						windowDays,
						ageDays: fw.ageDays,
					};
				}
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
				recordScraperRun(false);
				return err(reply, 502, `Fact extraction failed: ${msg}`);
			}

			// 入池前验证关(U3/R4):以**不可变 rawContent** 为基准校验抽取结果(每条 from-url 都重跑)。
			// 正文去 HTML 标签后供 grounding 子串/重叠比对。
			const rawText = `${rawContent.title}\n${(rawContent.body ?? "").replace(
				/<[^>]*>/g,
				" ",
			)}`;
			const verification = verifyCrawledTopic({
				facts: extracted.facts,
				rawText,
				publishedTime,
				windowDays,
				now: Date.now(),
				config: loadVerifyConfig(),
			});

			// 硬拒(明确无效:空页/错误页/广告)→ 不入池,但**用户可见**(用户主动点的,不静默吞)。
			if (verification.decision === "reject") {
				recordScraperRun(false);
				recordGossipVerify("rejected");
				return {
					ok: true,
					outcome: "rejected" as const,
					rejected: verification.reasons.join("；") || "内容无效",
					verification,
				};
			}

			// 跨 URL 内容去重:指纹命中已有条目 → 软标「疑似重复」入池(可见可恢复),不静默丢
			// (避免同人不同瓜被指纹误杀)。source_url UNIQUE 仍兜底同 URL 重复。
			if (await pendingTopicExistsByFingerprint(verification.fingerprint)) {
				verification.suspectedDuplicate = true;
				if (verification.decision === "pass") verification.decision = "flag";
				verification.reasons = [
					...verification.reasons,
					"疑似重复(内容指纹命中已有条目)",
				];
				recordGossipVerify("suspected_duplicate");
			}

			const now = new Date().toISOString();
			const rawContentWithExtractionMode = {
				...rawContent,
				metadata: {
					...(rawContent.metadata ?? {}),
					extractionMode: extracted.extractionMode,
				},
			};
			const topic: PendingTopic = {
				id: generateId("pending"),
				sourceUrl: url,
				siteName,
				title: rawContent.title,
				rawContent: rawContentWithExtractionMode,
				facts: extracted.facts,
				confidence: extracted.confidence,
				status: "pending",
				coverImageUrl: extracted.coverImageUrl,
				domain: "gossip",
				contentFingerprint: verification.fingerprint,
				verification,
				createdAt: now,
				updatedAt: now,
			};

			const { inserted } = await savePendingTopic(topic);
			if (!inserted) {
				// 409 重复 URL 早退：fetch/提取虽已发生但语义上不是新爬取事件，不计数。
				// A11/R11:带显式 outcome 判别(与其余三结局同一判别轴,客户端统一据 outcome 分支)。
				reply.code(409);
				return {
					ok: false as const,
					outcome: "duplicate" as const,
					error: "URL already exists in pending topics",
				};
			}
			recordScraperRun(true);
			if (verification.decision === "flag") recordGossipVerify("flagged");
			reply.code(201);
			return { ok: true, outcome: "created" as const, topic };
		},
	);
}
