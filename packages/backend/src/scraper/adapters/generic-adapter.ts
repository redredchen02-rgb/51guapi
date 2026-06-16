// 通用 HTML adapter：不實作 SiteAdapter interface，僅供 gossip-routes.ts 直接呼叫。
// 以 heuristic <a href> 過濾發現詳情頁 URL，fetchContent 提取 og meta 為主。

import { getChannelByHostname } from "../channel-store.js";
import type { RawContent } from "../site-adapter.js";
import { isHostAllowed, loadSSRFAllowlist } from "../ssrf-allowlist.js";
import { SsrfError, safeFetch } from "../ssrf-guard.js";

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
	const prefix = channel.pathPrefix || "/";
	const path = target.pathname;
	const ok = path === prefix || path.startsWith(prefix);
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

function extractOgMeta(html: string, property: string): string {
	const re = new RegExp(
		`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${property}["']`,
		"i",
	);
	const m = html.match(re);
	return (m?.[1] ?? m?.[2] ?? "").trim();
}

function extractMetaName(html: string, name: string): string {
	const re = new RegExp(
		`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${name}["']`,
		"i",
	);
	const m = html.match(re);
	return (m?.[1] ?? m?.[2] ?? "").trim();
}

function extractTitle(html: string): string {
	const og = extractOgMeta(html, "og:title");
	if (og) return og;
	const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	return m ? m[1].replace(/<[^>]*>/g, "").trim() : "";
}

function extractH1(html: string): string {
	const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
	return m ? m[1].replace(/<[^>]*>/g, "").trim() : "";
}

function extractBody(html: string): string {
	const og = extractOgMeta(html, "og:description");
	if (og) return og;
	const desc = extractMetaName(html, "description");
	if (desc) return desc;
	// 嘗試常見正文容器
	const bodyRe =
		/<(?:div|article|section)[^>]+(?:class|id)=["'][^"']*(?:post-content|article-content|entry-content|content-detail|main-content)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|article|section)>/i;
	const m = html.match(bodyRe);
	if (m)
		return m[1]
			.replace(/<[^>]*>/g, " ")
			.replace(/\s+/g, " ")
			.trim();
	return "";
}

/**
 * 從清單頁 HTML 提取詳情頁 URL，帶 anchor text 作為 title。
 * 最多返回 20 條，不重複，同 hostname。
 */
export async function fetchList(listUrl: string): Promise<DiscoveredUrl[]> {
	// U6 P0:抓取前按目标 hostname 强制单渠道 path_prefix。
	let channel: ReturnType<typeof getChannelByHostname>;
	try {
		channel = enforcePathPrefix(new URL(listUrl));
	} catch {
		return []; // 路径越权或非法 URL → 视同抓取失败(fetchList 对错误一律返回空)
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
		return [];
	}
	if (!res.ok) return [];

	// 流式截断:不只信 content-length,逐块累计超 maxBytes 即中止。
	let html: string;
	try {
		html = await readBodyCapped(res, maxBytes);
	} catch {
		return [];
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
	return results;
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
	const title = extractH1(html) || extractTitle(html);
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
