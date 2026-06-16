import { describe, expect, it, vi } from "vitest";
import { extractFacts } from "./fact-extractor.js";
import type { RawContent } from "./site-adapter.js";

function makeRaw(overrides: Partial<RawContent> = {}): RawContent {
	return {
		title: "测试作品 Vol.1",
		body: "制作：Studio X。漢化：某汉化组。简介：一段剧情介绍。",
		url: "https://example.com/article/1",
		...overrides,
	};
}

/** 构造一个返回 OK JSON 响应的 fetchFn mock */
function okFetch(facts: Record<string, string | null>): typeof fetch {
	return vi.fn(
		async () =>
			new Response(
				JSON.stringify({
					choices: [{ message: { content: JSON.stringify(facts) } }],
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			),
	) as unknown as typeof fetch;
}

const BASE_OPTS = {
	endpoint: "https://api.example.com",
	apiKey: "test-key",
	model: "gpt-test",
};

// ---- json_schema strict 路径 ----

describe("extractFacts — strict path", () => {
	it("返回 ExtractedFacts，confidence = filled/total，mode=strict", async () => {
		const fetchFn = okFetch({
			作品名: "测试作品",
			集数: "Vol.1",
			制作: "Studio X",
			漢化: null,
			無修: null,
			题材: null,
			简介: null,
		});
		const result = await extractFacts(makeRaw(), { ...BASE_OPTS, fetchFn });
		expect(result.extractionMode).toBe("strict");
		expect(result.confidence).toBeCloseTo(3 / 7);
		expect(result.facts.作品名).toBe("测试作品");
	});

	it("passthrough coverImageUrl（不经 LLM schema）", async () => {
		const fetchFn = okFetch({
			作品名: "X",
			集数: null,
			制作: null,
			漢化: null,
			無修: null,
			题材: null,
			简介: null,
		});
		const result = await extractFacts(
			makeRaw({ coverImageUrl: "https://cdn.example.com/cover.jpg" }),
			{
				...BASE_OPTS,
				fetchFn,
			},
		);
		expect(result.coverImageUrl).toBe("https://cdn.example.com/cover.jpg");
	});

	it("coverImageUrl 缺失时返回 undefined", async () => {
		const fetchFn = okFetch({
			作品名: "X",
			集数: null,
			制作: null,
			漢化: null,
			無修: null,
			题材: null,
			简介: null,
		});
		const result = await extractFacts(makeRaw(), { ...BASE_OPTS, fetchFn });
		expect(result.coverImageUrl).toBeUndefined();
	});
});

// ---- json_object fallback 路径（400 触发降级）----

describe("extractFacts — json_object fallback", () => {
	it("首次请求返回 400 时降级为 json_object，mode=fallback", async () => {
		let callCount = 0;
		const fetchFn = vi.fn(async () => {
			callCount++;
			if (callCount === 1) {
				// 第一次：strict 路径，返回 400（endpoint 不支持 json_schema）
				return new Response("Bad Request", { status: 400 });
			}
			// 第二次：fallback 路径，返回正常结果
			return new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content: JSON.stringify({
									作品名: "作品B",
									集数: null,
									制作: null,
									漢化: null,
									無修: null,
									题材: null,
									简介: null,
								}),
							},
						},
					],
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}) as unknown as typeof fetch;

		const result = await extractFacts(makeRaw(), { ...BASE_OPTS, fetchFn });
		expect(result.extractionMode).toBe("fallback");
		expect(result.facts.作品名).toBe("作品B");
		expect(callCount).toBe(2);
	});

	it("fallback 模式 confidence 被 cap 在 0.3", async () => {
		let callCount = 0;
		const fetchFn = vi.fn(async () => {
			callCount++;
			if (callCount === 1) return new Response("Bad Request", { status: 400 });
			// 所有 7 个字段都填了 → rawConfidence = 1.0，但 cap 后应为 0.3
			return new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content: JSON.stringify({
									作品名: "A",
									集数: "B",
									制作: "C",
									漢化: "D",
									無修: "E",
									题材: "F",
									简介: "G",
								}),
							},
						},
					],
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}) as unknown as typeof fetch;

		const result = await extractFacts(makeRaw(), { ...BASE_OPTS, fetchFn });
		expect(result.extractionMode).toBe("fallback");
		expect(result.confidence).toBeLessThanOrEqual(0.3);
	});

	it("两次请求均返回 400 → 抛出错误", async () => {
		const fetchFn = vi.fn(
			async () => new Response("Bad Request", { status: 400 }),
		) as unknown as typeof fetch;
		await expect(
			extractFacts(makeRaw(), { ...BASE_OPTS, fetchFn }),
		).rejects.toThrow();
	});
});

// ---- 错误路径 ----

describe("extractFacts — error paths", () => {
	it("HTTP 非 400 失败（如 500）→ 抛出", async () => {
		const fetchFn = vi.fn(
			async () => new Response("Internal Error", { status: 500 }),
		) as unknown as typeof fetch;
		await expect(
			extractFacts(makeRaw(), { ...BASE_OPTS, fetchFn }),
		).rejects.toThrow(/500/);
	});

	it('请求超时 → 抛出 "timed out"', async () => {
		const fetchFn = vi.fn(async (_url: string, opts?: RequestInit) => {
			await new Promise<never>((_, reject) => {
				opts?.signal?.addEventListener("abort", () => {
					const err = new Error("The operation was aborted");
					(err as NodeJS.ErrnoException).name = "AbortError";
					reject(err);
				});
			});
		}) as unknown as typeof fetch;

		await expect(
			extractFacts(makeRaw(), { ...BASE_OPTS, fetchFn, timeoutMs: 50 }),
		).rejects.toThrow(/timed out/);
	});
});
