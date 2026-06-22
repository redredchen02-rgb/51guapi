import { useCallback, useRef, useState } from "react";
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
	// U7:logsRef 是「最新数组」的同步真相源。logError 同步追加到 ref,
	// state 更新与 storage 写入都从 ref 取值,这样同一渲染周期内的多次 logError
	// 互不覆盖(此前从闭包 logs 取值 + deps [logs],后者会盖掉前者,双双丢记录)。
	const logsRef = useRef<ErrorLog[]>([]);

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
			// 结构化字段,不写响应体/密钥。持久化失败静默,绝不影响主流程。
			const newLogs = [log, ...logsRef.current].slice(0, 100);
			logsRef.current = newLogs;
			setLogs(newLogs);
			try {
				const storage = getStorage();
				if (storage) await storage.set({ [STORAGE_KEY]: newLogs });
			} catch {
				// 静默失败
			}
		},
		[],
	);

	const retrieveLogs = useCallback(async () => {
		try {
			const storage = getStorage();
			if (storage) {
				const result = await storage.get<Record<string, unknown>>(STORAGE_KEY);
				const restored =
					(result?.[STORAGE_KEY] as ErrorLog[] | undefined) ?? [];
				logsRef.current = restored;
				setLogs(restored);
			}
		} catch {
			// 静默失败
		}
	}, []);

	const clearLogs = useCallback(async () => {
		logsRef.current = [];
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
