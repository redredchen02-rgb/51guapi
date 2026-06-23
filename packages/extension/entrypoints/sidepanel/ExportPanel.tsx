import type { ContentDraft, GossipFactsBlock } from "@51guapi/shared";
import { useEffect, useRef, useState } from "react";
import {
	copyToClipboard,
	downloadFile,
	exportDraftAsJSON,
	exportDraftAsMarkdown,
	safeFilename,
} from "../../lib/export.js";

/** 單條草稿導出面板:JSON / Markdown 下載 + 複製到剪貼板。 */
export function ExportPanel({
	draft,
	facts,
}: {
	draft: ContentDraft;
	facts?: GossipFactsBlock | null;
}) {
	const [hint, setHint] = useState<string>("");
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// 卸载时清掉未触发的 timer,避免 unmount 后 setState 警告
	useEffect(() => {
		return () => {
			if (timerRef.current) clearTimeout(timerRef.current);
		};
	}, []);

	const flash = (msg: string) => {
		// 快速重 flash 时先清旧 timer,防止旧的 2s 倒计时提前清空新提示
		if (timerRef.current) clearTimeout(timerRef.current);
		setHint(msg);
		timerRef.current = setTimeout(() => setHint(""), 2000);
	};

	const onExportJSON = () => {
		downloadFile(
			safeFilename(draft, "json"),
			exportDraftAsJSON(draft, facts),
			"application/json",
		);
		flash("已导出 JSON");
	};

	const onExportMarkdown = () => {
		downloadFile(
			safeFilename(draft, "md"),
			exportDraftAsMarkdown(draft, facts),
			"text/markdown",
		);
		flash("已导出 Markdown");
	};

	const onCopyMarkdown = async () => {
		try {
			await copyToClipboard(exportDraftAsMarkdown(draft, facts));
			flash("已复制到剪贴板");
		} catch {
			flash("复制失败");
		}
	};

	return (
		<div className="export-panel" style={{ marginTop: "var(--space-lg)" }}>
			<div className="field-label">导出</div>
			<div
				style={{ display: "flex", gap: "var(--space-sm)", flexWrap: "wrap" }}
			>
				<button type="button" onClick={onExportJSON}>
					导出 JSON
				</button>
				<button type="button" onClick={onExportMarkdown}>
					导出 Markdown
				</button>
				<button type="button" onClick={onCopyMarkdown}>
					复制
				</button>
			</div>
			{hint && (
				<div
					className="text-sm text-muted"
					style={{ marginTop: "var(--space-sm)" }}
				>
					{hint}
				</div>
			)}
		</div>
	);
}
