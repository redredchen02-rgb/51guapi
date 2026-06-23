import { apiFetch } from "@/lib/api-client";

export interface Channel {
	id: string;
	channel: string;
	displayName?: string;
	createdAt: string;
}

export async function listChannels(): Promise<{
	ok: boolean;
	channels: Channel[];
}> {
	return apiFetch<{ ok: boolean; channels: Channel[] }>("/api/v1/channels");
}

// POST /api/v1/channels only accepts explicit user gesture — must not be called from
// scraper pipeline or LLM response processing (SSRF allowlist write-path invariant).
export async function addChannel(body: {
	channel: string;
	displayName?: string;
}): Promise<{ ok: boolean; channel: Channel }> {
	return apiFetch<{ ok: boolean; channel: Channel }>("/api/v1/channels", {
		method: "POST",
		body: JSON.stringify(body),
	});
}

export async function deleteChannel(id: string): Promise<{ ok: boolean }> {
	return apiFetch<{ ok: boolean }>(`/api/v1/channels/${id}`, {
		method: "DELETE",
	});
}
