import type {
	PendingTopic,
	PendingTopicsResponse,
	RejectionReason,
	ThemeCount,
} from "@51guapi/shared";
import { type ApiFetchInit, apiFetch } from "./api-fetch";
import { logger } from "./logger";

// 以下类型现为 @51guapi/shared 的 canonical 契约;此处 re-export 保持既有 import 路径。
export type { PendingTopic, PendingTopicsResponse, ThemeCount };

export interface FetchPendingTopicsOptions {
	status?: string;
	sort_by?: "score" | "created_at";
	fold_threshold?: number;
	domain?: "gossip";
	/** 按归一化题材（熱度標籤）过滤；U5 题材选择。 */
	theme?: string;
	/** true=只取已人工核对（题材池）；false=只取未核对；U4。 */
	verified?: boolean;
}

export interface PendingTopicResponse {
	ok: boolean;
	topic?: PendingTopic;
	error?: string;
}

/**
 * 收敛各 client 函数重复的 apiFetch + 401/非 ok 回退 + catch+logger.warn 样板。
 *
 * 边界:401 与非 ok 都直接返回 `fallback`(语义等价于原各函数——bool 函数 `res.ok`
 * 在非 ok 时本就是 false;array 函数本就回退 `[]`),只有 2xx 才进 `onOk` 解析。
 * `fnName` 作为 logger 标签逐函数传入,保持原日志可定位性。fallback 类型由调用方
 * 决定(array 函数传 `[]`,bool 函数传 `false`),divergence 经泛型保留。
 */
async function requestWithFallback<T>(
	fnName: string,
	fallback: T,
	path: string,
	init: ApiFetchInit,
	onOk: (res: Response) => Promise<T>,
): Promise<T> {
	try {
		const res = await apiFetch(path, init);
		if (res.status === 401 || !res.ok) return fallback;
		return await onOk(res);
	} catch (e) {
		logger.warn("pending-client", `${fnName} failed`, {
			error: e instanceof Error ? e.message : String(e),
		});
		return fallback;
	}
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
	if (opts.theme) qp.set("theme", opts.theme);
	if (opts.verified !== undefined) qp.set("verified", String(opts.verified));
	const params = qp.toString() ? `?${qp.toString()}` : "";

	return requestWithFallback<PendingTopic[]>(
		"fetchPendingTopics",
		[],
		`/api/v1/pending-topics${params}`,
		{ fetchFn, timeoutMs: timeoutMs ?? 10_000 },
		async (res) => {
			const data = (await res.json()) as PendingTopicsResponse;
			return data.ok && data.topics ? data.topics : [];
		},
	);
}

/**
 * 局部更新待审核选题的事实字段（内联编辑后批准前调用）。
 */
export async function patchPendingTopic(
	id: string,
	patch: { facts?: Record<string, string> },
	timeoutMs = 10_000,
): Promise<boolean> {
	return requestWithFallback<boolean>(
		"patchPendingTopic",
		false,
		`/api/v1/pending-topics/${encodeURIComponent(id)}`,
		{ method: "PATCH", body: JSON.stringify(patch), timeoutMs },
		async () => true,
	);
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
	return requestWithFallback<boolean>(
		"updatePendingStatus",
		false,
		`/api/v1/pending-topics/${encodeURIComponent(id)}`,
		{
			method: "PATCH",
			body: JSON.stringify({
				status,
				...(rejectedReason ? { rejectedReason } : {}),
			}),
			timeoutMs,
		},
		async () => true,
	);
}

/**
 * 拉取题材计数（题材选择器用）。默认只统计已核对的吃瓜（题材池）；U5。
 */
export async function fetchThemeCounts(
	fetchFn?: typeof fetch,
	timeoutMs = 10_000,
): Promise<ThemeCount[]> {
	return requestWithFallback<ThemeCount[]>(
		"fetchThemeCounts",
		[],
		"/api/v1/pending-topics/themes",
		{ fetchFn, timeoutMs },
		async (res) => {
			const data = (await res.json()) as { ok: boolean; themes?: ThemeCount[] };
			return data.ok && data.themes ? data.themes : [];
		},
	);
}

/**
 * 人工二次核对：置/撤销 verified（进/出题材池）；U4。
 */
export async function setPendingVerified(
	id: string,
	verified: boolean,
	timeoutMs = 10_000,
): Promise<boolean> {
	return requestWithFallback<boolean>(
		"setPendingVerified",
		false,
		`/api/v1/pending-topics/${encodeURIComponent(id)}`,
		{ method: "PATCH", body: JSON.stringify({ verified }), timeoutMs },
		async () => true,
	);
}

/**
 * 手动创建待审核选题
 */
export async function createPendingTopic(
	topic: {
		sourceUrl: string;
		siteName: string;
		title: string;
		facts?: Record<string, string>;
		confidence?: number;
		domain?: "gossip" | "acg";
	},
	timeoutMs = 10_000,
): Promise<boolean> {
	return requestWithFallback<boolean>(
		"createPendingTopic",
		false,
		"/api/v1/pending-topics",
		{
			method: "POST",
			body: JSON.stringify(topic),
			timeoutMs,
		},
		async () => true,
	);
}
