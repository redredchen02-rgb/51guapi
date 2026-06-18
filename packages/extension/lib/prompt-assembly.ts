import {
	type FactsBlock,
	type Settings,
	THEME_ALLOWLIST,
} from "@51guapi/shared";
import { buildPrompt } from "./messaging";
import { deriveFewShotExamples } from "./storage";

/** 构造 prompt 末尾的分类/标签约束块。recommendedTags 为空时只含分类约束。 */
export function buildConstraintSuffix(recommendedTags: string[]): string {
	const category = `分类约束：从吃瓜题材里挑一个最贴切的（${THEME_ALLOWLIST.join("、")} 等），没有合适的可留空。`;
	if (recommendedTags.length === 0) return `\n\n---\n${category}`;
	const tags = recommendedTags.join("，");
	return `\n\n---\n${category}\n标签约束：只能从以下列表中选择标签（如无匹配可留空，不要自造新词）：${tags}`;
}

/**
 * 组装单条选题的生成 prompt:正文模板 + 约束后缀(推荐标签)。
 *
 * 收敛 `handleRunBatch` 与 `handleRetryBatchItem` 中逐字节相同的内联组装
 * (两处仅外层 generateDraftFn 调用差一个 enrichment 参数,组装本身相同)。
 * 纯函数,不读 settings/apiKey、不缓存——调用方各自 await 读取后传入。
 */
export function assemblePrompt(
	settings: Settings,
	topic: string,
	facts?: FactsBlock,
): string {
	return (
		buildPrompt(
			settings.promptTemplate,
			topic,
			facts,
			deriveFewShotExamples(settings.fewShotPairs ?? []),
		) + buildConstraintSuffix(settings.recommendedTags ?? [])
	);
}
