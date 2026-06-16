import type { ContentDraft } from "@51guapi/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { storage } from "#imports";
import { createBatch, markGenerating } from "./batch";
import {
	addFewShotPair,
	clearBatch,
	DEFAULT_SETTINGS,
	deriveFewShotExamples,
	getApiKey,
	getBackendToken,
	getBatch,
	getSettings,
	parseFewShotExamples,
	removeLastFewShotPair,
	saveApiKey,
	saveBackendToken,
	saveBatch,
	saveSettings,
} from "./storage";

const D: ContentDraft = {
	id: "d",
	title: "t",
	subtitle: "",
	category: "2",
	coverImageUrl: "",
	body: "<p>x</p>",
	tags: [],
	description: "",
	postStatus: "0",
	publishedAt: "",
	mediaId: "1",
	status: "draft",
	createdAt: "2026-06-04T00:00:00.000Z",
};

describe("storage", () => {
	beforeEach(() => {
		fakeBrowser.reset();
	});

	it("storage 为空时 getSettings 返回完整默认对象", async () => {
		const s = await getSettings();
		expect(s.endpoint).toBe(DEFAULT_SETTINGS.endpoint);
		expect(s.fieldMapping.title?.selector).toBe('input[name="title"]');
		expect(s.fieldMapping.body?.fieldType).toBe("quill");
		expect(s.recommendedTags).toEqual([]);
		expect(s.fewShotPairs).toEqual([]);
	});

	it("旧 storage（无 recommendedTags/fewShotPairs）getSettings 回落默认值", async () => {
		await storage.setItem("local:settings", {
			endpoint: "https://x.com",
			model: "gpt-4o",
		});
		const s = await getSettings();
		expect(s.recommendedTags).toEqual([]);
		expect(s.fewShotPairs).toEqual([]);
	});

	it("saveSettings 后 getSettings 取回同值", async () => {
		const next = {
			...DEFAULT_SETTINGS,
			endpoint: "https://api.example.com/v1/chat/completions",
			model: "gpt-4o",
		};
		await saveSettings(next);
		const got = await getSettings();
		expect(got.endpoint).toBe("https://api.example.com/v1/chat/completions");
		expect(got.model).toBe("gpt-4o");
	});

	it("部分设置与默认 fieldMapping 合并(缺省项回落)", async () => {
		await saveSettings({
			...DEFAULT_SETTINGS,
			fieldMapping: { title: { selector: "#custom-title", fieldType: "text" } },
		});
		const got = await getSettings();
		expect(got.fieldMapping.title?.selector).toBe("#custom-title");
		expect(got.fieldMapping.body?.selector).toBe("#editor");
	});

	it("getApiKey 未设置时返回空字符串而非崩溃", async () => {
		expect(await getApiKey()).toBe("");
	});

	it("saveApiKey 后能取回", async () => {
		await saveApiKey("sk-test-123");
		expect(await getApiKey()).toBe("sk-test-123");
	});

	describe("批量持久化 + 加载即恢复(生成专用)", () => {
		it("无批次 → null", async () => {
			expect(await getBatch()).toBeNull();
		});

		it("save/get 往返", async () => {
			const b = createBatch(
				"b1",
				7,
				["x"],
				"2026-06-04T00:00:00.000Z",
				(i) => `i${i}`,
			);
			await saveBatch(b);
			const got = await getBatch();
			expect(got?.id).toBe("b1");
			expect(got?.tabId).toBe(7);
		});

		it("加载即恢复:卡在 generating 的条目 → error(可重试)", async () => {
			let b = createBatch(
				"b1",
				7,
				["a"],
				"2026-06-04T00:00:00.000Z",
				(i) => `i${i}`,
			);
			b = markGenerating(b, "i0");
			await saveBatch(b);
			const got = await getBatch();
			expect(got?.items[0]?.status).toBe("error");
		});

		it("坏批次值(items 非数组)→ null", async () => {
			await storage.setItem("local:batch", { id: "x" });
			expect(await getBatch()).toBeNull();
		});

		it("clearBatch 后 → null", async () => {
			const b = createBatch("b1", 7, ["x"], "t", (i) => `i${i}`);
			await saveBatch(b);
			await clearBatch();
			expect(await getBatch()).toBeNull();
		});

		it("save 完整草稿后能取回 draft", async () => {
			let b = createBatch("b1", 7, ["x"], "t", (i) => `i${i}`);
			b = {
				...b,
				items: b.items.map((it) => ({
					...it,
					status: "filled" as const,
					draft: D,
				})),
			};
			await saveBatch(b);
			const got = await getBatch();
			expect(got?.items[0]?.draft?.id).toBe("d");
		});
	});

	describe("backendToken", () => {
		it("未设置时返回空字符串", async () => {
			expect(await getBackendToken()).toBe("");
		});

		it("saveBackendToken 后能取回", async () => {
			await saveBackendToken("jwt-token-abc");
			expect(await getBackendToken()).toBe("jwt-token-abc");
		});
	});

	describe("addFewShotPair / removeLastFewShotPair", () => {
		it("addFewShotPair:首条追加成功 → ok:true,settings 存有 pair", async () => {
			const r = await addFewShotPair({ input: "Q1", output: "A1" });
			expect(r).toEqual({ ok: true });
			const s = await getSettings();
			expect(s.fewShotPairs).toHaveLength(1);
			expect(s.fewShotPairs?.[0]).toEqual({ input: "Q1", output: "A1" });
		});

		it("addFewShotPair:已有 8 条 → ok:false, reason:full,不写入", async () => {
			for (let i = 0; i < 8; i++) {
				await addFewShotPair({ input: `i${i}`, output: `o${i}` });
			}
			const r = await addFewShotPair({ input: "overflow", output: "x" });
			expect(r).toEqual({ ok: false, reason: "full" });
			const s = await getSettings();
			expect(s.fewShotPairs).toHaveLength(8);
		});

		it("addFewShotPair:多条时 fewShotPairs 正确储存", async () => {
			await addFewShotPair({ input: "Q1", output: "A1" });
			await addFewShotPair({ input: "Q2", output: "A2" });
			const s = await getSettings();
			expect(s.fewShotPairs).toEqual([
				{ input: "Q1", output: "A1" },
				{ input: "Q2", output: "A2" },
			]);
		});

		it("removeLastFewShotPair:移除末尾一条", async () => {
			await addFewShotPair({ input: "Q1", output: "A1" });
			await addFewShotPair({ input: "Q2", output: "A2" });
			await removeLastFewShotPair();
			const s = await getSettings();
			expect(s.fewShotPairs).toHaveLength(1);
			expect(s.fewShotPairs?.[0]).toEqual({ input: "Q1", output: "A1" });
		});

		it("removeLastFewShotPair:最后一条移除后 fewShotPairs 为空", async () => {
			await addFewShotPair({ input: "Q1", output: "A1" });
			await removeLastFewShotPair();
			const s = await getSettings();
			expect(s.fewShotPairs).toHaveLength(0);
		});

		it("removeLastFewShotPair:空列表时幂等,不报错", async () => {
			await expect(removeLastFewShotPair()).resolves.toBeUndefined();
			const s = await getSettings();
			expect(s.fewShotPairs ?? []).toHaveLength(0);
		});
	});

	describe("dailyBatchSize clamp", () => {
		it("未设置时 getSettings 返回默认值 5", async () => {
			const s = await getSettings();
			expect(s.dailyBatchSize).toBe(5);
		});

		it("saveSettings(5) → getSettings 返回 5", async () => {
			await saveSettings({ ...DEFAULT_SETTINGS, dailyBatchSize: 5 });
			const s = await getSettings();
			expect(s.dailyBatchSize).toBe(5);
		});

		it("saveSettings(0) → clamp 到 1", async () => {
			await saveSettings({ ...DEFAULT_SETTINGS, dailyBatchSize: 0 });
			const s = await getSettings();
			expect(s.dailyBatchSize).toBe(1);
		});

		it("saveSettings(99) → clamp 到 20", async () => {
			await saveSettings({ ...DEFAULT_SETTINGS, dailyBatchSize: 99 });
			const s = await getSettings();
			expect(s.dailyBatchSize).toBe(20);
		});

		it("saveSettings(undefined) → getSettings 回落默认值 5", async () => {
			await saveSettings({ ...DEFAULT_SETTINGS, dailyBatchSize: undefined });
			const s = await getSettings();
			expect(s.dailyBatchSize).toBe(5);
		});

		it("旧 storage（无 dailyBatchSize）→ getSettings 回落默认值 5", async () => {
			await storage.setItem("local:settings", {
				endpoint: "https://x.com",
				model: "gpt-4o",
			});
			const s = await getSettings();
			expect(s.dailyBatchSize).toBe(5);
		});
	});

	describe("parseFewShotExamples / deriveFewShotExamples", () => {
		it("happy path: 單條帶分隔符 → [{input, output}]", () => {
			expect(parseFewShotExamples("A\n---\nB")).toEqual([
				{ input: "A", output: "B" },
			]);
		});

		it("happy path: 兩條以 \\n\\n 分隔 → 兩個 pair", () => {
			expect(parseFewShotExamples("A\n---\nB\n\nC\n---\nD")).toEqual([
				{ input: "A", output: "B" },
				{ input: "C", output: "D" },
			]);
		});

		it("edge case: 無分隔符的 block → {input: '', output: block}", () => {
			expect(parseFewShotExamples("no separator here")).toEqual([
				{ input: "", output: "no separator here" },
			]);
		});

		it("edge case: 空字串 → []", () => {
			expect(parseFewShotExamples("")).toEqual([]);
		});

		it("edge case: 只有空白行 → []", () => {
			expect(parseFewShotExamples("\n\n\n")).toEqual([]);
		});

		it("round-trip: derive → parse 還原相同 pairs", () => {
			const pairs = [
				{ input: "Q1", output: "A1" },
				{ input: "Q2", output: "A2" },
			];
			expect(parseFewShotExamples(deriveFewShotExamples(pairs))).toEqual(pairs);
		});
	});
});
