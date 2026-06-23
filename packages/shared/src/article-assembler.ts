// 文章组装器：规范七/八 九段落结构，同防幻觉不变量。
// 模型只产叙事槽位（纯文本口吻）；事实骨架由程序从 GossipFactsBlock verbatim 注入。
// body 里唯一的 <a href> 来自 facts.來源連結；模型散文经 sanitize+esc，不含 HTML 或 URL。

import type { GossipFactsBlock } from "./gossip-facts.js";
import { HTTP_URL_PATTERN } from "./link-source.js";
import { esc, PLACEHOLDER, sanitizeToPlainText } from "./post-assembler.js";

/** 模型可写槽位：纯文本口吻，不含事实值、不含 URL、不含 HTML。 */
export interface ArticleSlots {
	titleSuffix?: string;
	intro: string;
	narrative: string;
	faqItems: { q: string; a: string }[];
	conclusion: string;
	tags: string[];
	keywords?: string[];
}

/** 组装产物：供路由层包装为 ContentDraft。 */
export interface AssembledArticle {
	title: string;
	body: string;
	description: string;
	tags: string[];
	keywords: string[];
}

/** 剔除 --> 防止破坏 HTML 注释包装（<!-- section:X --> 标记）。 */
function safeForHtmlComment(s: string): string {
	return s.replace(/-->/g, "—");
}

/** 散文统一处理：sanitize（去标签、去裸 URL）→ safeForHtmlComment → esc。 */
function sanitizeEscForComment(raw: string | undefined): string {
	return esc(safeForHtmlComment(sanitizeToPlainText(raw)));
}

/** 从 field 值里取第一个 URL，与 gossipFactUrls 同规则。 */
function firstUrl(s: string): string | null {
	const m = s.match(new RegExp(HTTP_URL_PATTERN, "i"));
	return m ? m[0] : null;
}

/** 渲染来源链接段：有 URL → `<a href>`；有文本无 URL → 纯文本；空 → null。 */
function renderSourceLink(
	label: string,
	field: string | undefined,
): string | null {
	const v = field?.trim();
	if (!v) return null;
	const url = firstUrl(v);
	if (!url) return `${label}：${esc(v)}`;
	const safe = esc(url);
	return `${label}：<a href="${safe}">${safe}</a>`;
}

/** 从 GossipFactsBlock 生成"一分钟快速看懂"段落（verbatim，跳过空字段）。 */
function renderQuickInfo(facts: GossipFactsBlock): string {
	const fields: [string, string | null][] = [
		["人物/主体", facts.當事人],
		["事件摘要", facts.事件摘要],
		["发生时间", facts.發生時間],
		["起因", facts.起因],
		["经过", facts.經過],
		["结果/当前进展", facts.結果],
		["热度标签", facts.熱度標籤],
	];
	const bits = fields
		.filter(([, v]) => v !== null && v !== undefined && v !== "")
		.map(([k, v]) => `${esc(k)}：${esc(v as string)}`);
	if (!bits.length) return "";
	return `<p>${bits.join("<br>")}</p>`;
}

/**
 * 组装吃瓜文章（规范七/八 九段结构）。
 *
 * 防幻觉不变量（同 assembleGossipDraft）：
 *   1. body 里唯一的 <a href> 来自 facts.來源連結（verbatim）。
 *   2. 模型散文 → sanitizeToPlainText → safeForHtmlComment → esc；零 URL、零 HTML 注入。
 *   3. 缺失事实位一律 PLACEHOLDER，绝不由模型补。
 */
export function assembleGossipArticle(
	slots: ArticleSlots,
	facts: GossipFactsBlock,
): AssembledArticle {
	const name = facts.當事人?.trim();
	const titlePrefix = name ?? PLACEHOLDER;
	const titleSuffix = sanitizeToPlainText(slots.titleSuffix).trim();
	const title = titleSuffix ? `${titlePrefix}${titleSuffix}` : titlePrefix;

	const parts: string[] = [];

	// 1. 开头简介（模型，sanitize+esc）
	const intro = sanitizeEscForComment(slots.intro);
	if (intro) {
		parts.push("<!-- section:intro -->");
		parts.push(`<p>${intro}</p>`);
	}

	// 2. 一分钟快速看懂（verbatim facts，零模型输入）
	const quickInfo = renderQuickInfo(facts);
	if (quickInfo) {
		parts.push("<!-- section:quickinfo -->");
		parts.push(quickInfo);
	}

	// 3. 事件经过（模型，sanitize+esc）
	const narrative = sanitizeEscForComment(slots.narrative);
	if (narrative) {
		parts.push("<!-- section:narrative -->");
		parts.push(`<p>${narrative}</p>`);
	}

	// 4. 图片展示（静态占位，零模型输入，零 URL）
	parts.push("<!-- section:images -->");
	parts.push(`<p>${PLACEHOLDER}：图片</p>`);

	// 5. 视频介绍（静态占位，零模型输入）
	parts.push("<!-- section:video -->");
	parts.push(`<p>${PLACEHOLDER}：视频说明</p>`);

	// 6. FAQ（模型，q+a 均 sanitize+esc）
	parts.push("<!-- section:faq -->");
	for (const { q, a } of slots.faqItems) {
		const safeQ = sanitizeEscForComment(q);
		const safeA = sanitizeEscForComment(a);
		if (safeQ || safeA) {
			parts.push(`<p><strong>Q：</strong>${safeQ}</p>`);
			parts.push(`<p><strong>A：</strong>${safeA}</p>`);
		}
	}

	// 7. 结尾总结（模型，sanitize+esc）
	const conclusion = sanitizeEscForComment(slots.conclusion);
	if (conclusion) {
		parts.push("<!-- section:conclusion -->");
		parts.push(`<p>${conclusion}</p>`);
	}

	// 8. 来源链接（facts.來源連結 verbatim；body 里唯一的 <a href>）
	const sourceLink = renderSourceLink("来源连结", facts.來源連結 ?? undefined);
	if (sourceLink) {
		parts.push("<!-- section:source -->");
		parts.push(`<p>${sourceLink}</p>`);
	}

	const body = parts.join("\n");
	const description =
		facts.事件摘要?.trim() || sanitizeToPlainText(slots.intro).slice(0, 120);

	return {
		title,
		body,
		description,
		tags: slots.tags.map((t) => t.trim()).filter(Boolean),
		keywords: (slots.keywords ?? []).map((k) => k.trim()).filter(Boolean),
	};
}
