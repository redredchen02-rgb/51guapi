import type { FewShotPair } from "@51guapi/shared";
import { apiFetch } from "./api-fetch";

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export interface PromptTemplate {
	id: string;
	name: string;
	template: string;
	fewShotPairs: FewShotPair[];
	model?: string;
	createdAt: string;
	updatedAt: string;
}

/**
 * 从后端获取所有 Prompt 模板列表。
 */
export async function fetchPrompts(
	fetchFn?: typeof fetch,
	timeoutMs = 10_000,
): Promise<{ ok: boolean; prompts?: PromptTemplate[]; error?: string }> {
	try {
		const res = await apiFetch("/api/v1/prompts", { fetchFn, timeoutMs });
		if (!res.ok) {
			return { ok: false, error: `HTTP ${res.status}` };
		}
		return await res.json();
	} catch (err) {
		return { ok: false, error: errorMessage(err) };
	}
}

/**
 * 在后端创建新 Prompt 模板。
 */
export async function createPrompt(
	data: {
		name: string;
		template: string;
		fewShotPairs: FewShotPair[];
		model?: string;
	},
	timeoutMs = 10_000,
	fetchFn?: typeof fetch,
): Promise<{ ok: boolean; error?: string }> {
	try {
		const res = await apiFetch("/api/v1/prompts", {
			method: "POST",
			body: JSON.stringify(data),
			fetchFn,
			timeoutMs,
		});
		if (!res.ok) {
			return { ok: false, error: `HTTP ${res.status}` };
		}
		return await res.json();
	} catch (err) {
		return { ok: false, error: errorMessage(err) };
	}
}

/**
 * 更新后端的 Prompt 模板。
 */
export async function updatePrompt(
	id: string,
	data: {
		name: string;
		template: string;
		fewShotPairs: FewShotPair[];
		model?: string;
	},
	timeoutMs = 10_000,
	fetchFn?: typeof fetch,
): Promise<{ ok: boolean; error?: string }> {
	try {
		const res = await apiFetch(`/api/v1/prompts/${id}`, {
			method: "PUT",
			body: JSON.stringify(data),
			fetchFn,
			timeoutMs,
		});
		if (!res.ok) {
			return { ok: false, error: `HTTP ${res.status}` };
		}
		return await res.json();
	} catch (err) {
		return { ok: false, error: errorMessage(err) };
	}
}
