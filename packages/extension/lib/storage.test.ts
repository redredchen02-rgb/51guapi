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
	getExtensionCounters,
	getSettings,
	removeLastFewShotPair,
	saveApiKey,
	saveBackendToken,
	saveBatch,
	saveExtensionCounters,
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

	describe("ExtensionCounters", () => {
		it("首次调用返回默认 0/0/0", async () => {
			const c = await getExtensionCounters();
			expect(c).toEqual({
				publishAttempts: { success: 0, failed: 0 },
				batchesCompleted: 0,
			});
		});

		it("save 后 getExtensionCounters 取回 batchesCompleted", async () => {
			await saveExtensionCounters({
				publishAttempts: { success: 1, failed: 2 },
				batchesCompleted: 3,
			});
			const c = await getExtensionCounters();
			expect(c.batchesCompleted).toBe(3);
			expect(c.publishAttempts).toEqual({ success: 1, failed: 2 });
		});

		it("不完整旧数据（缺 batchesCompleted）→ 回落默认而不崩溃", async () => {
			await storage.setItem("local:extensionCounters", {
				publishAttempts: { success: 5 },
			});
			const c = await getExtensionCounters();
			expect(c.batchesCompleted).toBe(0);
			expect(c.publishAttempts.success).toBe(5);
			expect(c.publishAttempts.failed).toBe(0);
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

	describe("deriveFewShotExamples(单向序列化,内容含分隔符不再回 parse)", () => {
		it("pairs → 可读文本,input/output 以 \\n---\\n 连接,pair 间空行", () => {
			expect(
				deriveFewShotExamples([
					{ input: "Q1", output: "A1" },
					{ input: "Q2", output: "A2" },
				]),
			).toBe("Q1\n---\nA1\n\nQ2\n---\nA2");
		});

		it("空列表 → 空串", () => {
			expect(deriveFewShotExamples([])).toBe("");
		});

		it("内容含 --- / 空行也照常序列化(不再有 parse 往返损坏风险)", () => {
			expect(
				deriveFewShotExamples([{ input: "Q", output: "l1\n---\nl2\n\nl3" }]),
			).toBe("Q\n---\nl1\n---\nl2\n\nl3");
		});
	});
});
