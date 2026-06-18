// 清單頁翻頁偵測：下一頁 URL 偵測 + 頁碼推斷 + 同源+協議白名單校驗。
// 純函數,無網路;resolveSameHost 含纵深防御(協議白名單 + 嚴格同源),禁簡化。

/**
 * 從清單頁 HTML 偵測「下一頁」URL。v0.2 保守支援：
 *   1. `<link rel="next" href=...>` 或 `<a ... rel="next" ...>`（HTML 標準）
 *   2. 常見分頁 pattern：`?page=N` / `?p=N` query、`/page/N` 路徑段
 * 偵測到的 URL 會絕對化並校驗「與當前頁同 host」；跨 host 一律不回傳（不跟隨）。
 * 偵測不到即回 undefined（呼叫方據此停止翻頁，不報錯）。
 */
function detectNextPageUrl(html: string, base: URL): string | undefined {
	// 1. rel="next"（link 或 a，rel 與 href 順序不限）
	const relNextRe =
		/<(?:a|link)\s[^>]*(?:rel=["'][^"']*\bnext\b[^"']*["'][^>]*href=["']([^"'#][^"']*)["']|href=["']([^"'#][^"']*)["'][^>]*rel=["'][^"']*\bnext\b[^"']*["'])/i;
	const relMatch = html.match(relNextRe);
	const relHref = relMatch?.[1] ?? relMatch?.[2];
	if (relHref) {
		const resolved = resolveSameHost(relHref.trim(), base);
		if (resolved) return resolved;
	}

	// 2. 常見分頁 pattern：href 指向 ?page=/?p= 或 /page/N，且頁碼大於當前頁
	const currentPage = currentPageNumber(base);
	const pagedRe =
		/<a\s[^>]*href=["']([^"'#][^"']*(?:[?&](?:page|p)=\d+|\/page\/\d+)[^"']*)["']/gi;
	let best: { url: string; n: number } | undefined;
	for (let m = pagedRe.exec(html); m !== null; m = pagedRe.exec(html)) {
		const candidate = resolveSameHost(m[1].trim(), base);
		if (!candidate) continue;
		const n = currentPageNumber(new URL(candidate));
		// 只跟隨「下一頁」：頁碼 = 當前頁 + 1（保守，避免跳到末頁或亂序）
		if (n === currentPage + 1 && (!best || n < best.n)) {
			best = { url: candidate, n };
		}
	}
	return best?.url;
}

/** 解析 href 為絕對 URL 並要求同 host；否則回 undefined。 */
function resolveSameHost(href: string, base: URL): string | undefined {
	let absolute: URL;
	try {
		absolute = new URL(href, base);
	} catch {
		return undefined;
	}
	// 协议白名单化（纵深防御）：只允许 http(s)，不依赖远端 safeFetch 这唯一一道。
	// 非 http(s) 的 next（file:/javascript:/data:）在此即不跟随。
	if (absolute.protocol !== "http:" && absolute.protocol !== "https:") {
		return undefined;
	}
	if (absolute.hostname !== base.hostname) return undefined;
	return absolute.toString();
}

/** 從 URL 推斷當前頁碼（?page=/?p= 或 /page/N），預設 1。 */
function currentPageNumber(u: URL): number {
	const q = u.searchParams.get("page") ?? u.searchParams.get("p");
	if (q && /^\d+$/.test(q)) return Number(q);
	const m = u.pathname.match(/\/page\/(\d+)/);
	if (m) return Number(m[1]);
	return 1;
}

export { currentPageNumber, detectNextPageUrl, resolveSameHost };
