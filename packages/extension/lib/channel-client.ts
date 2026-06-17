import { apiFetch } from "./api-fetch";

// U6 渠道客户端 — 管理可爬取渠道域名(动态进后端 SSRF allowlist)。
// 新增渠道是高敏感写操作:必须带操作者确认手势(header x-operator-confirm + body confirm)。
// 该手势与后端 channel-routes 的人手确认闸对齐,LLM/自动化不会带。

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
	/** 管理员口令重验(step-up)。后端要求,缺/错回 403。 */
	adminPassword?: string;
}

/**
 * 新增渠道。必带操作者确认手势(header + body)+ 管理员口令 step-up,否则后端回 403。
 * 返回新增(或去重命中)的渠道。
 */
export async function createChannel(
	channel: string,
	opts: CreateChannelOptions = {},
	fetchFn?: typeof fetch,
): Promise<Channel> {
	const res = await apiFetch("/api/v1/channels", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			// 人手确认手势:与后端 channel-routes 的 CONFIRM_HEADER 对齐。
			"x-operator-confirm": "1",
		},
		body: JSON.stringify({
			channel,
			displayName: opts.displayName,
			reason: opts.reason,
			confirm: true,
			adminPassword: opts.adminPassword,
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
