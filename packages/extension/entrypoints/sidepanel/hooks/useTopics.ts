import { useCallback, useEffect, useState } from "react";
import {
	fetchPendingTopics,
	type PendingTopic,
} from "../../../lib/pending-client";

export function useTopics(selectedTheme: string | null) {
	const [topics, setTopics] = useState<PendingTopic[]>([]);
	const [loading, setLoading] = useState(true);
	const [hideLowScore, setHideLowScore] = useState(false);

	const refresh = useCallback(async () => {
		setLoading(true);
		const list = selectedTheme
			? await fetchPendingTopics({
					status: "pending",
					domain: "gossip",
					sort_by: "score",
					theme: selectedTheme,
					verified: true,
				})
			: await fetchPendingTopics({
					status: "pending",
					sort_by: "score",
					domain: "gossip",
				});
		setTopics(list);
		setLoading(false);
	}, [selectedTheme]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	return { topics, loading, hideLowScore, setHideLowScore, refresh };
}
