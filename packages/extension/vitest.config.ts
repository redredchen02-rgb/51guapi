import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing";

// WxtVitest 的 UnimportPlugin 不总能在测试环境中解析 #imports 虚拟模块，
// 当 lib 文件(storage/backend-url 等)被间接引入时会报 "Failed to resolve import '#imports'"。
// 同时使用两种机制:
//   - node 环境: Vite resolveId 插件 (enforce:pre)
//   - jsdom 环境: vitest moduleNameMapper → 直接 shim 文件
const VIRTUAL_WXT_IMPORTS = "\0wxt-hash-imports";
const resolveWxtImports = {
	name: "resolve-wxt-hash-imports",
	enforce: "pre" as const,
	resolveId(id: string) {
		if (id === "#imports") return VIRTUAL_WXT_IMPORTS;
	},
	load(id: string) {
		if (id === VIRTUAL_WXT_IMPORTS) {
			return [
				'export { storage } from "wxt/utils/storage";',
				'export { browser } from "wxt/browser";',
			].join("\n");
		}
	},
};

const wxtImportsShim = fileURLToPath(
	new URL("src/vitest-wxt-imports-shim.ts", import.meta.url),
);

// WxtVitest 提供 WXT 的自动导入与 fakeBrowser。
// 顶层 await 避免 async defineConfig 工厂与 Vite 8 类型不兼容。
// e2e(tests/e2e)用独立的 vitest.e2e.config.ts 跑,此处排除保持快循环轻快。
const wxtPlugins = await WxtVitest();

// moduleNameMapper is a valid Vitest runtime option (Jest-compat) but
// not yet reflected in the TypeScript types for Vitest 4.x — cast to bypass.
export default defineConfig({
	plugins: [
		resolveWxtImports,
		...(Array.isArray(wxtPlugins) ? wxtPlugins : [wxtPlugins]),
	],
	test: {
		exclude: [...configDefaults.exclude, "tests/e2e/**"],
		moduleNameMapper: {
			"^#imports$": wxtImportsShim,
		},
		coverage: {
			provider: "v8",
			reporter: ["text", "lcov"],
			include: ["entrypoints/**", "lib/**"],
			exclude: ["**/*.html"],
		},
		// biome-ignore lint/suspicious/noExplicitAny: moduleNameMapper is a valid Vitest runtime option but absent from Vitest 4.x type definitions
	} as any,
});
