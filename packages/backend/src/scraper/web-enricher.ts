// Web 搜索富化模块（门面）：编排「双层缓存 + Jina/pixiv 搜索」生成富化上下文。
// 搜索结果喂入 LLM prompt，让文章更丰富有深度；失败时静默降级，不影响主管线。
//
// 拆分（Phase 4 Unit 3）后职责：
//   - enrichment-cache.ts：内存 LRU + SQLite 双层缓存（memoryCache/table 单例的唯一持有者）
//   - web-search.ts：Jina/pixiv 外呼与解析（固定出口前缀，security 钉死）
//   - 本文件：enrichContext 编排 + formatEnrichmentForPrompt + 公开 API 门面 re-export

import type { FactsBlock } from "@51guapi/shared";
import {
	type EnrichedContext,
	evictLruFromMemoryCache,
	getCacheKey,
	loadFromDbCache,
	MEMORY_CACHE_SIZE,
	MEMORY_CACHE_TTL,
	memoryCache,
	saveToDbCache,
} from "./enrichment-cache.js";
import { buildSearchTasks, executeSearchTask } from "./web-search.js";

export type { EnrichedContext } from "./enrichment-cache.js";
export { __clearForTest } from "./enrichment-cache.js";
// ---- 门面 re-export：保持公开 API 与拆分前逐字一致 ----
export type { SearchResult } from "./web-search.js";

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
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
