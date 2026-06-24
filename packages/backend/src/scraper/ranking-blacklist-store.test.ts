import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initPendingDb } from "./pending-db.js";
import {
	addToBlacklist,
	clearBlacklistForTest,
	getBlacklistSet,
} from "./ranking-blacklist-store.js";

describe("ranking-blacklist-store", () => {
	beforeEach(() => {
		initPendingDb();
		clearBlacklistForTest();
	});

	afterEach(() => {
		clearBlacklistForTest();
	});

	it("getBlacklistSet 空庫回傳空 Set", () => {
		expect(getBlacklistSet().size).toBe(0);
	});

	it("addToBlacklist 後可從 getBlacklistSet 讀回", async () => {
		addToBlacklist("王力宏");
		// addToBlacklist 使用 pendingWriteQueue.enqueue，需等 microtask 完成
		await new Promise((r) => setTimeout(r, 20));
		expect(getBlacklistSet().has("王力宏")).toBe(true);
	});

	it("INSERT OR IGNORE：重複加入同一關鍵詞不報錯且只有一筆", async () => {
		addToBlacklist("章子怡");
		addToBlacklist("章子怡");
		await new Promise((r) => setTimeout(r, 20));
		const s = getBlacklistSet();
		expect(s.has("章子怡")).toBe(true);
		expect(s.size).toBe(1);
	});

	it("多個關鍵詞各自獨立加入", async () => {
		addToBlacklist("A");
		addToBlacklist("B");
		addToBlacklist("C");
		await new Promise((r) => setTimeout(r, 20));
		const s = getBlacklistSet();
		expect(s.size).toBe(3);
		expect(s.has("A")).toBe(true);
		expect(s.has("B")).toBe(true);
		expect(s.has("C")).toBe(true);
	});

	it("clearBlacklistForTest 清除全部黑名單", async () => {
		addToBlacklist("X");
		await new Promise((r) => setTimeout(r, 20));
		clearBlacklistForTest();
		expect(getBlacklistSet().size).toBe(0);
	});
});
