import type { GenerateDraftResponse, Settings } from "@51guapi/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import {
	type BackgroundHandlerDeps,
	createHandlers,
} from "../entrypoints/background";
import { DEFAULT_SETTINGS } from "./storage";

function makeDeps(
	overrides: Partial<BackgroundHandlerDeps> = {},
): BackgroundHandlerDeps {
	const settings: Settings = { ...DEFAULT_SETTINGS };
	return {
		getSettings: vi.fn(async () => settings),
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
					status: "draft",
					createdAt: "2026-06-17T00:00:00.000Z",
				},
				llmCostTokens: { prompt: 5, completion: 5 },
			}),
		),
		generateArticleFn: vi.fn(async () => ({
			ok: false as const,
			kind: "not-impl",
			error: "not implemented in test stub",
		})),
		...overrides,
	};
}

describe("handleGenerate — forwards structured context", () => {
	beforeEach(() => {
		fakeBrowser.reset();
	});

	it("透传 facts 到 generateDraftFn", async () => {
		const deps = makeDeps();
		const handlers = createHandlers(deps);
		const facts = {
			當事人: "测试人物",
			事件摘要: "测试摘要",
			起因: null,
			經過: null,
			結果: null,
			來源連結: "https://example.com/a",
			發生時間: null,
			熱度標籤: null,
		};
		await handlers.handleGenerate("prompt", { facts });
		expect(deps.generateDraftFn).toHaveBeenCalledWith(
			expect.stringContaining("prompt"),
			expect.objectContaining({ facts }),
		);
	});

	it("无 options 时保持手动生成兼容", async () => {
		const deps = makeDeps();
		const handlers = createHandlers(deps);
		await handlers.handleGenerate("manual prompt");
		expect(deps.generateDraftFn).toHaveBeenCalledWith(
			expect.stringContaining("manual prompt"),
			expect.objectContaining({
				facts: undefined,
			}),
		);
	});
});
