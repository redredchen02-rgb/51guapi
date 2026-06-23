import { useState } from "react";

export function useTopicEditing() {
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [localFacts, setLocalFacts] = useState<
		Record<string, Record<string, string>>
	>({});

	function toggleExpand(id: string, facts: Record<string, string>) {
		setExpanded((prev) => {
			const next = new Set(prev);
			next.has(id) ? next.delete(id) : next.add(id);
			return next;
		});
		setLocalFacts((prev) => {
			if (prev[id] !== undefined) return prev;
			return { ...prev, [id]: { ...facts } };
		});
	}

	function setFactField(id: string, key: string, value: string) {
		setLocalFacts((prev) => ({
			...prev,
			[id]: { ...(prev[id] ?? {}), [key]: value },
		}));
	}

	return { expanded, localFacts, toggleExpand, setFactField };
}
