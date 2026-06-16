// 后台分类是固定 2 选 1(2026-06-05 从真后台实测:`2=漫畫文章 / 4=動漫文章`)。
// 模型常吐自由文字(「同人」「成人動畫」「校園/日常」),与后台 option 不符 → 填充 degrade、真帖缺分类。
// 这里把模型自由文字**归一化到后台真实 label**;fillNativeSelect 再按 label 文本命中真 option。
// 站点是 51漫画(漫畫优先),模糊/缺失时默认「漫畫文章」。纯数据 + 纯函数(站点知识,无 chrome/DOM 依赖)。
// Migrated from packages/extension/lib/vocab.ts (identical to packages/backend/src/shared/vocab.ts)

export interface CategoryOption {
	/** 后台 <option> 的 value。 */
	value: string;
	/** 后台 <option> 的显示文本(归一化目标;fillNativeSelect 按此文本命中)。 */
	label: string;
	/** 模型自由文字的关键词命中规则。 */
	keywords: RegExp;
}

// 顺序即优先级:先判「動漫」(動畫/番…),再判「漫畫」(漫畫/同人/本子…)。
export const CATEGORY_VOCAB: CategoryOption[] = [
	{
		value: "4",
		label: "動漫文章",
		keywords: /動漫|动漫|動畫|动画|新番|番劇|番剧|\bOVA\b|\bTV\b|anime|動畫化/i,
	},
	{
		value: "2",
		label: "漫畫文章",
		keywords:
			/漫畫|漫画|本子|同人誌|同人志|同人|畫集|画集|繪本|绘本|條漫|条漫|comic|manga/i,
	},
];

const FALLBACK_LABEL = "漫畫文章"; // 站点漫畫优先:模糊/未知/缺失 → 默认漫畫文章,操作者可在审核区改。

/**
 * 模型分类自由文字 → 后台真实 label('漫畫文章'/'動漫文章')。
 * 命中顺序:已是后台 value → 已是后台 label → 关键词模糊命中 → 兜底漫畫文章。
 * 返回 label(非 value):draft.category 保持可读,且 fillNativeSelect 的文本匹配能命中真 option。
 */
export function normalizeCategory(raw: string | undefined): string {
	const s = (raw ?? "").trim();
	if (!s) return FALLBACK_LABEL;
	const byValue = CATEGORY_VOCAB.find((c) => c.value === s);
	if (byValue) return byValue.label;
	const byLabel = CATEGORY_VOCAB.find((c) => c.label === s);
	if (byLabel) return byLabel.label;
	const byKeyword = CATEGORY_VOCAB.find((c) => c.keywords.test(s));
	if (byKeyword) return byKeyword.label;
	return FALLBACK_LABEL;
}
