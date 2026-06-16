import type { ContentDraft } from "@51guapi/shared";
import { useCallback, useEffect, useRef } from "react";
import { logger } from "../../../lib/logger";
import { saveCurrentDraft } from "../../../lib/storage";

interface UseAutoSaveReturn {
	saveDraft: (draft: ContentDraft, immediate?: boolean) => void;
}

export function useAutoSave(delay = 1000): UseAutoSaveReturn {
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const saveDraft = useCallback(
		(draft: ContentDraft, immediate = false) => {
			if (timerRef.current) {
				clearTimeout(timerRef.current);
			}

			const doSave = () => {
				const result = saveCurrentDraft(draft);
				if (result && typeof result.catch === "function") {
					result.catch((e: unknown) =>
						logger.error(
							"useAutoSave",
							e instanceof Error ? e.message : String(e),
						),
					);
				}
			};

			if (immediate) {
				doSave();
			} else {
				timerRef.current = setTimeout(doSave, delay);
			}
		},
		[delay],
	);

	useEffect(() => {
		return () => {
			if (timerRef.current) clearTimeout(timerRef.current);
		};
	}, []);

	return { saveDraft };
}
