// Web 搜索富化模块：用 Jina (r.jina.ai) 抓取 pixiv 作者页面补充作品资讯。
// 搜索结果喂入 LLM prompt，让文章更丰富有深度。
// 搜索失败时静默降级，不影响主管线。

import type { FactsBlock } from "@51guapi/shared";
import { getDb } from "./pending-db.js";

const UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const JINA_PREFIX = "https://r.jina.ai/";

export interface SearchResult {
	title: string;
	snippet: string;
	url: string;
}

export interface EnrichedContext {
	queryResults: Array<{
		query: string;
		results: SearchResult[];
	}>;
	collectedAt: string;
}

// ---- 缓存（内存 + SQLite 双层）----
const memoryCache = new Map<
	string,
	{ data: EnrichedContext; expiresAt: number; lastAccessedAt: number }
>();
const MEMORY_CACHE_TTL = 60 * 60 * 1000; // 1 小时
const MEMORY_CACHE_SIZE = 500; // 增大缓存容量，减少 LRU 淘汰频率
const DB_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 小时

function evictLruFromMemoryCache(): void {
	let lruKey: string | undefined;
	let lruTime = Infinity;
	for (const [k, v] of memoryCache) {
		if (v.lastAccessedAt < lruTime) {
			lruTime = v.lastAccessedAt;
			lruKey = k;
		}
	}
	if (lruKey) memoryCache.delete(lruKey);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

let _enrichmentTableReady = false;

/** 初始化富化缓存表（幂等，只执行一次）。 */
function initEnrichmentCacheTable(): void {
	if (_enrichmentTableReady) return;
	_enrichmentTableReady = true;
	try {
		const db = getDb();
		db.exec(`
			CREATE TABLE IF NOT EXISTS enrichment_cache (
				cache_key TEXT PRIMARY KEY,
				data TEXT NOT NULL,
				created_at TEXT NOT NULL
			);
			CREATE INDEX IF NOT EXISTS idx_enrichment_created ON enrichment_cache(created_at);
		`);
		// 清理过期缓存（24小时）
		db.prepare(
			"DELETE FROM enrichment_cache WHERE created_at < datetime('now', '-1 day')",
		).run();
	} catch {
		// 初始化失败不影响主流程
	}
}

/** 从 SQLite 加载缓存。 */
function loadFromDbCache(key: string): EnrichedContext | null {
	try {
		initEnrichmentCacheTable();
		const db = getDb();
		const row = db
			.prepare(
				`SELECT data, created_at FROM enrichment_cache WHERE cache_key = ?`,
			)
			.get(key) as { data: string; created_at: string } | undefined;

		if (!row) return null;

		const age = Date.now() - new Date(row.created_at).getTime();
		if (age > DB_CACHE_TTL) {
			db.prepare("DELETE FROM enrichment_cache WHERE cache_key = ?").run(key);
			return null;
		}

		return JSON.parse(row.data) as EnrichedContext;
	} catch {
		return null;
	}
}

/** 保存到 SQLite 缓存。 */
function saveToDbCache(key: string, data: EnrichedContext): void {
	try {
		initEnrichmentCacheTable();
		const db = getDb();
		db.prepare(
			`INSERT OR REPLACE INTO enrichment_cache (cache_key, data, created_at)
			 VALUES (?, ?, ?)`,
		).run(key, JSON.stringify(data), new Date().toISOString());
	} catch {
		// 保存失败不影响主流程
	}
}

function getCacheKey(facts: FactsBlock): string {
	return `${facts.制作 || ""}|${facts.作品名 || ""}`;
}

/** 从 Jina 返回的 Markdown 中提取有用信息。 */
function parseJinaContent(content: string, sourceUrl: string): SearchResult[] {
	const results: SearchResult[] = [];

	// 提取标题
	const titleMatch = content.match(/^Title:\s*(.+)$/m);
	const title = titleMatch ? titleMatch[1].trim() : "";

	// 提取页面描述或前几段作为摘要
	const lines = content.split("\n").filter((l) => l.trim());
	const snippetLines: string[] = [];

	for (const line of lines) {
		const trimmed = line.trim();
		// 跳过导航、图片链接等
		if (
			trimmed.startsWith("[![") ||
			trimmed.startsWith("* [") ||
			trimmed.startsWith("- [") ||
			trimmed.includes("pixiv.net/en/") ||
			trimmed.includes("pximg.net") ||
			trimmed.length < 10
		) {
			continue;
		}
		// 收集有意义的文本行
		if (snippetLines.length < 3 && !trimmed.startsWith("#")) {
			snippetLines.push(trimmed);
		}
	}

	const snippet = snippetLines.join(" ").slice(0, 300);

	if (title || snippet) {
		results.push({
			title: title || "pixiv 作者页面",
			snippet,
			url: sourceUrl,
		});
	}

	return results;
}

/** 用 Jina 抓取 pixiv 作者标签页面。 */
async function fetchPixivByArtist(
	artistName: string,
	fetchFn: typeof fetch = fetch,
	timeoutMs = 15_000,
): Promise<SearchResult[]> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const url = `${JINA_PREFIX}pixiv.net/tags/${encodeURIComponent(artistName)}`;
		const res = await fetchFn(url, {
			headers: {
				"User-Agent": UA,
				Accept: "text/plain",
			},
			signal: controller.signal,
		});

		if (!res.ok) return [];

		const content = await res.text();
		return parseJinaContent(
			content,
			`https://pixiv.net/tags/${encodeURIComponent(artistName)}`,
		);
	} catch {
		return [];
	} finally {
		clearTimeout(timer);
	}
}

/** 用 Jina 抓取 pixiv 搜索页面（作品名）。 */
async function fetchPixivByWork(
	workName: string,
	fetchFn: typeof fetch = fetch,
	timeoutMs = 15_000,
): Promise<SearchResult[]> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		// 去掉特殊字符，保留可搜索部分
		const cleanName = workName
			.replace(/[～〜~]/g, " ")
			.replace(/[（(][^）)]*[）)]/g, "")
			.replace(/\s+/g, " ")
			.trim();

		if (!cleanName) return [];

		const url = `${JINA_PREFIX}pixiv.net/tags/${encodeURIComponent(cleanName)}`;
		const res = await fetchFn(url, {
			headers: {
				"User-Agent": UA,
				Accept: "text/plain",
			},
			signal: controller.signal,
		});

		if (!res.ok) return [];

		const content = await res.text();
		return parseJinaContent(
			content,
			`https://pixiv.net/tags/${encodeURIComponent(cleanName)}`,
		);
	} catch {
		return [];
	} finally {
		clearTimeout(timer);
	}
}

/** 根据事实构建搜索任务列表。 */
function buildSearchTasks(
	facts: FactsBlock,
	maxQueries: number,
): Array<{ type: "artist" | "work"; query: string }> {
	const tasks: Array<{ type: "artist" | "work"; query: string }> = [];

	const maker = facts.制作?.trim();
	const name = facts.作品名?.trim();

	// 优先用作者名搜 pixiv（同人作者的主要平台）
	if (maker) {
		const coreMaker = maker.replace(/[（(][^）)]*[）)]/g, "").trim() || maker;
		tasks.push({ type: "artist", query: coreMaker });
	}

	// 用作品名搜 pixiv
	if (name && tasks.length < maxQueries) {
		tasks.push({ type: "work", query: name });
	}

	return tasks.slice(0, maxQueries);
}

/** 格式化富化上下文为 LLM prompt 可用的文本。 */
export function formatEnrichmentForPrompt(ctx: EnrichedContext): string {
	const hasAny = ctx.queryResults.some((qr) => qr.results.length > 0);
	if (!hasAny) return "";

	const lines: string[] = [
		"【网络参考资料】(以下为网络搜索结果，可参考用于丰富文章内容，但不得直接复制):",
	];

	for (const qr of ctx.queryResults) {
		if (qr.results.length === 0) continue;
		lines.push(`\n搜索「${qr.query}」结果：`);
		for (const r of qr.results) {
			lines.push(`- ${r.title}：${r.snippet}`);
			lines.push(`  来源：${r.url}`);
		}
	}

	const text = lines.join("\n");
	return text.length > 2000 ? `${text.slice(0, 2000)}\n...(已截断)` : text;
}

export interface EnrichDeps {
	facts: FactsBlock;
	maxQueries?: number;
	fetchFn?: typeof fetch;
	timeoutMs?: number;
	/** 最大并发数（默认 2，防止触发限流）。 */
	maxConcurrency?: number;
}

/** 执行单个搜索任务。 */
async function executeSearchTask(
	task: { type: "artist" | "work"; query: string },
	fetchFn: typeof fetch,
	timeoutMs: number,
): Promise<{ query: string; results: SearchResult[] }> {
	let results: SearchResult[];
	if (task.type === "artist") {
		results = await fetchPixivByArtist(task.query, fetchFn, timeoutMs);
	} else {
		results = await fetchPixivByWork(task.query, fetchFn, timeoutMs);
	}
	return { query: task.query, results };
}

/** 主入口：根据事实执行搜索富化，返回结构化上下文。 */
export async function enrichContext(
	deps: EnrichDeps,
): Promise<EnrichedContext> {
	const {
		facts,
		maxQueries = 3,
		fetchFn = fetch,
		timeoutMs = 15_000,
		maxConcurrency = 2,
	} = deps;

	const cacheKey = getCacheKey(facts);

	// 1. 检查内存缓存
	const memoryCached = memoryCache.get(cacheKey);
	if (memoryCached && memoryCached.expiresAt > Date.now()) {
		memoryCached.lastAccessedAt = Date.now();
		return memoryCached.data;
	}

	// 2. 检查 SQLite 缓存
	const dbCached = loadFromDbCache(cacheKey);
	if (dbCached) {
		// 回填内存缓存
		if (memoryCache.size >= MEMORY_CACHE_SIZE) {
			evictLruFromMemoryCache();
		}
		memoryCache.set(cacheKey, {
			data: dbCached,
			expiresAt: Date.now() + MEMORY_CACHE_TTL,
			lastAccessedAt: Date.now(),
		});
		return dbCached;
	}

	// 3. 执行搜索
	const tasks = buildSearchTasks(facts, maxQueries);
	if (tasks.length === 0) {
		return { queryResults: [], collectedAt: new Date().toISOString() };
	}

	const queryResults: EnrichedContext["queryResults"] = [];

	if (tasks.length <= maxConcurrency) {
		const results = await Promise.all(
			tasks.map((task) => executeSearchTask(task, fetchFn, timeoutMs)),
		);
		queryResults.push(...results);
	} else {
		for (let i = 0; i < tasks.length; i += maxConcurrency) {
			const batch = tasks.slice(i, i + maxConcurrency);
			const results = await Promise.all(
				batch.map((task) => executeSearchTask(task, fetchFn, timeoutMs)),
			);
			queryResults.push(...results);
			if (i + maxConcurrency < tasks.length) {
				await sleep(500 + Math.random() * 300);
			}
		}
	}

	const result: EnrichedContext = {
		queryResults,
		collectedAt: new Date().toISOString(),
	};

	// 4. 写入缓存
	if (memoryCache.size >= MEMORY_CACHE_SIZE) {
		evictLruFromMemoryCache();
	}
	memoryCache.set(cacheKey, {
		data: result,
		expiresAt: Date.now() + MEMORY_CACHE_TTL,
		lastAccessedAt: Date.now(),
	});
	saveToDbCache(cacheKey, result);

	return result;
}
