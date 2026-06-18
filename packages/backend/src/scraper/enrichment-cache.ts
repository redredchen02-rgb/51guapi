// 富化缓存层（内存 LRU + SQLite 双层）。
//
// 单一所有者不变量：本文件是 `memoryCache` 与 `_enrichmentTableReady` 的唯一持有者。
// 所有消费者必须经同一 `./enrichment-cache.js` specifier import，禁止第二份实例——
// 否则缓存语义会因实例分裂而失效。模块级单例拓扑与拆分前完全一致（不改工厂）。

import type { FactsBlock } from "@51guapi/shared";
import { getDb } from "./pending-db.js";
import type { SearchResult } from "./web-search.js";

export interface EnrichedContext {
	queryResults: Array<{
		query: string;
		results: SearchResult[];
	}>;
	collectedAt: string;
}

export const MEMORY_CACHE_TTL = 60 * 60 * 1000; // 1 小时
export const MEMORY_CACHE_SIZE = 500; // 增大缓存容量，减少 LRU 淘汰频率
export const DB_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 小时

// ---- 内存缓存（模块级单例，本文件唯一持有）----
export const memoryCache = new Map<
	string,
	{ data: EnrichedContext; expiresAt: number; lastAccessedAt: number }
>();

export function evictLruFromMemoryCache(): void {
	let lruKey: string | undefined;
	let lruTime = Number.POSITIVE_INFINITY;
	for (const [k, v] of memoryCache) {
		if (v.lastAccessedAt < lruTime) {
			lruTime = v.lastAccessedAt;
			lruKey = k;
		}
	}
	if (lruKey) memoryCache.delete(lruKey);
}

// ---- SQLite 缓存 ----
let _enrichmentTableReady = false;

/** 初始化富化缓存表（幂等，进程级只执行一次）。 */
export function initEnrichmentCacheTable(): void {
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
export function loadFromDbCache(key: string): EnrichedContext | null {
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
export function saveToDbCache(key: string, data: EnrichedContext): void {
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

export function getCacheKey(facts: FactsBlock): string {
	return `${facts.制作 || ""}|${facts.作品名 || ""}`;
}

/**
 * 仅供测试：清空内存缓存以隔离用例。
 * 决策：只清 `memoryCache`，**不**清 `_enrichmentTableReady`——后者生产语义是
 * 「进程级一次性建表」，reset 它会让每用例重跑 CREATE + DELETE 过期 SQL（=行为变更）。
 * 不清它安全的理由：测试 DB 走临时目录（config/test-setup.ts）且 CREATE TABLE IF NOT EXISTS 幂等。
 */
export function __clearForTest(): void {
	memoryCache.clear();
}
