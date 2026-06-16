import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		setupFiles: ["./src/config/test-setup.ts"],
		exclude: ["dist/**", "node_modules/**"],
		coverage: {
			provider: "v8",
			reporter: ["text", "lcov"],
			include: ["src/**"],
			exclude: ["src/migrations/**", "src/**/*.test.ts"],
		},
	},
});
