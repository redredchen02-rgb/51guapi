import { dirname, join } from "node:path";
import type { FewShotPair } from "@51guapi/shared";
import { JsonFileStore } from "../utils/json-store.js";

// ---- 类型定义 ----

export interface PromptTemplate {
	id: string;
	name: string;
	template: string;
	fewShotPairs: FewShotPair[];
	model?: string;
	createdAt: string;
	updatedAt: string;
}

export interface PromptTemplateCreate {
	name: string;
	template: string;
	fewShotPairs: FewShotPair[];
	model?: string;
}

export interface PromptTemplateUpdate {
	name?: string;
	template?: string;
	fewShotPairs?: FewShotPair[];
	model?: string;
}

// ---- 文件持久层（轻量 JSON，与 pending-store.ts 一致） ----

const DATA_DIR =
	process.env.PUBLISHER_DATA_DIR ||
	join(dirname(new URL(import.meta.url).pathname), "..", "data");
const PROMPTS_DIR = join(DATA_DIR, "prompts");

const promptStore = new JsonFileStore<PromptTemplate>({
	dirPath: PROMPTS_DIR,
	updatedAtKey: "updatedAt",
});

// ---- lazy-on-read 遷移：舊 JSON 含 fewShotExamples 字段时，自動 parse 回傳 ----

type RawPrompt = PromptTemplate & { fewShotExamples?: string };

function migratePairs(raw: RawPrompt): PromptTemplate {
	if (
		(!raw.fewShotPairs || raw.fewShotPairs.length === 0) &&
		typeof raw.fewShotExamples === "string" &&
		raw.fewShotExamples
	) {
		const blocks = raw.fewShotExamples.split(/\n\n+/).filter(Boolean);
		const parsed: FewShotPair[] = blocks.map((b) => {
			const sep = b.indexOf("\n---\n");
			return sep !== -1
				? { input: b.slice(0, sep), output: b.slice(sep + 5) }
				: { input: "", output: b };
		});
		return { ...raw, fewShotPairs: parsed };
	}
	return { ...raw, fewShotPairs: raw.fewShotPairs ?? [] };
}

export async function getAllPrompts(): Promise<PromptTemplate[]> {
	const raws = (await promptStore.list()) as RawPrompt[];
	return raws.map(migratePairs);
}

export async function getPromptById(
	id: string,
): Promise<PromptTemplate | null> {
	const raw = (await promptStore.read(id)) as RawPrompt | null;
	if (!raw) return null;
	return migratePairs(raw);
}

export async function loadPrompt(id: string): Promise<PromptTemplate | null> {
	return getPromptById(id);
}

export async function savePrompt(template: PromptTemplate): Promise<void> {
	return promptStore.write(template);
}

export async function listPrompts(): Promise<PromptTemplate[]> {
	return getAllPrompts();
}

export async function deletePrompt(id: string): Promise<boolean> {
	return promptStore.delete(id);
}
