import { CATEGORY_VOCAB, normalizeCategory } from "@51guapi/shared";
import { describe, expect, it } from "vitest";

describe("normalizeCategory", () => {
	it("已是后台 value → 返回对应 label", () => {
		expect(normalizeCategory("2")).toBe("漫畫文章");
		expect(normalizeCategory("4")).toBe("動漫文章");
	});

	it("已是后台 label → 原样返回", () => {
		expect(normalizeCategory("漫畫文章")).toBe("漫畫文章");
		expect(normalizeCategory("動漫文章")).toBe("動漫文章");
	});

	it("模型自由文字(動漫向)→ 動漫文章", () => {
		expect(normalizeCategory("成人動畫")).toBe("動漫文章"); // 实测里模型吐过这个
		expect(normalizeCategory("動漫")).toBe("動漫文章");
		expect(normalizeCategory("某新番介紹")).toBe("動漫文章");
		expect(normalizeCategory("OVA 推薦")).toBe("動漫文章");
	});

	it("模型自由文字(漫畫向)→ 漫畫文章", () => {
		expect(normalizeCategory("同人")).toBe("漫畫文章"); // 火影忍者同人 → 漫畫文章(本次实测用例)
		expect(normalizeCategory("成人同人漫畫")).toBe("漫畫文章");
		expect(normalizeCategory("本子")).toBe("漫畫文章");
	});

	it("優先判動漫:含「動畫」即使也含「漫」也归動漫", () => {
		expect(normalizeCategory("改編自漫畫的動畫")).toBe("動漫文章");
	});

	it("未知/无关自由文字 → 兜底漫畫文章(站点漫畫优先)", () => {
		expect(normalizeCategory("校園/日常")).toBe("漫畫文章"); // 实测里模型吐过的题材文字
		expect(normalizeCategory("不知道是啥")).toBe("漫畫文章");
	});

	it("空/缺失 → 兜底漫畫文章", () => {
		expect(normalizeCategory("")).toBe("漫畫文章");
		expect(normalizeCategory(undefined)).toBe("漫畫文章");
		expect(normalizeCategory("   ")).toBe("漫畫文章");
	});

	it("归一化结果必是某个后台真实 label(永不 degrade)", () => {
		const labels = CATEGORY_VOCAB.map((c) => c.label);
		for (const sample of [
			"同人",
			"成人動畫",
			"校園/日常",
			"",
			"whatever",
			"漫畫文章",
			"4",
		]) {
			expect(labels).toContain(normalizeCategory(sample));
		}
	});
});
