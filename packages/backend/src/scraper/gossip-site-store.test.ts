import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GossipSiteConfig } from "./gossip-site-store.js";
import {
	deleteGossipSite,
	getGossipSite,
	listGossipSites,
	saveGossipSite,
} from "./gossip-site-store.js";

// Test-setup.ts has already set PUBLISHER_DATA_DIR to an isolated temp dir.
// We clear the gossip-sites subdirectory between tests.
const DATA_DIR = process.env.PUBLISHER_DATA_DIR!;
const SITES_DIR = join(DATA_DIR, "gossip-sites");

function cleanSites() {
	if (existsSync(SITES_DIR))
		rmSync(SITES_DIR, { recursive: true, force: true });
}

function makeSite(overrides: Partial<GossipSiteConfig> = {}): GossipSiteConfig {
	const now = new Date().toISOString();
	return {
		id: `site_test_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
		name: "測試站點",
		listUrl: "https://example-gossip.com/latest",
		enabled: true,
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

describe("gossip-site-store", () => {
	beforeEach(cleanSites);
	afterEach(cleanSites);

	it("save → get：資料完整往返", async () => {
		const site = makeSite();
		await saveGossipSite(site);
		const loaded = await getGossipSite(site.id);
		expect(loaded).not.toBeNull();
		expect(loaded?.name).toBe("測試站點");
		expect(loaded?.listUrl).toBe("https://example-gossip.com/latest");
		expect(loaded?.enabled).toBe(true);
	});

	it("listGossipSites：返回所有已存站點", async () => {
		const s1 = makeSite({ id: "site_a", name: "站點A" });
		const s2 = makeSite({ id: "site_b", name: "站點B" });
		await saveGossipSite(s1);
		await saveGossipSite(s2);
		const list = await listGossipSites();
		expect(list.length).toBe(2);
	});

	it("listGossipSites：空目錄返回空陣列", async () => {
		const list = await listGossipSites();
		expect(list).toHaveLength(0);
	});

	it("deleteGossipSite：刪除不存在的 id 返回 false 不拋出", async () => {
		const result = await deleteGossipSite("nonexistent-id");
		expect(result).toBe(false);
	});

	it("deleteGossipSite：成功刪除後 getGossipSite 返回 null", async () => {
		const site = makeSite();
		await saveGossipSite(site);
		await deleteGossipSite(site.id);
		const loaded = await getGossipSite(site.id);
		expect(loaded).toBeNull();
	});
});
