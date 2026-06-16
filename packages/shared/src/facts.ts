// 源接地(防幻觉)的事实块:解析"选题 + 事实"输入,把事实渲入 prompt。
// 纯函数、无副作用、不碰 chrome —— 供 side panel 解析输入、background 组 prompt 复用。
//
// 设计要点(见 plan 2026-06-05-002 U1/U2):
//   - 输入语法:`选题 || 作品名=… | 集数=… | 漢化=… | 無修=… | 简介=…`
//   - 无 `||` 的行 = 纯选题(零事实),向后兼容旧 textarea 用法。
//   - 事实是"只润色不造事实"契约的唯一事实来源;AI 不得新增此外的作品名/集数/连结。
// Migrated from packages/extension/lib/facts.ts (identical to packages/backend/src/shared/facts.ts)

/** 一条选题的结构化事实(全可选;缺的字段由模型在文中标【待补】)。 */
export interface FactsBlock {
	作品名?: string;
	集数?: string;
	制作?: string;
	漢化?: string;
	無修?: string;
	题材?: string;
	简介?: string;
	/** 连载/完结状态（扩展字段，不影响核心防幻觉）。 */
	状态?: string;
	/** 总章节数（扩展字段）。 */
	章节数?: string;
	/** 详细标签，逗号分隔（扩展字段）。 */
	标签?: string;
}

export type FactKey = keyof FactsBlock;

/** 核心字段顺序（参与置信度计算）。 */
export const CORE_FACT_KEYS: FactKey[] = [
	"作品名",
	"集数",
	"制作",
	"漢化",
	"無修",
	"题材",
	"简介",
];

/** 全部字段顺序（含扩展字段，渲 prompt 时使用）。 */
export const FACT_ORDER: FactKey[] = [
	...CORE_FACT_KEYS,
	"状态",
	"章节数",
	"标签",
];

/** 输入 key 别名 → 规范键。比对前会 trim + 转小写(中文不受影响)。 */
const KEY_ALIASES: Record<string, FactKey> = {
	作品名: "作品名",
	作品: "作品名",
	名称: "作品名",
	name: "作品名",
	title: "作品名",
	集数: "集数",
	集數: "集数",
	话数: "集数",
	話數: "集数",
	ep: "集数",
	eps: "集数",
	episodes: "集数",
	制作: "制作",
	製作: "制作",
	原作: "制作",
	studio: "制作",
	author: "制作",
	漢化: "漢化",
	汉化: "漢化",
	hanhua: "漢化",
	cn: "漢化",
	無修: "無修",
	无修: "無修",
	無修正: "無修",
	无修正: "無修",
	uncen: "無修",
	uncensored: "無修",
	题材: "题材",
	題材: "题材",
	标签: "题材",
	標籤: "题材",
	tags: "题材",
	tag: "题材",
	简介: "简介",
	簡介: "简介",
	描述: "简介",
	desc: "简介",
	description: "简介",
	intro: "简介",
	状态: "状态",
	status: "状态",
	连载: "状态",
	完结: "状态",
	章节数: "章节数",
	章节数量: "章节数",
	集数总计: "章节数",
	详细标签: "标签",
	detailedTags: "标签",
	detailTags: "标签",
};

/** 含 URL 的事实字段(连结来源校验的允许集来自这些)。 */
const URL_FIELDS: FactKey[] = ["漢化", "無修", "简介"];

/**
 * 每个事实字段在组装后 ContentDraft 里的落点(grounding verbatim 校验用)。
 * 与 post-assembler.assembleDraft 的注入位置保持一致:作品名→title、简介→description、
 * 集数/制作/漢化/無修(+扩展 状态/章节数)→body、题材/标签→tags。
 * grounding-gate 与 assembler 共用此映射,杜绝口径漂移。
 */
export type FactTarget = "title" | "body" | "description" | "tags";
export const FACT_TARGET: Record<FactKey, FactTarget> = {
	作品名: "title",
	简介: "description",
	集数: "body",
	制作: "body",
	漢化: "body",
	無修: "body",
	状态: "body",
	章节数: "body",
	题材: "tags",
	标签: "tags",
};

const TOPIC_FACTS_SEP = "||";
const FIELD_SEP = "|";

export interface ParsedTopic {
	topic: string;
	facts: FactsBlock;
}

/**
 * 解析一行"选题 + 事实"。
 * - 无 `||` → 纯选题、零事实(向后兼容)。
 * - 空行 → null(调用方跳过)。
 * - 宽容:未知 key 忽略;value 内含 `=` 只按首个 `=` 切;重复 key 后者覆盖。
 */
export function parseTopicLine(line: string): ParsedTopic | null {
	const trimmed = line.trim();
	if (trimmed === "") return null;

	const sepIdx = trimmed.indexOf(TOPIC_FACTS_SEP);
	if (sepIdx < 0) return { topic: trimmed, facts: {} };

	const topic = trimmed.slice(0, sepIdx).trim();
	const factsPart = trimmed.slice(sepIdx + TOPIC_FACTS_SEP.length);
	const facts: FactsBlock = {};

	for (const seg of factsPart.split(FIELD_SEP)) {
		const eq = seg.indexOf("=");
		if (eq < 0) continue;
		const rawKey = seg.slice(0, eq).trim().toLowerCase();
		const value = seg.slice(eq + 1).trim();
		if (value === "") continue;
		const canon = KEY_ALIASES[rawKey];
		if (canon) facts[canon] = value;
	}

	return { topic, facts };
}

/** facts 是否一条都没有(用于"全【待补】不计入合格率"判断)。 */
export function isEmptyFacts(facts: FactsBlock): boolean {
	return FACT_ORDER.every((k) => !facts[k]);
}

/** 收集 facts 里出现的所有 URL(连结来源校验的允许集)。 */
export function factUrls(facts: FactsBlock): string[] {
	const urls: string[] = [];
	const urlRe = /https?:\/\/[^\s|]+/gi;
	for (const k of URL_FIELDS) {
		const v = facts[k];
		if (!v) continue;
		const m = v.match(urlRe);
		if (m) urls.push(...m);
	}
	return urls;
}

/**
 * 把 facts 渲成 prompt 里的【事实】块 + 只润色契约约束。
 * 零事实 → 明确指示"通篇【待补】、绝不编造"。
 */
export function formatFactsForPrompt(facts: FactsBlock): string {
	const lines = FACT_ORDER.filter((k) => facts[k]).map(
		(k) => `- ${k}:${facts[k]}`,
	);
	if (lines.length === 0) {
		return "【事实】(未提供任何事实——请通篇用「【待补】」占位,绝不编造任何作品名/集数/原作/连结)";
	}
	return [
		"【事实】(只能使用以下事实;严禁新增或编造作品名/集数/原作/连结;缺的在文中写「【待补】」;连结只能原样使用下方给出的 URL):",
		...lines,
	].join("\n");
}

/**
 * 用模板 + 选题 + (可选)事实 + (可选)few-shot 组装最终 prompt。
 * 向后兼容:facts/fewShot 省略时,行为等同旧 buildPrompt(template, topic)。
 * 模板可含占位符 {{topic}} {{facts}} {{fewshot}};无占位符时按约定追加。
 */
export function applyPromptTemplate(
	template: string,
	topic: string,
	facts?: FactsBlock,
	fewShot?: string,
	enrichment?: string,
): string {
	let out = template.includes("{{topic}}")
		? template.replaceAll("{{topic}}", topic)
		: `${template}\n主题:${topic}`;

	if (facts !== undefined) {
		const block = formatFactsForPrompt(facts);
		out = out.includes("{{facts}}")
			? out.replaceAll("{{facts}}", block)
			: `${out}\n\n${block}`;
	} else {
		out = out.replaceAll("{{facts}}", "");
	}

	if (fewShot && fewShot.trim() !== "") {
		out = out.includes("{{fewshot}}")
			? out.replaceAll("{{fewshot}}", fewShot)
			: `${fewShot}\n\n${out}`;
	} else {
		out = out.replaceAll("{{fewshot}}", "");
	}

	if (enrichment && enrichment.trim() !== "") {
		out = out.includes("{{enrichment}}")
			? out.replaceAll("{{enrichment}}", enrichment)
			: `${out}\n\n${enrichment}`;
	} else {
		out = out.replaceAll("{{enrichment}}", "");
	}

	return out.trim();
}
