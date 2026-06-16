import {
	DEFAULT_FIELD_MAPPING,
	isValidFieldMapping,
	VALID_FIELD_TYPES,
} from "@51guapi/shared";
import { describe, expect, it } from "vitest";

describe("isValidFieldMapping", () => {
	it("接受默认字段映射(自洽性)", () => {
		expect(isValidFieldMapping(DEFAULT_FIELD_MAPPING)).toBe(true);
	});

	it("接受空对象(无字段也算合法)", () => {
		expect(isValidFieldMapping({})).toBe(true);
	});

	it("拒绝 fieldType 不在 VALID_FIELD_TYPES 的字段", () => {
		const bad = {
			title: { selector: 'input[name="title"]', fieldType: "bogus" },
		};
		expect(isValidFieldMapping(bad)).toBe(false);
	});

	it("拒绝缺少 selector 的字段", () => {
		const bad = {
			title: { fieldType: "text" },
		};
		expect(isValidFieldMapping(bad)).toBe(false);
	});

	it("拒绝 selector 为空字符串的字段", () => {
		const bad = {
			title: { selector: "   ", fieldType: "text" },
		};
		expect(isValidFieldMapping(bad)).toBe(false);
	});

	it("拒绝字段定义不是对象", () => {
		const bad = { title: "input[name=title]" };
		expect(isValidFieldMapping(bad)).toBe(false);
	});

	it.each([
		null,
		undefined,
		42,
		"str",
		true,
		[DEFAULT_FIELD_MAPPING.title],
	])("对非对象输入返回 false 且不抛错: %p", (input) => {
		expect(() => isValidFieldMapping(input)).not.toThrow();
		expect(isValidFieldMapping(input)).toBe(false);
	});

	it("接受所有 VALID_FIELD_TYPES 作为合法 fieldType", () => {
		const mapping = Object.fromEntries(
			VALID_FIELD_TYPES.map((t, i) => [
				`f${i}`,
				{ selector: `#sel-${i}`, fieldType: t },
			]),
		);
		expect(isValidFieldMapping(mapping)).toBe(true);
	});
});
