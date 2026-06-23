import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/pending")({
	component: PendingPage,
});

function PendingPage() {
	return (
		<div className="p-6">
			<h1 className="text-2xl font-semibold text-foreground">待審選題</h1>
			<p className="mt-2 text-muted-foreground">即將實作（U5）</p>
		</div>
	);
}
