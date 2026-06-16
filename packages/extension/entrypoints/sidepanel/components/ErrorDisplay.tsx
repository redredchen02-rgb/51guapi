import { useState } from "react";

interface ErrorDisplayProps {
	message: string;
	solution?: string;
	details?: string;
	onRetry?: () => void;
	onDismiss?: () => void;
}

export function ErrorDisplay({
	message,
	solution,
	details,
	onRetry,
	onDismiss,
}: ErrorDisplayProps) {
	const [showDetails, setShowDetails] = useState(false);

	return (
		<div className="banner-error" role="alert">
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "flex-start",
				}}
			>
				<div>
					<div
						className="text-error font-semibold"
						style={{ marginBottom: "var(--space-sm)" }}
					>
						{message}
					</div>
					{solution && (
						<div
							className="text-muted"
							style={{ marginBottom: "var(--space-sm)" }}
						>
							{solution}
						</div>
					)}
				</div>
				<div style={{ display: "flex", gap: "var(--space-md)" }}>
					{onRetry && (
						<button
							type="button"
							onClick={onRetry}
							className="btn btn-danger btn-sm"
						>
							重试
						</button>
					)}
					{onDismiss && (
						<button
							type="button"
							onClick={onDismiss}
							aria-label="关闭"
							className="btn-icon text-muted"
							style={{ fontSize: "var(--font-sm)" }}
						>
							关闭
						</button>
					)}
				</div>
			</div>

			{details && (
				<div style={{ marginTop: "var(--space-md)" }}>
					<button
						type="button"
						onClick={() => setShowDetails(!showDetails)}
						className="btn-icon text-info"
						style={{ fontSize: "var(--font-sm)", padding: 0 }}
					>
						{showDetails ? "隐藏详情" : "显示详情"}
					</button>
					{showDetails && (
						<pre
							className="banner-warning"
							style={{
								marginTop: "var(--space-sm)",
								fontSize: "var(--font-xs)",
								overflowX: "auto",
								whiteSpace: "pre-wrap",
							}}
						>
							{details}
						</pre>
					)}
				</div>
			)}
		</div>
	);
}
