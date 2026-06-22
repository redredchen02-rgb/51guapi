// Node 解析钩子:把 `#imports`(WXT 虚拟模块,Node 下不存在)重定向到最小桩。
//
// 仅供 `pnpm preflight` 的 tsx 运行期使用。部分扩展端模块静态导入
// auth-client/backend-url,这些模块顶部会从 WXT 虚拟模块 `#imports` 取 storage。
// preflight 只需要模块可加载,不会触达真实 Chrome storage。
// 对 WXT 构建零影响(WXT 由自己的打包器提供 #imports)。

const STUB = new URL("./test-stubs/wxt-imports.ts", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
	if (specifier === "#imports") {
		return { url: STUB, shortCircuit: true };
	}
	return nextResolve(specifier, context);
}
