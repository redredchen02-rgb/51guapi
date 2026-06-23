interface Props {
	selectedCount: number;
	busy: boolean;
	approveError: string | null;
	onApprove: () => void;
	onReject: () => void;
	onRetryApprove: () => void;
}

export function BulkActionBar({
	selectedCount,
	busy,
	approveError,
	onApprove,
	onReject,
	onRetryApprove,
}: Props) {
	return (
		<>
			{approveError && (
				<div
					role="alert"
					style={{
						marginTop: "var(--space-md)",
						padding: "var(--space-md) var(--space-lg)",
						background: "var(--color-error-bg, #fff2f0)",
						border: "1px solid var(--color-error, #cf1322)",
						borderRadius: "var(--radius-md)",
						fontSize: "var(--font-sm)",
						color: "var(--color-error, #cf1322)",
						display: "flex",
						alignItems: "center",
						gap: "var(--space-md)",
					}}
				>
					<span style={{ flex: 1 }}>{approveError}</span>
					<button
						type="button"
						className="btn btn-plain btn-sm"
						onClick={onRetryApprove}
						disabled={busy || selectedCount === 0}
						style={{ whiteSpace: "nowrap", flexShrink: 0 }}
					>
						重试生成草稿
					</button>
				</div>
			)}
			<div
				style={{
					display: "flex",
					gap: "var(--space-md)",
					marginTop: "var(--space-xl)",
				}}
			>
				<button
					type="button"
					onClick={onApprove}
					disabled={selectedCount === 0 || busy}
					className="btn btn-primary"
				>
					{busy ? "生成中…" : `批准并生成草稿 (${selectedCount})`}
				</button>
				<button
					type="button"
					onClick={onReject}
					disabled={selectedCount === 0 || busy}
					className="btn btn-plain"
					style={{
						borderColor: "var(--color-border)",
						color:
							selectedCount > 0 && !busy
								? "var(--color-error)"
								: "var(--color-text-disabled)",
					}}
				>
					拒绝
				</button>
			</div>
		</>
	);
}
