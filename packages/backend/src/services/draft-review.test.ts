// @vitest-environment jsdom

import type { Settings } from "@51guapi/shared";
import { describe, expect, it, vi } from "vitest";
import { reviewDraftLlm } from "./draft-review.js";

const settings: Settings = {
	endpoint: "https://api.example.com/v1/chat/completions",
	model: "gpt-4o-mini",
	fallbackModel: "",
	promptTemplate: "test template",
	fewShotPairs: [],
};

const oaiReply = (content: string) => ({ choices: [{ message: { content } }] });
const base = { now: () => "2026-06-03T00:00:00.000Z", genId: () => "draft_1" };

function seqFetch(steps: Array<{ status: number; payload?: unknown }>) {
	let i = 0;
	return vi.fn(async () => {
		const step = steps[Math.min(i, steps.length - 1)];
		i += 1;
		return {
			ok: step.status >= 200 && step.status < 300,
			status: step.status,
			statusText: String(step.status),
			headers: { get: () => null },
			json: async () => step.payload ?? {},
		} as unknown as Response;
	});
}

const noSleep = async () => {};

describe("callLlmForJson(review/rewrite)429/5xx 退避 + 不-throw 契约", () => {
	const MIN_DRAFT = {
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
	} as unknown as Parameters<typeof reviewDraftLlm>[0];

	it("分桶:200 + 非法 JSON(gemma4 格式)→ 立即 ok:false,不重试", async () => {
		const sleep = vi.fn(noSleep);
		const fetchFn = seqFetch([{ status: 200, payload: oaiReply("不是JSON") }]);
		const res = await reviewDraftLlm(MIN_DRAFT, undefined, {
			settings,
			apiKey: "k",
			fetchFn,
			sleep,
			maxRetries: 2,
			...base,
		});
		expect(res.ok).toBe(false);
		expect(sleep).not.toHaveBeenCalled();
	});

	it("持续 5xx → 重试耗尽返 ok:false、不 throw", async () => {
		const sleep = vi.fn(noSleep);
		const fetchFn = seqFetch([{ status: 503 }]);
		let result: Awaited<ReturnType<typeof reviewDraftLlm>> | undefined;
		await expect(
			(async () => {
				result = await reviewDraftLlm(MIN_DRAFT, undefined, {
					settings,
					apiKey: "k",
					fetchFn,
					sleep,
					maxRetries: 2,
					...base,
				});
			})(),
		).resolves.toBeUndefined();
		expect(result?.ok).toBe(false);
		expect(sleep).toHaveBeenCalledTimes(2);
	});
});
