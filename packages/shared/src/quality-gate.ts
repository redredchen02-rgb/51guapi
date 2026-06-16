// 内容质量门禁：评估草稿是否达到发布标准。
// 纯函数、无副作用，可在 shared 包中复用。

import type { FactsBlock } from "./facts.js";
import { containsPlaceholder } from "./post-assembler.js";
import type { ContentDraft } from "./types.js";

export interface QualityCheck {
	/** 检查项名称。 */
	name: string;
	/** 是否通过。 */
	pass: boolean;
	/** 得分 0-1。 */
	score: number;
	/** 说明信息。 */
	message: string;
}

export interface QualityVerdict {
	/** 综合分 0-1。 */
	overall: number;
	/** 各项检查结果。 */
	checks: QualityCheck[];
	/** 是否通过（overall >= threshold）。 */
	pass: boolean;
}

/** 默认通过阈值。 */
const DEFAULT_THRESHOLD = 0.6;

/** 从 HTML 提取纯文本长度。 */
function plainTextLength(html: string): number {
	return html
		.replace(/<[^>]*>/g, "")
		.replace(/&[a-z]+;/gi, " ")
		.replace(/\s+/g, " ")
		.trim().length;
}

/** 检查正文长度。 */
function checkBodyLength(body: string): QualityCheck {
	const len = plainTextLength(body);
	const pass = len >= 150;
	const score = Math.min(len / 200, 1);
	return {
		name: "body_length",
		pass,
		score,
		message: pass ? `正文 ${len} 字，达标` : `正文仅 ${len} 字，建议 ≥150 字`,
	};
}

/** 检查事实完整性。 */
function checkFactsCompleteness(facts: FactsBlock): QualityCheck {
	const coreKeys = ["作品名", "集数", "制作", "漢化", "無修", "题材", "简介"];
	const filled = coreKeys.filter((k) => {
		const v = facts[k as keyof FactsBlock];
		return v && v.trim().length > 0;
	}).length;
	const ratio = filled / coreKeys.length;
	const pass = ratio >= 0.5;
	return {
		name: "facts_completeness",
		pass,
		score: ratio,
		message: pass
			? `事实填充率 ${(ratio * 100).toFixed(0)}%，达标`
			: `事实填充率仅 ${(ratio * 100).toFixed(0)}%，建议 ≥50%`,
	};
}

/** 检查标题质量。 */
function checkTitleQuality(title: string): QualityCheck {
	const hasPlaceholder = containsPlaceholder(title);
	const len = title.length;
	const pass = !hasPlaceholder && len >= 5 && len <= 100;
	const score = hasPlaceholder ? 0 : len >= 5 && len <= 100 ? 1 : 0.5;
	return {
		name: "title_quality",
		pass,
		score,
		message: hasPlaceholder
			? "标题含【待补】，需补全"
			: pass
				? `标题 ${len} 字，质量良好`
				: `标题长度 ${len} 字，建议 5-100 字`,
	};
}

/** 检查社区口吻。 */
function checkCommunityTone(body: string): QualityCheck {
	const toneWords = [
		"嗨嗨",
		"大家好",
		"推荐",
		"安利",
		"宝藏",
		"绝了",
		"太顶了",
		"快来看",
		"赶紧",
		"冲",
		"入坑",
		"必看",
		"神作",
		"良心",
		"小伙伴们",
		"各位",
		"紳士",
		"51娘",
	];
	const text = body.replace(/<[^>]*>/g, "").toLowerCase();
	const found = toneWords.filter((w) => text.includes(w));
	const pass = found.length >= 2;
	const score = Math.min(found.length / 3, 1);
	return {
		name: "community_tone",
		pass,
		score,
		message: pass
			? `检测到 ${found.length} 个社区词汇，口吻达标`
			: `仅检测到 ${found.length} 个社区词汇，建议增加口语化表达`,
	};
}

/** 检查标签准确性。 */
function checkTagsAccuracy(draft: ContentDraft): QualityCheck {
	const tags = draft.tags ?? [];
	const pass = tags.length >= 2 && tags.length <= 10;
	const score = tags.length >= 2 ? 1 : tags.length === 1 ? 0.5 : 0;
	return {
		name: "tags_accuracy",
		pass,
		score,
		message: pass
			? `${tags.length} 个标签，数量合适`
			: tags.length < 2
				? "标签不足 2 个，建议补充"
				: `标签过多（${tags.length} 个），建议精简`,
	};
}

/**
 * 评估草稿质量。
 * @param draft 草稿内容
 * @param facts 事实块（可选，用于事实完整性检查）
 * @param threshold 通过阈值（默认 0.6）
 */
export function evaluateQuality(
	draft: ContentDraft,
	facts?: FactsBlock,
	threshold: number = DEFAULT_THRESHOLD,
): QualityVerdict {
	const checks: QualityCheck[] = [
		checkBodyLength(draft.body),
		checkFactsCompleteness(facts ?? {}),
		checkTitleQuality(draft.title),
		checkCommunityTone(draft.body),
		checkTagsAccuracy(draft),
	];

	const totalScore = checks.reduce((sum, c) => sum + c.score, 0);
	const overall = checks.length > 0 ? totalScore / checks.length : 0;

	return {
		overall,
		checks,
		pass: overall >= threshold,
	};
}
