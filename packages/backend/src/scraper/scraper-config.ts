import type { ScraperSiteConfig, SiteAdapter } from "./site-adapter.js";

class ScraperConfig {
	private adapters = new Map<string, SiteAdapter>();
	private siteConfigs: ScraperSiteConfig[] = [];

	registerAdapter(adapter: SiteAdapter): void {
		this.adapters.set(adapter.name, adapter);
	}

	registerAdapters(adapters: SiteAdapter[]): void {
		for (const a of adapters) this.registerAdapter(a);
	}

	getAdapter(name: string): SiteAdapter | undefined {
		return this.adapters.get(name);
	}

	listAdapters(): SiteAdapter[] {
		return [...this.adapters.values()];
	}

	addSiteConfig(config: ScraperSiteConfig): void {
		this.siteConfigs.push(config);
	}

	getSiteConfig(siteName: string): ScraperSiteConfig | undefined {
		return this.siteConfigs.find((c) => c.siteName === siteName);
	}

	listSiteConfigs(): ScraperSiteConfig[] {
		return [...this.siteConfigs];
	}

	/** 重置配置（仅用于测试隔离）。 */
	reset(): void {
		this.adapters.clear();
		this.siteConfigs = [];
	}
}

export const scraperConfig = new ScraperConfig();
