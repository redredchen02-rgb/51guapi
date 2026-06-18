interface LogEntry {
	id: string;
	message: string;
	timestamp: string;
}

interface Props {
	logs: LogEntry[];
	onExport: () => void;
	onClear: () => void;
}

// 受控展示组件:错误日志列表 + 导出/清空。logs 与导出/清空逻辑全在 App 主组件。
// 仅在 App 中 showLogs 为真时挂载。inline style/文案/className 逐字保留。
export function LogPanel({ logs, onExport, onClear }: Props) {
	return (
		<div
			className="card surface-muted"
			style={{
				maxHeight: 200,
				overflowY: "auto",
				marginBottom: "var(--space-lg)",
			}}
		>
			<div className="flex-between" style={{ marginBottom: "var(--space-md)" }}>
				<span className="font-semibold">错误日志</span>
				<div style={{ display: "flex", gap: "var(--space-md)" }}>
					<button
						type="button"
						onClick={onExport}
						className="btn-icon text-info"
						style={{ fontSize: "var(--font-sm)" }}
					>
						导出
					</button>
					<button
						type="button"
						onClick={onClear}
						className="btn-icon text-error"
						style={{ fontSize: "var(--font-sm)" }}
					>
						清空
					</button>
				</div>
			</div>

			{logs.length === 0 ? (
				<div className="text-muted">暂无错误日志</div>
			) : (
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: "var(--space-md)",
					}}
				>
					{logs.map((log) => (
						<div
							key={log.id}
							className="surface-elevated"
							style={{ padding: "var(--space-md)" }}
						>
							<div
								className="text-error"
								style={{ marginBottom: "var(--space-sm)" }}
							>
								{log.message}
							</div>
							<div className="text-muted text-xs">
								{new Date(log.timestamp).toLocaleString()}
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
