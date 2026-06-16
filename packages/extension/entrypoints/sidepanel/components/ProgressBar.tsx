interface ProgressBarProps {
	progress: number;
	label?: string;
	indeterminate?: boolean;
}

export function ProgressBar({
	progress,
	label,
	indeterminate,
}: ProgressBarProps) {
	return (
		<div
			style={{
				width: "100%",
				height: 8,
				background: "var(--color-border-lighter)",
				borderRadius: "var(--radius-md)",
				overflow: "hidden",
				position: "relative",
			}}
		>
			<div
				role="progressbar"
				aria-valuenow={indeterminate ? undefined : progress}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuetext={indeterminate ? "加载中…" : undefined}
				style={
					indeterminate
						? {
								position: "absolute",
								width: "40%",
								height: "100%",
								background: "var(--color-info)",
								borderRadius: "var(--radius-md)",
								animation: "progress-indeterminate 1.4s ease infinite",
							}
						: {
								width: `${progress}%`,
								height: "100%",
								background: "var(--color-info)",
								transition: "width 0.3s ease",
							}
				}
			/>
			{label && (
				<div
					className="text-sm text-secondary"
					style={{ marginTop: "var(--space-sm)" }}
				>
					{label}
				</div>
			)}
		</div>
	);
}
