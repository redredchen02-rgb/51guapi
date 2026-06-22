import type { ContentDraft } from "@51guapi/shared";
import {
	esc,
	hasUnsourcedLink,
	sanitizeToPlainText,
	verifyLinks,
} from "@51guapi/shared";
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

	// A5(P0,二轮审稿终定):rewrite 路径视模型为只写散文。整个 draft 来自客户端、无服务端
	// ground truth,故任何「客户端允许集」(facts/原 body 链接)都可被自我放行——一律否决。
	// 改为:把模型返回的 title/body/tags 经与生成路径同款 sanitizeToPlainText(body 再 esc)
	// 中和后再存储/导出,剥掉 anchor / 裸文本 / markdown 一切链接形式(sanitizeToPlainText
	// 去标签 + 裸 URL→【待补】)。模型零链接,不依赖任何允许集。真 sink 是 export.ts 的
	// verbatim JSON/Markdown 导出,故中和必须在存储/导出前。
	// 中和必须对**最终** draft 的 title/body/tags **无条件**执行,而非仅当模型返回该字段。
	// rewrite 仅针对部分 failedDims,模型常省略其余字段;若只中和「模型返回的字段」,模型省略
	// 时客户端原始 draft 的裸文本/markdown 链接会原样穿透进 export.ts 的 JSON/Markdown 导出
	// (对抗审计已实证可绕)。取「模型返回值优先,否则客户端原值」为最终值,再统一中和——无论
	// 来源是模型还是客户端,一律剥链(anchor 去标签 / 裸 URL→【待补】 / markdown URL 剥除)。
	const titleSrc =
		typeof parsed.title === "string" && parsed.title.trim()
			? parsed.title
			: draft.title;
	const bodySrc =
		typeof parsed.body === "string" && parsed.body.trim()
			? parsed.body
			: draft.body;
	const tagsSrc = Array.isArray(parsed.tags) ? parsed.tags : draft.tags;

	const rewritten: ContentDraft = {
		...draft,
		title: sanitizeToPlainText(titleSrc),
		body: `<p>${esc(sanitizeToPlainText(bodySrc))}</p>`,
		tags: tagsSrc.map((t) => sanitizeToPlainText(String(t))).filter(Boolean),
	};

	// 纵深防御(生成路径同款,允许集恒空):中和后 body 不应含任何 <a href>。主防线是上面
	// 的中和,此处只锁「未来若中和被绕过即拒」的不变量,正常永不触发。
	if (hasUnsourcedLink(verifyLinks(rewritten.body, []))) {
		return {
			ok: false,
			error: "草稿正文含未溯源链接(疑似模型自造),已拒绝。",
		};
	}

	const rewriteCostTokens = extractUsage(raw);
	return {
		ok: true,
		draft: rewritten,
		...(rewriteCostTokens ? { rewriteCostTokens } : {}),
	};
}
