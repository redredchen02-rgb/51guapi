import type {
	ContentDraft,
	FactsBlock,
	GenerateDraftResponse,
	GossipFactsBlock,
	ReviewResult,
	Settings,
} from "@51guapi/shared";
import { clearToken, getToken } from "./auth-client";
import { getBackendUrl } from "./backend-url";

export interface LlmDeps {
	settings: Settings;
	apiKey: string; // Left in interface for compatibility, but ignored in execution
	facts?: FactsBlock | GossipFactsBlock;
	enrichment?: string;
	fetchFn?: typeof fetch;
	now?: () => string;
	genId?: () => string;
	timeoutMs?: number;
}

export type ListModelsResult =
	| { ok: true; models: string[] }
	| { ok: false; error: string };

/**
 * 拉取模型列表，转而请求本地后端服务。
 */
export async function listModels(
	_endpoint: string,
	_apiKey: string, // Kept for interface compatibility
	fetchFn: typeof fetch = fetch,
	timeoutMs = 20_000,
): Promise<ListModelsResult> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const token = await getToken();
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (token) headers.Authorization = `Bearer ${token}`;

		const backendUrl = await getBackendUrl();
		const res = await fetchFn(`${backendUrl}/api/v1/models`, {
			headers,
			signal: controller.signal,
		});

		if (res.status === 401) {
			await clearToken();
			return { ok: false, error: "登录已过期，请重新登录。" };
		}

		if (!res.ok) {
			const errText = await res.text().catch(() => "");
			let errorDetail = `后端服务返回错误 (${res.status})`;
			try {
				const parsedErr = JSON.parse(errText);
				if (parsedErr.error) errorDetail = parsedErr.error;
			} catch {}
			return { ok: false, error: errorDetail };
		}

		const data = (await res.json()) as ListModelsResult;
		return data;
	} catch (err) {
		const aborted = err instanceof Error && err.name === "AbortError";
		return {
			ok: false,
			error: aborted
				? "拉取模型超时，请检查服务。"
				: "无法连接到后端服务，请确认后端已启动。",
		};
	} finally {
		clearTimeout(timer);
	}
}

/**
 * 生成一条草稿，请求本地后端服务。
 */
export async function generateDraft(
	prompt: string,
	deps: LlmDeps,
): Promise<GenerateDraftResponse> {
	const { settings, facts, enrichment } = deps;
	const fetchFn = deps.fetchFn ?? fetch;
	const timeoutMs = deps.timeoutMs ?? 60_000;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const token = await getToken();
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (token) headers.Authorization = `Bearer ${token}`;

		const backendUrl = await getBackendUrl();
		const res = await fetchFn(`${backendUrl}/api/v1/drafts/generate`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				prompt,
				settings,
				facts,
				enrichment,
			}),
			signal: controller.signal,
		});

		if (res.status === 401) {
			await clearToken();
			return { ok: false, kind: "network", error: "登录已过期，请重新登录。" };
		}

		if (!res.ok) {
			const errText = await res.text().catch(() => "");
			let errorDetail = `后端服务返回错误 (${res.status})`;
			try {
				const parsedErr = JSON.parse(errText);
				if (parsedErr.error) errorDetail = parsedErr.error;
			} catch {}
			return { ok: false, kind: "network", error: errorDetail };
		}

		// 整体透传后端响应:ok 臂含 draft 与 slots(模型叙事槽位,供扩展端重新组装)。
		// slots 旧响应可能缺省;它是模型不可信文本,只能经 assembleGossipDraft 消费,不得直接渲染。
		const data = (await res.json()) as GenerateDraftResponse;
		return data;
	} catch (err) {
		const aborted = err instanceof Error && err.name === "AbortError";
		return {
			ok: false,
			kind: "network",
			error: aborted
				? "后端请求超时，请检查服务状态。"
				: "无法连接到后端服务，请确认后端已在 127.0.0.1:3002 启动。",
		};
	} finally {
		clearTimeout(timer);
	}
}

// ---- Phase 3: review / rewrite proxy clients ----

export type ReviewDraftResponse =
	| {
			ok: true;
			result: ReviewResult;
			reviewCostTokens?: { prompt: number; completion: number };
	  }
	| { ok: false; kind?: "network"; error: string };

export type RewriteDraftResponse =
	| {
			ok: true;
			draft: ContentDraft;
			rewriteCostTokens?: { prompt: number; completion: number };
	  }
	| { ok: false; kind?: "network"; error: string };

/** POST /api/v1/drafts/review — 薄代理，不 throw，失败返回 ok:false。 */
export async function reviewDraft(
	draft: ContentDraft,
	criteriaPrompt: string | undefined,
	deps: LlmDeps,
): Promise<ReviewDraftResponse> {
	const fetchFn = deps.fetchFn ?? fetch;
	const timeoutMs = deps.timeoutMs ?? 45_000;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const token = await getToken();
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (token) headers.Authorization = `Bearer ${token}`;
		const backendUrl = await getBackendUrl();
		const res = await fetchFn(`${backendUrl}/api/v1/drafts/review`, {
			method: "POST",
			headers,
			body: JSON.stringify({ draft, criteriaPrompt, settings: deps.settings }),
			signal: controller.signal,
		});
		if (res.status === 401) {
			await clearToken();
			return { ok: false, kind: "network", error: "登录已过期，请重新登录。" };
		}
		if (!res.ok)
			return {
				ok: false,
				kind: "network",
				error: `评审请求失败 (${res.status})。`,
			};
		return (await res.json()) as ReviewDraftResponse;
	} catch (err) {
		const aborted = err instanceof Error && err.name === "AbortError";
		return {
			ok: false,
			kind: "network",
			error: aborted ? "评审请求超时。" : "无法连接到后端服务。",
		};
	} finally {
		clearTimeout(timer);
	}
}

/** POST /api/v1/drafts/rewrite — 薄代理，不 throw，失败返回 ok:false。 */
export async function rewriteDraft(
	draft: ContentDraft,
	failedDims: string[],
	deps: LlmDeps,
): Promise<RewriteDraftResponse> {
	const fetchFn = deps.fetchFn ?? fetch;
	const timeoutMs = deps.timeoutMs ?? 45_000;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const token = await getToken();
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (token) headers.Authorization = `Bearer ${token}`;
		const backendUrl = await getBackendUrl();
		const res = await fetchFn(`${backendUrl}/api/v1/drafts/rewrite`, {
			method: "POST",
			headers,
			body: JSON.stringify({ draft, failedDims, settings: deps.settings }),
			signal: controller.signal,
		});
		if (res.status === 401) {
			await clearToken();
			return { ok: false, kind: "network", error: "登录已过期，请重新登录。" };
		}
		if (!res.ok)
			return {
				ok: false,
				kind: "network",
				error: `重写请求失败 (${res.status})。`,
			};
		return (await res.json()) as RewriteDraftResponse;
	} catch (err) {
		const aborted = err instanceof Error && err.name === "AbortError";
		return {
			ok: false,
			kind: "network",
			error: aborted ? "重写请求超时。" : "无法连接到后端服务。",
		};
	} finally {
		clearTimeout(timer);
	}
}

/** 白名单合并：根据 failedDims 决定取 rewrite 的哪些字段；id/coverImageUrl 始终保留 original。 */
export function mergeRewriteResult(
	original: ContentDraft,
	rewrite: Partial<ContentDraft>,
	failedDims: string[],
): ContentDraft {
	const merged: ContentDraft = { ...original };
	if (failedDims.includes("title_quality") && rewrite.title)
		merged.title = rewrite.title;
	if (
		(failedDims.includes("body_richness") ||
			failedDims.includes("community_tone")) &&
		rewrite.body
	) {
		merged.body = rewrite.body;
	}
	if (failedDims.includes("category_accuracy")) {
		if (rewrite.tags) merged.tags = rewrite.tags;
	}
	// 以下字段始终保留 original 值（非 AI 生成字段）
	merged.id = original.id;
	merged.coverImageUrl = original.coverImageUrl;
	return merged;
}

import { toDraft } from "@51guapi/shared";

export { toDraft };
