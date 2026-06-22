import { defineConfig } from "vitest/config";

// 镜像 packages/backend/vitest.config.ts，但 shared 是纯逻辑、无 DB，故不需要 setupFiles。
// 加这份 config + package.json 的 test 脚本后，根 `pnpm -r test` 不再静默跳过 shared 内核。
export default defineConfig({
	test: {
		exclude: ["dist/**", "node_modules/**"],
		coverage: {
			provider: "v8",
			reporter: ["text", "lcov"],
			include: ["src/**"],
			exclude: ["src/**/*.test.ts"],
			// 非回退地板(ratchet)：随更多模块补测逐步调高。仅 `pnpm coverage` 时生效。
			thresholds: {
				lines: 20,
				functions: 20,
				statements: 20,
			},
		},
	},
});
