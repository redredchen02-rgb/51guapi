// Node 解析钩子:把 `#imports`(WXT 虚拟模块,Node 下不存在)重定向到最小桩。
//
// 仅供 `pnpm preflight` 的 tsx 运行期使用 —— dry-run 检查的 batch-orchestrator 链路
// 静态导入了 auth-client/backend-url(顶部 import storage from "#imports"),
// 但 dry-run 路径全程注入 stub,实际从不调用 storage。
// 对 WXT 构建零影响(WXT 由自己的打包器提供 #imports)。

const STUB = new URL("./test-stubs/wxt-imports.ts", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
	if (specifier === "#imports") {
		return { url: STUB, shortCircuit: true };
	}
	return nextResolve(specifier, context);
}
