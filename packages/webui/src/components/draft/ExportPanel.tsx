import { assembleDraftJSON, assembleDraftMarkdown } from "@51guapi/shared";
import type { ContentDraft } from "@51guapi/shared";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ExportPanelProps {
	draft: ContentDraft;
}

function downloadFile(filename: string, content: string, mimeType: string) {
	const blob = new Blob([content], { type: mimeType });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

function safeFilename(title: string) {
	return title
		.slice(0, 40)
		.replace(/[/\\?%*:|"<>]/g, "_")
		.trim();
}

export function ExportPanel({ draft }: ExportPanelProps) {
	const base = safeFilename(draft.title);

	const exportJSON = () => {
		const exported = assembleDraftJSON(draft);
		downloadFile(`${base}.json`, JSON.stringify(exported, null, 2), "application/json");
	};

	const exportMarkdown = () => {
		const md = assembleDraftMarkdown(draft);
		downloadFile(`${base}.md`, md, "text/markdown");
	};

	return (
		<div className="flex gap-2">
			<Button variant="outline" size="sm" onClick={exportJSON}>
				<Download size={13} className="mr-1.5" />
				JSON
			</Button>
			<Button variant="outline" size="sm" onClick={exportMarkdown}>
				<Download size={13} className="mr-1.5" />
				Markdown
			</Button>
		</div>
	);
}
