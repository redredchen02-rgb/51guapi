import type { RawContent, SiteAdapter } from "../site-adapter.js";
import { guardedFetchHtml } from "./guarded-fetch.js";

function extractTitle(html: string): string {
	const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
	return m ? m[1].trim() : "Untitled";
}

function extractBody(html: string): string {
	// Strip all HTML tags for plain text
	const noTags = html.replace(/<[^>]*>/g, "");
	// Collapse whitespace
	return noTags.replace(/\s+/g, " ").trim();
}

export const demoAdapter: SiteAdapter = {
	name: "demo",

	async fetchContent(url: string): Promise<RawContent> {
		// 经共用三件套出站（allowlistCheck + enforcePathPrefix + readBodyCapped）：
		// 不裸调 safeFetch，避免漏接逐跳 allowlist 复检与 byte cap。
		const html = await guardedFetchHtml(url, {
			"User-Agent":
				"Mozilla/5.0 (compatible; 51guapi-scraper/1.0; +http://127.0.0.1:3002)",
		});
		const title = extractTitle(html);
		const body = extractBody(html);

		if (!body) {
			throw new Error(`Empty body received from ${url}`);
		}

		return { title, body, url };
	},
};
