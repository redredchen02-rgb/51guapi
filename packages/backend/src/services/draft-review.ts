import type { ContentDraft, ReviewResult } from "@51guapi/shared";
import { callLlmForJson } from "./draft-gen.js";
import type { LlmDeps } from "./fetch-backoff.js";

/** 从 LLM 响应 raw JSON 中提取 token 用量。兼容 OpenAI 标准和部分代理格式。 */
export function extractUsage(
	raw: unknown,
): { prompt: number; completion: number } | undefined {
	if (typeof raw !== "object" || raw === null) return undefined;
	const u = (raw as Record<string, unknown>).usage;
	if (typeof u !== "object" || u === null) return undefined;
	const obj = u as Record<string, unknown>;
	const prompt =
		typeof obj.prompt_tokens === "number"
			? obj.prompt_tokens
			: typeof obj.inputTokens === "number"
				? obj.inputTokens
				: undefined;
	const completion =
		typeof obj.completion_tokens === "number"
			? obj.completion_tokens
			: typeof obj.outputTokens === "number"
				? obj.outputTokens
				: undefined;
	if (prompt === undefined || completion === undefined) return undefined;
	return { prompt, completion };
}

const DEFAULT_CRITERIA = `你是专业吃瓜内容评审员。请对以下娱乐八卦草稿进行四维评审。

四个维度：
1. body_richness（正文丰富度）：正文字数≥150字、包含事件来龙去脉（起因/经过/结果），内容实质丰富、不空洞。
2. community_tone（吃瓜口吻）：用词活泼接地气，符合吃瓜博主风格，含知情人/爆料/疑似等词汇，不过于官方生硬。
3. title_quality（标题质量）：标题含当事人名或事件类型关键词，让读者一眼知道是哪条瓜，有信息量且吸引人。
4. category_accuracy（分类准确性）：分类是吃瓜题材（如出軌、塌房、緋聞、官宣等），标签反映具体事件类型，有实际含义。

仅输出 JSON，格式：{"dimensions":[{"name":"body_richness","pass":true,"reason":"一句话"},{"name":"community_tone","pass":true,"reason":"一句话"},{"name":"title_quality","pass":true,"reason":"一句话"},{"name":"category_accuracy","pass":true,"reason":"一句话"}]}`;

export function buildReviewPrompt(
	draft: ContentDraft,
	criteriaPrompt?: string,
): string {
	const criteria = criteriaPrompt?.trim() || DEFAULT_CRITERIA;
	const bodyText = draft.body.replace(/<[^>]+>/g, "").trim();
	return `${criteria}

草稿：
标题：${draft.title}
分类：${draft.category}
标签：${draft.tags.join("、") || "（无）"}
正文：${bodyText}`;
}

export type ReviewDraftResult =
	| {
			ok: true;
			result: ReviewResult;
			reviewCostTokens?: { prompt: number; completion: number };
	  }
	| { ok: false; error: string };

export async function reviewDraftLlm(
	draft: ContentDraft,
	criteriaPrompt: string | undefined,
	deps: LlmDeps,
): Promise<ReviewDraftResult> {
	const prompt = buildReviewPrompt(draft, criteriaPrompt);
	const result = await callLlmForJson(prompt, deps, "评审");
	if (!result.ok) return { ok: false, error: result.error };

	const { raw, parsed } = result;

	const dims = parsed.dimensions;
	if (!Array.isArray(dims))
		return { ok: false, error: "评审结果缺少 dimensions 字段。" };

	const dimensions = dims
		.filter(
			(d): d is Record<string, unknown> => typeof d === "object" && d !== null,
		)
		.map((d) => ({
			name: String(d.name ?? ""),
			pass: Boolean(d.pass),
			...(d.reason !== undefined ? { reason: String(d.reason) } : {}),
		}))
		.filter((d) => d.name.length > 0);

	const reviewCostTokens = extractUsage(raw);
	return {
		ok: true,
		result: { ok: true, dimensions },
		...(reviewCostTokens ? { reviewCostTokens } : {}),
	};
}
