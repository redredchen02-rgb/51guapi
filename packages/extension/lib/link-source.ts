// 连结来源校验(R6):草稿正文里任何 URL 必须能在输入事实里找到来源,否则=违规(疑似幻觉)。
// 与 sanitizeBody(防 XSS)正交 —— sanitize 原样放行远程 https 链接,故这是独立的另一道闸。
// 纯函数;extractLinks 用正则提取 HTML <a href>(无 DOM 依赖,SW 亦可用)。
//
// 不自动改写/剥除连结,只返回判定结果,由审核区(U4)渲染给人决定。

export interface LinkCheck {
	url: string;
	/** 该连结能否在输入事实里找到来源。false = 疑似 AI 自造。 */
	sourced: boolean;
}

/** 从正文 HTML 抽 <a href>。纯字串正则解析，无 DOM 环境(如 SW)亦可。 */
export function extractLinks(html: string): string[] {
	const links: string[] = [];
	const regex = /<a\s+(?:[^>]*?\s+)?href=(["'])(.*?)\1/gi;
	while (true) {
		const match = regex.exec(html);
		if (match === null) break;
		let href = (match[2] ?? "").trim();
		// Decode basic HTML entities that might have been escaped in href
		href = href
			.replace(/&quot;/g, '"')
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&amp;/g, "&");
		if (href) {
			links.push(href);
		}
	}
	return links;
}

/**
 * 归一化 URL 以宽松比对:忽略 scheme、host 转小写并去 `www.`、去尾斜杠。
 * 解析失败 → 返回 trim+小写的原串(仍可相等比对)。
 */
export function normalizeUrl(u: string): string {
	const raw = u.trim();
	try {
		const url = new URL(raw);
		const host = url.host.toLowerCase().replace(/^www\./, "");
		const path = url.pathname.replace(/\/+$/, "");
		return `${host}${path}${url.search}`;
	} catch {
		return raw.toLowerCase().replace(/\/+$/, "");
	}
}

/**
 * 校验正文 HTML 里的连结是否都来自 allowedUrls(输入事实里的 URL)。
 * 返回每条 body 连结的判定(去重,保序)。
 */
export function verifyLinks(html: string, allowedUrls: string[]): LinkCheck[] {
	const allowed = new Set(allowedUrls.map(normalizeUrl));
	const seen = new Set<string>();
	const out: LinkCheck[] = [];
	for (const href of extractLinks(html)) {
		const norm = normalizeUrl(href);
		if (seen.has(norm)) continue;
		seen.add(norm);
		out.push({ url: href, sourced: allowed.has(norm) });
	}
	return out;
}

/** 是否存在任何无来源连结(疑似幻觉)。 */
export function hasUnsourcedLink(checks: LinkCheck[]): boolean {
	return checks.some((c) => !c.sourced);
}
