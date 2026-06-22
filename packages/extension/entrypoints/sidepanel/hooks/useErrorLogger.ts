import { useCallback, useState } from "react";
import { getStorage } from "../../../lib/chrome-storage-utils";

interface ErrorLog {
	id: string;
	message: string;
	stack?: string;
	context?: Record<string, unknown>;
	timestamp: string;
}

interface UseErrorLoggerReturn {
	logs: ErrorLog[];
	logError: (error: Error, context?: Record<string, unknown>) => Promise<void>;
	retrieveLogs: () => Promise<void>;
	clearLogs: () => Promise<void>;
	exportLogs: () => string;
}

const STORAGE_KEY = "pfa-error-logs";

export function useErrorLogger(): UseErrorLoggerReturn {
	const [logs, setLogs] = useState<ErrorLog[]>([]);

	const logError = useCallback(
		async (error: Error, context?: Record<string, unknown>) => {
			const log: ErrorLog = {
				id: crypto.randomUUID(),
				message: error.message,
				stack: error.stack,
				context,
				timestamp: new Date().toISOString(),
			};
			// A14(R14):持久化到 chrome.storage —— 此前只 setLogs,刷新 side panel 即丢日志。
			// 先算 newLogs 再 setLogs + storage.set(仿 useOperationHistory);结构化字段,
			// 不写响应体/密钥。持久化失败静默,绝不影响主流程。
			const newLogs = [log, ...logs].slice(0, 100);
			setLogs(newLogs);
			try {
				const storage = getStorage();
				if (storage) await storage.set({ [STORAGE_KEY]: newLogs });
			} catch {
				// 静默失败
			}
		},
		[logs],
	);

	const retrieveLogs = useCallback(async () => {
		try {
			const storage = getStorage();
			if (storage) {
				const result = await storage.get<Record<string, unknown>>(STORAGE_KEY);
				setLogs((result?.[STORAGE_KEY] as ErrorLog[] | undefined) ?? []);
			}
		} catch {
			// 静默失败
		}
	}, []);

	const clearLogs = useCallback(async () => {
		setLogs([]);
		try {
			const storage = getStorage();
			if (storage) {
				await storage.remove(STORAGE_KEY);
			}
		} catch {
			// 静默失败
		}
	}, []);

	const exportLogs = useCallback(() => {
		return JSON.stringify(logs, null, 2);
	}, [logs]);

	return { logs, logError, retrieveLogs, clearLogs, exportLogs };
}
