import type { FactsBlock } from "@51guapi/shared";
import { CORE_FACT_KEYS, FACT_ORDER } from "@51guapi/shared";
import { chatCompletionsUrl } from "../services/llm.js";
import type { ExtractedFacts, RawContent } from "./site-adapter.js";

/** json_schema 约束——保证 LLM 输出结构化事实。 */
const FACTS_SCHEMA = {
	name: "extracted_facts",
	strict: true,
	schema: {
		type: "object",
		additionalProperties: false,
		properties: {
			作品名: { type: ["string", "null"] },
			集数: { type: ["string", "null"] },
			制作: { type: ["string", "null"] },
			漢化: { type: ["string", "null"] },
			無修: { type: ["string", "null"] },
			题材: { type: ["string", "null"] },
			简介: { type: ["string", "null"] },
		},
		required: ["作品名", "集数", "制作", "漢化", "無修", "题材", "简介"],
	},
} as const;

const EXTRACTOR_PROMPT = `你是一个内容分析助手。你接收一篇网页内容（标题 + 正文 + 结构化元数据），从中提取结构化事实。

请提取以下字段（如果某字段在原文中不存在，设为 null）：
- 作品名
- 集数（话数/期数，如 "第1话" "10限目"，从标题或正文中找数字）
- 制作（制作方/工作室/原作/作者，优先用元数据中的"制作"字段）
- 漢化（汉化组信息，如 "中国翻訳"）
- 無修（無修正版本信息）
- 题材（分类+详细标签，用逗号分隔，如 "多人群交, 丝袜, 萝莉"）
- 简介

重要提示：
- 如果提供了"结构化元数据"，优先使用其中的信息
- 标题中 [作者名] 格式的文字通常是作者/制作方
- 标题中 [中国翻訳] 等通常是汉化组
- 标题中的数字（如 "10限目"）可能是集数
- 题材字段应包含主要分类和详细标签（从元数据的"标签"字段获取）
- 只从原文中提取信息，绝不编造。字段如找不到对应内容则设为 null。以 JSON 格式返回上述字段。`;

const FALLBACK_CONFIDENCE_CAP = 0.3;

function str(v: unknown): string {
	return typeof v === "string" ? v : "";
}

function parseFactsFromContent(content: string): FactsBlock {
	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(content) as Record<string, unknown>;
	} catch {
		return {};
	}
	const facts: FactsBlock = {};
	for (const key of FACT_ORDER) {
		const val = str(parsed[key]);
		if (val) facts[key] = val;
	}
	return facts;
}

export async function extractFacts(
	rawContent: RawContent,
	opts: {
		endpoint: string;
		apiKey: string;
		model?: string;
		timeoutMs?: number;
		fetchFn?: typeof fetch;
	},
): Promise<ExtractedFacts> {
	const {
		endpoint,
		apiKey,
		model = "gpt-4o-mini",
		timeoutMs = 30_000,
		fetchFn = fetch,
	} = opts;

	let userPrompt = `${EXTRACTOR_PROMPT}\n\n标题：${rawContent.title}\n\n正文：${rawContent.body.slice(0, 8000)}`;

	// 如果有结构化元数据，附加到 prompt 中
	if (rawContent.metadata && Object.keys(rawContent.metadata).length > 0) {
		const metaLines = Object.entries(rawContent.metadata)
			.filter(([, v]) => v)
			.map(([k, v]) => `- ${k}: ${v}`)
			.join("\n");
		if (metaLines) {
			userPrompt += `\n\n结构化元数据（来自页面提取，可直接使用）：\n${metaLines}`;
		}
	}

	// Two-pass: json_schema strict → json_object fallback (mirrors llm.ts pattern)
	for (const useSchema of [true, false] as const) {
		const responseFormat = useSchema
			? { type: "json_schema" as const, json_schema: FACTS_SCHEMA }
			: { type: "json_object" as const };

		const requestBody = {
			model,
			messages: [{ role: "user" as const, content: userPrompt }],
			response_format: responseFormat,
		};

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);

		let res: Response | null = null;
		let fetchErr: unknown = null;
		try {
			res = await fetchFn(chatCompletionsUrl(endpoint), {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify(requestBody),
				signal: controller.signal,
			});
		} catch (err) {
			fetchErr = err;
		} finally {
			clearTimeout(timer);
		}

		if (fetchErr) {
			if (fetchErr instanceof Error && fetchErr.name === "AbortError") {
				throw new Error("Fact extraction timed out");
			}
			throw fetchErr;
		}

		if (!res) throw new Error("No response received from LLM");

		// json_schema not supported by this endpoint → retry with json_object
		if (useSchema && res.status === 400) continue;

		if (!res.ok) {
			throw new Error(`LLM request failed: HTTP ${res.status}`);
		}

		let raw: unknown;
		try {
			raw = await res.json();
		} catch {
			throw new Error("LLM response is not valid JSON");
		}
		const content =
			(raw as { choices?: Array<{ message?: { content?: string } }> })
				?.choices?.[0]?.message?.content ?? "";

		const facts = parseFactsFromContent(content);
		const filled = CORE_FACT_KEYS.filter((k) => facts[k]).length;
		const rawConfidence =
			CORE_FACT_KEYS.length > 0 ? filled / CORE_FACT_KEYS.length : 0;
		const extractionMode = useSchema ? "strict" : "fallback";
		const confidence =
			extractionMode === "fallback"
				? Math.min(rawConfidence, FALLBACK_CONFIDENCE_CAP)
				: rawConfidence;

		return {
			facts,
			confidence,
			coverImageUrl: rawContent.coverImageUrl,
			extractionMode,
		};
	}

	throw new Error("Fact extraction failed after all attempts");
}
