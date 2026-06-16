import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	deletePrompt,
	getAllPrompts,
	getPromptById,
	listPrompts,
	type PromptTemplate,
	savePrompt,
} from "./prompt-store.js";

function makePrompt(overrides: Partial<PromptTemplate> = {}): PromptTemplate {
	const now = new Date().toISOString();
	return {
		id: `prompt_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
		name: "测试模板",
		template: "你是一个写手 {{topic}}",
		fewShotPairs: [{ input: "Q1", output: "A1" }],
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

// 清空 prompts 目录，避免跨测试串扰
async function clearAll() {
	for (const p of await listPrompts()) await deletePrompt(p.id);
}

beforeEach(clearAll);
afterEach(clearAll);

describe("prompt-store", () => {
	it("save → load: 字段完整往返", async () => {
		const p = makePrompt({ model: "gemma" });
		await savePrompt(p);
		const loaded = await getPromptById(p.id);
		expect(loaded).not.toBeNull();
		expect(loaded?.name).toBe("测试模板");
		expect(loaded?.template).toBe("你是一个写手 {{topic}}");
		expect(loaded?.fewShotPairs).toEqual([{ input: "Q1", output: "A1" }]);
		expect(loaded?.model).toBe("gemma");
	});

	it("load 不存在的 id → null", async () => {
		expect(await getPromptById("nonexistent")).toBeNull();
	});

	it("save 同 id 两次 → 覆盖，以最新为准", async () => {
		const p = makePrompt();
		await savePrompt(p);
		await savePrompt({ ...p, name: "改名后" });
		expect((await getPromptById(p.id))?.name).toBe("改名后");
	});

	it("空 store → getAllPrompts 返回空数组", async () => {
		expect(await getAllPrompts()).toEqual([]);
	});

	it("getAllPrompts 返回所有已存模板", async () => {
		await savePrompt(makePrompt({ id: "prompt_a", name: "A" }));
		await savePrompt(makePrompt({ id: "prompt_b", name: "B" }));
		const list = await getAllPrompts();
		expect(list.length).toBe(2);
		expect(list.map((p) => p.name).sort()).toEqual(["A", "B"]);
	});

	it("delete 已存在 → true，记录消失", async () => {
		const p = makePrompt();
		await savePrompt(p);
		expect(await deletePrompt(p.id)).toBe(true);
		expect(await getPromptById(p.id)).toBeNull();
	});

	it("delete 不存在的 id → false", async () => {
		expect(await deletePrompt("ghost")).toBe(false);
	});

	describe("lazy-on-read migration", () => {
		it("JSON 含舊格式 fewShotExamples 無 fewShotPairs → 自動 parse 回傳 pairs", async () => {
			const now = new Date().toISOString();
			// 直接寫入舊格式（繞過 savePrompt 型別限制）
			const raw = {
				id: "prompt_legacy_001",
				name: "舊格式模板",
				template: "t",
				fewShotExamples: "Q\n---\nA",
				createdAt: now,
				updatedAt: now,
			};
			// biome-ignore lint/suspicious/noExplicitAny: intentional raw write for migration test
			await savePrompt(raw as any);

			const loaded = await getPromptById("prompt_legacy_001");
			expect(loaded?.fewShotPairs).toEqual([{ input: "Q", output: "A" }]);
		});

		it("JSON 含舊格式 fewShotExamples 且 fewShotPairs 為空陣列 → 觸發 parse", async () => {
			const now = new Date().toISOString();
			const raw = {
				id: "prompt_legacy_002",
				name: "舊格式空 pairs",
				template: "t",
				fewShotExamples: "Q\n---\nA",
				fewShotPairs: [],
				createdAt: now,
				updatedAt: now,
			};
			// biome-ignore lint/suspicious/noExplicitAny: intentional raw write for migration test
			await savePrompt(raw as any);

			const loaded = await getPromptById("prompt_legacy_002");
			expect(loaded?.fewShotPairs).toEqual([{ input: "Q", output: "A" }]);
		});

		it("兩側一致性：後端 lazy parse 與 extension parseFewShotExamples 邏輯相同", async () => {
			const now = new Date().toISOString();
			const raw = {
				id: "prompt_consistency_001",
				name: "一致性測試",
				template: "t",
				fewShotExamples: "A\n---\nB\n\nC\n---\nD",
				createdAt: now,
				updatedAt: now,
			};
			// biome-ignore lint/suspicious/noExplicitAny: intentional raw write for migration test
			await savePrompt(raw as any);

			const loaded = await getPromptById("prompt_consistency_001");
			expect(loaded?.fewShotPairs).toEqual([
				{ input: "A", output: "B" },
				{ input: "C", output: "D" },
			]);
		});
	});
});
