import { describe, expect, it, vi } from "vitest";
import { gossipExtractFacts } from "./gossip-fact-extractor.js";
import type { RawContent } from "./site-adapter.js";

const SAMPLE_CONTENT: RawContent = {
	title: "明星A出軌B事件始末",
	body: "明星A近日被拍到與神秘男B私會，前任C隨即發文暗諷。消息人士透露兩人已分手三個月。",
	url: "https://example.com/gossip/123",
	coverImageUrl: "https://cdn.example.com/cover.jpg",
};

const OPTS = {
	endpoint: "https://api.openai.com",
	apiKey: "sk-test",
	model: "gpt-4o-mini",
};

function mockFetch(body: object, status = 200) {
	return vi.fn().mockResolvedValue({
		ok: status >= 200 && status < 300,
		status,
		json: async () => body,
	});
}

function llmResponse(content: string) {
	return {
		choices: [{ message: { content } }],
	};
}

describe("gossipExtractFacts", () => {
	it("happy path：strict 模式提取到當事人和事件摘要", async () => {
		const factsJson = JSON.stringify({
			當事人: "明星A, 神秘男B",
			事件摘要: "明星A被拍與B私會，前任C發文暗諷",
			起因: null,
			經過: "兩人在咖啡店被拍",
			結果: "已分手三個月",
			來源連結: "https://example.com/gossip/123",
			發生時間: "2024-08",
			熱度標籤: "出軌, 撕逼",
		});
		const fetchFn = mockFetch(llmResponse(factsJson));
		const result = await gossipExtractFacts(SAMPLE_CONTENT, {
			...OPTS,
			fetchFn,
		});
		expect(result.extractionMode).toBe("strict");
		expect(result.confidence).toBeGreaterThan(0.5);
		expect(result.facts.當事人).toBe("明星A, 神秘男B");
		expect(result.facts.事件摘要).not.toBeNull();
		expect(result.coverImageUrl).toBe("https://cdn.example.com/cover.jpg");
	});

	it("strict 模式 400 → fallback to json_object，confidence ≤ 0.3", async () => {
		const factsJson = JSON.stringify({
			當事人: "明星A",
			事件摘要: "出軌",
			起因: null,
			經過: null,
			結果: null,
			來源連結: null,
			發生時間: null,
			熱度標籤: null,
		});
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({}) })
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => llmResponse(factsJson),
			});
		const result = await gossipExtractFacts(SAMPLE_CONTENT, {
			...OPTS,
			fetchFn,
		});
		expect(result.extractionMode).toBe("fallback");
		expect(result.confidence).toBeLessThanOrEqual(0.3);
	});

	it("所有欄位為 null → confidence 接近 0", async () => {
		const nullFacts = JSON.stringify({
			當事人: null,
			事件摘要: null,
			起因: null,
			經過: null,
			結果: null,
			來源連結: null,
			發生時間: null,
			熱度標籤: null,
		});
		const fetchFn = mockFetch(llmResponse(nullFacts));
		const result = await gossipExtractFacts(SAMPLE_CONTENT, {
			...OPTS,
			fetchFn,
		});
		expect(result.confidence).toBe(0);
	});

	it("rawContent.body 超過 8000 字仍能執行（不拋出）", async () => {
		const longContent = { ...SAMPLE_CONTENT, body: "x".repeat(10000) };
		const factsJson = JSON.stringify({
			當事人: "A",
			事件摘要: "test",
			起因: null,
			經過: null,
			結果: null,
			來源連結: null,
			發生時間: null,
			熱度標籤: null,
		});
		const fetchFn = mockFetch(llmResponse(factsJson));
		await expect(
			gossipExtractFacts(longContent, { ...OPTS, fetchFn }),
		).resolves.toBeDefined();
	});

	it("兩個 pass 均失敗（非 400/422）→ 拋出錯誤", async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
		await expect(
			gossipExtractFacts(SAMPLE_CONTENT, { ...OPTS, fetchFn }),
		).rejects.toThrow(/LLM request failed/);
	});

	it("AbortError timeout → 拋出 timed out 訊息", async () => {
		const err = new Error("aborted");
		err.name = "AbortError";
		const fetchFn = vi.fn().mockRejectedValue(err);
		await expect(
			gossipExtractFacts(SAMPLE_CONTENT, { ...OPTS, fetchFn }),
		).rejects.toThrow(/timed out/i);
	});

	it("strict 422 → fallback to json_object", async () => {
		const factsJson = JSON.stringify({
			當事人: "B",
			事件摘要: "test",
			起因: null,
			經過: null,
			結果: null,
			來源連結: null,
			發生時間: null,
			熱度標籤: null,
		});
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({}) })
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => llmResponse(factsJson),
			});
		const result = await gossipExtractFacts(SAMPLE_CONTENT, {
			...OPTS,
			fetchFn,
		});
		expect(result.extractionMode).toBe("fallback");
	});
});
