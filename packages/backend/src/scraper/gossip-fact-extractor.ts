import {
	GOSSIP_FACT_KEYS,
	GOSSIP_FACTS_SCHEMA,
	type GossipFactsBlock,
} from "@51guapi/shared";
import { chatCompletionsUrl } from "../services/llm.js";
import type { RawContent } from "./site-adapter.js";

const GOSSIP_SCHEMA = {
	name: "gossip_facts",
	strict: true,
	schema: GOSSIP_FACTS_SCHEMA,
} as const;

const GOSSIP_PROMPT = `你是一個吃瓜（娛樂八卦）內容分析助手。你接收一篇娛樂新聞/明星八卦網頁（標題 + 正文），從中提取結構化事實。

請提取以下欄位（如果某欄位在原文中不存在，設為 null）：
- 當事人：涉及的人名或組合，逗號分隔
- 事件摘要：一兩句概括事件核心
- 起因：事件起因
- 經過：事件經過
- 結果：事件結果或當前狀態
- 來源連結：原文 URL，verbatim
- 發生時間：事件發生時間，如 2024-05
- 熱度標籤：如「出軌」「解約」「撕逼」「公開戀情」，從文章情緒/關鍵詞推斷，逗號分隔

重要提示：
- 只從原文提取，絕不編造
- 當事人從標題/正文找人名
- 熱度標籤反映事件性質，從原文情緒和關鍵詞推斷
- 字段如找不到對應內容則設為 null`;

const FALLBACK_CONFIDENCE_CAP = 0.3;

export interface ExtractedGossipFacts {
	facts: GossipFactsBlock;
	confidence: number;
	coverImageUrl?: string;
	extractionMode: "strict" | "fallback";
}

function str(v: unknown): string {
	return typeof v === "string" ? v : "";
}

type LlmResponse = { choices?: Array<{ message?: { content?: string } }> };
function isLlmResponse(v: unknown): v is LlmResponse {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseGossipFacts(content: string): GossipFactsBlock {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return emptyGossipFacts();
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return emptyGossipFacts();
	}
	const obj = parsed as Record<string, unknown>;
	const facts: Partial<GossipFactsBlock> = {};
	for (const key of GOSSIP_FACT_KEYS) {
		const val = obj[key];
		facts[key] = typeof val === "string" && val ? val : null;
	}
	return facts as GossipFactsBlock;
}

function emptyGossipFacts(): GossipFactsBlock {
	const facts: Partial<GossipFactsBlock> = {};
	for (const key of GOSSIP_FACT_KEYS) facts[key] = null;
	return facts as GossipFactsBlock;
}

export async function gossipExtractFacts(
	rawContent: RawContent,
	opts: {
		endpoint: string;
		apiKey: string;
		model?: string;
		timeoutMs?: number;
		fetchFn?: typeof fetch;
	},
): Promise<ExtractedGossipFacts> {
	const {
		endpoint,
		apiKey,
		model = "gpt-4o-mini",
		timeoutMs = 30_000,
		fetchFn = fetch,
	} = opts;

	const userPrompt = `${GOSSIP_PROMPT}\n\n標題：${rawContent.title}\n\n正文：${rawContent.body.slice(0, 8000)}`;

	// 單個 AbortController 跨兩次 pass 共享 timeout budget
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		for (const useSchema of [true, false] as const) {
			const responseFormat = useSchema
				? { type: "json_schema" as const, json_schema: GOSSIP_SCHEMA }
				: { type: "json_object" as const };

			const requestBody = {
				model,
				messages: [{ role: "user" as const, content: userPrompt }],
				response_format: responseFormat,
			};

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
			}

			if (fetchErr) {
				if (fetchErr instanceof Error && fetchErr.name === "AbortError") {
					throw new Error("Gossip fact extraction timed out");
				}
				throw fetchErr;
			}

			if (!res) throw new Error("No response received from LLM");
			if (useSchema && (res.status === 400 || res.status === 422)) continue;
			if (!res.ok) throw new Error(`LLM request failed: HTTP ${res.status}`);

			let raw: unknown;
			try {
				raw = await res.json();
			} catch {
				throw new Error("LLM response is not valid JSON");
			}
			const content = isLlmResponse(raw)
				? (raw.choices?.[0]?.message?.content ?? "")
				: "";

			const facts = parseGossipFacts(content);
			const filled = GOSSIP_FACT_KEYS.filter(
				(k) => facts[k] !== null && str(facts[k]),
			).length;
			const rawConfidence =
				GOSSIP_FACT_KEYS.length > 0 ? filled / GOSSIP_FACT_KEYS.length : 0;
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
	} finally {
		clearTimeout(timer);
	}

	throw new Error("Gossip fact extraction failed after all attempts");
}
