type Mode = "empty" | "generating" | "draft";

interface Props {
	mode: Mode;
	busy: boolean;
	hasDraft: boolean;
	onGenerate: () => void;
	onCopy: () => void;
	onNext: () => void;
}

// 受控展示组件:生成草稿 / 复制正文 / 下一条 按钮组(按 mode/draft 条件渲染)。
// handler 全在 App 主组件;此处只触发回调。外层 flex 容器、inline style、文案逐字保留。
export function DraftActionButtons({
	mode,
	busy,
	hasDraft,
	onGenerate,
	onCopy,
	onNext,
}: Props) {
	return (
		<div
			style={{
				display: "flex",
				gap: "var(--space-md)",
				marginTop: "var(--space-xl)",
			}}
		>
			{(mode === "empty" || mode === "generating" || mode === "draft") && (
				<button
					type="button"
					onClick={onGenerate}
					disabled={busy}
					className="btn btn-primary"
				>
					生成草稿
				</button>
			)}
			{hasDraft && (
				<button
					type="button"
					onClick={onCopy}
					disabled={busy}
					className="btn btn-plain"
				>
					复制正文
				</button>
			)}
			{hasDraft && (
				<button
					type="button"
					onClick={onNext}
					disabled={busy}
					className="btn btn-plain"
				>
					下一条
				</button>
			)}
		</div>
	);
}
