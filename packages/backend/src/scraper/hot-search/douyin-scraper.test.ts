import { describe, expect, it } from "vitest";
import { scrapeDouyin } from "./douyin-scraper.js";

describe("scrapeDouyin — Phase 2 stub", () => {
	it("回傳空陣列，不拋錯", async () => {
		await expect(scrapeDouyin()).resolves.toEqual([]);
	});
});
