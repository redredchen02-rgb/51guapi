import type { GossipFactsBlock } from "@51guapi/shared";
import {
	countThemes,
	normalizeCategory,
	OTHER_THEME,
	parseThemes,
} from "@51guapi/shared";
import { describe, expect, it } from "vitest";

function facts(熱度標籤: string | null): GossipFactsBlock {
	return {
		當事人: null,
		事件摘要: null,
		起因: null,
		經過: null,
		結果: null,
		來源連結: null,
		發生時間: null,
		熱度標籤,
	};
}

describe("parseThemes", () => {
	it("已知标签归一", () => {
		expect(parseThemes("出軌")).toEqual(["出軌"]);
	});
	it("公開戀情 精确归到 公開戀情 类", () => {
		expect(parseThemes("公開戀情")).toEqual(["公開戀情"]);
	});
	it("戀情 归到 戀情（不应被 公開戀情 吸收）", () => {
		expect(parseThemes("戀情")).toEqual(["戀情"]);
	});
	it("多标签 → 多题材去重", () => {
		expect(parseThemes("出軌,撕逼,出軌").sort()).toEqual(
			["出軌", "撕逼"].sort(),
		);
	});
	it("未知标签 → 其他", () => {
		expect(parseThemes("演唱會延期")).toEqual([OTHER_THEME]);
	});
	it("null/空 → 其他", () => {
		expect(parseThemes(null)).toEqual([OTHER_THEME]);
		expect(parseThemes("   ")).toEqual([OTHER_THEME]);
	});
	it("已知 + 未知混合 → 已知题材 + 其他", () => {
		const t = parseThemes("出軌,某种怪标签").sort();
		expect(t).toEqual(["其他", "出軌"].sort());
	});
	it("非折叠字符（全ASCII/无简繁差异）原样通过 fold passthrough", () => {
		expect(parseThemes("hello world")).toEqual([OTHER_THEME]);
		expect(parseThemes("爆料")).toEqual(["爆料"]);
	});
	it("简体熱度標籤 → 命中繁体题材表（简繁兼容）", () => {
		expect(parseThemes("出轨")).toEqual(["出軌"]);
		expect(parseThemes("复出,绯闻").sort()).toEqual(["復出", "緋聞"].sort());
		expect(parseThemes("公开恋情")).toEqual(["公開戀情"]);
	});
});

describe("countThemes", () => {
	it("一条多题材在各题材各计一次，按计数降序", () => {
		const list = [facts("出軌,撕逼"), facts("出軌"), facts(null)];
		const counts = countThemes(list);
		const map = Object.fromEntries(counts.map((c) => [c.theme, c.count]));
		expect(map.出軌).toBe(2);
		expect(map.撕逼).toBe(1);
		expect(map[OTHER_THEME]).toBe(1);
		// 降序
		expect(counts[0].count).toBeGreaterThanOrEqual(
			counts[counts.length - 1].count,
		);
	});
});

describe("normalizeCategory（单值主题材）", () => {
	it("命中题材 → 该题材（含简体）", () => {
		expect(normalizeCategory("出軌")).toBe("出軌");
		expect(normalizeCategory("出轨")).toBe("出軌");
	});
	it("包含匹配 → 归一题材", () => {
		expect(normalizeCategory("塌房了")).toBe("塌房");
	});
	it("多标签 → 取首个主题材", () => {
		expect(normalizeCategory("出軌,撕逼")).toBe("出軌");
	});
	it("未识别/空/undefined → 其他", () => {
		expect(normalizeCategory("演唱會延期")).toBe(OTHER_THEME);
		expect(normalizeCategory("")).toBe(OTHER_THEME);
		expect(normalizeCategory(undefined)).toBe(OTHER_THEME);
	});
});
