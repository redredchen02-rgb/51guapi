import type { PendingTopic } from "../../../lib/pending-client";
import { FactsEditorModal } from "./FactsEditorModal";
import { VerificationBadge } from "./VerificationBadge";

interface Props {
	topic: PendingTopic;
	checked: boolean;
	expanded: boolean;
	/** localFacts[topic.id] 切片(主组件持有);传给展开后的事实编辑表单。 */
	editedFacts: Record<string, string> | undefined;
	busy: boolean;
	onToggleSelect: () => void;
	onToggleExpand: () => void;
	onFactChange: (key: string, value: string) => void;
	/** 人工二次核对回调（U4）;传入则展开区显示「确认核对」。 */
	onVerify?: () => void;
	verifying?: boolean;
}

// 受控展示组件:单条选题卡(checkbox + 标题/评分徽章 + 详情按钮 + 内嵌事实编辑表单)。
// selected/expanded/localFacts state 全留 PendingTopicsView 主组件;此处只触发回调、读 props。
// score 派生(score ?? confidence)、isHigh/isMed 阈值、inline style、文案逐字保留拆分前行为。
export function TopicListItem({
	topic,
	checked,
	expanded,
	editedFacts,
	busy,
	onToggleSelect,
	onToggleExpand,
	onFactChange,
	onVerify,
	verifying,
}: Props) {
	const score = topic.score ?? topic.confidence;
	const isHigh = score >= 0.7;
	const isMed = score >= 0.4 && score < 0.7;
	return (
		<li
			style={{
				border: `1px solid ${isHigh ? "var(--color-success)" : "var(--color-border-lighter)"}`,
				borderRadius: "var(--radius-md)",
				marginBottom: "var(--space-sm)",
				opacity: score < 0.3 ? 0.6 : 1,
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					padding: "var(--space-lg) var(--space-md)",
				}}
			>
				<input
					type="checkbox"
					checked={checked}
					onChange={onToggleSelect}
					style={{ marginRight: "var(--space-md)" }}
					disabled={busy}
				/>
				<div style={{ flex: 1, minWidth: 0 }}>
					<div
						className="font-semibold"
						style={{
							fontSize: "var(--font-base)",
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
							display: "flex",
							alignItems: "center",
							gap: 6,
						}}
					>
						{isHigh && (
							<span
								style={{
									fontSize: "var(--font-xs)",
									background: "var(--color-success)",
									color: "#fff",
									padding: "1px 5px",
									borderRadius: 4,
									flexShrink: 0,
								}}
							>
								高潜力
							</span>
						)}
						<span
							style={{
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
							}}
						>
							{topic.title || topic.sourceUrl}
						</span>
					</div>
					<div
						className="text-xs text-muted"
						style={{ marginTop: "var(--space-xs)" }}
					>
						{topic.siteName} ·{" "}
						<span
							style={{
								color: isHigh
									? "var(--color-success)"
									: isMed
										? "var(--color-warning)"
										: "var(--color-text-disabled)",
							}}
						>
							評分 {Math.round(score * 100)}
						</span>
						{" · "}
						{topic.sourceUrl.slice(0, 50)}
					</div>
					<VerificationBadge
						verification={topic.verification}
						verifiedAt={topic.verifiedAt}
					/>
				</div>
				<button
					type="button"
					onClick={onToggleExpand}
					aria-expanded={expanded}
					className="btn btn-plain btn-sm text-secondary"
				>
					{expanded ? "收起" : "详情"}
				</button>
			</div>

			{expanded && (
				<FactsEditorModal
					topic={topic}
					editedFacts={editedFacts}
					busy={busy}
					onFactChange={onFactChange}
					onVerify={onVerify}
					verifying={verifying}
				/>
			)}
		</li>
	);
}
