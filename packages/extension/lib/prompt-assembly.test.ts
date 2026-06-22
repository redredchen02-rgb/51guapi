import type { FactsBlock, Settings } from "@51guapi/shared";
import { describe, expect, it } from "vitest";
import { buildPrompt } from "./messaging";
import { assemblePrompt, buildConstraintSuffix } from "./prompt-assembly";
import { deriveFewShotExamples } from "./storage";

const BASE: Settings = {
	endpoint: "https://api.example.com",
	model: "gpt-4o-mini",
	promptTemplate: "Write about {{topic}}",
};

const FACTS: FactsBlock = { 作品名: "海角", 集数: "12" };

// 期望:assemblePrompt 输出 = 原内联组装(buildPrompt + buildConstraintSuffix),
// 逐字符相同。这是行为保持的真断言(不是与自身常量比较)。
function inline(settings: Settings, topic: string, facts?: FactsBlock): string {
	return (
		buildPrompt(
			settings.promptTemplate,
			topic,
			facts,
			deriveFewShotExamples(settings.fewShotPairs ?? []),
		) + buildConstraintSuffix(settings.recommendedTags ?? [])
	);
}

describe("assemblePrompt", () => {
	it("runBatch 形状(settings+topic+facts)→ 与原内联组装逐字符相同", () => {
		const s: Settings = { ...BASE, recommendedTags: ["奇幻", "热血"] };
		expect(assemblePrompt(s, "topic-a", FACTS)).toBe(
			inline(s, "topic-a", FACTS),
		);
	});

	it("retry 形状(无 enrichment,facts 仍传)→ 与原内联组装逐字符相同", () => {
		const s: Settings = { ...BASE, recommendedTags: ["科幻"] };
		// retry 路径只少了外层 generateDraftFn 的 enrichment;prompt 组装入参相同。
		expect(assemblePrompt(s, "topic-b", FACTS)).toBe(
			inline(s, "topic-b", FACTS),
		);
	});

	it("recommendedTags 为 undefined → 等价于空数组(只含分类约束)", () => {
		expect(assemblePrompt(BASE, "topic-c", FACTS)).toBe(
			inline(BASE, "topic-c", FACTS),
		);
		expect(assemblePrompt(BASE, "topic-c", FACTS)).toContain("分类约束");
		expect(assemblePrompt(BASE, "topic-c", FACTS)).not.toContain("标签约束");
	});

	it("recommendedTags 空数组 → 与 undefined 行为一致", () => {
		const s: Settings = { ...BASE, recommendedTags: [] };
		expect(assemblePrompt(s, "topic-d", FACTS)).toBe(
			assemblePrompt(BASE, "topic-d", FACTS),
		);
	});

	it("facts 缺省 → 不崩、与内联一致", () => {
		expect(assemblePrompt(BASE, "topic-e")).toBe(inline(BASE, "topic-e"));
	});
});

describe("buildConstraintSuffix (moved to lib)", () => {
	it("空标签 → 只含分类约束", () => {
		expect(buildConstraintSuffix([])).toContain("分类约束");
		expect(buildConstraintSuffix([])).not.toContain("标签约束");
	});

	it("分类约束含 THEME_ALLOWLIST 实际词条（出軌等）", () => {
		expect(buildConstraintSuffix([])).toContain("出軌");
	});

	it("有标签 → 含标签约束且逗号连接", () => {
		const out = buildConstraintSuffix(["a", "b"]);
		expect(out).toContain("标签约束");
		expect(out).toContain("a，b");
	});
});
