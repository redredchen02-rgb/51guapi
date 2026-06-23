import { describe, expect, it } from "vitest";
import {
	extractLinks,
	HTTP_URL_PATTERN,
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

describe("HTTP_URL_PATTERN (shared URL extraction regex)", () => {
	const reGlobal = () => new RegExp(HTTP_URL_PATTERN, "gi");
	const reSingle = () => new RegExp(HTTP_URL_PATTERN, "i");

	it("matches plain http and https URLs", () => {
		expect("https://example.com/path".match(reSingle())?.[0]).toBe(
			"https://example.com/path",
		);
		expect("http://example.com".match(reSingle())?.[0]).toBe(
			"http://example.com",
		);
	});
	it("extracts all URLs from a string containing multiple URLs", () => {
		const text = "see https://a.com and https://b.com/q?x=1 for details";
		expect(text.match(reGlobal())).toEqual([
			"https://a.com",
			"https://b.com/q?x=1",
		]);
	});
	it("stops at whitespace — does not overshoot into surrounding text", () => {
		const m = "visit https://x.com done".match(reSingle());
		expect(m?.[0]).toBe("https://x.com");
	});
	it("stops at pipe — does not consume | separator used in text fields", () => {
		const m = "https://src.com/a | 說明".match(reSingle());
		expect(m?.[0]).toBe("https://src.com/a");
	});
	it("returns null when no URL is present", () => {
		expect("pure text without any url".match(reSingle())).toBeNull();
	});
	it("matches URLs with query params and fragments", () => {
		const url = "https://a.com/p?x=1&y=2#sec";
		expect(url.match(reSingle())?.[0]).toBe(url);
	});
});
