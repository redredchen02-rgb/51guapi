import { describe, expect, it } from "vitest";
import {
	MARKETING_WORD_BLOCKLIST,
	validateArticleTags,
} from "./article-tags.js";

describe("validateArticleTags", () => {
	it("3-5 个无营销词标签 → ok:true", () => {
		expect(validateArticleTags(["张三", "出轨", "吃瓜"]).ok).toBe(true);
		expect(validateArticleTags(["a", "b", "c", "d", "e"]).ok).toBe(true);
	});

	it("标签少于 3 个 → ok:false，错误提示数量不足", () => {
		const r = validateArticleTags(["a", "b"]);
		expect(r.ok).toBe(false);
		expect(r.errors.some((e) => e.includes("不足 3 个"))).toBe(true);
	});

	it("空数组 → ok:false", () => {
		const r = validateArticleTags([]);
		expect(r.ok).toBe(false);
		expect(r.errors.some((e) => e.includes("不足 3 个"))).toBe(true);
	});

	it("标签超过 5 个 → ok:false，错误提示数量超过", () => {
		const r = validateArticleTags(["a", "b", "c", "d", "e", "f"]);
		expect(r.ok).toBe(false);
		expect(r.errors.some((e) => e.includes("超过 5 个"))).toBe(true);
	});

	it("含营销词 → ok:false，错误指明具体词", () => {
		const r = validateArticleTags(["爆款话题", "出轨", "吃瓜"]);
		expect(r.ok).toBe(false);
		expect(r.errors.some((e) => e.includes("爆款"))).toBe(true);
	});

	it("所有营销词均被阻断", () => {
		for (const word of MARKETING_WORD_BLOCKLIST) {
			const r = validateArticleTags([`含${word}词`, "b", "c"]);
			expect(r.ok).toBe(false);
			expect(r.errors.some((e) => e.includes(word))).toBe(true);
		}
	});

	it("营销词在标签中间（substring 匹配）→ 被阻断", () => {
		const r = validateArticleTags(["这真的炸裂了", "出轨", "吃瓜"]);
		expect(r.ok).toBe(false);
		expect(r.errors.some((e) => e.includes("炸裂"))).toBe(true);
	});

	it("多个错误同时存在", () => {
		const r = validateArticleTags(["爆款"]);
		expect(r.ok).toBe(false);
		expect(r.errors.length).toBeGreaterThanOrEqual(2);
	});

	it("errors 为空数组时 ok 必为 true", () => {
		const r = validateArticleTags(["明星", "吃瓜", "出轨"]);
		expect(r.errors).toHaveLength(0);
		expect(r.ok).toBe(true);
	});
});
