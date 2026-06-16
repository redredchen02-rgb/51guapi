import type { RawContent, SiteAdapter } from "../site-adapter.js";
import { safeFetch } from "../ssrf-guard.js";

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
		const res = await safeFetch(url, {
			headers: {
				"User-Agent":
					"Mozilla/5.0 (compatible; 51guapi-scraper/1.0; +http://127.0.0.1:3001)",
			},
		});

		if (!res.ok) {
			throw new Error(`HTTP ${res.status}: Failed to fetch ${url}`);
		}

		const html = await res.text();
		const title = extractTitle(html);
		const body = extractBody(html);

		if (!body) {
			throw new Error(`Empty body received from ${url}`);
		}

		return { title, body, url };
	},
};
