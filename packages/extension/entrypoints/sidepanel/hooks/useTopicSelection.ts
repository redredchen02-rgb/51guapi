import { useCallback, useState } from "react";

export function useTopicSelection() {
	const [selected, setSelected] = useState<Set<string>>(new Set());

	const toggleSelect = useCallback((id: string) => {
		setSelected((prev) => {
			const next = new Set(prev);
			next.has(id) ? next.delete(id) : next.add(id);
			return next;
		});
	}, []);

	return { selected, setSelected, toggleSelect };
}
