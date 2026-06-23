import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "jsdom",
		globals: true,
		setupFiles: ["./src/test-setup.ts"],
		exclude: ["dist/**", "node_modules/**"],
		coverage: {
			provider: "v8",
			reporter: ["text", "lcov"],
			// Only measure coverage for the pure-logic layer (api-client).
			// React components/routes/api-wrappers are integration-tested via smoke test,
			// not unit-tested — including them would make the threshold meaningless.
			include: ["src/lib/**"],
			exclude: [
				"src/**/*.test.ts",
				"src/**/*.test.tsx",
				"src/test-setup.ts",
				"src/lib/utils.ts", // shadcn cn() helper — trivial re-export, no logic to gate
			],
			thresholds: {
				lines: 60,
				functions: 60,
				statements: 60,
			},
		},
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
});
