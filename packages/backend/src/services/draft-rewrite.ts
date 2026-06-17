import type { ContentDraft } from "@51guapi/shared";
import { callLlmForJson } from "./draft-gen.js";
import { extractUsage } from "./draft-review.js";
import type { LlmDeps } from "./fetch-backoff.js";

const DIM_LABELS: Record<string, string> = {
	body_richness: "正文（需更丰富充实，≥150字，有实质内容）",
	community_tone: "正文风格（需更贴近吃瓜娱乐报道口吻，含爆料/疑似等词汇）",
	title_quality: "标题（需更吸引人、有信息量）",
	category_accuracy: "分类和标签（需更准确匹配内容）",
};

export function buildRewritePrompt(
	draft: ContentDraft,
	failedDims: string[],
): string {
	const targets = failedDims.map((d) => DIM_LABELS[d] ?? d).join("\n- ");
	const bodyText = draft.body.replace(/<[^>]+>/g, "").trim();
	return `以下帖子草稿有以下维度未达标，请**仅**针对这些维度重写，其他字段不变：
- ${targets}

原草稿：
标题：${draft.title}
分类：${draft.category}
标签：${draft.tags.join("、") || "（无）"}
正文：${bodyText}

仅输出 JSON（包含需重写的字段，未改动字段省略）：
{"title":"改后标题","body":"<p>改后正文</p>","tags":["改后标签1","改后标签2"]}`;
}

export type RewriteDraftResult =
	| {
			ok: true;
			draft: ContentDraft;
			rewriteCostTokens?: { prompt: number; completion: number };
	  }
	| { ok: false; error: string };

export async function rewriteDraftLlm(
	draft: ContentDraft,
	failedDims: string[],
	deps: LlmDeps,
): Promise<RewriteDraftResult> {
	const prompt = buildRewritePrompt(draft, failedDims);
	const result = await callLlmForJson(prompt, deps, "重写");
	if (!result.ok) return { ok: false, error: result.error };

	const { raw, parsed } = result;

	const rewritten: ContentDraft = { ...draft };
	if (typeof parsed.title === "string" && parsed.title.trim())
		rewritten.title = parsed.title.trim();
	if (typeof parsed.body === "string" && parsed.body.trim())
		rewritten.body = parsed.body.trim();
	if (Array.isArray(parsed.tags)) {
		rewritten.tags = parsed.tags.map((t) => String(t)).filter(Boolean);
	}

	const rewriteCostTokens = extractUsage(raw);
	return {
		ok: true,
		draft: rewritten,
		...(rewriteCostTokens ? { rewriteCostTokens } : {}),
	};
}
