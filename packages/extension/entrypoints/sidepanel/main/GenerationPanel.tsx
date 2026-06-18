import { ProgressBar } from "../components/ProgressBar";

type Mode = "empty" | "generating" | "draft";

interface Props {
	mode: Mode;
	topic: string;
	busy: boolean;
	hasDraft: boolean;
	progress: number;
	progressLabel: string;
	onTopicChange: (v: string) => void;
	onCancel: () => void;
}

// 受控展示组件:主题 textarea + 生成进度条/取消(mode-aware)。
// topic/mode/loadingState 全在 App 主组件;此处只按 mode 条件渲染。
// 条件表达式、inline style、文案逐字保留拆分前 App.tsx 的行为。
export function GenerationPanel({
	mode,
	topic,
	busy,
	hasDraft,
	progress,
	progressLabel,
	onTopicChange,
	onCancel,
}: Props) {
	return (
		<>
			{(mode === "empty" ||
				mode === "generating" ||
				(mode === "draft" && !hasDraft)) && (
				<div style={{ marginBottom: "var(--space-lg)" }}>
					<textarea
						className="field-input"
						style={{ minHeight: 60, padding: "var(--space-lg)" }}
						placeholder="输入选题/主题,例如:介绍某条吃瓜素材的看点"
						value={topic}
						disabled={busy}
						onChange={(e) => onTopicChange(e.target.value)}
					/>
				</div>
			)}

			{mode === "generating" && (
				<div style={{ marginBottom: "var(--space-lg)" }}>
					<ProgressBar progress={progress} label={progressLabel} />
					<button
						type="button"
						onClick={onCancel}
						className="btn btn-plain btn-sm"
						style={{ marginTop: "var(--space-lg)" }}
					>
						取消
					</button>
				</div>
			)}
		</>
	);
}
