import { apiFetch } from "@/lib/api-client";

export interface PromptTemplate {
	id: string;
	name: string;
	template: string;
	isDefault?: boolean;
	createdAt: string;
	updatedAt?: string;
}

export async function listPrompts(): Promise<{
	ok: boolean;
	prompts: PromptTemplate[];
}> {
	return apiFetch<{ ok: boolean; prompts: PromptTemplate[] }>(
		"/api/v1/prompts",
	);
}

export async function getPrompt(
	id: string,
): Promise<{ ok: boolean; prompt: PromptTemplate }> {
	return apiFetch<{ ok: boolean; prompt: PromptTemplate }>(
		`/api/v1/prompts/${id}`,
	);
}

export async function createPrompt(body: {
	name: string;
	template: string;
}): Promise<{ ok: boolean; prompt: PromptTemplate }> {
	return apiFetch<{ ok: boolean; prompt: PromptTemplate }>("/api/v1/prompts", {
		method: "POST",
		body: JSON.stringify(body),
	});
}

export async function updatePrompt(
	id: string,
	body: Partial<Pick<PromptTemplate, "name" | "template">>,
): Promise<{ ok: boolean; prompt: PromptTemplate }> {
	return apiFetch<{ ok: boolean; prompt: PromptTemplate }>(
		`/api/v1/prompts/${id}`,
		{
			method: "PUT",
			body: JSON.stringify(body),
		},
	);
}

export async function deletePrompt(id: string): Promise<{ ok: boolean }> {
	return apiFetch<{ ok: boolean }>(`/api/v1/prompts/${id}`, {
		method: "DELETE",
	});
}
