import type { PendingTopic } from "../../../lib/pending-client";

interface Props {
	topics: PendingTopic[];
	busy: boolean;
	onConfirm: () => void;
	onCancel: () => void;
}

// 受控展示组件:今日一键备稿确认 banner(显示最高分选题 + 确认/取消)。
// quickDraftConfirm state 与两个 handler 全留 PendingTopicsView 主组件;此处只触发回调。
// banner 容器、inline style、文案逐字保留拆分前 PendingTopicsView.tsx 的行为。
export function GenerateConfirmDialog({
	topics,
	busy,
	onConfirm,
	onCancel,
}: Props) {
	return (
		<div className="banner-info" style={{ marginBottom: "var(--space-md)" }}>
			<div
				className="font-semibold"
				style={{ marginBottom: "var(--space-lg)" }}
			>
				将为最高分选题生成草稿：
			</div>
			<ul
				style={{
					margin: "0 0 var(--space-md) 0",
					paddingLeft: "var(--space-xl)",
				}}
			>
				{topics.map((t) => (
					<li
						key={t.id}
						style={{
							marginBottom: "var(--space-xs)",
							fontSize: "var(--font-sm)",
							color: "var(--color-text)",
						}}
					>
						{t.title || t.sourceUrl}
					</li>
				))}
			</ul>
			<div style={{ display: "flex", gap: "var(--space-md)" }}>
				<button
					type="button"
					onClick={onConfirm}
					disabled={busy}
					className="btn btn-primary btn-sm"
				>
					确认生成
				</button>
				<button
					type="button"
					onClick={onCancel}
					disabled={busy}
					className="btn btn-plain btn-sm"
				>
					取消
				</button>
			</div>
		</div>
	);
}
