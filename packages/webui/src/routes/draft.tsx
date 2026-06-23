import { createFileRoute } from "@tanstack/react-router";
import { DraftEditor } from "@/components/draft/DraftEditor";

export const Route = createFileRoute("/draft")({
	component: DraftPage,
});

function DraftPage() {
	return (
		<div className="p-6">
			<DraftEditor />
		</div>
	);
}
