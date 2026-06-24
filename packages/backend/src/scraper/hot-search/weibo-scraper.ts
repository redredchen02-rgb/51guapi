import { allowlistCheck } from "../adapters/guarded-fetch.js";
import { safeFetch } from "../ssrf-guard.js";
import type { HotSearchItem } from "./types.js";

// Sina Visitor System — 兩步預熱取匿名 cookie，再抓熱搜。
// 每次呼叫做完整三步（個人工具低頻，不快取 cookie）。
const GENVISITOR_URL = "https://passport.weibo.com/visitor/genvisitor";
const VISITOR_URL_BASE = "https://passport.weibo.com/visitor/visitor";
const HOTSEARCH_URL = "https://weibo.com/ajax/side/hotSearch";

const UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

interface GenVisitorData {
	tid?: string;
}

interface WeiboHotItem {
	word?: string;
	num?: number;
	rank?: number;
}

interface WeiboHotResponse {
	ok?: number;
	data?: { realtime?: WeiboHotItem[] };
}

function makeFetch(fetchFn?: typeof fetch) {
	return async (url: string, init: RequestInit): Promise<Response> => {
		if (fetchFn) return fetchFn(url, init);
		return safeFetch(url, init, { allowlistCheck });
	};
}

function extractCookies(res: Response): string {
	// Node.js fetch 在 Headers 裡返回 set-cookie（逗號分隔）
	const raw = res.headers.get("set-cookie") ?? "";
	return raw
		.split(/,(?=[^;]+=)/)
		.map((c) => c.trim().split(";")[0])
		.filter(Boolean)
		.join("; ");
}

export async function scrapeWeibo(
	fetchFn?: typeof fetch,
): Promise<HotSearchItem[]> {
	const doFetch = makeFetch(fetchFn);

	// Step 1: 取 tid
	let tid: string;
	try {
		const res1 = await doFetch(GENVISITOR_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				"User-Agent": UA,
				Referer: "https://weibo.com/",
			},
			body: "cb=gen_callback&fp=undefined",
		});
		const data1 = (await res1.json()) as { data?: GenVisitorData };
		tid = data1?.data?.tid ?? "";
		if (!tid) {
			console.warn("[weibo-scraper] genvisitor: no tid in response");
			return [];
		}
	} catch (e) {
		console.warn("[weibo-scraper] genvisitor failed:", e);
		return [];
	}

	// Step 2: incarnate → 取 SUB + SUBP cookie
	let cookies: string;
	try {
		const rand = (Math.random() * 0.9 + 0.1).toFixed(16);
		const incarnateUrl = `${VISITOR_URL_BASE}?a=incarnate&t=${tid}&w=2&c=&gc=&cb=cross_domain&from=weibo&_rand=${rand}`;
		const res2 = await doFetch(incarnateUrl, {
			headers: { "User-Agent": UA, Referer: "https://weibo.com/" },
		});
		cookies = extractCookies(res2);
		if (!cookies) {
			console.warn("[weibo-scraper] incarnate: no cookies returned");
			return [];
		}
	} catch (e) {
		console.warn("[weibo-scraper] incarnate failed:", e);
		return [];
	}

	// Step 3: 熱搜請求
	let body: WeiboHotResponse;
	try {
		const res3 = await doFetch(HOTSEARCH_URL, {
			headers: {
				Cookie: cookies,
				"User-Agent": UA,
				Referer: "https://weibo.com/hot/search",
				"X-Requested-With": "XMLHttpRequest",
			},
		});
		if (!res3.ok) {
			console.warn("[weibo-scraper] hotsearch HTTP", res3.status);
			return [];
		}
		body = (await res3.json()) as WeiboHotResponse;
	} catch (e) {
		console.warn("[weibo-scraper] hotsearch failed:", e);
		return [];
	}

	const realtime = body?.data?.realtime ?? [];
	if (!realtime.length) return [];

	const nums = realtime.map((r) => r.num ?? 0);
	const maxNum = Math.max(...nums, 1);

	return realtime
		.filter((r): r is WeiboHotItem & { word: string } => Boolean(r.word))
		.map((r, i) => ({
			keyword: r.word,
			heatScore: Math.min(100, ((r.num ?? 0) / maxNum) * 100),
			rankPosition: r.rank ?? i + 1,
		}));
}
