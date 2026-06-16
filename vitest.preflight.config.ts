import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Preflight 自检测试(PR-A)。Node 环境;dryrun-green 测试在文件内用
// `// @vitest-environment jsdom` 局部覆盖(approveBatch 链路触及 document)。
//
// `#imports` 是 WXT 的虚拟模块,Node 下不存在。dry-run 链路静态导入了
// auth-client/backend-url(它们顶部 import storage from "#imports"),故 alias 到最小桩;
// dry-run 路径全程注入 stub,实际从不调用 storage。
export default defineConfig({
	resolve: {
		alias: {
			"#imports": fileURLToPath(
				new URL(
					"./scripts/preflight/test-stubs/wxt-imports.ts",
					import.meta.url,
				),
			),
		},
	},
	test: {
		environment: "node",
		include: ["scripts/preflight/**/*.test.ts"],
	},
});
