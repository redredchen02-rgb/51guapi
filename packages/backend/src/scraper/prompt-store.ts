import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { FewShotPair } from "@51guapi/shared";
import { dataDirEnv } from "../config/data-dir.js";
import { getDb } from "./pending-db.js";

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

// ---- SQLite 持久层（prompt_templates 表;原 JSON 文件轨已迁入,见 migration 012） ----

interface PromptRow {
	id: string;
	name: string;
	template: string;
	few_shot_pairs: string;
	model: string | null;
	created_at: string;
	updated_at: string;
}

function rowToPrompt(row: PromptRow): PromptTemplate {
	return {
		id: row.id,
		name: row.name,
		template: row.template,
		fewShotPairs: JSON.parse(row.few_shot_pairs) as FewShotPair[],
		model: row.model ?? undefined,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

// ---- fewShotExamples（旧字符串格式）→ fewShotPairs（结构化）迁移 ----
// 规范存储是结构化 fewShotPairs;旧 JSON 可能仅有 fewShotExamples 字符串。save 与 backfill
// 都过此归一,故 SQLite 行恒为结构化。旧字符串内含 ---/空行的歧义为历史遗留,无法完美还原。
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

function insertPrompt(t: PromptTemplate, replace: boolean): void {
	const db = getDb();
	const verb = replace ? "INSERT OR REPLACE" : "INSERT OR IGNORE";
	db.prepare(
		`${verb} INTO prompt_templates
		   (id, name, template, few_shot_pairs, model, created_at, updated_at)
		 VALUES (@id, @name, @template, @fewShotPairs, @model, @createdAt, @updatedAt)`,
	).run({
		id: t.id,
		name: t.name,
		template: t.template,
		fewShotPairs: JSON.stringify(t.fewShotPairs ?? []),
		model: t.model ?? null,
		createdAt: t.createdAt,
		updatedAt: t.updatedAt,
	});
}

// ---- 一次性 JSON→SQLite backfill（幂等;现网通常 0 行,目录多不存在） ----
const PROMPTS_DIR = join(
	dataDirEnv() ||
		join(dirname(new URL(import.meta.url).pathname), "..", "data"),
	"prompts",
);

let backfilled = false;

async function ensureBackfilled(): Promise<void> {
	if (backfilled) return;
	backfilled = true;
	let files: string[];
	try {
		files = (await readdir(PROMPTS_DIR)).filter((f) => f.endsWith(".json"));
	} catch {
		return; // 目录不存在 → 无遗留 JSON,纯 SQLite。
	}
	for (const f of files) {
		try {
			const raw = JSON.parse(
				await readFile(join(PROMPTS_DIR, f), "utf-8"),
			) as RawPrompt;
			insertPrompt(migratePairs(raw), false); // INSERT OR IGNORE:不覆盖已迁入的
		} catch {
			// 跳过坏/不可读文件
		}
	}
}

/** 测试用:重置 backfill 一次性闸（仅供 *.test.ts）。 */
export function __resetBackfillForTest(): void {
	backfilled = false;
}

export async function getAllPrompts(): Promise<PromptTemplate[]> {
	await ensureBackfilled();
	const rows = getDb()
		.prepare("SELECT * FROM prompt_templates ORDER BY updated_at DESC")
		.all() as PromptRow[];
	return rows.map(rowToPrompt);
}

export async function getPromptById(
	id: string,
): Promise<PromptTemplate | null> {
	await ensureBackfilled();
	const row = getDb()
		.prepare("SELECT * FROM prompt_templates WHERE id = ?")
		.get(id) as PromptRow | undefined;
	return row ? rowToPrompt(row) : null;
}

export async function loadPrompt(id: string): Promise<PromptTemplate | null> {
	return getPromptById(id);
}

export async function savePrompt(template: PromptTemplate): Promise<void> {
	await ensureBackfilled();
	// 归一旧格式 + 刷新 updatedAt（对齐原 JsonFileStore.write 全覆盖语义）。
	const t = migratePairs(template as RawPrompt);
	insertPrompt({ ...t, updatedAt: new Date().toISOString() }, true);
}

export async function listPrompts(): Promise<PromptTemplate[]> {
	return getAllPrompts();
}

export async function deletePrompt(id: string): Promise<boolean> {
	await ensureBackfilled();
	const info = getDb()
		.prepare("DELETE FROM prompt_templates WHERE id = ?")
		.run(id);
	return info.changes > 0;
}
