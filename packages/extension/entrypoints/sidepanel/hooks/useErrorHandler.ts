import { useCallback, useState } from "react";
import { logger } from "../../../lib/logger";

interface UseErrorHandlerReturn {
	error: string | null;
	handleError: (error: Error | string) => void;
	clearError: () => void;
}

export function useErrorHandler(): UseErrorHandlerReturn {
	const [error, setError] = useState<string | null>(null);

	const handleError = useCallback((err: Error | string) => {
		const message = err instanceof Error ? err.message : String(err);
		setError(message);
		logger.error("ErrorHandler", message);
	}, []);

	const clearError = useCallback(() => {
		setError(null);
	}, []);

	return {
		error,
		handleError,
		clearError,
	};
}
