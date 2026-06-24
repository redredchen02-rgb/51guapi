import type { HotSearchKeyword } from "../hot-search-store.js";
import { upsertHotSearchBatch } from "../hot-search-store.js";
import { scrapeBaidu } from "./baidu-scraper.js";
import { scrapeDouyin } from "./douyin-scraper.js";
import { isGossipOrEntertainment } from "./gossip-filter.js";
import type { HotSearchItem } from "./types.js";
import { scrapeWeibo } from "./weibo-scraper.js";

export interface ScrapeResult {
	baidu: number;
	weibo: number;
	douyin: number;
	total: number;
	errors: string[];
}

function buildKeywords(
	items: HotSearchItem[],
	platform: HotSearchKeyword["platform"],
	now: Date,
): HotSearchKeyword[] {
	const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
	const capturedAt = now.toISOString();
	return items.map((item) => ({
		id: `${platform}-${item.rankPosition}-${now.getTime()}`,
		keyword: item.keyword,
		platform,
		heatScore: item.heatScore,
		rankPosition: item.rankPosition,
		capturedAt,
		expiresAt,
	}));
}

export async function scrapeAllPlatforms(
	fetchFn?: typeof fetch,
): Promise<ScrapeResult> {
	const now = new Date();
	const errors: string[] = [];

	const [baiduResult, weiboResult, douyinResult] = await Promise.allSettled([
		scrapeBaidu(fetchFn),
		scrapeWeibo(fetchFn),
		scrapeDouyin(fetchFn),
	]);

	const baiduItems = (
		baiduResult.status === "fulfilled" ? baiduResult.value : []
	).filter((item) => isGossipOrEntertainment(item.keyword));
	const weiboItems = (
		weiboResult.status === "fulfilled" ? weiboResult.value : []
	).filter((item) => isGossipOrEntertainment(item.keyword));
	const douyinItems = (
		douyinResult.status === "fulfilled" ? douyinResult.value : []
	).filter((item) => isGossipOrEntertainment(item.keyword));

	if (baiduResult.status === "rejected")
		errors.push(`baidu: ${baiduResult.reason}`);
	if (weiboResult.status === "rejected")
		errors.push(`weibo: ${weiboResult.reason}`);
	if (douyinResult.status === "rejected")
		errors.push(`douyin: ${douyinResult.reason}`);

	const allKeywords: HotSearchKeyword[] = [
		...buildKeywords(baiduItems, "baidu", now),
		...buildKeywords(weiboItems, "weibo", now),
		...buildKeywords(douyinItems, "douyin", now),
	];

	if (allKeywords.length > 0) {
		upsertHotSearchBatch(allKeywords);
	}

	return {
		baidu: baiduItems.length,
		weibo: weiboItems.length,
		douyin: douyinItems.length,
		total: allKeywords.length,
		errors,
	};
}
