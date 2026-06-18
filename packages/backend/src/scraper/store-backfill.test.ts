// P6-2 一次性 JSON→SQLite backfill 验证。test-setup 给每个测试文件独立 temp DATA_DIR,
// 故此处写的 JSON 文件不会污染其他 store 测试。

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { dataDirEnv } from "../config/data-dir.js";
import {
	listGossipSites,
	__resetBackfillForTest as resetGossipBackfill,
} from "./gossip-site-store.js";
import { initPendingDb } from "./pending-db.js";
import {
	getAllPrompts,
	__resetBackfillForTest as resetPromptBackfill,
} from "./prompt-store.js";

const DATA_DIR = dataDirEnv() ?? "";
const PROMPTS_DIR = join(DATA_DIR, "prompts");
const SITES_DIR = join(DATA_DIR, "gossip-sites");

const ts = "2026-06-01T00:00:00.000Z";

describe("JSON→SQLite backfill (P6-2)", () => {
	beforeEach(() => {
		const db = initPendingDb();
		db.exec("DELETE FROM prompt_templates; DELETE FROM gossip_sites;");
		resetPromptBackfill();
		resetGossipBackfill();
	});

	it("prompt:旧 JSON(含 fewShotExamples)→ 迁入 SQLite 并归一为 fewShotPairs", async () => {
		await mkdir(PROMPTS_DIR, { recursive: true });
		await writeFile(
			join(PROMPTS_DIR, "p_legacy.json"),
			JSON.stringify({
				id: "p_legacy",
				name: "旧模板",
				template: "t",
				fewShotExamples: "Q\n---\nA",
				createdAt: ts,
				updatedAt: ts,
			}),
		);
		const p = (await getAllPrompts()).find((x) => x.id === "p_legacy");
		expect(p).toBeDefined();
		expect(p?.fewShotPairs).toEqual([{ input: "Q", output: "A" }]);
	});

	it("gossip-site:旧 JSON → 迁入 SQLite(enabled 往返)", async () => {
		await mkdir(SITES_DIR, { recursive: true });
		await writeFile(
			join(SITES_DIR, "s_legacy.json"),
			JSON.stringify({
				id: "s_legacy",
				name: "旧站点",
				listUrl: "https://g.example.com/latest",
				enabled: true,
				createdAt: ts,
				updatedAt: ts,
			}),
		);
		const s = (await listGossipSites()).find((x) => x.id === "s_legacy");
		expect(s).toBeDefined();
		expect(s?.enabled).toBe(true);
		expect(s?.listUrl).toBe("https://g.example.com/latest");
	});

	it("backfill 幂等:二次触发不重复插入、不报错", async () => {
		await mkdir(SITES_DIR, { recursive: true });
		await writeFile(
			join(SITES_DIR, "s_idem.json"),
			JSON.stringify({
				id: "s_idem",
				name: "幂等",
				listUrl: "https://g.example.com/x",
				enabled: false,
				createdAt: ts,
				updatedAt: ts,
			}),
		);
		await listGossipSites();
		resetGossipBackfill();
		const sites = await listGossipSites();
		expect(sites.filter((x) => x.id === "s_idem")).toHaveLength(1);
	});
});
