import type { FastifyBaseLogger } from "fastify";
import cron from "node-cron";
import { recordScraperRun } from "../services/metrics.js";
import { sendAlert } from "../services/telegram.js";
import { generateId } from "../utils/generate-id.js";
import { getChannelByHostname } from "./channel-store.js";
import { extractFacts } from "./fact-extractor.js";
import {
	type PendingTopic,
	pendingTopicExistsBySourceUrl,
	savePendingTopic,
} from "./pending-store.js";
import { scraperConfig } from "./scraper-config.js";
import type { ScraperSiteConfig, SiteAdapter } from "./site-adapter.js";

interface SchedulerDeps {
	logger?: FastifyBaseLogger;
	llmEndpoint: string;
	llmApiKey: string;
	llmModel?: string;
}

export const jobs = new Map<string, cron.ScheduledTask>();

const BASE_DELAY_MS = 1_000;
const MAX_ATTEMPTS = 3;
const CONSECUTIVE_FAILURE_THRESHOLD = 3;

/** 指数退避延迟，带随机抖动。 */
async function sleep(attempt: number): Promise<void> {
	const delay =
		BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * BASE_DELAY_MS;
	await new Promise((resolve) => setTimeout(resolve, delay));
}

async function fetchWithRetry(
	adapter: SiteAdapter,
	url: string,
	deps: SchedulerDeps,
	siteName: string,
): Promise<Awaited<ReturnType<typeof adapter.fetchContent>> | null> {
	let fetchError: Error | null = null;
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			return await adapter.fetchContent(url);
		} catch (err) {
			fetchError = err instanceof Error ? err : new Error(String(err));
			deps.logger?.warn(
				`[scheduler] Fetch attempt ${attempt}/${MAX_ATTEMPTS} failed for ${siteName}: ${fetchError.message}`,
			);
			if (attempt < MAX_ATTEMPTS) await sleep(attempt);
		}
	}
	return null;
}

/** 单条 URL 模式（现有行为）。 */
async function runSingleUrl(
	site: ScraperSiteConfig,
	adapter: SiteAdapter,
	deps: SchedulerDeps,
): Promise<void> {
	const runStart = Date.now();
	deps.logger?.info(`[scheduler] Triggering ${site.siteName}: ${site.url}`);

	const rawContent = await fetchWithRetry(
		adapter,
		site.url,
		deps,
		site.siteName,
	);

	if (!rawContent) {
		deps.logger?.error(
			{ siteName: site.siteName, attempts: MAX_ATTEMPTS },
			`[scheduler] All fetch attempts failed for ${site.siteName}`,
		);
		deps.logger?.info({
			event: "scraper_run",
			siteName: site.siteName,
			success: 0,
			failed: 1,
			durationMs: Date.now() - runStart,
		});
		recordScraperRun(false);
		return;
	}

	try {
		const { facts, confidence, extractionMode, coverImageUrl } =
			await extractFacts(rawContent, {
				endpoint: deps.llmEndpoint,
				apiKey: deps.llmApiKey,
				model: deps.llmModel || "gpt-4o-mini",
			});

		const now = new Date().toISOString();
		const topic: PendingTopic = {
			id: generateId("scheduled"),
			sourceUrl: site.url,
			siteName: site.siteName,
			title: rawContent.title,
			rawContent,
			facts,
			confidence,
			...(coverImageUrl ? { coverImageUrl } : {}),
			domain: "gossip",
			status: "pending",
			createdAt: now,
			updatedAt: now,
		};

		await savePendingTopic(topic);

		deps.logger?.info({
			event: "scraper_run",
			siteName: site.siteName,
			success: 1,
			failed: 0,
			durationMs: Date.now() - runStart,
			confidence,
			extractionMode,
		});
		recordScraperRun(true);
		deps.logger?.info(
			`[scheduler] Saved pending topic from ${site.siteName}: ${rawContent.title}`,
		);
	} catch (err) {
		deps.logger?.error(
			err,
			`[scheduler] Extract/save failed for ${site.siteName}`,
		);
		deps.logger?.info({
			event: "scraper_run",
			siteName: site.siteName,
			success: 0,
			failed: 1,
			durationMs: Date.now() - runStart,
		});
		recordScraperRun(false);
	}
}

/**
 * 取 listUrl host 对应渠道的 maxDepth（翻页页数上限）。
 * 无渠道记录或 URL 非法 → 1（单页，退化为 v0.1 行为，不回归）。
 */
function resolveMaxDepth(listUrl: string): number {
	try {
		const hostname = new URL(listUrl).hostname;
		return getChannelByHostname(hostname)?.maxDepth ?? 1;
	} catch {
		return 1;
	}
}

/** 列表发现模式：从列表页批量发现详情页 URL。 */
async function runListDiscovery(
	site: ScraperSiteConfig,
	adapter: SiteAdapter,
	deps: SchedulerDeps,
): Promise<void> {
	if (!site.listUrl) {
		deps.logger?.warn(
			`[scheduler] No listUrl for ${site.siteName}, skipping discovery`,
		);
		return;
	}
	const budget = Math.max(
		1,
		Number(process.env.SCRAPER_LIST_BUDGET ?? "20") || 20,
	);
	deps.logger?.info(
		`[scheduler] List-discovery start: ${site.siteName} listUrl=${site.listUrl}`,
	);

	// 翻页页数上限取自 listUrl host 对应渠道的 maxDepth；无渠道记录退化为 1（单页，与 v0.1 等价）。
	const maxPages = resolveMaxDepth(site.listUrl);
	const candidateUrls = adapter.fetchListPaged
		? await adapter.fetchListPaged(site.listUrl, maxPages)
		: ((await adapter.fetchList?.(site.listUrl)) ?? []);

	// Session-level dedup（防止同一次 run 内重复抓取同一 URL）
	const sessionSet = new Set<string>();

	// DB-level dedup（已在 pending_topics 里的跳过，避免不必要的 fetchContent）
	const freshUrls: string[] = [];
	for (const url of candidateUrls) {
		if (sessionSet.has(url)) continue;
		sessionSet.add(url);
		if (await pendingTopicExistsBySourceUrl(url)) continue;
		freshUrls.push(url);
	}

	if (freshUrls.length > budget) {
		deps.logger?.warn(
			`[scheduler] Budget cap: ${freshUrls.length} → ${budget} URLs for ${site.siteName}`,
		);
		freshUrls.splice(budget);
	}

	let insertCount = 0;
	let consecutiveFailures = 0;

	for (const url of freshUrls) {
		try {
			const rawContent = await adapter.fetchContent(url);
			const { facts, confidence, coverImageUrl } = await extractFacts(
				rawContent,
				{
					endpoint: deps.llmEndpoint,
					apiKey: deps.llmApiKey,
					model: deps.llmModel || "gpt-4o-mini",
				},
			);

			const now = new Date().toISOString();
			const topic: PendingTopic = {
				id: generateId("discovered"),
				sourceUrl: url,
				siteName: site.siteName,
				title: rawContent.title,
				rawContent,
				facts,
				confidence,
				...(coverImageUrl ? { coverImageUrl } : {}),
				domain: "gossip",
				status: "pending",
				createdAt: now,
				updatedAt: now,
			};

			const { inserted } = await savePendingTopic(topic);
			if (inserted) {
				insertCount++;
				consecutiveFailures = 0;
			}
		} catch (err) {
			consecutiveFailures++;
			deps.logger?.warn(`[scheduler] fetchContent failed for ${url}: ${err}`);
			if (consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD) {
				await sendAlert(
					`[${site.siteName}] ${CONSECUTIVE_FAILURE_THRESHOLD} consecutive fetch failures`,
				);
				consecutiveFailures = 0;
			}
		}
	}

	deps.logger?.info({
		event: "scraper_run",
		siteName: site.siteName,
		mode: "list-discovery",
		discovered: candidateUrls.length,
		inserted: insertCount,
	});
	recordScraperRun(true);

	if (insertCount > 0) {
		await sendAlert(
			`[${site.siteName}] ${insertCount} new topic(s) discovered`,
		);
	}
}

export function startScheduler(deps: SchedulerDeps): void {
	const sites = scraperConfig
		.listSiteConfigs()
		.filter((s) => s.enabled && s.cron && s.url && s.url.trim() !== "");

	for (const site of sites) {
		if (jobs.has(site.siteName)) {
			deps.logger?.warn(`Scheduler already running for ${site.siteName}`);
			continue;
		}

		if (!site.cron) {
			deps.logger?.error(`No cron expression for ${site.siteName}, skipping`);
			continue;
		}

		if (!cron.validate(site.cron)) {
			deps.logger?.error(
				`Invalid cron expression for ${site.siteName}: ${site.cron}`,
			);
			continue;
		}

		const job = cron.schedule(site.cron, async () => {
			const adapter = scraperConfig.getAdapter(site.adapterName);
			if (!adapter) {
				deps.logger?.error(
					`Adapter ${site.adapterName} not found for ${site.siteName}`,
				);
				return;
			}

			if (adapter.fetchList && site.listUrl) {
				await runListDiscovery(site, adapter, deps);
			} else {
				await runSingleUrl(site, adapter, deps);
			}
		});

		jobs.set(site.siteName, job);
		deps.logger?.info(
			`[scheduler] Started cron for ${site.siteName}: ${site.cron}`,
		);
	}
}

export function stopScheduler(): void {
	for (const [name, job] of jobs) {
		job.stop();
		jobs.delete(name);
	}
}

export function isSchedulerRunning(name: string): boolean {
	return jobs.has(name);
}
