import { useState } from "react";

interface Shortcut {
	keys: string;
	description: string;
}

const shortcuts: Shortcut[] = [
	{ keys: "Ctrl + Enter", description: "生成草稿" },
	{ keys: "Ctrl + Shift + Enter", description: "填充到当前页" },
	{ keys: "Ctrl + →", description: "下一条" },
	{ keys: "Ctrl + S", description: "保存" },
];

export function KeyboardShortcutsHelp() {
	const [isOpen, setIsOpen] = useState(false);

	return (
		<>
			<button
				type="button"
				aria-label="快捷键帮助"
				onClick={() => setIsOpen(true)}
				className="btn-icon text-close"
				style={{ fontSize: "var(--font-sm)", padding: "0 var(--space-sm)" }}
			>
				?
			</button>

			{isOpen && (
				<div
					role="dialog"
					style={{
						position: "fixed",
						top: 0,
						left: 0,
						right: 0,
						bottom: 0,
						background: "rgba(0, 0, 0, 0.5)",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						zIndex: 1000,
					}}
					onClick={(e) => {
						if (e.target === e.currentTarget) {
							setIsOpen(false);
						}
					}}
					onKeyDown={(e) => {
						if (e.key === "Escape") {
							setIsOpen(false);
						}
					}}
				>
					<div
						className="glass-panel"
						style={{
							padding: "var(--space-xl)",
							maxWidth: 400,
							width: "100%",
						}}
					>
						<div
							className="flex-between"
							style={{ marginBottom: "var(--space-lg)" }}
						>
							<h3 className="text-xl" style={{ margin: 0 }}>
								快捷键帮助
							</h3>
							<button
								type="button"
								aria-label="关闭"
								onClick={() => setIsOpen(false)}
								className="btn-icon text-close"
								style={{ fontSize: "var(--font-xl)" }}
							>
								×
							</button>
						</div>

						<div
							style={{
								display: "flex",
								flexDirection: "column",
								gap: "var(--space-md)",
							}}
						>
							{shortcuts.map((shortcut) => (
								<div
									key={shortcut.keys}
									className="flex-between"
									style={{
										padding: "var(--space-md) 0",
										borderBottom: "1px solid var(--color-border-lighter)",
									}}
								>
									<span className="font-medium">{shortcut.keys}</span>
									<span className="text-secondary">{shortcut.description}</span>
								</div>
							))}
						</div>
					</div>
				</div>
			)}
		</>
	);
}
