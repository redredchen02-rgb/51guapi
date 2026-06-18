// @vitest-environment jsdom

import type { ContentDraft, Settings } from "@51guapi/shared";
import { describe, expect, it, vi } from "vitest";
// 门面 smoke:逐字从 services/llm.js(barrel)import 全部原公开符号,
// 证拆分后外部 import 路径与公开 API 一字未变。详细行为用例已下沉到
// fetch-backoff.test / draft-gen.test / draft-review.test。
import {
	buildRequest,
	buildReviewPrompt,
	buildRewritePrompt,
	chatCompletionsUrl,
	DRAFT_SLOTS_SCHEMA,
	extractUsage,
	generateDraft,
	listModels,
	modelsUrl,
	reviewDraftLlm,
	rewriteDraftLlm,
	slotsFromParsed,
} from "../services/llm.js";

const settings: Settings = {
	endpoint: "https://api.example.com/v1/chat/completions",
	model: "gpt-4o-mini",
	fallbackModel: "",
	promptTemplate: "test template",
	fewShotPairs: [],
};

const oaiReply = (content: string) => ({ choices: [{ message: { content } }] });

describe("services/llm 门面 re-export", () => {
	it("门面导出全部原公开符号,且经门面调用与子模块行为一致", async () => {
		// 函数/常量身份齐备
		for (const sym of [
			chatCompletionsUrl,
			buildRequest,
			slotsFromParsed,
			generateDraft,
			modelsUrl,
			listModels,
			extractUsage,
			buildReviewPrompt,
			buildRewritePrompt,
			reviewDraftLlm,
			rewriteDraftLlm,
		]) {
			expect(typeof sym).toBe("function");
		}
		expect(DRAFT_SLOTS_SCHEMA.name).toBe("draft_slots");

		// 经门面的纯函数行为
		expect(chatCompletionsUrl("https://h.com/v1")).toBe(
			"https://h.com/v1/chat/completions",
		);

		// 经门面的 generateDraft 端到端(mock fetch)
		const fetchFn = vi.fn(
			async () =>
				({
					ok: true,
					status: 200,
					statusText: "OK",
					json: async () => oaiReply('{"intro":"i","highlights":"h"}'),
				}) as Response,
		);
		const res = await generateDraft("主题", {
			settings,
			apiKey: "k",
			fetchFn,
			now: () => "2026-06-03T00:00:00.000Z",
			genId: () => "draft_1",
		});
		expect(res.ok).toBe(true);

		// 经门面的 reviewDraftLlm 不 throw、返结构化结果
		const reviewFetch = vi.fn(
			async () =>
				({
					ok: true,
					status: 200,
					statusText: "OK",
					json: async () =>
						oaiReply('{"dimensions":[{"name":"title_quality","pass":true}]}'),
				}) as Response,
		);
		const review = await reviewDraftLlm(
			{
				id: "d1",
				title: "T",
				subtitle: "",
				category: "2",
				coverImageUrl: "",
				body: "<p>b</p>",
				tags: [],
				description: "",
				status: "draft",
				createdAt: "2026-06-04T00:00:00.000Z",
			} as ContentDraft,
			undefined,
			{ settings, apiKey: "k", fetchFn: reviewFetch },
		);
		expect(review.ok).toBe(true);
	});
});
