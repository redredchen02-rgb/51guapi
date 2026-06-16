// @vitest-environment jsdom
// extractLinks 依赖 DOMParser;主 vitest 配置是 node 环境,故此文件单独用 jsdom。
import { describe, expect, it } from "vitest";
import {
	extractLinks,
	hasUnsourcedLink,
	normalizeUrl,
	verifyLinks,
} from "./link-source";

describe("extractLinks", () => {
	it("pulls hrefs from anchor tags", () => {
		const html =
			'<p>看 <a href="http://a/1">漢化</a> 和 <a href="https://b/2">無修</a></p>';
		expect(extractLinks(html)).toEqual(["http://a/1", "https://b/2"]);
	});
	it("empty when no links", () => {
		expect(extractLinks("<p>纯文字无连结</p>")).toEqual([]);
	});
});

describe("normalizeUrl", () => {
	it("ignores scheme, lowercases host, strips www and trailing slash", () => {
		expect(normalizeUrl("https://WWW.A.com/x/")).toBe(
			normalizeUrl("http://a.com/x"),
		);
	});
	it("keeps query string", () => {
		expect(normalizeUrl("https://a.com/x?id=1")).toBe("a.com/x?id=1");
	});
	it("falls back to lowercased trimmed string on parse failure", () => {
		expect(normalizeUrl("  NOT A URL/  ")).toBe("not a url");
	});
});

describe("verifyLinks", () => {
	it("marks links found in allowed set as sourced", () => {
		const html = '<a href="http://a/1">x</a>';
		expect(verifyLinks(html, ["https://a/1"])).toEqual([
			{ url: "http://a/1", sourced: true },
		]);
	});

	it("marks links NOT in input facts as unsourced (hallucination)", () => {
		const html = '<a href="https://evil-invented.net/g/123">無修</a>';
		const r = verifyLinks(html, ["https://real.com/x"]);
		expect(r).toEqual([
			{ url: "https://evil-invented.net/g/123", sourced: false },
		]);
		expect(hasUnsourcedLink(r)).toBe(true);
	});

	it("treats normalized-equivalent urls as sourced", () => {
		const html = '<a href="http://www.a.com/x/">x</a>';
		expect(verifyLinks(html, ["https://a.com/x"])[0]?.sourced).toBe(true);
	});

	it("empty body links -> empty result; facts links but no body links -> empty", () => {
		expect(verifyLinks("<p>无连结</p>", ["https://a.com/x"])).toEqual([]);
	});

	it("all unsourced when allowed set empty", () => {
		const r = verifyLinks('<a href="https://a.com/x">x</a>', []);
		expect(r[0]?.sourced).toBe(false);
	});

	it("dedupes normalized-equivalent body links", () => {
		const html =
			'<a href="https://a.com/x">1</a><a href="http://www.a.com/x/">2</a>';
		expect(verifyLinks(html, [])).toHaveLength(1);
	});
});
