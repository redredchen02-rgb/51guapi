import { describe, expect, it } from "vitest";
import { scraperConfig } from "./scraper-config.js";
import type { SiteAdapter } from "./site-adapter.js";

function makeAdapter(name: string): SiteAdapter {
	return {
		name,
		fetchContent: async () => ({ title: "", body: "", url: "" }),
	};
}

describe("ScraperConfig", () => {
	it("registerAdapters（複數）→ 全數可 getAdapter 取得", () => {
		scraperConfig.reset();
		scraperConfig.registerAdapters([makeAdapter("a"), makeAdapter("b")]);
		expect(scraperConfig.getAdapter("a")).toBeDefined();
		expect(scraperConfig.getAdapter("b")).toBeDefined();
	});

	it("reset() → adapters 和 siteConfigs 均清空", () => {
		scraperConfig.registerAdapter(makeAdapter("x"));
		scraperConfig.addSiteConfig({
			siteName: "x-site",
			adapterName: "x",
			url: "https://x.test",
			cron: "0 * * * *",
			enabled: true,
		});
		scraperConfig.reset();
		expect(scraperConfig.listAdapters()).toHaveLength(0);
		expect(scraperConfig.listSiteConfigs()).toHaveLength(0);
	});
});
