import { describe, expect, it } from "vitest";
import type { GossipFactsBlock } from "./gossip-facts.js";
import { gossipFactUrls } from "./gossip-facts.js";
import { hasUnsourcedLink, verifyLinks } from "./link-source.js";
import {
	assembleGossipDraft,
	containsPlaceholder,
	esc,
	PLACEHOLDER,
	sanitizeToPlainText,
} from "./post-assembler.js";

function facts(over: Partial<GossipFactsBlock> = {}): GossipFactsBlock {
	return {
		當事人: null,
		事件摘要: null,
		起因: null,
		經過: null,
		結果: null,
		來源連結: null,
		發生時間: null,
		熱度標籤: null,
		...over,
	};
}

describe("containsPlaceholder", () => {
	it("detects closed, annotated, and unclosed 待补 markers", () => {
		expect(containsPlaceholder("【待补】")).toBe(true);
		expect(containsPlaceholder("【待补:作品名】")).toBe(true);
		expect(containsPlaceholder("前缀【待补 残缺")).toBe(true);
	});
	it("is null-safe and false for clean text", () => {
		expect(containsPlaceholder(undefined)).toBe(false);
		expect(containsPlaceholder(null)).toBe(false);
		expect(containsPlaceholder("正常文本")).toBe(false);
	});
});

describe("sanitizeToPlainText (model prose neutralization)", () => {
	it("strips HTML tags", () => {
		expect(sanitizeToPlainText("<b>粗</b>体")).toBe("粗 体");
	});
	it("replaces bare URLs and www with placeholder — model cannot author links", () => {
		const out = sanitizeToPlainText("看 https://evil.com 这里 www.evil2.com");
		expect(out).toContain(PLACEHOLDER);
		expect(out).not.toContain("evil.com");
		expect(out).not.toContain("evil2.com");
	});
	it("returns empty for empty/undefined", () => {
		expect(sanitizeToPlainText(undefined)).toBe("");
		expect(sanitizeToPlainText("")).toBe("");
	});
});

describe("esc", () => {
	it("escapes HTML-significant chars", () => {
		expect(esc('<a href="x">&')).toBe("&lt;a href=&quot;x&quot;&gt;&amp;");
	});
});

describe("assembleGossipDraft (anti-hallucination invariants)", () => {
	it("title falls back to placeholder when 當事人 missing", () => {
		const out = assembleGossipDraft(
			{ intro: "引子", highlights: "看点" },
			facts(),
		);
		expect(out.title).toBe(PLACEHOLDER);
	});
	it("prefixes 當事人 verbatim and injects source link from facts only", () => {
		const f = facts({ 當事人: "甲", 來源連結: "https://src.com/x" });
		const out = assembleGossipDraft(
			{ intro: "i", highlights: "h", titleSuffix: "出軌" },
			f,
		);
		expect(out.title).toBe("甲出軌");
		expect(out.body).toContain('<a href="https://src.com/x">');
	});
	it("INVARIANT: no model-injected link survives; every body link is sourced from facts", () => {
		const f = facts({ 當事人: "甲", 來源連結: "https://src.com/x" });
		const out = assembleGossipDraft(
			{
				// model tries to smuggle links via prose slots (anchor + bare URL)
				intro: '看 <a href="https://evil.com">这</a> 还有 https://evil2.com',
				highlights: "纯看点",
			},
			f,
		);
		expect(out.body).not.toContain("evil.com");
		expect(out.body).not.toContain("evil2.com");
		const checks = verifyLinks(out.body, gossipFactUrls(f));
		expect(hasUnsourcedLink(checks)).toBe(false);
	});
	it("clean prose with no facts source link yields zero body links", () => {
		const f = facts({ 當事人: "甲" });
		const out = assembleGossipDraft({ intro: "i", highlights: "h" }, f);
		expect(verifyLinks(out.body, gossipFactUrls(f))).toHaveLength(0);
	});
});
