import {
	applyPromptTemplate,
	factUrls,
	formatFactsForPrompt,
	isEmptyFacts,
	parseTopicLine,
} from "@51guapi/shared";
import { describe, expect, it } from "vitest";

describe("parseTopicLine", () => {
	it("parses topic + facts with canonical keys", () => {
		const r = parseTopicLine(
			"少女彈珠汽水介紹 || 作品名=少女彈珠汽水 | 集数=6 | 漢化=http://h/x",
		);
		expect(r).toEqual({
			topic: "少女彈珠汽水介紹",
			facts: { 作品名: "少女彈珠汽水", 集数: "6", 漢化: "http://h/x" },
		});
	});

	it("treats a line without || as a bare topic with no facts (backward compat)", () => {
		expect(parseTopicLine("某某成人動畫介紹")).toEqual({
			topic: "某某成人動畫介紹",
			facts: {},
		});
	});

	it("returns null for empty/whitespace lines", () => {
		expect(parseTopicLine("   ")).toBeNull();
		expect(parseTopicLine("")).toBeNull();
	});

	it("maps english/alt aliases to canonical chinese keys", () => {
		const r = parseTopicLine(
			"t || name=X | ep=12 | tags=校園 | uncen=http://u/1 | desc=简述",
		);
		expect(r?.facts).toEqual({
			作品名: "X",
			集数: "12",
			题材: "校園",
			無修: "http://u/1",
			简介: "简述",
		});
	});

	it("ignores unknown keys and empty values; later key wins; value may contain =", () => {
		const r = parseTopicLine(
			"t || 作品名=A | unknown=zzz | 集数= | 简介=a=b=c | 作品名=B",
		);
		expect(r?.facts).toEqual({ 作品名: "B", 简介: "a=b=c" });
	});

	it("produces empty facts when || present but no parseable fields", () => {
		const r = parseTopicLine("t || 没有等号");
		expect(r).toEqual({ topic: "t", facts: {} });
	});
});

describe("isEmptyFacts", () => {
	it("true when no field set, false when any set", () => {
		expect(isEmptyFacts({})).toBe(true);
		expect(isEmptyFacts({ 作品名: "X" })).toBe(false);
	});
});

describe("factUrls", () => {
	it("collects urls from 漢化/無修/简介", () => {
		expect(
			factUrls({
				漢化: "http://a/1",
				無修: "https://b/2",
				简介: "见 https://c/3 这里",
				作品名: "X",
			}),
		).toEqual(["http://a/1", "https://b/2", "https://c/3"]);
	});
	it("empty when no urls", () => {
		expect(factUrls({ 作品名: "X", 集数: "6" })).toEqual([]);
	});
});

describe("formatFactsForPrompt", () => {
	it("lists provided fields in canonical order with anti-fabrication header", () => {
		const out = formatFactsForPrompt({ 集数: "6", 作品名: "X" });
		expect(out).toContain("【事实】");
		expect(out).toContain("- 作品名:X");
		expect(out).toContain("- 集数:6");
		// 作品名 before 集数 (canonical order)
		expect(out.indexOf("作品名")).toBeLessThan(out.indexOf("集数"));
	});

	it("instructs whole-draft 【待补】 when no facts", () => {
		const out = formatFactsForPrompt({});
		expect(out).toContain("未提供任何事实");
		expect(out).toContain("【待补】");
	});
});

describe("applyPromptTemplate", () => {
	it("replaces {{topic}} {{facts}} {{fewshot}} placeholders", () => {
		const tpl = "{{fewshot}}写:{{topic}}\n{{facts}}";
		const out = applyPromptTemplate(tpl, "主题A", { 作品名: "X" }, "范例YY");
		expect(out).toContain("主题A");
		expect(out).toContain("- 作品名:X");
		expect(out).toContain("范例YY");
	});

	it("backward compatible: 2-arg call behaves like old buildPrompt", () => {
		expect(applyPromptTemplate("写:{{topic}}", "主题A")).toBe("写:主题A");
		expect(applyPromptTemplate("模板无占位", "主题A")).toBe(
			"模板无占位\n主题:主题A",
		);
	});

	it("strips unused {{facts}}/{{fewshot}} placeholders when not provided", () => {
		const out = applyPromptTemplate(
			"{{fewshot}}写:{{topic}}\n{{facts}}",
			"主题A",
		);
		expect(out).not.toContain("{{facts}}");
		expect(out).not.toContain("{{fewshot}}");
		expect(out).toContain("主题A");
	});

	it("appends facts block when template has no {{facts}} placeholder but facts given", () => {
		const out = applyPromptTemplate("写:{{topic}}", "主题A", { 作品名: "X" });
		expect(out).toContain("主题A");
		expect(out).toContain("【事实】");
		expect(out).toContain("- 作品名:X");
	});

	it("empty facts object still injects the whole-draft 【待补】 instruction", () => {
		const out = applyPromptTemplate("写:{{topic}}\n{{facts}}", "主题A", {});
		expect(out).toContain("未提供任何事实");
	});
});
