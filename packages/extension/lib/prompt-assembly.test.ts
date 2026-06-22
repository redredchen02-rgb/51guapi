import { describe, expect, it } from "vitest";
import { buildConstraintSuffix } from "./prompt-assembly";

describe("buildConstraintSuffix (moved to lib)", () => {
	it("空标签 → 只含分类约束", () => {
		expect(buildConstraintSuffix([])).toContain("分类约束");
		expect(buildConstraintSuffix([])).not.toContain("标签约束");
	});

	it("分类约束含 THEME_ALLOWLIST 实际词条（出軌等）", () => {
		expect(buildConstraintSuffix([])).toContain("出軌");
	});

	it("有标签 → 含标签约束且逗号连接", () => {
		const out = buildConstraintSuffix(["a", "b"]);
		expect(out).toContain("标签约束");
		expect(out).toContain("a，b");
	});
});
