// @vitest-environment jsdom

import type { Settings } from "@51guapi/shared";
import { describe, expect, it, vi } from "vitest";
import { generateDraft } from "./draft-gen.js";
import {
	defaultSleep,
	fetchWithBackoff,
	parseRetryAfter,
} from "./fetch-backoff.js";

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

// ---- O4 墙钟预算直测 ----

const FAKE_SETTINGS: Settings = {
	endpoint: "https://api.example.com/v1",
	model: "test-model",
	fallbackModel: "",
	promptTemplate: "",
	fewShotPairs: [],
};

function mk429(): Response {
	return {
		ok: false,
		status: 429,
		headers: { get: () => null },
	} as unknown as Response;
}

describe("fetchWithBackoff — O4 墙钟预算守", () => {
	it("budget 止停：累计睡眠 ≥ 预算即停，sleep 调用次数 < maxRetries", async () => {
		// delay 序列: 1000ms, 2000ms, 4000ms ...
		// budget=3000: 0+1000=1000<3000 → sleep(1000)；1000+2000=3000>=3000 → 停
		// 预期: sleep 只调用一次(1000ms)
		const sleepArgs: number[] = [];
		const sleep = vi.fn(async (ms: number) => {
			sleepArgs.push(ms);
		});
		const fetchFn = vi.fn(async () => mk429());

		await fetchWithBackoff(fetchFn, "https://api.example.com", {}, 5_000, {
			settings: FAKE_SETTINGS,
			apiKey: "k",
			maxRetries: 10,
			retryBaseMs: 1_000,
			retryCapMs: 5_000,
			wallClockBudgetMs: 3_000,
			sleep,
		});

		expect(sleep).toHaveBeenCalledTimes(1);
		expect(sleepArgs[0]).toBe(1_000);
		// 总睡眠时长 < 预算
		const total = sleepArgs.reduce((a, b) => a + b, 0);
		expect(total).toBeLessThan(3_000);
	});

	it("budget=0：第一轮 429 后立即停止，不调用 sleep", async () => {
		const sleep = vi.fn(noSleep);
		const fetchFn = vi.fn(async () => mk429());

		const { res } = await fetchWithBackoff(
			fetchFn,
			"https://api.example.com",
			{},
			5_000,
			{
				settings: FAKE_SETTINGS,
				apiKey: "k",
				maxRetries: 3,
				retryBaseMs: 500,
				retryCapMs: 1_000,
				wallClockBudgetMs: 0,
				sleep,
			},
		);

		expect(sleep).not.toHaveBeenCalled();
		expect(res?.status).toBe(429);
	});

	it("budget 充足：正常两轮重试均睡眠，结果返回最终 429", async () => {
		const sleep = vi.fn(noSleep);
		const fetchFn = vi.fn(async () => mk429());

		await fetchWithBackoff(fetchFn, "https://api.example.com", {}, 5_000, {
			settings: FAKE_SETTINGS,
			apiKey: "k",
			maxRetries: 2,
			retryBaseMs: 100,
			retryCapMs: 500,
			wallClockBudgetMs: 60_000, // 远高于 2×500=1000
			sleep,
		});

		// maxRetries=2: sleep 被调用两次后 attempt>=maxRetries 退出
		expect(sleep).toHaveBeenCalledTimes(2);
	});
});

// ---- defaultSleep ----

describe("defaultSleep", () => {
	it("0ms 立即 resolve，不拋錯", async () => {
		await expect(defaultSleep(0)).resolves.toBeUndefined();
	});
});

// ---- parseRetryAfter ----

function makeResp(header: string | null): Response {
	return {
		ok: false,
		status: 429,
		headers: { get: () => header },
	} as unknown as Response;
}

describe("parseRetryAfter", () => {
	const NOW = 1_000_000;

	it("無 Retry-After header → null", () => {
		expect(parseRetryAfter(makeResp(null), NOW)).toBeNull();
	});

	it("數字 header '2' → 2000ms", () => {
		expect(parseRetryAfter(makeResp("2"), NOW)).toBe(2000);
	});

	it("數字 header '0' → 0ms（clamp to 0）", () => {
		expect(parseRetryAfter(makeResp("0"), NOW)).toBe(0);
	});

	it("HTTP-date header → 正 delta ms", () => {
		const futureMs = NOW + 5000;
		const dateStr = new Date(futureMs).toUTCString();
		const result = parseRetryAfter(makeResp(dateStr), NOW);
		expect(result).toBeGreaterThanOrEqual(4990); // 容許 parse 誤差
	});

	it("無效字串 → null", () => {
		expect(parseRetryAfter(makeResp("not-a-date-or-number"), NOW)).toBeNull();
	});
});

// ---- fetchWithBackoff: network error ----

describe("fetchWithBackoff — fetch 拋出網路錯誤", () => {
	it("fetchFn throw → 立即返回 { fetchErr }，不重試", async () => {
		const netErr = new Error("ECONNREFUSED");
		const fetchFn = vi.fn(async () => {
			throw netErr;
		});

		const { fetchErr, res } = await fetchWithBackoff(
			fetchFn,
			"https://api.example.com",
			{},
			5_000,
			{
				settings: FAKE_SETTINGS,
				apiKey: "k",
				maxRetries: 3,
				retryBaseMs: 100,
				retryCapMs: 1_000,
				wallClockBudgetMs: 60_000,
				sleep: vi.fn(noSleep),
			},
		);

		expect(fetchErr).toBe(netErr);
		expect(res).toBeUndefined();
		expect(fetchFn).toHaveBeenCalledTimes(1); // 不重試
	});
});

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
