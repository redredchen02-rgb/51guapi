// Chrome Storage API 工具函数
// 供需要访问 chrome.storage.local 的 hooks 使用

declare const chrome: {
	storage?: {
		local?: {
			get: (
				keys: string | string[] | Record<string, unknown>,
			) => Promise<Record<string, unknown>>;
			set: (items: Record<string, unknown>) => Promise<void>;
			remove: (keys: string | string[]) => Promise<void>;
		};
	};
};

/** 检查 chrome.storage.local API 是否可用 */
export function isStorageAvailable(): boolean {
	try {
		return typeof chrome !== "undefined" && chrome?.storage?.local != null;
	} catch {
		return false;
	}
}

/** 获取 chrome.storage.local 引用，不可用时返回 null */
export function getStorage() {
	if (!isStorageAvailable()) return null;
	return chrome.storage?.local as {
		get: <T>(key: string) => Promise<T | null>;
		set: (data: Record<string, unknown>) => Promise<void>;
		remove: (key: string) => Promise<void>;
	};
}
