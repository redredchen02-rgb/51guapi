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
			include: ["src/**"],
			exclude: [
				"src/**/*.test.ts",
				"src/**/*.test.tsx",
				"src/test-setup.ts",
				"src/routeTree.gen.ts",
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
