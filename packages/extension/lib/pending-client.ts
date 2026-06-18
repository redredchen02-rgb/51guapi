import type { RejectionReason } from "@51guapi/shared";
import { apiFetch } from "./api-fetch";
import { logger } from "./logger";

export interface PendingTopic {
	id: string;
	sourceUrl: string;
	siteName: string;
	title: string;
	rawContent?: {
		title: string;
		body: string;
		url: string;
		metadata?: Record<string, string>;
	};
	facts: Record<string, string>;
	confidence: number;
	score?: number;
	status: "pending" | "approved" | "rejected";
	rejectedReason?: RejectionReason;
	coverImageUrl?: string;
	/** 质量分低于 fold_threshold 时后端标记为折叠（低优先级）。 */
	folded?: boolean;
	/** 预格式化的 web 搜索富化文本，可直接注入 LLM prompt（后端 formatEnrichmentForPrompt 输出）。 */
	enrichmentText?: string;
	domain?: "gossip";
	createdAt: string;
	updatedAt: string;
}

export interface FetchPendingTopicsOptions {
	status?: string;
	sort_by?: "score" | "created_at";
	fold_threshold?: number;
	domain?: "gossip";
}

export interface PendingTopicsResponse {
	ok: boolean;
	topics?: PendingTopic[];
	error?: string;
}

export interface PendingTopicResponse {
	ok: boolean;
	topic?: PendingTopic;
	error?: string;
}

/**
 * 拉取待审核选题列表。支持按质量分排序（sort_by='score'）和折叠阈值。
 *
 * 两种调用方式:
 *   fetchPendingTopics({ status: 'pending', sort_by: 'score', fold_threshold: 0.5 })
 *   fetchPendingTopics('pending')
 */
export async function fetchPendingTopics(
	opts: FetchPendingTopicsOptions,
	fetchFn?: typeof fetch,
	timeoutMs?: number,
): Promise<PendingTopic[]>;
export async function fetchPendingTopics(
	status?: string,
	fetchFn?: typeof fetch,
	timeoutMs?: number,
): Promise<PendingTopic[]>;
export async function fetchPendingTopics(
	statusOrOpts?: string | FetchPendingTopicsOptions,
	fetchFn?: typeof fetch,
	timeoutMs?: number,
): Promise<PendingTopic[]> {
	const opts: FetchPendingTopicsOptions =
		typeof statusOrOpts === "object" && statusOrOpts !== null
			? statusOrOpts
			: { status: statusOrOpts };

	const qp = new URLSearchParams();
	if (opts.status) qp.set("status", opts.status);
	if (opts.sort_by) qp.set("sort_by", opts.sort_by);
	if (opts.fold_threshold !== undefined)
		qp.set("fold_threshold", String(opts.fold_threshold));
	if (opts.domain) qp.set("domain", opts.domain);
	const params = qp.toString() ? `?${qp.toString()}` : "";

	try {
		const res = await apiFetch(`/api/v1/pending-topics${params}`, {
			fetchFn,
			timeoutMs: timeoutMs ?? 10_000,
		});
		if (res.status === 401) return [];
		if (!res.ok) return [];
		const data = (await res.json()) as PendingTopicsResponse;
		return data.ok && data.topics ? data.topics : [];
	} catch (e) {
		logger.warn("pending-client", "fetchPendingTopics failed", {
			error: e instanceof Error ? e.message : String(e),
		});
		return [];
	}
}

/**
 * 局部更新待审核选题的事实字段（内联编辑后批准前调用）。
 */
export async function patchPendingTopic(
	id: string,
	patch: { facts?: Record<string, string> },
	timeoutMs = 10_000,
): Promise<boolean> {
	try {
		const res = await apiFetch(
			`/api/v1/pending-topics/${encodeURIComponent(id)}`,
			{
				method: "PATCH",
				body: JSON.stringify(patch),
				timeoutMs,
			},
		);
		if (res.status === 401) return false;
		return res.ok;
	} catch (e) {
		logger.warn("pending-client", "patchPendingTopic failed", {
			error: e instanceof Error ? e.message : String(e),
		});
		return false;
	}
}

/**
 * 触发立即抓取（R3）。
 */
export async function triggerScrape(
	siteName: string,
	timeoutMs = 15_000,
): Promise<boolean> {
	try {
		const res = await apiFetch("/api/v1/scraper/trigger", {
			method: "POST",
			body: JSON.stringify({ siteName }),
			timeoutMs,
		});
		if (res.status === 401) return false;
		return res.ok;
	} catch (e) {
		logger.warn("pending-client", "triggerScrape failed", {
			error: e instanceof Error ? e.message : String(e),
		});
		return false;
	}
}

/**
 * 拉取已注册的适配器列表（R3）。
 */
export async function fetchAdapters(timeoutMs = 10_000): Promise<string[]> {
	try {
		const res = await apiFetch("/api/v1/scraper/adapters", { timeoutMs });
		if (res.status === 401) return [];
		if (!res.ok) return [];
		const data = (await res.json()) as {
			ok: boolean;
			adapters?: { name: string }[];
		};
		return data.ok && data.adapters ? data.adapters.map((a) => a.name) : [];
	} catch (e) {
		logger.warn("pending-client", "fetchAdapters failed", {
			error: e instanceof Error ? e.message : String(e),
		});
		return [];
	}
}

/**
 * 批准/拒绝待审核选题（更新后端状态）。
 */
export async function updatePendingStatus(
	id: string,
	status: "pending" | "approved" | "rejected",
	rejectedReason?: RejectionReason,
	timeoutMs = 10_000,
): Promise<boolean> {
	try {
		const res = await apiFetch(
			`/api/v1/pending-topics/${encodeURIComponent(id)}`,
			{
				method: "PATCH",
				body: JSON.stringify({
					status,
					...(rejectedReason ? { rejectedReason } : {}),
				}),
				timeoutMs,
			},
		);
		if (res.status === 401) return false;
		return res.ok;
	} catch (e) {
		logger.warn("pending-client", "updatePendingStatus failed", {
			error: e instanceof Error ? e.message : String(e),
		});
		return false;
	}
}
