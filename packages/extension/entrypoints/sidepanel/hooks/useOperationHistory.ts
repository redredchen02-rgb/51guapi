import { useCallback, useState } from "react";
import { getStorage } from "../../../lib/chrome-storage-utils";

interface OperationRecord {
	id: string;
	type: "generate" | "fill" | "publish" | "error";
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

	const recordOperation = useCallback(
		async (operation: Omit<OperationRecord, "id" | "timestamp">) => {
			const record: OperationRecord = {
				...operation,
				id: crypto.randomUUID(),
				timestamp: new Date().toISOString(),
			};

			setHistory((prev) => {
				const newHistory = [record, ...prev].slice(0, 100); // 保留最近 100 条
				return newHistory;
			});
		},
		[],
	);

	const retrieveHistory = useCallback(async () => {
		try {
			const storage = getStorage();
			if (storage) {
				const result = await storage.get<Record<string, unknown>>(STORAGE_KEY);
				setHistory(
					(result?.[STORAGE_KEY] as OperationRecord[] | undefined) ?? [],
				);
			}
		} catch {
			// 静默失败
		}
	}, []);

	const clearHistory = useCallback(async () => {
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
