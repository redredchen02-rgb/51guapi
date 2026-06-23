import type {
	ContentDraft,
	GenerateDraftResponse,
	GossipFactsBlock,
	ReviewResult,
	Settings,
} from "@51guapi/shared";
import { apiFetch } from "@/lib/api-client";

export async function generateDraft(body: {
	prompt: string;
	settings?: Partial<Settings>;
	facts?: GossipFactsBlock;
}): Promise<GenerateDraftResponse> {
	return apiFetch<GenerateDraftResponse>("/api/v1/drafts/generate", {
		method: "POST",
		body: JSON.stringify(body),
	});
}

export async function reviewDraft(body: {
	draft: ContentDraft;
	settings?: Partial<Settings>;
}): Promise<{ ok: boolean; result: ReviewResult }> {
	return apiFetch<{ ok: boolean; result: ReviewResult }>(
		"/api/v1/drafts/review",
		{
			method: "POST",
			body: JSON.stringify(body),
		},
	);
}

export async function rewriteDraft(body: {
	draft: ContentDraft;
	failedDims: string[];
	settings?: Partial<Settings>;
}): Promise<{ ok: boolean; draft: ContentDraft }> {
	return apiFetch<{ ok: boolean; draft: ContentDraft }>(
		"/api/v1/drafts/rewrite",
		{
			method: "POST",
			body: JSON.stringify(body),
		},
	);
}

export async function listModels(): Promise<{ ok: boolean; models: string[] }> {
	return apiFetch<{ ok: boolean; models: string[] }>("/api/v1/models");
}
