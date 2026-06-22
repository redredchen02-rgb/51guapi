import { describe, expect, it } from "vitest";
import {
	extractLinks,
	hasUnsourcedLink,
	normalizeUrl,
	verifyLinks,
} from "./link-source.js";

describe("extractLinks", () => {
	it("extracts href from <a> tags (double and single quotes, extra attrs)", () => {
		expect(extractLinks('<a href="https://a.com/x">x</a>')).toEqual([
			"https://a.com/x",
		]);
		expect(extractLinks("<a class='c' href='https://b.com'>b</a>")).toEqual([
			"https://b.com",
		]);
	});
	it("decodes &amp; entities in href", () => {
		expect(extractLinks('<a href="https://a.com/?x=1&amp;y=2">x</a>')).toEqual([
			"https://a.com/?x=1&y=2",
		]);
	});
	it("returns empty for prose with no links", () => {
		expect(extractLinks("纯文本，没有任何链接")).toEqual([]);
	});
});

describe("normalizeUrl", () => {
	it("ignores scheme, lowercases host, strips www and trailing slash", () => {
		expect(normalizeUrl("https://WWW.A.com/path/")).toBe("a.com/path");
		expect(normalizeUrl("http://a.com/path")).toBe("a.com/path");
	});
	it("keeps query string", () => {
		expect(normalizeUrl("https://a.com/p?x=1")).toBe("a.com/p?x=1");
	});
	it("falls back to lowercased trimmed string on parse failure", () => {
		expect(normalizeUrl("  NOT a url/ ")).toBe("not a url");
	});
});

describe("verifyLinks + hasUnsourcedLink (grounding gate)", () => {
	it("marks links present in the allowed set as sourced", () => {
		const checks = verifyLinks('<a href="https://src.com/a">x</a>', [
			"https://src.com/a",
		]);
		expect(checks).toEqual([{ url: "https://src.com/a", sourced: true }]);
		expect(hasUnsourcedLink(checks)).toBe(false);
	});
	it("flags a link NOT in the allowed set as unsourced (hallucination signal)", () => {
		const checks = verifyLinks('<a href="https://evil.com">x</a>', [
			"https://src.com/a",
		]);
		expect(hasUnsourcedLink(checks)).toBe(true);
	});
	it("treats scheme/www/trailing-slash differences as the same source", () => {
		const checks = verifyLinks('<a href="http://www.src.com/a/">x</a>', [
			"https://src.com/a",
		]);
		expect(hasUnsourcedLink(checks)).toBe(false);
	});
	it("empty allowed set rejects any link (fail-closed)", () => {
		const checks = verifyLinks('<a href="https://src.com">x</a>', []);
		expect(hasUnsourcedLink(checks)).toBe(true);
	});
	it("dedups repeated links, preserves order", () => {
		const checks = verifyLinks(
			'<a href="https://a.com">1</a><a href="https://a.com">2</a>',
			["https://a.com"],
		);
		expect(checks).toHaveLength(1);
	});
});
