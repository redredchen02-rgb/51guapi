import type {
	ContentDraft,
	FactsBlock,
	GenerateDraftResponse,
	Settings,
} from "@51guapi/shared";
import {
	assembleDraft,
	type DraftSlots,
	normalizeCategory,
	toDraft,
} from "@51guapi/shared";

export interface LlmDeps {
	settings: Settings;
	apiKey: string;
	facts?: FactsBlock;
	/** Web 搜索富化的格式化文本；为空则不注入。 */
	enrichment?: string;
	fetchFn?: typeof fetch;
	now?: () => string;
	genId?: () => string;
	timeoutMs?: number;
	/** 429/5xx 退避重试参数(可注入便于测试快进)。 */
	maxRetries?: number;
	retryBaseMs?: number;
	/** 单次退避时长上限(亦作总等待的近似上限,防上游 Retry-After 拉爆)。 */
	retryCapMs?: number;
	sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 500;
const DEFAULT_RETRY_CAP_MS = 8_000;

const defaultSleep = (ms: number): Promise<void> =>
	new Promise((r) => setTimeout(r, ms));

/** 解析 Retry-After(秒或 HTTP-date),失败返 null。 */
function parseRetryAfter(res: Response, nowMs: number): number | null {
	const h = res.headers?.get?.("retry-after");
	if (!h) return null;
	const secs = Number(h);
	if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
	const date = Date.parse(h);
	if (Number.isFinite(date)) return Math.max(0, date - nowMs);
	return null;
}

/**
 * 单请求 fetch + **仅对 429/5xx** 的有限次指数退避重试。
 * 每次尝试各自 AbortController+timer(勿共享,否则重试请求会被旧 signal 立即 abort)。
 * 非 429/5xx(含 ok、4xx 如 400)与网络错误立即返回交调用方处理(保持分桶)。
 */
async function fetchWithBackoff(
	fetchFn: typeof fetch,
	url: string,
	init: RequestInit,
	timeoutMs: number,
	deps: LlmDeps,
): Promise<{ res?: Response; fetchErr?: unknown }> {
	const maxRetries = deps.maxRetries ?? DEFAULT_MAX_RETRIES;
	const baseMs = deps.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
	const capMs = deps.retryCapMs ?? DEFAULT_RETRY_CAP_MS;
	const sleep = deps.sleep ?? defaultSleep;

	for (let attempt = 0; ; attempt++) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		let res: Response | undefined;
		let fetchErr: unknown = null;
		try {
			res = await fetchFn(url, { ...init, signal: controller.signal });
		} catch (err) {
			fetchErr = err;
		} finally {
			clearTimeout(timer);
		}
		if (fetchErr) return { fetchErr };
		if (!res) return {};
		const retryable = res.status === 429 || res.status >= 500;
		if (!retryable || attempt >= maxRetries) return { res };
		// 退避:Retry-After(若有,clamp 到 capMs)否则指数,均 clamp 到 capMs。
		const retryAfter = parseRetryAfter(res, Date.now());
		const expo = Math.min(capMs, baseMs * 2 ** attempt);
		const delay = Math.min(capMs, retryAfter ?? expo);
		// 日志只记 status/attempt/delay,不记 body/headers/url/key。
		console.warn(
			`[llm] retry status=${res.status} attempt=${attempt + 1} delay=${delay}ms`,
		);
		await sleep(delay);
	}
}

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

type LlmJsonResult =
	| { ok: true; raw: unknown; parsed: Record<string, unknown>; content: string }
	| { ok: false; error: string };

async function callLlmForJson(
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
	const facts = deps.facts ?? {};

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
	const assembled = assembleDraft(slots, facts);
	const tags = Array.isArray(parsed.tags)
		? parsed.tags.map(str).filter(Boolean)
		: [];
	const category = normalizeCategory(str(parsed.category));
	const draft = toDraft(assembled, category, tags, id, now);

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

// ---- Phase 3: AI review & rewrite ----

import type { ReviewResult } from "@51guapi/shared";

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

const DEFAULT_CRITERIA = `你是专业内容评审员。请对以下帖子草稿进行四维评审。

四个维度：
1. body_richness（正文丰富度）：正文字数≥150字、内容实质丰富、不空洞单薄。
2. community_tone（社区口吻）：文风贴近动漫社区，口语化接地气，不过于官方生硬。
3. title_quality（标题质量）：标题有信息量、吸引人，让读者想点进去看。
4. category_accuracy（分类准确性）：分类和标签准确匹配内容，标签有实际含义。

仅输出 JSON，格式：{"dimensions":[{"name":"body_richness","pass":true,"reason":"一句话"},{"name":"community_tone","pass":true,"reason":"一句话"},{"name":"title_quality","pass":true,"reason":"一句话"},{"name":"category_accuracy","pass":true,"reason":"一句话"}]}`;

const DIM_LABELS: Record<string, string> = {
	body_richness: "正文（需更丰富充实，≥150字，有实质内容）",
	community_tone: "正文风格（需更贴近动漫社区口吻，口语化接地气）",
	title_quality: "标题（需更吸引人、有信息量）",
	category_accuracy: "分类和标签（需更准确匹配内容）",
};

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
