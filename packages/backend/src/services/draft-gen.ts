import type {
	FactsBlock,
	GenerateDraftResponse,
	Settings,
} from "@51guapi/shared";
import {
	assembleDraft,
	type DraftSlots,
	gossipFactUrls,
	hasUnsourcedLink,
	normalizeCategory,
	toDraft,
	verifyLinks,
} from "@51guapi/shared";
import { fetchWithBackoff, type LlmDeps } from "./fetch-backoff.js";

export const DRAFT_SLOTS_SCHEMA = {
	name: "draft_slots",
	strict: true,
	schema: {
		type: "object",
		additionalProperties: false,
		properties: {
			titleSuffix: { type: ["string", "null"] },
			subtitle: { type: ["string", "null"] },
			intro: { type: "string" },
			highlights: { type: "string" },
			outro: { type: ["string", "null"] },
			category: { type: ["string", "null"] },
			tags: { type: ["array", "null"], items: { type: "string" } },
		},
		required: [
			"titleSuffix",
			"subtitle",
			"intro",
			"highlights",
			"outro",
			"category",
			"tags",
		],
	},
} as const;

interface BuiltRequest {
	url: string;
	init: RequestInit;
}

export function chatCompletionsUrl(endpoint: string): string {
	const e = endpoint.trim().replace(/\/+$/, "");
	return /\/chat\/completions$/.test(e) ? e : `${e}/chat/completions`;
}

export function buildRequest(
	prompt: string,
	settings: Settings,
	apiKey: string,
	opts: { jsonSchema?: boolean } = {},
): BuiltRequest {
	const response_format = opts.jsonSchema
		? { type: "json_schema" as const, json_schema: DRAFT_SLOTS_SCHEMA }
		: { type: "json_object" as const };
	const body = {
		model: settings.model,
		messages: [{ role: "user", content: prompt }],
		response_format,
	};
	return {
		url: chatCompletionsUrl(settings.endpoint),
		init: {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify(body),
		},
	};
}

const str = (v: unknown): string =>
	typeof v === "string" ? v : v == null ? "" : String(v);

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

export type LlmJsonResult =
	| { ok: true; raw: unknown; parsed: Record<string, unknown>; content: string }
	| { ok: false; error: string };

export async function callLlmForJson(
	prompt: string,
	deps: LlmDeps,
	label: string,
): Promise<LlmJsonResult> {
	const { settings, apiKey } = deps;
	const fetchFn = deps.fetchFn ?? fetch;
	const timeoutMs = deps.timeoutMs ?? 45_000;

	if (!apiKey || !settings.endpoint)
		return { ok: false, error: "未配置 API key 或端点。" };

	const { url, init } = buildRequest(prompt, settings, apiKey, {
		jsonSchema: false,
	});

	// 仅对 429/5xx 退避重试;parse/format 失败(gemma4 200+坏JSON)不重试,保持「不 throw」契约。
	const { res, fetchErr } = await fetchWithBackoff(
		fetchFn,
		url,
		init,
		timeoutMs,
		deps,
	);
	if (fetchErr) {
		return {
			ok: false,
			error:
				fetchErr instanceof Error && fetchErr.name === "AbortError"
					? `${label}请求超时。`
					: "网络错误。",
		};
	}
	if (!res) return { ok: false, error: "网络错误。" };

	if (!res.ok)
		return { ok: false, error: `${label}请求失败 (${res.status})。` };

	let raw: unknown;
	try {
		raw = await res.json();
	} catch {
		return { ok: false, error: `${label}响应非合法 JSON。` };
	}

	const content = extractContent(raw);
	if (!content) return { ok: false, error: `${label}响应格式不符。` };
	const parsed = parseContentJson(content);
	if (!parsed) return { ok: false, error: `${label}结果解析失败。` };

	return { ok: true, raw, parsed, content };
}

const optStr = (v: unknown): string | undefined => {
	const s = str(v);
	return s === "" ? undefined : s;
};

export function slotsFromParsed(parsed: Record<string, unknown>): DraftSlots {
	return {
		titleSuffix: optStr(parsed.titleSuffix),
		subtitle: optStr(parsed.subtitle),
		intro: str(parsed.intro),
		highlights: str(parsed.highlights),
		outro: optStr(parsed.outro),
	};
}

function isHttps(url: string): boolean {
	try {
		return new URL(url).protocol === "https:";
	} catch {
		return false;
	}
}

export async function generateDraft(
	prompt: string,
	deps: LlmDeps,
): Promise<GenerateDraftResponse> {
	const { settings, apiKey } = deps;
	const fetchFn = deps.fetchFn ?? fetch;
	const now = deps.now ? deps.now() : new Date().toISOString();
	const id = deps.genId ? deps.genId() : `draft_${Date.now()}`;
	const timeoutMs = deps.timeoutMs ?? 60_000;
	const facts = deps.facts ?? {
		當事人: null,
		事件摘要: null,
		起因: null,
		經過: null,
		結果: null,
		來源連結: null,
		發生時間: null,
		熱度標籤: null,
	};

	// 注入 Web 搜索富化内容到 prompt 末尾
	const finalPrompt = deps.enrichment
		? `${prompt}\n\n${deps.enrichment}`
		: prompt;

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

	const modelsToTry = [settings.model];
	if (settings.fallbackModel && settings.fallbackModel.trim().length > 0) {
		modelsToTry.push(settings.fallbackModel.trim());
	}

	let res: Response | undefined;
	let lastErrorMsg = "服务返回错误,请重试。";

	for (const currentModel of modelsToTry) {
		let successInCurrentModel = false;
		for (const useSchema of [true, false]) {
			const { url, init } = buildRequest(
				finalPrompt,
				{ ...settings, model: currentModel },
				apiKey,
				{
					jsonSchema: useSchema,
				},
			);
			// 仅对 429/5xx 退避重试;400/ok/网络错误立即返回(保持分桶)。
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
					? "请求超时,请重试。"
					: "网络错误,请检查 endpoint 或网络后重试。";
				break;
			}

			if (res?.ok) {
				successInCurrentModel = true;
				break;
			}

			if (res && useSchema && res.status === 400) {
				continue;
			}

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
			error: "响应不是合法 JSON(可能 endpoint 非 OpenAI 兼容格式)。",
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
			error: "模型未返回合法 JSON 草稿,请调整 prompt 或重试。",
		};
	}

	// 提升为具名常量,以便随响应返回 —— 扩展端据此重新组装(re-assemble)。
	const slots = slotsFromParsed(parsed);
	const assembled = assembleDraft(slots, facts as unknown as FactsBlock);
	const tags = Array.isArray(parsed.tags)
		? parsed.tags.map(str).filter(Boolean)
		: [];
	const category = normalizeCategory(str(parsed.category));
	const draft = toDraft(assembled, category, tags, id, now);

	// F3 防幻觉 grounding 守卫:草稿正文里的任何 <a href> 必须溯源到 facts 的来源链接
	// (來源連結),否则疑似模型自造 → 拒绝。说明:后端吃瓜组装本身不向 body 注入链接、
	// 且 prose 槽位经 esc 转义,故此守卫当前结构性恒过,作纵深防御 —— codify
	// post-assembler 已声明的不变量;任何未来回归(注入来源链/放行 prose HTML)都会在此
	// 被 grounding 拦下,而非把幻觉链接落进草稿。
	if (hasUnsourcedLink(verifyLinks(draft.body, gossipFactUrls(facts)))) {
		return {
			ok: false,
			kind: "grounding",
			error: "草稿正文含未溯源链接(疑似模型自造),已拒绝。",
		};
	}

	// 质量评估
	const { evaluateQuality } = await import("@51guapi/shared");
	const quality = evaluateQuality(draft, facts);
	const qualityWarnings = quality.checks
		.filter((c) => !c.pass)
		.map((c) => ({ name: c.name, message: c.message }));

	return {
		ok: true,
		draft,
		slots,
		...(qualityWarnings.length > 0 ? { qualityWarnings } : {}),
	};
}

export type ListModelsResult =
	| { ok: true; models: string[] }
	| { ok: false; error: string };

export function modelsUrl(endpoint: string): string {
	const e = endpoint
		.trim()
		.replace(/\/+$/, "")
		.replace(/\/chat\/completions$/, "")
		.replace(/\/+$/, "");
	return `${e}/models`;
}

export async function listModels(
	endpoint: string,
	apiKey: string,
	fetchFn: typeof fetch = fetch,
	timeoutMs = 20_000,
): Promise<ListModelsResult> {
	if (!apiKey || !endpoint)
		return { ok: false, error: "请先配置 API key 与 endpoint。" };
	if (!isHttps(endpoint))
		return { ok: false, error: "endpoint 必须是 https:// 地址。" };

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	let res: Response;
	try {
		res = await fetchFn(modelsUrl(endpoint), {
			headers: { Authorization: `Bearer ${apiKey}` },
			signal: controller.signal,
		});
	} catch (err) {
		const aborted = err instanceof Error && err.name === "AbortError";
		return {
			ok: false,
			error: aborted
				? "请求超时,请重试。"
				: "网络错误(可能 CORS 限制或 endpoint 不可达)。",
		};
	} finally {
		clearTimeout(timer);
	}

	if (!res.ok)
		return {
			ok: false,
			error: `服务返回错误(${res.status} ${res.statusText})。`,
		};

	let raw: unknown;
	try {
		raw = await res.json();
	} catch {
		return {
			ok: false,
			error: "响应不是合法 JSON(可能非 OpenAI 兼容 /models)。",
		};
	}
	const data = (raw as { data?: unknown })?.data;
	if (!Array.isArray(data))
		return {
			ok: false,
			error: "响应无 data 数组(可能非 OpenAI 兼容 /models)。",
		};

	const models = data
		.map((m) =>
			m && typeof m === "object" ? (m as { id?: unknown }).id : undefined,
		)
		.filter((id): id is string => typeof id === "string" && id.length > 0)
		.sort((a, b) => a.localeCompare(b));
	if (models.length === 0) return { ok: false, error: "模型列表为空。" };
	return { ok: true, models };
}
