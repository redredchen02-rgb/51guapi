// 純 HTML 提取：og/meta/title/h1 + 正文容器配平/密度兜底。
// 無網路、無 SSRF 耦合，純函數，供 generic-adapter 門面與測試直接 import。

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

// 常見正文容器 class/id 關鍵詞。
const CONTENT_CONTAINER_KEYWORDS =
	"post-content|post_content|article-content|article_content|entry-content|entry_content|content-detail|detail-content|main-content|main_content|article-body|article_body|post-body|post_body|rich_media_content|js_content|article-detail|article-text|news-content|cnt-article";

/** 去除 script/style 後剝光標籤、歸一空白。 */
function stripTagsToText(htmlFragment: string): string {
	return htmlFragment
		.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
		.replace(/<[^>]*>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

// 正文容器關鍵詞(用於在已切出的開標籤字串內做 includes 判定,非内嵌进定位正则)。
const CONTENT_KEYWORD_RE = new RegExp(`(?:${CONTENT_CONTAINER_KEYWORDS})`, "i");
const HAS_CLASS_OR_ID_RE = /\b(?:class|id)=/i;
// 开标签长度上限:真实开标签不会上万字符。有界量词杜绝「无界嵌套量词」的二次方回溯
// (ReDoS):恶意页面可构造无 `>`/无闭合引号/多 class= 锚点的 5MB HTML 触发资源耗尽。
const MAX_OPEN_TAG_LEN = 2048;

/**
 * 提取正文容器文本：定位 class/id 命中關鍵詞的 div/article/section 開標籤後,
 * **括號配平**找到對應閉合標籤（而非貪婪到首個同類閉合,否則嵌套容器會被腰斬）。
 *
 * 定位与属性判定分离:先用有界量词 `[^>]{0,N}>` 切出开标签,再在标签字串内用普通
 * 字符串/正则判断 class/id + 关键词,避免单条正则里两个无界 [^"']* 夹关键词的二次方回溯。
 */
function extractContainerText(html: string): string {
	// 先清掉註釋與 script/style:否則註釋內的 `<div>`、script 字串裡的 `</div>` 会污染
	// 括號配平,把頁尾噪聲灌進正文(吞過頭)。在清理後的副本上定位+配平,索引自洽。
	const cleaned = html
		.replace(/<!--[\s\S]*?-->/g, " ")
		.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
	const openTagRe = new RegExp(
		`<(div|article|section)\\b[^>]{0,${MAX_OPEN_TAG_LEN}}>`,
		"gi",
	);
	for (let m = openTagRe.exec(cleaned); m; m = openTagRe.exec(cleaned)) {
		const tagFull = m[0];
		if (
			!HAS_CLASS_OR_ID_RE.test(tagFull) ||
			!CONTENT_KEYWORD_RE.test(tagFull)
		) {
			continue;
		}
		const tag = m[1].toLowerCase();
		const start = m.index + m[0].length;
		// 從容器內部起對同類標籤開/閉計數,深度歸 0 處即對應閉合標籤。捕完整標籤以辨識
		// 自閉合 `<div/>`(不改深度,否則永等不到閉合 → 吞到頁尾)。
		const tokenRe = new RegExp(
			`<(/?)${tag}\\b[^>]{0,${MAX_OPEN_TAG_LEN}}>`,
			"gi",
		);
		tokenRe.lastIndex = start;
		let depth = 1;
		let endIdx = -1;
		for (let mm = tokenRe.exec(cleaned); mm; mm = tokenRe.exec(cleaned)) {
			if (mm[1] === "/") depth--;
			else if (!mm[0].endsWith("/>")) depth++;
			if (depth === 0) {
				endIdx = mm.index;
				break;
			}
		}
		// 配平失敗(未閉合/被 maxBytes 截斷)→ 不吞頁尾,跳過此容器另尋,最終落兜底。
		if (endIdx === -1) continue;
		return stripTagsToText(cleaned.slice(start, endIdx));
	}
	return "";
}

/** 文本密度兜底：剝掉 nav/header/footer/aside 噪聲後聚合 <p> 段落;不足則剝光 <body>。 */
function extractByDensity(rawHtml: string): string {
	const html = rawHtml.replace(
		/<(nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi,
		" ",
	);
	const paras = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
		.map((m) => stripTagsToText(m[1]))
		.filter((s) => s.length > 0);
	const joined = paras.join(" ").trim();
	if (joined.length >= 40) return joined;
	const bodyM = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
	return stripTagsToText(bodyM ? bodyM[1] : html);
}

/**
 * 正文提取（質量優先序）：
 *   1. 正文容器（括號配平,抓全嵌套內容）
 *   2. og:description / meta description（營銷摘要,僅作容器為空時兜底）
 *   3. 文本密度（聚合 <p> 段落）
 * 舊實現把 og:description 放第一優先,導致絕大多數有 og 的站點正文被截成一句話,
 * LLM 只能從標題+一句摘要提煉 → 起因/經過/結果 幾乎必空。
 */
function extractBody(html: string): string {
	const container = extractContainerText(html);
	if (container) return container;
	const og = extractOgMeta(html, "og:description");
	if (og) return og;
	const desc = extractMetaName(html, "description");
	if (desc) return desc;
	return extractByDensity(html);
}

export {
	extractBody,
	extractByDensity,
	extractContainerText,
	extractH1,
	extractMetaName,
	extractOgMeta,
	extractTitle,
	stripTagsToText,
};
