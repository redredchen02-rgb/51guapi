import { describe, expect, it } from "vitest";
import { fuzzyMatch } from "./ranking-service.js";

// fuzzyMatch 是純函數，不需要 DB — 直接測試
describe("fuzzyMatch", () => {
	it("完全包含（keyword ⊆ title）", () => {
		expect(fuzzyMatch("王力宏離婚記者會", "王力宏")).toBe(true);
	});

	it("反向包含（title ⊆ keyword）", () => {
		expect(fuzzyMatch("章子怡", "章子怡汪峰分居傳聞")).toBe(true);
	});

	it("空格正規化：去空格後包含", () => {
		expect(fuzzyMatch("章子怡汪峰", "章子怡 汪峰")).toBe(true);
		expect(fuzzyMatch("章子怡 汪峰", "章子怡汪峰")).toBe(true);
	});

	it("大小寫不敏感（英文混合）", () => {
		expect(fuzzyMatch("Jay Chou concert", "jay chou")).toBe(true);
	});

	it("無關字符：不匹配", () => {
		expect(fuzzyMatch("王力宏離婚", "周杰倫")).toBe(false);
	});

	it("空字串：不匹配", () => {
		expect(fuzzyMatch("", "王力宏")).toBe(false);
		expect(fuzzyMatch("王力宏", "")).toBe(false);
	});

	it("相同字串：匹配", () => {
		expect(fuzzyMatch("章子怡", "章子怡")).toBe(true);
	});
});
