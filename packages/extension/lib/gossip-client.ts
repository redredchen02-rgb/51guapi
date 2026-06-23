import { apiFetch } from "./api-fetch";

export interface GossipSite {
	id: string;
	name: string;
	listUrl: string;
	enabled: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface DiscoveredItem {
	url: string;
	title?: string;
}

// 收敛 5 个 gossip 请求重复的错误样板:401 → Unauthorized、非 2xx → 后端 error
// 消息回退。成功时**不消费** body(res.json 只能读一次),交由调用方按各自形状解析。
// 注:401→clearToken 副作用已在 apiFetch 内完成,此处仅负责把状态翻成错误。
async function handleGossipResponse(res: Response): Promise<void> {
	if (res.status === 401) {
		throw new Error("Unauthorized");
	}
	if (!res.ok) {
		const data = (await res.json()) as { error?: string };
		throw new Error(data.error ?? `HTTP ${res.status}`);
	}
}

export async function fetchGossipSites(
	fetchFn?: typeof fetch,
): Promise<GossipSite[]> {
	const res = await apiFetch("/api/v1/gossip/sites", {
		fetchFn,
		timeoutMs: 10_000,
	});
	await handleGossipResponse(res);
	const data = (await res.json()) as { ok: boolean; sites?: GossipSite[] };
	return data.ok && data.sites ? data.sites : [];
}

export async function createGossipSite(
	name: string,
	listUrl: string,
	fetchFn?: typeof fetch,
): Promise<GossipSite | null> {
	try {
		const res = await apiFetch("/api/v1/gossip/sites", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name, listUrl }),
			fetchFn,
			timeoutMs: 10_000,
		});
		await handleGossipResponse(res);
		const data = (await res.json()) as { ok: boolean; site?: GossipSite };
		return data.site ?? null;
	} catch (e) {
		throw e instanceof Error ? e : new Error(String(e));
	}
}

export async function deleteGossipSite(
	id: string,
	fetchFn?: typeof fetch,
): Promise<void> {
	const res = await apiFetch(`/api/v1/gossip/sites/${id}`, {
		method: "DELETE",
		fetchFn,
		timeoutMs: 10_000,
	});
	await handleGossipResponse(res);
}

export async function discoverGossipSite(
	siteId: string,
	fetchFn?: typeof fetch,
): Promise<DiscoveredItem[]> {
	try {
		const res = await apiFetch(`/api/v1/gossip/sites/${siteId}/discover`, {
			method: "POST",
			fetchFn,
			timeoutMs: 30_000,
		});
		await handleGossipResponse(res);
		const data = (await res.json()) as {
			ok: boolean;
			discovered?: DiscoveredItem[];
		};
		return data.discovered ?? [];
	} catch (e) {
		throw e instanceof Error ? e : new Error(String(e));
	}
}

export async function fetchGossipTopicFromUrl(
	url: string,
	siteName: string,
	fetchFn?: typeof fetch,
): Promise<{ id: string; title: string }> {
	const res = await apiFetch("/api/v1/gossip/topics/from-url", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ url, siteName }),
		fetchFn,
		timeoutMs: 60_000,
	});
	// 409 是本函数特有的去重信号,必须先于通用非 2xx 分支命中。
	if (res.status === 409) throw new Error("DUPLICATE_URL");
	await handleGossipResponse(res);
	const data = (await res.json()) as {
		ok: boolean;
		topic?: { id: string; title: string };
	};
	if (!data.ok || !data.topic) throw new Error("Empty response");
	return data.topic;
}
