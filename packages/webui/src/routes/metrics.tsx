import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/metrics")({
	component: MetricsPage,
});

function MetricsPage() {
	return (
		<div className="p-6">
			<h1 className="text-2xl font-semibold text-foreground">運行狀態</h1>
			<p className="mt-2 text-muted-foreground">即將實作（U8）</p>
		</div>
	);
}
