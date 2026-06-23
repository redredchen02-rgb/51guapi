import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { TopicFilters } from "@/components/pending/TopicFilters";
import { TopicsTable } from "@/components/pending/TopicsTable";
import { usePendingTopics } from "@/hooks/usePendingTopics";

export const Route = createFileRoute("/pending")({
	component: PendingPage,
});

function PendingPage() {
	const [status, setStatus] = useState<
		"pending" | "approved" | "rejected" | undefined
	>("pending");

	const { data: topics, isLoading } = usePendingTopics({
		status,
		domain: "gossip",
	});

	return (
		<div className="flex flex-col gap-4 p-6">
			<div className="flex items-center justify-between">
				<TopicFilters currentStatus={status} onStatusChange={setStatus} />
				{topics && (
					<span className="text-sm text-muted-foreground">
						共 {topics.length} 筆
					</span>
				)}
			</div>
			<div className="rounded-lg border border-border bg-background">
				<TopicsTable topics={topics} isLoading={isLoading} />
			</div>
		</div>
	);
}
