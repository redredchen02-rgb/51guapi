// 吃瓜题材（熱度標籤）解析与归一：纯函数、无 I/O。
// 题材信号 = GossipFactsBlock.熱度標籤（LLM 从文章推断的自由文本，逗号分隔）。
// 为防注入式怪标签污染题材集，解析时按分类 allow-list 归一；未识别 → 「其他」。
// 一条瓜可有多题材（在每个匹配题材下出现）；生成时按条目去重，避免同瓜重复生成。

import type { GossipFactsBlock } from "./gossip-facts.js";

/** 未识别标签归入的兜底题材。 */
export const OTHER_THEME = "其他";

/** 题材分类 allow-list（吃瓜常见类目）。LLM 自由标签按包含关系归一到这些。 */
export const THEME_ALLOWLIST: string[] = [
	"出軌",
	"劈腿",
	"解約",
	"撕逼",
	"公開戀情",
	"戀情",
	"分手",
	"結婚",
	"離婚",
	"塌房",
	"復出",
	"道歉",
	"爆料",
	"否認",
	"官宣",
	"緋聞",
	"炒作",
	"合作",
];

// 繁简异体字归一表（只覆盖题材 allow-list 用字）：把简体折叠到繁体，
// 使简体/繁体的熱度標籤都能命中繁体题材表。新增题材词若含简繁差异字，在此补对照。
const HANZI_FOLD: Record<string, string> = {
	轨: "軌",
	约: "約",
	开: "開",
	恋: "戀",
	结: "結",
	离: "離",
	复: "復",
	认: "認",
	绯: "緋",
	闻: "聞",
};

/** 按 HANZI_FOLD 把简体异体字折叠到繁体，用于简繁无关的题材匹配。 */
function fold(s: string): string {
	let out = "";
	for (const ch of s) out += HANZI_FOLD[ch] ?? ch;
	return out;
}

/**
 * 把一条瓜的 熱度標籤 解析为归一化的题材集（去重）。
 * - null/空 → [OTHER_THEME]
 * - 每个标签经简繁归一后按 allow-list 包含匹配；不匹配 → OTHER_THEME
 */
export function parseThemes(hot: string | null | undefined): string[] {
	if (!hot || !hot.trim()) return [OTHER_THEME];
	const raw = hot
		.split(/[,，、/|]/)
		.map((t) => t.trim())
		.filter((t) => t.length > 0);
	if (raw.length === 0) return [OTHER_THEME];
	const themes = new Set<string>();
	for (const tag of raw) {
		const ft = fold(tag);
		const match = THEME_ALLOWLIST.find((t) => {
			const ftt = fold(t);
			return ft === ftt || ft.includes(ftt);
		});
		themes.add(match ?? OTHER_THEME);
	}
	return [...themes];
}

/**
 * 把单个自由文字归一为吃瓜主题材（draft.category 单值分类用）。
 * 复用 parseThemes：命中 allow-list → 该题材；未识别/空 → OTHER_THEME。
 * 取首个题材作单值（多题材另由 tags / 题材选择器体现）。
 */
export function normalizeCategory(raw: string | undefined): string {
	return parseThemes(raw)[0] ?? OTHER_THEME;
}

/** 便捷重载：直接从 facts 取题材。 */
export function factThemes(facts: GossipFactsBlock): string[] {
	return parseThemes(facts.熱度標籤);
}

/** 统计一批 facts 的题材→计数（题材选择器用）。一条多题材在各题材各计一次。 */
export function countThemes(
	factsList: GossipFactsBlock[],
): { theme: string; count: number }[] {
	const counts = new Map<string, number>();
	for (const f of factsList) {
		for (const theme of factThemes(f)) {
			counts.set(theme, (counts.get(theme) ?? 0) + 1);
		}
	}
	return [...counts.entries()]
		.map(([theme, count]) => ({ theme, count }))
		.sort((a, b) => b.count - a.count);
}
