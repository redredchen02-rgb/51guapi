interface Props {
	busy: boolean;
	topicsEmpty: boolean;
	quickDraftStatus: string;
	onQuickDraft: () => void;
	onExportCsv: () => void;
	onRefresh: () => void;
	onBack: () => void;
}

export function TopicsToolbar({
	busy,
	topicsEmpty,
	quickDraftStatus,
	onQuickDraft,
	onExportCsv,
	onRefresh,
	onBack,
}: Props) {
	return (
		<nav className="flex-between mb-md">
			<h1 style={{ fontSize: "var(--font-xl)", margin: 0 }}>待审核选题</h1>
			<div className="flex gap-sm" style={{ alignItems: "center" }}>
				<button
					type="button"
					disabled={busy}
					onClick={onQuickDraft}
					className="btn btn-primary btn-sm"
				>
					{quickDraftStatus === "备稿中…" ? "备稿中…" : "今日一键备稿"}
				</button>
				<button
					type="button"
					disabled={topicsEmpty}
					onClick={onExportCsv}
					className="btn btn-plain btn-sm"
				>
					导出 CSV
				</button>
				<button
					type="button"
					onClick={onRefresh}
					className="btn btn-plain btn-sm"
				>
					↻ 刷新
				</button>
				<button type="button" onClick={onBack} className="btn btn-plain btn-sm">
					← 返回
				</button>
			</div>
		</nav>
	);
}
