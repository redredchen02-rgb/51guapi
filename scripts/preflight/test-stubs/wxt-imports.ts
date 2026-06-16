// WXT `#imports` 虚拟模块的最小桩(仅供 preflight 测试)。
//
// dry-run 检查走的 batch-orchestrator 链路会**静态导入** auth-client/backend-url,
// 它们顶部 `import { storage } from "#imports"`。但 dry-run 路径全程注入 stub deps,
// 从不真正触达 storage。因此这里只需让模块能加载,无需真实实现。

export const storage = {
	getItem: async () => null,
	setItem: async () => {},
	removeItem: async () => {},
	defineItem: () => ({
		getValue: async () => null,
		setValue: async () => {},
		removeValue: async () => {},
	}),
};

export const browser = {} as unknown;
