// @vitest-environment node

import type { ContentDraft, GossipFactsBlock, Settings } from "@51guapi/shared";
import { describe, expect, it, vi } from "vitest";
import { rewriteDraftLlm } from "./draft-rewrite.js";

const settings: Settings = {
	endpoint: "https://api.example.com/v1",
	model: "gpt-4o-mini",
	fallbackModel: "",
	promptTemplate: "",
	fewShotPairs: [],
};

const draft: ContentDraft = {
	id: "d1",
	title: "原标题",
	subtitle: "",
	category: "緋聞",
	coverImageUrl: "",
	body: "<p>原正文</p>",
	tags: [],
	description: "",
	status: "draft",
	createdAt: "2026-06-22T00:00:00.000Z",
};

const facts: GossipFactsBlock = {
	當事人: "甲",
	事件摘要: "摘要",
	起因: null,
	經過: null,
	結果: null,
	來源連結: "https://source.example.com/a",
	發生時間: null,
	熱度標籤: "緋聞",
};

const reply = (content: string) => ({
	choices: [{ message: { content } }],
});

describe("rewriteDraftLlm grounding gate", () => {
	it("拒绝模型重写正文里的未溯源链接", async () => {
		const fetchFn = vi.fn(async () => {
			return {
				ok: true,
				status: 200,
				statusText: "OK",
				json: async () =>
					reply(
						JSON.stringify({
							body: '<p>新增链接 <a href="https://invented.example.net/x">来源</a></p>',
						}),
					),
			} as Response;
		});

		const result = await rewriteDraftLlm(draft, ["body_richness"], {
			settings,
			apiKey: "k",
			facts,
			fetchFn,
		});

		expect(result).toEqual({
			ok: false,
			error: "草稿正文含未溯源链接(疑似模型自造),已拒绝。",
		});
	});

	it("允许模型重写正文引用 facts 来源链接", async () => {
		const fetchFn = vi.fn(async () => {
			return {
				ok: true,
				status: 200,
				statusText: "OK",
				json: async () =>
					reply(
						JSON.stringify({
							body: '<p>引用 <a href="https://source.example.com/a">原文</a></p>',
						}),
					),
			} as Response;
		});

		const result = await rewriteDraftLlm(draft, ["body_richness"], {
			settings,
			apiKey: "k",
			facts,
			fetchFn,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.draft.body).toContain("https://source.example.com/a");
		}
	});
});
