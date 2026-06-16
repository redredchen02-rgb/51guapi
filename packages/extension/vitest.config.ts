import { configDefaults, defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing";

// WxtVitest 提供 WXT 的自动导入(storage/browser 等)与 fakeBrowser。
// e2e(tests/e2e)用独立的 vitest.e2e.config.ts 跑(加载真 Quill),此处排除,保持快循环单测轻快。
export default defineConfig({
	plugins: [WxtVitest()],
	test: {
		exclude: [...configDefaults.exclude, "tests/e2e/**"],
		coverage: {
			provider: "v8",
			reporter: ["text", "lcov"],
			include: ["entrypoints/**", "lib/**"],
			exclude: ["**/*.html"],
		},
	},
});
