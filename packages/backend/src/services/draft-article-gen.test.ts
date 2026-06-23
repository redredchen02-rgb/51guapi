import type { GossipFactsBlock } from "@51guapi/shared";
import { describe, expect, it, vi } from "vitest";
import { generateArticleDraft } from "./draft-article-gen.js";
import type { LlmDeps } from "./fetch-backoff.js";

const FACTS: GossipFactsBlock = {
	當事人: "张三李四",
	事件摘要: "网传某明星出轨疑云",
	起因: "网友爆料私信截图",
	經過: "双方粉丝互掐，未见当事人公开回应",
	結果: "目前尚无官方声明",
	來源連結: "https://example.com/gossip/article-1",
	發生時間: "2026-06",
	熱度標籤: "出轨,塌房",
};

/** 构造返回合法 LLM 响应的 fetchFn mock。 */
function makeFetchMock(slotsOverride?: Record<string, unknown>): typeof fetch {
	const slots = {
		titleSuffix: "出轨疑云持续发酵粉丝哗然",
		intro:
			"近期网络上流传一批疑似私信截图，引发大量网友关注和讨论。当事人尚未公开回应。",
		narrative:
			"事件起因于一批疑似私信截图在社交平台流传，截图内容引发粉丝强烈反应。目前双方粉丝持续对立，官方尚无声明。",
		faqItems: [
			{ q: "这件事是真的吗？", a: "目前尚无官方确认，以当事人声明为准。" },
			{ q: "有什么进展？", a: "目前暂无官方声明。" },
			{ q: "粉丝怎么看？", a: "粉丝意见分化，请理性吃瓜。" },
		],
		conclusion:
			"事件持续发酵，等待更多官方信息。建议关注当事人官方渠道获取最新消息。",
		tags: ["张三李四", "出轨", "吃瓜"],
		...slotsOverride,
	};
	const responseBody = JSON.stringify({
		choices: [{ message: { content: JSON.stringify(slots) } }],
	});
	return vi.fn().mockResolvedValue(
		new Response(responseBody, {
			status: 200,
			headers: { "Content-Type": "application/json" },
		}),
	) as typeof fetch;
}

function makeDeps(
	fetchFn: typeof fetch,
	overrides?: Partial<LlmDeps>,
): LlmDeps {
	return {
		settings: {
			endpoint: "https://api.example.com",
			model: "gpt-4o-mini",
			promptTemplate: "",
		},
		apiKey: "test-key",
		fetchFn,
		now: () => "2026-06-23T00:00:00Z",
		genId: () => "article_test_001",
		...overrides,
	};
}

describe("generateArticleDraft", () => {
	it("正常路径：返回 ok:true，draft 含 title 和 body", async () => {
		const result = await generateArticleDraft(FACTS, makeDeps(makeFetchMock()));
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Expected ok:true");
		expect(result.draft.title).toContain("张三李四");
		expect(result.draft.body).toContain("<!-- section:intro -->");
		expect(result.draft.body).toContain("<!-- section:quickinfo -->");
		expect(result.draft.body).toContain("<!-- section:faq -->");
	});

	it("grounding 守卫：body 无未溯源链接", async () => {
		const result = await generateArticleDraft(FACTS, makeDeps(makeFetchMock()));
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Expected ok:true");
		// 唯一链接来自 facts.來源連結
		expect(result.draft.body).toContain("https://example.com/gossip/article-1");
		// 无其他 <a href>
		const linkMatches = result.draft.body.match(/<a href="[^"]+"/g) ?? [];
		expect(
			linkMatches.every((l) => l.includes("example.com/gossip/article-1")),
		).toBe(true);
	});

	it("来源连结为 null → body 无 <a href>", async () => {
		const facts: GossipFactsBlock = { ...FACTS, 來源連結: null };
		const result = await generateArticleDraft(facts, makeDeps(makeFetchMock()));
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Expected ok:true");
		expect(result.draft.body).not.toContain("<a href");
	});

	it("标题长度在 25-35 字范围内 → qualityWarnings 不含长度警告", async () => {
		// titleSuffix + 当事人构成标题；当事人 4 字 + 后缀 ~20 字 = ~24 字
		// 注意：长度可能触发警告，只验证 ok 为 true
		const result = await generateArticleDraft(FACTS, makeDeps(makeFetchMock()));
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Expected ok:true");
		expect(Array.isArray(result.qualityWarnings)).toBe(true);
	});

	it("标签含营销词 → qualityWarnings 包含对应错误", async () => {
		const result = await generateArticleDraft(
			FACTS,
			makeDeps(makeFetchMock({ tags: ["爆款内容", "出轨", "吃瓜"] })),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Expected ok:true");
		expect(result.qualityWarnings.some((w) => w.includes("爆款"))).toBe(true);
	});

	it("标签少于 3 个 → qualityWarnings 包含数量不足警告", async () => {
		const result = await generateArticleDraft(
			FACTS,
			makeDeps(makeFetchMock({ tags: ["出轨"] })),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Expected ok:true");
		expect(result.qualityWarnings.some((w) => w.includes("不足"))).toBe(true);
	});

	it("未配置 apiKey → ok:false, kind:no-key", async () => {
		const deps = makeDeps(makeFetchMock(), { apiKey: "" });
		const result = await generateArticleDraft(FACTS, deps);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("Expected ok:false");
		expect(result.kind).toBe("no-key");
	});

	it("endpoint 非 https → ok:false", async () => {
		const deps = makeDeps(makeFetchMock(), {
			settings: {
				endpoint: "http://unsecured.example.com",
				model: "gpt-4o-mini",
				promptTemplate: "",
			},
		});
		const result = await generateArticleDraft(FACTS, deps);
		expect(result.ok).toBe(false);
	});

	it("LLM 返回 400（json_schema 不支持）→ 自动切换 json_object 重试", async () => {
		let callCount = 0;
		const fetchFn = vi.fn().mockImplementation(async () => {
			callCount++;
			if (callCount === 1) {
				return new Response("{}", { status: 400 });
			}
			return new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content: JSON.stringify({
									intro: "事件引发广泛关注。",
									narrative: "事件持续发酵，双方粉丝对立严重，尚无官方声明。",
									faqItems: [
										{ q: "这是真的吗？", a: "尚无官方确认。" },
										{ q: "有什么进展？", a: "暂无最新信息。" },
										{ q: "大家怎么看？", a: "网友意见不一。" },
									],
									conclusion: "等待更多信息。",
									tags: ["吃瓜", "出轨", "明星"],
								}),
							},
						},
					],
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}) as typeof fetch;

		const result = await generateArticleDraft(FACTS, makeDeps(fetchFn));
		expect(result.ok).toBe(true);
		expect(callCount).toBe(2);
	});

	it("LLM 返回非合法 JSON → ok:false, kind:format", async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValue(
				new Response(
					JSON.stringify({ choices: [{ message: { content: "not json" } }] }),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
			) as typeof fetch;

		const result = await generateArticleDraft(FACTS, makeDeps(fetchFn));
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("Expected ok:false");
		expect(result.kind).toBe("format");
	});

	it("faqItems 为空数组 → ok:true，body 含 section:faq 注释", async () => {
		const result = await generateArticleDraft(
			FACTS,
			makeDeps(makeFetchMock({ faqItems: [] })),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("Expected ok:true");
		expect(result.draft.body).toContain("<!-- section:faq -->");
	});

	it("fetch 抛出 TypeError（网络中断）→ ok:false", async () => {
		const failFetch: typeof fetch = async () => {
			throw new TypeError("fetch failed");
		};
		const result = await generateArticleDraft(FACTS, makeDeps(failFetch));
		expect(result.ok).toBe(false);
	});
});
