import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/settings")({
	component: SettingsPage,
});

function SettingsPage() {
	return (
		<div className="p-6">
			<h1 className="text-2xl font-semibold text-foreground">設定</h1>
			<p className="mt-2 text-muted-foreground">即將實作（U9）</p>
		</div>
	);
}
