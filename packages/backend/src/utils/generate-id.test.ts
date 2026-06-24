import { afterEach, describe, expect, it, vi } from "vitest";
import { generateId } from "./generate-id.js";

describe("generateId", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns a string from a single prefix arg", () => {
		const id = generateId("scrape");
		expect(typeof id).toBe("string");
		expect(generateId.length).toBe(1);
	});

	it("keeps the prefix_<digits>_<suffix> shape", () => {
		const id = generateId("discovered");
		// scheduler/routes 依赖 prefix_timestamp_ 契约
		expect(id).toMatch(/^discovered_\d+_.+$/);
		const [prefix, ts, suffix] = id.split("_");
		expect(prefix).toBe("discovered");
		expect(Number.isInteger(Number(ts))).toBe(true);
		expect(suffix.length).toBeGreaterThan(0);
	});

	it("passes arbitrary prefixes through verbatim", () => {
		for (const prefix of ["scrape", "pending", "prompt", "site", "scheduled"]) {
			expect(generateId(prefix)).toMatch(new RegExp(`^${prefix}_\\d+_`));
		}
	});

	it("produces 50000 distinct ids within a single tick", () => {
		const ids = new Set<string>();
		for (let i = 0; i < 50_000; i++) {
			ids.add(generateId("x"));
		}
		expect(ids.size).toBe(50_000);
	}, 20000);

	it("stays collision-free even when Date.now() is frozen", () => {
		vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
		const suffixes = new Set<string>();
		for (let i = 0; i < 10_000; i++) {
			const id = generateId("frozen");
			expect(id.startsWith("frozen_1700000000000_")).toBe(true);
			// suffix = 第三段及之后（理论上无下划线，但 split 兜底拼回）
			suffixes.add(id.split("_").slice(2).join("_"));
		}
		expect(suffixes.size).toBe(10_000);
	});
});
