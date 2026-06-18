import type { ContentDraft, GossipFactsBlock } from "@51guapi/shared";
import { evaluateQuality } from "@51guapi/shared";
import { describe, expect, it } from "vitest";

function makeDraft(overrides: Partial<ContentDraft> = {}): ContentDraft {
	return {
		id: "test-1",
		title: "测试标题",
		subtitle: "副标题",
		category: "漫画文章",
		coverImageUrl: "",
		body: "<p>这是一篇测试文章，包含足够的内容来通过正文长度检查。据知情人爆料，疑似曝光相关细节，网传已坐实。</p>",
		tags: ["标签1", "标签2"],
		description: "描述",
		status: "draft",
		createdAt: "2026-01-01",
		...overrides,
	};
}

describe("evaluateQuality", () => {
	it("全部达标时 overall >= 0.6", () => {
		const draft = makeDraft();
		const facts: GossipFactsBlock = {
			當事人: "测试当事人",
			事件摘要: "测试摘要",
			起因: "起因说明",
			經過: "经过描述",
			結果: "结果说明",
			來源連結: null,
			發生時間: null,
			熱度標籤: null,
		};
		const result = evaluateQuality(draft, facts);
		expect(result.pass).toBe(true);
		expect(result.overall).toBeGreaterThanOrEqual(0.6);
	});

	it("正文长度不足时扣分", () => {
		const draft = makeDraft({ body: "<p>太短</p>" });
		const result = evaluateQuality(draft);
		const check = result.checks.find((c) => c.name === "body_length");
		expect(check?.pass).toBe(false);
		expect(check?.score).toBeLessThan(1);
	});

	it("标题含【待补】时扣分", () => {
		const draft = makeDraft({ title: "【待补】作品名" });
		const result = evaluateQuality(draft);
		const check = result.checks.find((c) => c.name === "title_quality");
		expect(check?.pass).toBe(false);
		expect(check?.score).toBe(0);
	});

	// 行为变更:改用前缀 helper(containsPlaceholder)后,标注式/未闭合变体也判为占位,
	// 比此前的精确字符串匹配更严。规范化裸式【待补】得分不变(仍为 0)。
	it("标注式【待补:作品名】标题现在也判为占位(比旧精确匹配更严)", () => {
		const draft = makeDraft({ title: "【待补:作品名】" });
		const result = evaluateQuality(draft);
		const check = result.checks.find((c) => c.name === "title_quality");
		expect(check?.pass).toBe(false);
		expect(check?.score).toBe(0);
	});

	it("标签不足时扣分", () => {
		const draft = makeDraft({ tags: ["仅一个标签"] });
		const result = evaluateQuality(draft);
		const check = result.checks.find((c) => c.name === "tags_accuracy");
		expect(check?.pass).toBe(false);
	});

	it("标签过多时扣分", () => {
		const draft = makeDraft({ tags: Array(15).fill("标签") });
		const result = evaluateQuality(draft);
		const check = result.checks.find((c) => c.name === "tags_accuracy");
		expect(check?.pass).toBe(false);
	});

	it("缺少社区词汇时扣分", () => {
		const draft = makeDraft({
			body: "<p>这是一篇非常正式的文章，没有任何口语化表达。</p>".repeat(5),
		});
		const result = evaluateQuality(draft);
		const check = result.checks.find((c) => c.name === "community_tone");
		expect(check?.pass).toBe(false);
	});

	it("事实不完整时扣分", () => {
		const draft = makeDraft();
		const facts: GossipFactsBlock = {
			當事人: null,
			事件摘要: null,
			起因: null,
			經過: null,
			結果: null,
			來源連結: null,
			發生時間: null,
			熱度標籤: null,
		};
		const result = evaluateQuality(draft, facts);
		const check = result.checks.find((c) => c.name === "facts_completeness");
		expect(check?.pass).toBe(false);
	});

	it("可自定义阈值", () => {
		const draft = makeDraft();
		const result = evaluateQuality(
			draft,
			{
				當事人: null,
				事件摘要: null,
				起因: null,
				經過: null,
				結果: null,
				來源連結: null,
				發生時間: null,
				熱度標籤: null,
			},
			0.9,
		);
		expect(result.pass).toBe(result.overall >= 0.9);
	});

	it("checks 数组长度为 5", () => {
		const result = evaluateQuality(makeDraft());
		expect(result.checks).toHaveLength(5);
	});

	it("每项 check 有 name/pass/score/message", () => {
		const result = evaluateQuality(makeDraft());
		for (const check of result.checks) {
			expect(check.name).toBeTruthy();
			expect(typeof check.pass).toBe("boolean");
			expect(check.score).toBeGreaterThanOrEqual(0);
			expect(check.score).toBeLessThanOrEqual(1);
			expect(check.message).toBeTruthy();
		}
	});
});
