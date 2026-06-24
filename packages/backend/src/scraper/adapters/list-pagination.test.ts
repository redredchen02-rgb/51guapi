import { describe, expect, it } from "vitest";
import {
	currentPageNumber,
	detectNextPageUrl,
	resolveSameHost,
} from "./list-pagination.js";

// 翻頁偵測純函數單測：直接驅動 detectNextPageUrl/resolveSameHost/currentPageNumber,
// 與網路/SSRF 棧零耦合。每個導出函數錨一條 happy-path,並對 resolveSameHost 的
// 纵深防御(協議白名單 + 嚴格同源)做安全鉤死——後者為本單元的明確淨增(安全覆蓋)。

describe("list-pagination.detectNextPageUrl（happy-path 錨點）", () => {
	it("rel=next 指向同 host → 絕對化回傳", () => {
		const html = `<html><head><link rel="next" href="https://example.com/latest?page=2" /></head></html>`;
		expect(detectNextPageUrl(html, new URL("https://example.com/latest"))).toBe(
			"https://example.com/latest?page=2",
		);
	});

	it("?page=N pattern：無 rel=next 時用 <a href ?page=> 偵測「當前頁+1」", () => {
		const html = `<html><body><a href="/gossip/1">x</a><a href="https://example.com/latest?page=2">下一頁</a></body></html>`;
		expect(
			detectNextPageUrl(html, new URL("https://example.com/latest?page=1")),
		).toBe("https://example.com/latest?page=2");
	});

	it("偵測不到下一頁 → undefined", () => {
		const html = `<html><body><a href="/gossip/1">x</a></body></html>`;
		expect(
			detectNextPageUrl(html, new URL("https://example.com/latest")),
		).toBeUndefined();
	});
});

describe("list-pagination.currentPageNumber（happy-path 錨點）", () => {
	it("?page=N / ?p=N / /page/N → 取數字頁碼;無線索 → 預設 1", () => {
		expect(currentPageNumber(new URL("https://e.com/x?page=3"))).toBe(3);
		expect(currentPageNumber(new URL("https://e.com/x?p=7"))).toBe(7);
		expect(currentPageNumber(new URL("https://e.com/page/5"))).toBe(5);
		expect(currentPageNumber(new URL("https://e.com/latest"))).toBe(1);
	});
});

describe("list-pagination.resolveSameHost（纵深防御安全鉤死：協議白名單 + 嚴格同源）", () => {
	const base = new URL("https://example.com/latest");

	it("同 host 的 http(s) href → 絕對化回傳", () => {
		expect(resolveSameHost("/latest?page=2", base)).toBe(
			"https://example.com/latest?page=2",
		);
	});

	it("Security：跨 host href → 嚴格同源拒（undefined）", () => {
		expect(resolveSameHost("https://evil.com/x", base)).toBeUndefined();
	});

	it("Security：javascript: scheme → 協議白名單拒（undefined）", () => {
		expect(resolveSameHost("javascript:alert(1)", base)).toBeUndefined();
	});

	it("Security：data: scheme → 協議白名單拒（undefined）", () => {
		expect(
			resolveSameHost("data:text/html,<a href=/gossip/9>x</a>", base),
		).toBeUndefined();
	});

	it("Security：file: scheme → 協議白名單拒（undefined）", () => {
		expect(resolveSameHost("file:///etc/passwd", base)).toBeUndefined();
	});

	it("畸形 href（`http://[` 缺 IPv6 結尾）→ new URL 拋錯 → catch 回 undefined (line 45)", () => {
		expect(resolveSameHost("http://[", base)).toBeUndefined();
	});
});
