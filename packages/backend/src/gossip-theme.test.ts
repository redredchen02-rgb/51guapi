import type { GossipFactsBlock } from "@51guapi/shared";
import { countThemes, OTHER_THEME, parseThemes } from "@51guapi/shared";
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
	it("公開戀情 归到戀情/公開戀情 类(包含匹配)", () => {
		const t = parseThemes("公開戀情");
		expect(t.length).toBe(1);
		expect(t[0]).toMatch(/戀情/);
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
