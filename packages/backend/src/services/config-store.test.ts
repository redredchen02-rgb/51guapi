import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, initPendingDb, resetPendingDb } from "../scraper/pending-db.js";
import {
	configDelete,
	configGet,
	configKeys,
	configSet,
} from "./config-store.js";

function resetConfig() {
	initPendingDb();
	getDb().exec("DELETE FROM config_store");
}

beforeEach(resetConfig);
afterAll(resetPendingDb); // 关闭泄漏的 SQLite 句柄

describe("config-store", () => {
	it("set → get 往返", () => {
		expect(configSet("k1", "v1")).toBe(true);
		expect(configGet("k1")).toBe("v1");
	});

	it("get 不存在的 key → null", () => {
		expect(configGet("missing")).toBeNull();
	});

	it("set 同 key 两次 → upsert 覆盖", () => {
		configSet("k", "old");
		configSet("k", "new");
		expect(configGet("k")).toBe("new");
	});

	it("configKeys 列出所有键", () => {
		configSet("a", "1");
		configSet("b", "2");
		expect(configKeys().sort()).toEqual(["a", "b"]);
	});

	it("configKeys 空表 → []", () => {
		expect(configKeys()).toEqual([]);
	});

	it("delete → 键消失，get 返回 null", () => {
		configSet("d", "x");
		expect(configDelete("d")).toBe(true);
		expect(configGet("d")).toBeNull();
	});

	it("delete 不存在的 key → true（no-op 成功）", () => {
		expect(configDelete("ghost")).toBe(true);
	});
});
