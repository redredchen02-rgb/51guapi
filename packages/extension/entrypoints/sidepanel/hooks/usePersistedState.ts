import { useCallback, useEffect, useState } from "react";
import { getStorage } from "../../../lib/chrome-storage-utils";

export function usePersistedState<T>(
	key: string,
	defaultValue: T,
): [T, (value: T | ((prev: T) => T)) => void] {
	const [state, setState] = useState<T>(defaultValue);

	// 从存储加载初始值
	useEffect(() => {
		let cancelled = false;

		async function loadFromStorage() {
			try {
				const storage = getStorage();
				if (storage) {
					const result = await storage.get<Record<string, unknown>>(key);
					// chrome.storage.local.get 返回 {[key]: value}，需取出真实值
					const value = result?.[key];
					if (!cancelled && value !== undefined) {
						setState(value as T);
					}
				}
			} catch {
				// 静默失败
			}
		}

		void loadFromStorage();

		return () => {
			cancelled = true;
		};
	}, [key]);

	// 保存到存储
	const setValue = useCallback(
		(value: T | ((prev: T) => T)) => {
			setState((prev) => {
				const newValue =
					typeof value === "function" ? (value as (prev: T) => T)(prev) : value;

				// 异步保存到存储
				const storage = getStorage();
				if (storage) {
					storage.set({ [key]: newValue }).catch(() => {});
				}

				return newValue;
			});
		},
		[key],
	);

	return [state, setValue];
}
