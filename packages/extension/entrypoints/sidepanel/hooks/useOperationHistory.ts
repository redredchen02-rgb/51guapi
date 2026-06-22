import { useCallback, useRef, useState } from "react";
import { getStorage } from "../../../lib/chrome-storage-utils";

interface OperationRecord {
	id: string;
	type: "generate" | "error";
	topic: string;
	success: boolean;
	details?: Record<string, unknown>;
	timestamp: string;
}

interface UseOperationHistoryReturn {
	history: OperationRecord[];
	recordOperation: (
		operation: Omit<OperationRecord, "id" | "timestamp">,
	) => Promise<void>;
	retrieveHistory: () => Promise<void>;
	clearHistory: () => Promise<void>;
	exportHistory: () => string;
}

const STORAGE_KEY = "pfa-operation-history";

export function useOperationHistory(): UseOperationHistoryReturn {
	const [history, setHistory] = useState<OperationRecord[]>([]);
	// U7:historyRef 是「最新数组」的同步真相源。recordOperation 同步追加到 ref,
	// state 更新与 storage 写入都从 ref 取值,这样同一渲染周期内的多次 recordOperation
	// 互不覆盖(此前从闭包 history 取值 + deps [history],后者会盖掉前者,双双丢记录)。
	const historyRef = useRef<OperationRecord[]>([]);

	const recordOperation = useCallback(
		async (operation: Omit<OperationRecord, "id" | "timestamp">) => {
			const record: OperationRecord = {
				...operation,
				id: crypto.randomUUID(),
				timestamp: new Date().toISOString(),
			};
			// 保留最近 100 条。
			const newHistory = [record, ...historyRef.current].slice(0, 100);
			historyRef.current = newHistory;
			setHistory(newHistory);
			try {
				const storage = getStorage();
				if (storage) {
					await storage.set({ [STORAGE_KEY]: newHistory });
				}
			} catch {
				// 静默失败
			}
		},
		[],
	);

	const retrieveHistory = useCallback(async () => {
		try {
			const storage = getStorage();
			if (storage) {
				const result = await storage.get<Record<string, unknown>>(STORAGE_KEY);
				const restored =
					(result?.[STORAGE_KEY] as OperationRecord[] | undefined) ?? [];
				historyRef.current = restored;
				setHistory(restored);
			}
		} catch {
			// 静默失败
		}
	}, []);

	const clearHistory = useCallback(async () => {
		historyRef.current = [];
		setHistory([]);
		try {
			const storage = getStorage();
			if (storage) {
				await storage.remove(STORAGE_KEY);
			}
		} catch {
			// 静默失败
		}
	}, []);

	const exportHistory = useCallback(() => {
		return JSON.stringify(history, null, 2);
	}, [history]);

	return {
		history,
		recordOperation,
		retrieveHistory,
		clearHistory,
		exportHistory,
	};
}
