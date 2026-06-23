import { apiFetch } from "./api-fetch";

// 渠道客户端 — 管理可爬取渠道域名(动态进后端 SSRF allowlist)。
// 自用模式(plan 2026-06-18-003 + JWT 移除):无鉴权,直接请求后端。

export interface Channel {
	id: string;
	hostname: string;
	displayName: string;
	pathPrefix: string;
	maxDepth: number;
	maxBytes: number;
	createdBy: string;
	reason: string;
	createdAt: string;
}

export async function fetchChannels(
	fetchFn?: typeof fetch,
): Promise<Channel[]> {
	const res = await apiFetch("/api/v1/channels", {
		fetchFn,
		timeoutMs: 10_000,
	});
	if (res.status === 401) throw new Error("Unauthorized");
	if (!res.ok) {
		const data = (await res.json()) as { error?: string };
		throw new Error(data.error ?? `HTTP ${res.status}`);
	}
	const data = (await res.json()) as { ok: boolean; channels?: Channel[] };
	return data.ok && data.channels ? data.channels : [];
}

export interface CreateChannelOptions {
	displayName?: string;
	reason?: string;
}

/**
 * 新增渠道(自用模式:只需有效 JWT,无确认手势/口令)。
 * 返回新增(或去重命中)的渠道。
 */
export async function createChannel(
	channel: string,
	opts: CreateChannelOptions = {},
	fetchFn?: typeof fetch,
): Promise<Channel> {
	const res = await apiFetch("/api/v1/channels", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			channel,
			displayName: opts.displayName,
			reason: opts.reason,
		}),
		fetchFn,
		timeoutMs: 15_000,
	});
	if (res.status === 401) throw new Error("Unauthorized");
	if (!res.ok) {
		const data = (await res.json()) as { error?: string };
		throw new Error(data.error ?? `HTTP ${res.status}`);
	}
	const data = (await res.json()) as { ok: boolean; channel?: Channel };
	if (!data.ok || !data.channel) throw new Error("Empty response");
	return data.channel;
}

export async function deleteChannel(
	id: string,
	fetchFn?: typeof fetch,
): Promise<void> {
	const res = await apiFetch(`/api/v1/channels/${id}`, {
		method: "DELETE",
		fetchFn,
		timeoutMs: 10_000,
	});
	if (res.status === 401) throw new Error("Unauthorized");
	if (!res.ok) {
		const data = (await res.json()) as { error?: string };
		throw new Error(data.error ?? `HTTP ${res.status}`);
	}
}
