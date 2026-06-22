import type { ContentDraft } from "@51guapi/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing";
import { storage } from "#imports";
import {
	addFewShotPair,
	DEFAULT_SETTINGS,
	deriveFewShotExamples,
	getBackendToken,
	getCurrentDraft,
	getExtensionCounters,
	getSettings,
	removeLastFewShotPair,
	saveBackendToken,
	saveCurrentDraft,
	saveExtensionCounters,
	saveSettings,
} from "./storage";

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

	describe("backendToken", () => {
		it("未设置时返回空字符串", async () => {
			expect(await getBackendToken()).toBe("");
		});

		it("saveBackendToken 后能取回", async () => {
			await saveBackendToken("jwt-token-abc");
			expect(await getBackendToken()).toBe("jwt-token-abc");
		});
	});

	describe("currentDraft snapshot", () => {
		const draft: ContentDraft = {
			id: "d1",
			title: "草稿",
			subtitle: "",
			category: "2",
			coverImageUrl: "",
			body: "<p>x</p>",
			tags: [],
			description: "",
			status: "draft",
			createdAt: "2026-06-22T00:00:00.000Z",
		};

		it("saveCurrentDraft / getCurrentDraft 保留 draft 与 facts", async () => {
			const facts = {
				當事人: "A",
				事件摘要: "摘要",
				起因: null,
				經過: null,
				結果: null,
				來源連結: "https://example.com/source",
				發生時間: null,
				熱度標籤: null,
			};

			await saveCurrentDraft(draft, facts);

			await expect(getCurrentDraft()).resolves.toEqual({ draft, facts });
		});

		it("兼容旧版直接存 ContentDraft 的 currentDraft", async () => {
			await storage.setItem("local:currentDraft", draft);

			await expect(getCurrentDraft()).resolves.toEqual({
				draft,
				facts: null,
			});
		});
	});

	describe("ExtensionCounters", () => {
		it("首次调用返回默认 draftsGenerated=0", async () => {
			const c = await getExtensionCounters();
			expect(c).toEqual({ draftsGenerated: 0 });
		});

		it("save 后 getExtensionCounters 取回 draftsGenerated", async () => {
			await saveExtensionCounters({ draftsGenerated: 3 });
			const c = await getExtensionCounters();
			expect(c.draftsGenerated).toBe(3);
		});

		it("不完整旧数据（缺 draftsGenerated）→ 回落默认而不崩溃", async () => {
			await storage.setItem("local:extensionCounters", {});
			const c = await getExtensionCounters();
			expect(c.draftsGenerated).toBe(0);
		});

		it("旧 batchesCompleted 数据 → 迁移为 draftsGenerated", async () => {
			await storage.setItem("local:extensionCounters", { batchesCompleted: 4 });
			const c = await getExtensionCounters();
			expect(c.draftsGenerated).toBe(4);
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
