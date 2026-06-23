import type {
	ContentDraft,
	GenerateDraftResponse,
	Settings,
} from "@51guapi/shared";
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

describe("handleGenerateArticle", () => {
	type ArticleErrResult = { ok: false; kind?: string; error: string };
	type ArticleOkResult = {
		ok: true;
		draft: ContentDraft;
		qualityWarnings: string[];
	};
	type ArticleResult = ArticleOkResult | ArticleErrResult;

	const MOCK_ARTICLE_DRAFT: ContentDraft = {
		id: "art_001",
		title: "张三出轨疑云持续发酵热度不减",
		subtitle: "",
		category: "出轨",
		coverImageUrl: "",
		body: "<!-- section:intro --><p>测试</p>",
		tags: ["张三", "出轨", "吃瓜"],
		description: "网传出轨",
		status: "draft" as const,
		createdAt: "2026-06-23T00:00:00Z",
	};

	beforeEach(() => {
		fakeBrowser.reset();
	});

	it("正常路径：转发 topicId 到 generateArticleFn，返回其结果", async () => {
		const mockResult: ArticleResult = {
			ok: true,
			draft: MOCK_ARTICLE_DRAFT,
			qualityWarnings: [],
		};
		const deps = makeDeps({
			generateArticleFn: vi.fn(async () => mockResult),
		});
		const handlers = createHandlers(deps);
		const result = await handlers.handleGenerateArticle("topic-abc");
		expect(deps.generateArticleFn).toHaveBeenCalledWith("topic-abc");
		expect(result).toEqual(mockResult);
	});

	it("服务层返回 ok:false → 透传错误给调用方", async () => {
		const errResult: ArticleResult = {
			ok: false,
			kind: "llm_error",
			error: "LLM timeout",
		};
		const deps = makeDeps({
			generateArticleFn: vi.fn(async () => errResult),
		});
		const handlers = createHandlers(deps);
		const result = await handlers.handleGenerateArticle("topic-xyz");
		expect(result).toEqual(errResult);
	});

	it("generateArticleFn 抛出 → 返回 ok:false kind:network", async () => {
		const deps = makeDeps({
			generateArticleFn: vi.fn(async () => {
				throw new Error("network failure");
			}),
		});
		const handlers = createHandlers(deps);
		const result = await handlers.handleGenerateArticle("topic-err");
		expect(result).toMatchObject({ ok: false, kind: "network" });
	});
});

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
