// WXT `#imports` 虚拟模块的最小桩(仅供 preflight 测试)。
//
// preflight 会静态导入部分扩展端模块,它们顶部 `import { storage } from "#imports"`。
// 这里仅让模块能在 Node 下加载,无需真实 Chrome storage 实现。

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
