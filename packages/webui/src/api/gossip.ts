import { apiFetch } from "@/lib/api-client";

export interface GossipSite {
	id: string;
	name: string;
	listUrl: string;
	createdAt: string;
	lastDiscoverAt?: string | null;
	lastDiscoverCount?: number | null;
}

export async function listGossipSites(): Promise<{
	ok: boolean;
	sites: GossipSite[];
}> {
	return apiFetch<{ ok: boolean; sites: GossipSite[] }>("/api/v1/gossip/sites");
}

export async function addGossipSite(body: {
	name: string;
	listUrl: string;
}): Promise<{ ok: boolean; site: GossipSite }> {
	return apiFetch<{ ok: boolean; site: GossipSite }>("/api/v1/gossip/sites", {
		method: "POST",
		body: JSON.stringify(body),
	});
}

export async function deleteGossipSite(id: string): Promise<{ ok: boolean }> {
	return apiFetch<{ ok: boolean }>(`/api/v1/gossip/sites/${id}`, {
		method: "DELETE",
	});
}

export async function discoverGossipSite(
	id: string,
): Promise<{ ok: boolean; total: number }> {
	return apiFetch<{ ok: boolean; total: number }>(
		`/api/v1/gossip/sites/${id}/discover`,
		{
			method: "POST",
		},
	);
}

export async function addTopicFromUrl(body: {
	url: string;
	siteName?: string;
	windowDays?: number;
}): Promise<{ ok: boolean }> {
	return apiFetch<{ ok: boolean }>("/api/v1/gossip/topics/from-url", {
		method: "POST",
		body: JSON.stringify(body),
	});
}
