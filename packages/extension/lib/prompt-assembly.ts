import { THEME_ALLOWLIST } from "@51guapi/shared";

/** 构造 prompt 末尾的分类/标签约束块。recommendedTags 为空时只含分类约束。 */
export function buildConstraintSuffix(recommendedTags: string[]): string {
	const category = `分类约束：从吃瓜题材里挑一个最贴切的（${THEME_ALLOWLIST.join("、")} 等），没有合适的可留空。`;
	if (recommendedTags.length === 0) return `\n\n---\n${category}`;
	const tags = recommendedTags.join("，");
	return `\n\n---\n${category}\n标签约束：只能从以下列表中选择标签（如无匹配可留空，不要自造新词）：${tags}`;
}
