// 文章草稿生成服务（规范七/八）：gossip facts → 九段落 ContentDraft。
// 同防幻觉不变量：模型只写叙事槽位；事实由 assembleGossipArticle verbatim 注入。

import type {
	ArticleSlots,
	ContentDraft,
	GossipFactsBlock,
} from "@51guapi/shared";
import {
	assembleGossipArticle,
	gossipFactUrls,
	hasUnsourcedLink,
	toDraft,
	validateArticleTags,
	verifyLinks,
} from "@51guapi/shared";
import { chatCompletionsUrl } from "./draft-gen.js";
import { fetchWithBackoff, type LlmDeps } from "./fetch-backoff.js";

// ---------------------------------------------------------------------------
// JSON Schema（供 LLM structured output 使用，放在后端服务层，不进 shared）
// ---------------------------------------------------------------------------

const ARTICLE_SLOTS_SCHEMA = {
	name: "article_slots",
	strict: true,
	schema: {
		type: "object",
		additionalProperties: false,
		properties: {
			titleSuffix: { type: ["string", "null"] },
			intro: { type: "string" },
			narrative: { type: "string" },
			faqItems: {
				type: "array",
				items: {
					type: "object",
					properties: {
						q: { type: "string" },
						a: { type: "string" },
					},
					required: ["q", "a"],
					additionalProperties: false,
				},
			},
			conclusion: { type: "string" },
			tags: { type: "array", items: { type: "string" } },
			keywords: {
				type: ["array", "null"],
				items: { type: "string" },
			},
		},
		required: ["intro", "narrative", "faqItems", "conclusion", "tags"],
	},
} as const;

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function buildArticlePrompt(facts: GossipFactsBlock): string {
	const factsJson = JSON.stringify(facts, null, 2);
	return `你是一位娱乐资讯编辑，负责为已核实的吃瓜选题生成结构化文章草稿。

## 已核实素材（JSON 格式，逐字参考，不得更改事实）

\`\`\`json
${factsJson}
\`\`\`

## 任务

请基于以上素材，生成以下 JSON 格式的文章草稿。

重要约束（违反则整篇无效）：
- 所有文本槽位只写口吻散文，不写 URL、不写 HTML 标签
- 未证实信息使用"网传"/"疑似"/"被曝"/"据传"等限定词
- 标签只用素材中客观存在的词，禁止：爆款、必看、炸裂、刺激到不行、最好看、顶级、神仙

JSON 字段说明：
- titleSuffix（可选）：标题套话后缀（人物名前置后整体 25-35 字），纯文本，无 URL、无 HTML
- intro（必填）：80-120 字开头简介，直接切入事件，不重复标题，未证实信息加限定词
- narrative（必填）：100-200 字按时间顺序整理事件起因、发展和当前情况，以素材为准
- faqItems（必填）：3-5 个用户最关心的问答，每项 {"q": "问题", "a": "回答"}，纯文本
- conclusion（必填）：约 80 字结尾总结，不重复开头，不添加未证实信息
- tags（必填）：3-5 个标签数组，只用素材中已有的客观词
- keywords（可选）：检索关键词数组，可包含人物/平台/地点/事件类型

注意：你只写口吻散文槽位；事实值（人名、时间、URL 等）由系统从素材自动注入，无需在散文里重复。`;
}

// ---------------------------------------------------------------------------
// Request builder
// ---------------------------------------------------------------------------

interface BuiltRequest {
	url: string;
	init: RequestInit;
}

function buildArticleRequest(
	prompt: string,
	endpoint: string,
	model: string,
	apiKey: string,
	opts: { jsonSchema?: boolean } = {},
): BuiltRequest {
	const response_format = opts.jsonSchema
		? { type: "json_schema" as const, json_schema: ARTICLE_SLOTS_SCHEMA }
		: { type: "json_object" as const };
	return {
		url: chatCompletionsUrl(endpoint),
		init: {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				model,
				messages: [{ role: "user" as const, content: prompt }],
				response_format,
			}),
		},
	};
}

// ---------------------------------------------------------------------------
// JSON parsing helpers (same pattern as draft-gen.ts)
// ---------------------------------------------------------------------------

const str = (v: unknown): string =>
	typeof v === "string" ? v : v == null ? "" : String(v);

const optStr = (v: unknown): string | undefined => {
	const s = str(v);
	return s === "" ? undefined : s;
};

function extractContent(raw: unknown): string | null {
	if (typeof raw !== "object" || raw === null) return null;
	const choices = (
		raw as { choices?: Array<{ message?: { content?: unknown } }> }
	).choices;
	const content = choices?.[0]?.message?.content;
	return typeof content === "string" ? content : null;
}

function parseContentJson(content: string): Record<string, unknown> | null {
	const stripped = content
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/\s*```$/i, "")
		.trim();
	try {
		const obj = JSON.parse(stripped);
		return obj && typeof obj === "object" && !Array.isArray(obj)
			? (obj as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function articleSlotsFromParsed(parsed: Record<string, unknown>): ArticleSlots {
	const faqRaw = Array.isArray(parsed.faqItems) ? parsed.faqItems : [];
	const faqItems = faqRaw
		.filter(
			(item): item is Record<string, unknown> =>
				item !== null && typeof item === "object",
		)
		.map((item) => ({ q: str(item.q), a: str(item.a) }));

	return {
		titleSuffix: optStr(parsed.titleSuffix),
		intro: str(parsed.intro),
		narrative: str(parsed.narrative),
		faqItems,
		conclusion: str(parsed.conclusion),
		tags: Array.isArray(parsed.tags)
			? parsed.tags.map(str).filter(Boolean)
			: [],
		keywords: Array.isArray(parsed.keywords)
			? parsed.keywords.map(str).filter(Boolean)
			: undefined,
	};
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type GenerateArticleResult =
	| { ok: true; draft: ContentDraft; qualityWarnings: string[] }
	| { ok: false; kind?: string; error: string };

// ---------------------------------------------------------------------------
// Main generation function
// ---------------------------------------------------------------------------

function isHttps(url: string): boolean {
	try {
		return new URL(url).protocol === "https:";
	} catch {
		return false;
	}
}

export async function generateArticleDraft(
	facts: GossipFactsBlock,
	deps: LlmDeps,
): Promise<GenerateArticleResult> {
	const { settings, apiKey } = deps;
	const fetchFn = deps.fetchFn ?? fetch;
	const now = deps.now ? deps.now() : new Date().toISOString();
	const id = deps.genId ? deps.genId() : `article_${Date.now()}`;
	const timeoutMs = deps.timeoutMs ?? 60_000;

	if (!apiKey || !settings.endpoint) {
		return { ok: false, kind: "no-key", error: "后端未配置 API key 或端点。" };
	}
	if (!isHttps(settings.endpoint)) {
		return {
			ok: false,
			kind: "network",
			error: "endpoint 必须是 https:// 地址。",
		};
	}

	const prompt = buildArticlePrompt(facts);
	const modelsToTry = [settings.model];
	if (settings.fallbackModel?.trim()) {
		modelsToTry.push(settings.fallbackModel.trim());
	}

	let res: Response | undefined;
	let lastErrorMsg = "服务返回错误，请重试。";

	for (const currentModel of modelsToTry) {
		let successInCurrentModel = false;
		for (const useSchema of [true, false]) {
			const { url, init } = buildArticleRequest(
				prompt,
				settings.endpoint,
				currentModel,
				apiKey,
				{ jsonSchema: useSchema },
			);
			const attempt = await fetchWithBackoff(
				fetchFn,
				url,
				init,
				timeoutMs,
				deps,
			);
			res = attempt.res;
			const fetchErr = attempt.fetchErr;

			if (fetchErr) {
				const aborted =
					fetchErr instanceof Error && fetchErr.name === "AbortError";
				lastErrorMsg = aborted
					? "请求超时，请重试。"
					: "网络错误，请检查 endpoint 或网络后重试。";
				break;
			}

			if (res?.ok) {
				successInCurrentModel = true;
				break;
			}

			if (res && useSchema && res.status === 400) continue;

			if (res && (res.status === 429 || res.status >= 500)) {
				lastErrorMsg = `服务返回错误(${res.status} ${res.statusText})。`;
				break;
			}

			return {
				ok: false,
				kind: "network",
				error: `服务返回错误(${res?.status} ${res?.statusText})。`,
			};
		}
		if (successInCurrentModel) break;
	}

	if (!res?.ok) {
		return { ok: false, kind: "network", error: lastErrorMsg };
	}

	let raw: unknown;
	try {
		raw = await res.json();
	} catch {
		return {
			ok: false,
			kind: "format",
			error: "响应不是合法 JSON（可能 endpoint 非 OpenAI 兼容格式）。",
		};
	}

	const content = extractContent(raw);
	if (content == null) {
		return {
			ok: false,
			kind: "format",
			error: "响应结构与 OpenAI 兼容格式不符。",
		};
	}
	const parsed = parseContentJson(content);
	if (parsed == null) {
		return {
			ok: false,
			kind: "format",
			error: "模型未返回合法 JSON，请调整 prompt 或重试。",
		};
	}

	const slots = articleSlotsFromParsed(parsed);
	const assembled = assembleGossipArticle(slots, facts);

	// 组装为 ContentDraft（category 取熱度標籤首词；无则 "gossip"）
	const category = facts.熱度標籤?.split(/[，,、]/)[0].trim() || "gossip";
	const draft = toDraft(
		{
			title: assembled.title,
			subtitle: "",
			body: assembled.body,
			description: assembled.description,
		},
		category,
		assembled.tags,
		id,
		now,
	);

	// 防幻觉 grounding 守卫：body 里的 <a href> 必须来自 facts.來源連結
	if (hasUnsourcedLink(verifyLinks(draft.body, gossipFactUrls(facts)))) {
		return {
			ok: false,
			kind: "grounding",
			error: "文章正文含未溯源链接（疑似模型自造），已拒绝。",
		};
	}

	// 质量警告
	const qualityWarnings: string[] = [];

	// 标题长度检查（25-35 字）
	const titleLen = assembled.title.length;
	if (titleLen < 25) {
		qualityWarnings.push(`标题偏短（${titleLen} 字，建议 25-35 字）`);
	} else if (titleLen > 35) {
		qualityWarnings.push(`标题偏长（${titleLen} 字，建议 25-35 字）`);
	}

	// 标签校验
	const tagValidation = validateArticleTags(assembled.tags);
	if (!tagValidation.ok) {
		qualityWarnings.push(...tagValidation.errors);
	}

	return { ok: true, draft, qualityWarnings };
}
