import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		setupFiles: ["./src/config/test-setup.ts"],
		exclude: ["dist/**", "node_modules/**"],
		coverage: {
			provider: "v8",
			reporter: ["text", "lcov"],
			include: ["src/**"],
			exclude: [
				"src/migrations/**",
				"src/**/*.test.ts",
				"src/scraper/adapters/template-adapter.ts",
			],
			// 非回退地板(ratchet):实测 stmts≈88 / funcs≈91 / lines≈90,设保守 80 防回退。
			// 仅在 coverage 运行时求值——CI 的 Test 步骤已改为 `pnpm coverage`,故 CI 强制执行。
			thresholds: {
				lines: 80,
				functions: 80,
				statements: 80,
			},
		},
	},
});
