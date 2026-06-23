import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/draft")({
	component: DraftPage,
});

function DraftPage() {
	return (
		<div className="p-6">
			<h1 className="text-2xl font-semibold text-foreground">草稿編輯器</h1>
			<p className="mt-2 text-muted-foreground">即將實作（U6）</p>
		</div>
	);
}
