// enrichment-cache 单元测试：首个直接驱动 enrichment_cache 表的测试。
// 继承 config/test-setup.ts（临时 PUBLISHER_DATA_DIR）；DB 用例用每用例唯一 key，
// 避免 SQLite 行跨用例泄漏。

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
	__clearForTest,
	type EnrichedContext,
	evictLruFromMemoryCache,
	getCacheKey,
	loadFromDbCache,
	MEMORY_CACHE_SIZE,
	memoryCache,
	saveToDbCache,
} from "./enrichment-cache.js";
import { initPendingDb, resetPendingDb } from "./pending-db.js";

initPendingDb();

beforeEach(() => {
	__clearForTest();
});

afterAll(resetPendingDb); // 关闭泄漏的 SQLite 句柄

function ctx(tag: string): EnrichedContext {
	return {
		queryResults: [{ query: tag, results: [] }],
		collectedAt: "2026-06-12T00:00:00.000Z",
	};
}

describe("getCacheKey", () => {
	it("由 制作|作品名 组成，缺字段以空串占位", () => {
		expect(getCacheKey({ 制作: "a", 作品名: "b" })).toBe("a|b");
		expect(getCacheKey({ 制作: "a" })).toBe("a|");
		expect(getCacheKey({})).toBe("|");
	});
});

describe("SQLite 缓存往返", () => {
	it("save → load round-trip（唯一 key）", () => {
		const key = `rt-${Date.now()}-${Math.random()}`;
		expect(loadFromDbCache(key)).toBeNull();
		const data = ctx("round-trip");
		saveToDbCache(key, data);
		const loaded = loadFromDbCache(key);
		expect(loaded).toEqual(data);
	});

	it("不存在的 key 返回 null", () => {
		expect(loadFromDbCache(`missing-${Math.random()}`)).toBeNull();
	});
});

describe("evictLruFromMemoryCache", () => {
	it("逐出 lastAccessedAt 最小（最旧）的条目", () => {
		const now = Date.now();
		memoryCache.set("old", {
			data: ctx("old"),
			expiresAt: now + 1000,
			lastAccessedAt: now - 1000,
		});
		memoryCache.set("new", {
			data: ctx("new"),
			expiresAt: now + 1000,
			lastAccessedAt: now,
		});
		evictLruFromMemoryCache();
		expect(memoryCache.has("old")).toBe(false);
		expect(memoryCache.has("new")).toBe(true);
	});

	it("空缓存调用安全（不抛）", () => {
		expect(() => evictLruFromMemoryCache()).not.toThrow();
	});
});

describe("MEMORY_CACHE_SIZE 常量", () => {
	it("为 500（缓存容量上限）", () => {
		expect(MEMORY_CACHE_SIZE).toBe(500);
	});
});
