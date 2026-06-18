// @vitest-environment jsdom

import type { Settings } from "@51guapi/shared";
import { describe, expect, it, vi } from "vitest";
import { generateDraft } from "./draft-gen.js";

const settings: Settings = {
	endpoint: "https://api.example.com/v1/chat/completions",
	model: "gpt-4o-mini",
	fallbackModel: "",
	promptTemplate: "test template",
	fewShotPairs: [],
};

const oaiReply = (content: string) => ({ choices: [{ message: { content } }] });
const slotsReply = (slots: Record<string, unknown>) =>
	oaiReply(JSON.stringify(slots));
const base = { now: () => "2026-06-03T00:00:00.000Z", genId: () => "draft_1" };
const FACTS = {
	當事人: "明星A与明星B",
	事件摘要: "疑似出轨事件",
	起因: "网传目击照片流出",
	經過: "当事人否认，经纪公司发声明澄清",
	結果: "事件坐实，双方解约",
	來源連結: "https://example.com/news",
	發生時間: "2026-06",
	熱度標籤: "出轨,解约",
} as const;

// ---- 429/503 退避重试(Theme E PR-E4)----
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

describe("generateDraft 429/5xx 退避重试", () => {
	it("Happy:429 一次后 200 → 重试成功,sleep 被调用一次", async () => {
		const sleep = vi.fn(noSleep);
		const fetchFn = seqFetch([
			{ status: 429 },
			{ status: 200, payload: slotsReply({ intro: "i", highlights: "h" }) },
		]);
		const res = await generateDraft("主题", {
			settings,
			apiKey: "k",
			facts: FACTS,
			fetchFn,
			sleep,
			maxRetries: 2,
			...base,
		});
		expect(res.ok).toBe(true);
		expect(sleep).toHaveBeenCalledTimes(1);
		expect(fetchFn).toHaveBeenCalledTimes(2);
	});

	it("Error:持续 429 超过 maxRetries → 退避耗尽,sleep 调用 maxRetries 次,最终 ok:false", async () => {
		const sleep = vi.fn(noSleep);
		const fetchFn = seqFetch([{ status: 429 }]);
		const res = await generateDraft("主题", {
			settings, // 无 fallbackModel → 单 model;内层 schema 两轮各自重试
			apiKey: "k",
			fetchFn,
			sleep,
			maxRetries: 2,
			...base,
		});
		expect(res.ok).toBe(false);
		// 单 model(无 fallback);429 在退避耗尽后 break 出 schema 循环(不试 useSchema=false)。
		// 故仅 useSchema=true 一轮:1 初次 + maxRetries(2) 重试 = 2 次 sleep。
		expect(sleep).toHaveBeenCalledTimes(2);
	});

	it("分桶:400(gemma4 schema 不稳)→ 不重试,走 schema 降级", async () => {
		const sleep = vi.fn(noSleep);
		// schema 轮 400 → 降级到非 schema 轮 200。
		const fetchFn = seqFetch([
			{ status: 400 },
			{ status: 200, payload: slotsReply({ intro: "i", highlights: "h" }) },
		]);
		const res = await generateDraft("主题", {
			settings,
			apiKey: "k",
			facts: FACTS,
			fetchFn,
			sleep,
			maxRetries: 2,
			...base,
		});
		expect(res.ok).toBe(true);
		expect(sleep).not.toHaveBeenCalled(); // 400 不进退避桶
	});
});
