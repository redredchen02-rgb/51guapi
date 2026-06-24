import type {
	PendingTopic,
	PendingTopicsResponse,
	RejectionReason,
	ThemeCount,
} from "@51guapi/shared";
import { apiFetch } from "@/lib/api-client";

export type { PendingTopicsResponse, ThemeCount };

export interface ListPendingTopicsParams {
	status?: "pending" | "approved" | "rejected";
	domain?: "gossip";
	theme?: string;
	verified?: boolean;
	sort_by?: "score" | "created_at";
	limit?: number;
}

export async function listPendingTopics(
	params: ListPendingTopicsParams = {},
): Promise<PendingTopicsResponse> {
	const query = new URLSearchParams();
	if (params.status) query.set("status", params.status);
	if (params.domain) query.set("domain", params.domain);
	if (params.theme) query.set("theme", params.theme);
	if (params.verified !== undefined)
		query.set("verified", String(params.verified));
	if (params.sort_by) query.set("sort_by", params.sort_by);
	if (params.limit) query.set("limit", String(params.limit));

	const qs = query.toString();
	return apiFetch<PendingTopicsResponse>(
		`/api/v1/pending-topics${qs ? `?${qs}` : ""}`,
	);
}

export async function getPendingTopic(
	id: string,
): Promise<{ ok: boolean; topic: PendingTopic }> {
	return apiFetch<{ ok: boolean; topic: PendingTopic }>(
		`/api/v1/pending-topics/${id}`,
	);
}

export interface PatchPendingTopicBody {
	status?: "pending" | "approved" | "rejected";
	rejectedReason?: RejectionReason;
	verified?: boolean;
}

export async function patchPendingTopic(
	id: string,
	body: PatchPendingTopicBody,
): Promise<{ ok: boolean; topic: PendingTopic }> {
	return apiFetch<{ ok: boolean; topic: PendingTopic }>(
		`/api/v1/pending-topics/${id}`,
		{
			method: "PATCH",
			body: JSON.stringify(body),
		},
	);
}

export async function deletePendingTopic(id: string): Promise<{ ok: boolean }> {
	return apiFetch<{ ok: boolean }>(`/api/v1/pending-topics/${id}`, {
		method: "DELETE",
	});
}

export async function listTopicThemes(): Promise<{
	ok: boolean;
	themes: ThemeCount[];
}> {
	return apiFetch<{ ok: boolean; themes: ThemeCount[] }>(
		"/api/v1/pending-topics/themes",
	);
}
