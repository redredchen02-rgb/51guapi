interface Props {
	message?: string;
}

export function Loading({ message = "加载中…" }: Props) {
	return (
		<div
			role="status"
			aria-live="polite"
			className="flex-col flex-center"
			style={{
				gap: "var(--space-xl)",
				padding: "var(--space-2xl)",
				color: "var(--color-text-muted)",
			}}
		>
			<div className="spinner" />
			<span>{message}</span>
		</div>
	);
}
