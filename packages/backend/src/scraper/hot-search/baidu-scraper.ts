import { allowlistCheck } from "../adapters/guarded-fetch.js";
import { safeFetch } from "../ssrf-guard.js";
import type { HotSearchItem } from "./types.js";

const BAIDU_URL = "https://top.baidu.com/api/board?platform=pc&tab=realtime";

const UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

interface BaiduItem {
	word?: string;
	hotScore?: string | number;
	index?: number;
}

interface BaiduResponse {
	data?: {
		cards?: Array<{ content?: BaiduItem[] }>;
	};
}

function makeFetch(fetchFn?: typeof fetch) {
	return async (url: string, init: RequestInit): Promise<Response> => {
		if (fetchFn) return fetchFn(url, init);
		return safeFetch(url, init, { allowlistCheck });
	};
}

export async function scrapeBaidu(
	fetchFn?: typeof fetch,
): Promise<HotSearchItem[]> {
	const doFetch = makeFetch(fetchFn);
	let res: Response;
	try {
		res = await doFetch(BAIDU_URL, {
			headers: {
				Referer: "https://top.baidu.com/",
				"User-Agent": UA,
				Accept: "application/json",
			},
		});
	} catch (e) {
		console.warn("[baidu-scraper] fetch failed:", e);
		return [];
	}

	if (!res.ok) {
		console.warn("[baidu-scraper] HTTP", res.status);
		return [];
	}

	let body: BaiduResponse;
	try {
		body = (await res.json()) as BaiduResponse;
	} catch {
		console.warn("[baidu-scraper] invalid JSON");
		return [];
	}

	const content = body?.data?.cards?.[0]?.content ?? [];
	if (!content.length) return [];

	// hotScore 以本批次最高值正規化至 0-100
	const scores = content.map((c) => Number(c.hotScore ?? 0));
	const maxScore = Math.max(...scores, 1);

	return content
		.filter((c): c is BaiduItem & { word: string } => Boolean(c.word))
		.map((c, i) => ({
			keyword: c.word,
			heatScore: Math.min(100, (Number(c.hotScore ?? 0) / maxScore) * 100),
			rankPosition: c.index ?? i + 1,
		}));
}
