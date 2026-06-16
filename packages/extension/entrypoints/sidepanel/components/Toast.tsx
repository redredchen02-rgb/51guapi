import { useEffect } from "react";

interface ToastProps {
	message: string;
	type: "success" | "error" | "info";
	onClose?: () => void;
	duration?: number;
}

const TOAST_CLASS: Record<ToastProps["type"], string> = {
	success: "banner-success",
	error: "banner-error",
	info: "banner-info",
};

export function Toast({ message, type, onClose, duration = 3000 }: ToastProps) {
	useEffect(() => {
		if (!onClose) return;
		const timer = setTimeout(onClose, duration);
		return () => clearTimeout(timer);
	}, [onClose, duration]);

	return (
		<div
			role="alert"
			className={`${TOAST_CLASS[type]} toast-enter`}
			style={{
				padding: "var(--space-md) var(--space-lg)",
				marginBottom: "var(--space-md)",
				display: "flex",
				justifyContent: "space-between",
				alignItems: "center",
				fontSize: "var(--font-base)",
			}}
		>
			<span>{message}</span>
			{onClose && (
				<button
					type="button"
					aria-label="关闭"
					onClick={onClose}
					className="btn-icon text-close"
					style={{ fontSize: "var(--font-md)", padding: "0 var(--space-sm)" }}
				>
					×
				</button>
			)}
		</div>
	);
}
