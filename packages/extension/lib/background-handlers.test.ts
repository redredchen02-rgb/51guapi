import type { GenerateDraftResponse, Settings } from "@51guapi/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import {
	type BackgroundHandlerDeps,
	createHandlers,
} from "../entrypoints/background";
import { DEFAULT_SETTINGS, getExtensionCounters } from "./storage";

// batchesCompleted wiring（U4）：handleRunBatch 成功完成时递增计数器并持久化。
// background.ts 直接调用 storage helper（非注入 dep），故经 fakeBrowser storage 验证。

function makeDeps(
	overrides: Partial<BackgroundHandlerDeps> = {},
): BackgroundHandlerDeps {
	const settings: Settings = { ...DEFAULT_SETTINGS };
	let seq = 0;
	const savedBatches: unknown[] = [];
	return {
		getBatch: vi.fn(async () => null),
		saveBatch: vi.fn(async (b) => {
			savedBatches.push(b);
		}),
		getSettings: vi.fn(async () => settings),
		getApiKey: vi.fn(async () => "sk-test"),
		generateDraftFn: vi.fn(
			async (): Promise<GenerateDraftResponse> => ({
				ok: true,
				draft: {
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
					createdAt: "2026-06-17T00:00:00.000Z",
				},
				llmCostTokens: { prompt: 5, completion: 5 },
			}),
		),
		buildBatchId: () => `batch_${++seq}`,
		buildItemId: (id, i) => `${id}:${i}`,
		now: () => "2026-06-17T00:00:00.000Z",
		...overrides,
	};
}

describe("handleRunBatch — batchesCompleted wiring", () => {
	beforeEach(() => {
		fakeBrowser.reset();
	});

	it("成功完成 → batchesCompleted 从 0 变为 1", async () => {
		const handlers = createHandlers(makeDeps());
		await handlers.handleRunBatch(["topic-1"], 7);
		const c = await getExtensionCounters();
		expect(c.batchesCompleted).toBe(1);
	});

	it("两次成功 → batchesCompleted = 2（读 storage 确认）", async () => {
		const handlers = createHandlers(makeDeps());
		await handlers.handleRunBatch(["a"], 7);
		await handlers.handleRunBatch(["b"], 7);
		const c = await getExtensionCounters();
		expect(c.batchesCompleted).toBe(2);
	});

	it("外层抛出（getSettings 失败）→ batchesCompleted 不变", async () => {
		const deps = makeDeps({
			getSettings: vi.fn(async () => {
				throw new Error("boom");
			}),
		});
		const handlers = createHandlers(deps);
		await handlers.handleRunBatch(["x"], 7);
		const c = await getExtensionCounters();
		expect(c.batchesCompleted).toBe(0);
	});

	it("item 级生成失败但整体未抛出 → 仍计为完成（batchesCompleted=1）", async () => {
		const deps = makeDeps({
			generateDraftFn: vi.fn(
				async (): Promise<GenerateDraftResponse> => ({
					ok: false,
					kind: "network",
					error: "fail",
				}),
			),
		});
		const handlers = createHandlers(deps);
		await handlers.handleRunBatch(["x"], 7);
		const c = await getExtensionCounters();
		expect(c.batchesCompleted).toBe(1);
	});
});
