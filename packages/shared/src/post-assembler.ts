// 正文组装器(程序化结构化生成,防幻觉核心)。
// 模型只产「叙事槽位」(纯文本口吻);事实骨架(當事人/時間/來源連結等)由程式从 GossipFactsBlock
// **原样注入**,模型物理上打不出这些值;缺的程式插「【待补】」。
//
// 不变量(由测试守护):
//   1. body 里出现的任何 <a href> 必定来自 facts 的 URL —— verifyLinks(body, factUrls(facts)) 恒无 unsourced。
//   2. 模型散文先剥成纯文本(去标签、去裸 URL)再 HTML 转义 —— 散文里零连结、零 HTML 注入。
//   3. 缺失的事实位一律【待补】,绝不由模型补。
//
// 纯函数、无副作用、不碰 chrome/DOM(正则实现,SW/jsdom/node 皆可跑)。参照 lib/facts.ts 风格。
// Migrated from packages/extension/lib/post-assembler.ts (identical to packages/backend/src/shared/post-assembler.ts)

import type { GossipFactsBlock } from "./gossip-facts.js";
import { HTTP_URL_PATTERN } from "./link-source.js";

export const PLACEHOLDER = "【待补】";

/**
 * 是否含「待补」占位标记(fail-safe)。
 * 只认开标记 `【待补`,故标注式 `【待补:作品名】`、裸式 `【待补】`、未闭合/残缺 `【待补`(无 `】`)
 * 一律命中;空/undefined/null 返回 false 且绝不抛错。
 */
export function containsPlaceholder(text: string | undefined | null): boolean {
	if (!text) return false;
	return text.includes("【待补");
}

/** 模型只产出的叙事槽位:纯文本口吻,**不含** body/HTML/URL/具体事实值。 */
export interface DraftSlots {
	/** 标题套话后缀,如「出軌疑雲」;當事人由程式前置。 */
	titleSuffix?: string;
	/** 副标题(一句俏皮吸睛话)。 */
	subtitle?: string;
	/** 引子散文(吃瓜口吻开场)。 */
	intro: string;
	/** 看点散文。 */
	highlights: string;
	/** 结尾招呼(可选)。 */
	outro?: string;
}

/** 组装产物:供 toDraft 填入 ContentDraft 的纯文本/HTML 字段。 */
export interface AssembledDraft {
	/** 纯文本(填入 text input,不转义)。 */
	title: string;
	/** 纯文本。 */
	subtitle: string;
	/** 正文 HTML(事实 verbatim 注入 + 散文转义)。 */
	body: string;
	/** 纯文本摘要(填入 textarea,不转义)。 */
	description: string;
}

/** 从 來源連結 字段值里抽第一个 URL，与 gossipFactUrls 同规则。 */
function firstUrl(s: string): string | null {
	const m = s.match(new RegExp(HTTP_URL_PATTERN, "i"));
	return m ? m[0] : null;
}

/**
 * 把模型散文剥成安全纯文本:
 *  - 去 HTML 标签(防注入);
 *  - 裸 URL → 【待补】(模型试图自造连结的信号,真连结只走程式注入);
 *  - 折叠空白。
 * 注意:正则去标签不是安全边界(可被未闭合标签绕过)—— 真正的边界是其后的 esc() 转义
 * (body 经 esc 后零 HTML 注入面)。此处只为产出可读纯文本;正文不做 HTML 渲染,故当前
 * 无下游 DOMPurify(未来若新增正文 HTML 预览渲染须同步引入)。
 */
export function sanitizeToPlainText(s: string | undefined): string {
	if (!s) return "";
	let t = s.replace(/<[^>]*>/g, " ");
	t = t
		.replace(new RegExp(HTTP_URL_PATTERN, "gi"), PLACEHOLDER)
		.replace(/\bwww\.[^\s]+/gi, PLACEHOLDER);
	return t.replace(/\s+/g, " ").trim();
}

/** HTML 文本转义(写进 body 的文本片段;grounding-gate verbatim 比对复用同一函数,确保同层规范化)。 */
export function esc(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** 渲染一条已提供的连结:有 URL → `标签:<a>`;有文本无 URL → `标签:文本`;空 → null(整行省略)。 */
function renderLink(label: string, field: string | undefined): string | null {
	const v = field?.trim();
	if (!v) return null;
	const url = firstUrl(v);
	if (!url) return `${label}:${esc(v)}`;
	const safe = esc(url);
	return `${label}:<a href="${safe}">${safe}</a>`;
}

/**
 * 组装吃瓜草稿：模型槽位 + gossip facts → title/subtitle/body/description。
 * 同一防幻觉不变量：body 里的 URL 来自 facts.來源連結（verbatim），
 * 模型散文经 sanitizeToPlainText + esc 处理，grounding 闸可正常通过。
 */
export function assembleGossipDraft(
	slots: DraftSlots,
	facts: GossipFactsBlock,
): AssembledDraft {
	const name = facts.當事人?.trim();
	const title = name
		? `${name}${(slots.titleSuffix ?? "").trim()}`
		: PLACEHOLDER;
	const subtitle = sanitizeToPlainText(slots.subtitle);
	const description =
		facts.事件摘要?.trim() ||
		sanitizeToPlainText(slots.subtitle || slots.intro).slice(0, 120);

	const parts: string[] = [];

	// 抬头块（只含已提供字段，verbatim）
	const headerBits: string[] = [];
	if (name) headerBits.push(`當事人:${esc(name)}`);
	if (facts.發生時間?.trim())
		headerBits.push(`發生時間:${esc(facts.發生時間.trim())}`);
	if (facts.熱度標籤?.trim())
		headerBits.push(`話題標籤:${esc(facts.熱度標籤.trim())}`);
	if (headerBits.length) parts.push(`<p>${headerBits.join("<br>")}</p>`);

	// 散文（模型，消毒+转义）
	const intro = sanitizeToPlainText(slots.intro);
	if (intro) parts.push(`<p>${esc(intro)}</p>`);
	const highlights = sanitizeToPlainText(slots.highlights);
	if (highlights) parts.push(`<p>${esc(highlights)}</p>`);

	// 来源链接（facts URL verbatim；模型碰不到）
	const sourceLink = renderLink("來源連結", facts.來源連結 ?? undefined);
	if (sourceLink) parts.push(`<p>${sourceLink}</p>`);

	// 结尾（可选）
	const outro = sanitizeToPlainText(slots.outro);
	if (outro) parts.push(`<p>${esc(outro)}</p>`);

	return { title, subtitle, body: parts.join("\n"), description };
}
