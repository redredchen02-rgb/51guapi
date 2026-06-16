import { useCallback, useState } from "react";

interface UseLoadingStateReturn {
	progress: number;
	message: string;
	startLoading: (message: string) => void;
	updateProgress: (progress: number) => void;
	completeLoading: () => void;
}

export function useLoadingState(): UseLoadingStateReturn {
	const [progress, setProgress] = useState(0);
	const [message, setMessage] = useState("");

	const startLoading = useCallback((msg: string) => {
		setProgress(0);
		setMessage(msg);
	}, []);

	const updateProgress = useCallback((p: number) => {
		setProgress(p);
	}, []);

	const completeLoading = useCallback(() => {
		setProgress(0);
		setMessage("");
	}, []);

	return {
		progress,
		message,
		startLoading,
		updateProgress,
		completeLoading,
	};
}
