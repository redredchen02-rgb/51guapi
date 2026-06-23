import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/channels")({
	component: ChannelsPage,
});

function ChannelsPage() {
	return (
		<div className="p-6">
			<h1 className="text-2xl font-semibold text-foreground">渠道管理</h1>
			<p className="mt-2 text-muted-foreground">即將實作（U7）</p>
		</div>
	);
}
