// 通用 HTML adapter：不實作 SiteAdapter interface，僅供 gossip-routes.ts 直接呼叫。
// 以 heuristic <a href> 過濾發現詳情頁 URL，fetchContent 提取 og meta 為主。
//
// 門面職責：留守 SSRF/流控棧(enforcePathPrefix/readBodyCapped/allowlistCheck/
// safeFetch 用法 + fetchListPaged 的 nextHost!==startHost 權威跨源復檢)，
// 純 HTML 提取與翻頁偵測委派 html-extractors.ts / list-pagination.ts。

import { getChannelByHostname } from "../channel-store.js";
import type { RawContent } from "../site-adapter.js";
import { isHostAllowed, loadSSRFAllowlist } from "../ssrf-allowlist.js";
import { SsrfError, safeFetch } from "../ssrf-guard.js";
import {
	extractBody,
	extractH1,
	extractOgMeta,
	extractTitle,
} from "./html-extractors.js";
import { detectNextPageUrl } from "./list-pagination.js";

// 每跳重过 allowlist:运行时载入 env ∪ 渠道存储,redirect 目标不在表内即拒。
function allowlistCheck(url: URL): boolean {
	return isHostAllowed(url, loadSSRFAllowlist());
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * U6 P0:抓取前强制单渠道 path_prefix。
 *
 * 信任边界:env 基线 allowlist(ALLOWED_HOSTS)来的 host 可能无渠道记录 —— 这种
 * 情况维持现状放行(host 命中即可爬全域),不破坏既有 env 渠道。只对「操作者经
 * channel-store 新增的渠道」强制其 pathPrefix:有渠道记录则 URL.pathname 必须以
 * pathPrefix 开头,否则抛 SsrfError 明确拒绝(不静默放行)。
 *
 * 返回该 host 的渠道记录(若有),供后续 max_bytes 取单渠道上限。
 */
function enforcePathPrefix(
	target: URL,
): ReturnType<typeof getChannelByHostname> {
	const channel = getChannelByHostname(target.hostname);
	if (!channel) return null; // env-only host,无渠道约束 → 维持现状放行
	// 归一去尾斜杠后要求分隔符边界:prefix "/news" 只放行 "/news" 与 "/news/...",
	// 不放行兄弟路径 "/newsletter"、"/news-admin"(startsWith 无边界会越权)。
	const prefix = (channel.pathPrefix || "/").replace(/\/+$/, "") || "/";
	const path = target.pathname;
	const ok = prefix === "/" || path === prefix || path.startsWith(`${prefix}/`);
	if (!ok) {
		throw new SsrfError(
			`URL path ${path} 不在渠道 ${target.hostname} 允许的前缀 ${prefix} 内`,
		);
	}
	return channel;
}

/**
 * U6 P0:流式读取响应体并强制 max_bytes 截断。
 *
 * 不信任 content-length(服务器可不返回或谎报)。逐块累计字节,超过 limit 即中止
 * 并抛错。redirect 跟随由 safeFetch 逐跳收敛完成,最终响应体到这层才被消费,故此
 * 处的截断也覆盖 redirect 链的最终响应体(safeFetch 内部无需改)。
 */
async function readBodyCapped(res: Response, limit: number): Promise<string> {
	const body = res.body;
	if (!body) return res.text(); // 无可读流(测试桩等)→ 回退,信任 mock
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let total = 0;
	let out = "";
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > limit) {
				await reader.cancel();
				throw new Error(`Response too large (streamed > ${limit} bytes)`);
			}
			out += decoder.decode(value, { stream: true });
		}
	} finally {
		reader.releaseLock();
	}
	out += decoder.decode();
	return out;
}

const UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

/** 詳情頁路徑模式：/段/數字ID(.html?可選) 或 /YYYY/MM/slug 或 /YYYYMMDD/slug 格式。 */
const DETAIL_PATH_RE =
	/^\/[a-z0-9_-]+\/\d+(?:\.html?)?(?:[?#].*)?$|\/\d{4}\/\d{2}\/[^/]+|\/\d{8}\/[^/]+/i;

export interface DiscoveredUrl {
	url: string;
	title?: string;
}

/** fetchListPage 的內部回傳：本頁詳情 URL + 偵測到的下一頁 URL（同 host、絕對化後）。 */
interface ListPageResult {
	urls: DiscoveredUrl[];
	/** 偵測到的下一頁 URL（已絕對化、已校驗同 host）；無則 undefined。 */
	nextPageUrl?: string;
}

/** fetchListPaged 累積詳情 URL 的硬上限，防止被誘導成無限翻頁放大器。 */
const MAX_PAGED_URLS = 200;

/**
 * fetchListPaged 翻頁「請求次數」的常量硬上限（纵深防御閘）。
 * maxPages 來自操作者寫入的 channel.maxDepth,代碼側不信任其上界——即使配置寫成
 * 極大值,這裡在消費點封頂,確保單次 discover 的出站 list-fetch 次數 ≤ MAX_PAGES。
 * MAX_PAGED_URLS 只封累積 URL 數,封不住「詳情 URL 稀疏時的請求次數」,故另設此閘。
 */
const MAX_PAGES = 50;

/**
 * 抓取單一清單頁：返回本頁詳情 URL（≤20，同 host，去重）+ 偵測到的下一頁 URL。
 * 共用既有 enforcePathPrefix + safeFetch({allowlistCheck}) + readBodyCapped。
 * 對任何錯誤（越權/網路/非 200/超 byteCap）一律返回空頁（urls=[]、無 next）。
 */
async function fetchListPage(listUrl: string): Promise<ListPageResult> {
	// U6 P0:抓取前按目标 hostname 强制单渠道 path_prefix。
	let channel: ReturnType<typeof getChannelByHostname>;
	try {
		channel = enforcePathPrefix(new URL(listUrl));
	} catch {
		return { urls: [] }; // 路径越权或非法 URL → 视同抓取失败
	}
	const maxBytes = channel?.maxBytes ?? DEFAULT_MAX_BYTES;

	let res: Response;
	try {
		res = await safeFetch(
			listUrl,
			{
				headers: {
					"User-Agent": UA,
					Accept: "text/html,application/xhtml+xml",
					"Accept-Language": "zh-TW,zh;q=0.9",
				},
			},
			{ allowlistCheck },
		);
	} catch {
		return { urls: [] };
	}
	if (!res.ok) return { urls: [] };

	// 流式截断:不只信 content-length,逐块累计超 maxBytes 即中止。
	let html: string;
	try {
		html = await readBodyCapped(res, maxBytes);
	} catch {
		return { urls: [] };
	}
	const base = new URL(listUrl);
	const seen = new Set<string>();
	const results: DiscoveredUrl[] = [];

	const hrefRe = /<a\s[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
	for (
		let m = hrefRe.exec(html);
		m !== null && results.length < 20;
		m = hrefRe.exec(html)
	) {
		const href = m[1].trim();
		const anchorHtml = m[2];
		let absolute: URL;
		try {
			absolute = new URL(href, base);
		} catch {
			continue;
		}
		if (absolute.hostname !== base.hostname) continue;
		if (!DETAIL_PATH_RE.test(absolute.pathname)) continue;
		const normalized = `${absolute.origin}${absolute.pathname}`;
		if (seen.has(normalized)) continue;
		seen.add(normalized);

		// 從 anchor 提取純文字 title
		const anchorText = anchorHtml
			.replace(/<img[^>]*>/gi, "")
			.replace(/<[^>]*>/g, " ")
			.replace(/\s+/g, " ")
			.trim();

		results.push({ url: normalized, title: anchorText || undefined });
	}

	const nextPageUrl = detectNextPageUrl(html, base);
	return { urls: results, nextPageUrl };
}

/**
 * 從清單頁 HTML 提取詳情頁 URL，帶 anchor text 作為 title。
 * 最多返回 20 條，不重複，同 hostname。單頁——既有呼叫方相容入口。
 */
export async function fetchList(listUrl: string): Promise<DiscoveredUrl[]> {
	const { urls } = await fetchListPage(listUrl);
	return urls;
}

/**
 * 有界的「跟隨翻頁」抓取：從 listUrl 起，最多跟隨 maxPages 個清單頁，
 * 累積各頁詳情 URL（跨頁去重）。每頁都經 fetchListPage 既有的
 * enforcePathPrefix + safeFetch({allowlistCheck}) + readBodyCapped（不開旁路）。
 *
 * 停止條件（任一即止）：
 *   - 已抓 maxPages 頁；
 *   - 本頁無下一頁 URL（偵測不到即停，深度未滿也停）；
 *   - 下一頁與起始 listUrl 不同 host（跨 host 不跟隨）；
 *   - 下一頁已在 visited set（防迴圈）；
 *   - 累積詳情 URL 達 MAX_PAGED_URLS 上限（截斷）。
 *
 * 對單頁錯誤降級為「停止翻頁、保留已抓」，不拋出（沿用 fetchList 的錯誤語義）。
 */
export async function fetchListPaged(
	listUrl: string,
	maxPages: number,
): Promise<DiscoveredUrl[]> {
	// 消费点封顶：无论 maxPages（= 不信任的 channel.maxDepth）多大，翻页请求次数 ≤ MAX_PAGES。
	const pages = Math.min(Math.max(1, Math.floor(maxPages) || 1), MAX_PAGES);
	let startHost: string;
	try {
		startHost = new URL(listUrl).hostname;
	} catch {
		return [];
	}

	const visited = new Set<string>();
	const seenDetail = new Set<string>();
	const accumulated: DiscoveredUrl[] = [];
	let current: string | undefined = listUrl;

	for (let i = 0; i < pages && current; i++) {
		if (visited.has(current)) break; // 防迴圈
		visited.add(current);

		const { urls, nextPageUrl }: ListPageResult = await fetchListPage(current);
		for (const item of urls) {
			if (seenDetail.has(item.url)) continue;
			seenDetail.add(item.url);
			accumulated.push(item);
			if (accumulated.length >= MAX_PAGED_URLS) return accumulated; // 上限截斷
		}

		// 下一頁：須同 host（與起始 listUrl）且未訪問過，否則停。
		if (!nextPageUrl) break;
		let nextHost: string;
		try {
			nextHost = new URL(nextPageUrl).hostname;
		} catch {
			break;
		}
		if (nextHost !== startHost) break; // 跨 host 不跟隨
		if (visited.has(nextPageUrl)) break; // 防迴圈
		current = nextPageUrl;
	}

	return accumulated;
}

/**
 * 抓取單篇詳情頁，提取 RawContent。
 * HTTP 非 2xx 時拋出含狀態碼的 Error。
 */
export async function fetchContent(url: string): Promise<RawContent> {
	// U6 P0:抓取前按目标 hostname 强制单渠道 path_prefix(越权抛 SsrfError)。
	const channel = enforcePathPrefix(new URL(url));
	const maxBytes = channel?.maxBytes ?? DEFAULT_MAX_BYTES;

	const res = await safeFetch(
		url,
		{
			headers: {
				"User-Agent": UA,
				Accept: "text/html,application/xhtml+xml",
				"Accept-Language": "zh-TW,zh;q=0.9",
			},
		},
		{ allowlistCheck },
	);

	if (!res.ok) {
		res.body?.cancel();
		throw new Error(`HTTP ${res.status}: Failed to fetch ${url}`);
	}

	// 流式截断:不只信 content-length,逐块累计超 maxBytes 即中止报错。
	const html = await readBodyCapped(res, maxBytes);
	// 優先 og:title → <title>(extractTitle 內已含此序) → h1。h1 降為末位兜底:
	// 很多站點 h1 是 logo/站名/欄目名,優先它會讓標題系統性錯成站名。
	const title = extractTitle(html) || extractH1(html);
	const body = extractBody(html);
	const coverImageUrl = extractOgMeta(html, "og:image") || undefined;
	const publishedTime =
		extractOgMeta(html, "article:published_time") ||
		extractOgMeta(html, "og:updated_time") ||
		undefined;

	return {
		title,
		body,
		url,
		coverImageUrl,
		metadata: publishedTime ? { publishedTime } : undefined,
	};
}
