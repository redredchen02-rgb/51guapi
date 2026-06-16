import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_FIELD_MAPPING } from "@51guapi/shared";
import { describe, expect, it } from "vitest";
import { DEFAULT_RECIPE } from "./recipe";

describe("SiteRecipe", () => {
	it("fieldMapping 即 DEFAULT_FIELD_MAPPING(防分叉,单一事实源)", () => {
		expect(DEFAULT_RECIPE.fieldMapping).toBe(DEFAULT_FIELD_MAPPING);
	});

	it("发布配置与历史默认一致(行为不变)", () => {
		expect(DEFAULT_RECIPE.publish.saveEndpoint).toBe("/admin/webarticle/save");
		expect(DEFAULT_RECIPE.publish.editorSelector).toBe("#editor");
		expect(DEFAULT_RECIPE.publish.formSelector).toBe("form[lay-filter], form");
	});

	it("消毒白名单含历史标签/属性(行为不变)", () => {
		expect(DEFAULT_RECIPE.sanitize.allowedTags).toContain("img");
		expect(DEFAULT_RECIPE.sanitize.allowedTags).toContain("a");
		expect(DEFAULT_RECIPE.sanitize.allowedAttr).toEqual([
			"href",
			"target",
			"rel",
			"src",
			"alt",
		]);
	});

	it("host = admin 子域", () => {
		expect(DEFAULT_RECIPE.host).toBe("dx-999-adm.ympxbys.xyz");
	});

	it("纯净:recipe.ts 不 import #imports、不碰 chrome API(可被无头端复用)", () => {
		const src = readFileSync(resolve(process.cwd(), "lib/recipe.ts"), "utf-8");
		expect(src).not.toMatch(/from\s+['"]#imports['"]/);
		expect(src).not.toMatch(/\bchrome\.\w/);
		expect(src).not.toMatch(/\bbrowser\.\w/);
	});
});
