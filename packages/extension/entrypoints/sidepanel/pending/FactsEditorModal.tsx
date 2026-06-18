import { GOSSIP_FACT_KEYS } from "@51guapi/shared";
import React from "react";
import type { PendingTopic } from "../../../lib/pending-client";

interface Props {
	topic: PendingTopic;
	/** localFacts[topic.id] 切片(主组件持有);undefined 时回落 topic.facts[key]。 */
	editedFacts: Record<string, string> | undefined;
	busy: boolean;
	onFactChange: (key: string, value: string) => void;
}

// 受控展示组件:展开后的事实编辑表单(置信度 + 封面 + 可编辑事实字段 + 原始内容)。
// localFacts state 留 PendingTopicsView 主组件;此处无自持 facts state,
// 读 props.editedFacts(回落 topic.facts),改动经 props.onFactChange 上抛主组件。
// 容器/inline style/文案/字段回落逻辑逐字保留拆分前 PendingTopicsView.tsx 的行为。
export function FactsEditorModal({
	topic,
	editedFacts,
	busy,
	onFactChange,
}: Props) {
	return (
		<div
			className="expand-enter"
			style={{
				padding: "var(--space-lg) var(--space-xl)",
				fontSize: "var(--font-sm)",
				borderTop: "1px solid var(--color-border-lighter)",
			}}
		>
			{/* Unit 6: 质量信号 */}
			{topic.confidence != null && (
				<div
					style={{
						marginBottom: "var(--space-md)",
						fontSize: "var(--font-xs)",
						color:
							topic.confidence >= 0.7
								? "var(--color-success)"
								: topic.confidence >= 0.4
									? "var(--color-warning)"
									: "var(--color-text-disabled)",
					}}
				>
					置信度 {Math.round(topic.confidence * 100)}%
					{topic.extractionMode ? ` · ${topic.extractionMode}` : ""}
				</div>
			)}
			{topic.coverImageUrl && (
				<img
					src={topic.coverImageUrl}
					alt="封面"
					style={{
						maxHeight: 60,
						marginBottom: "var(--space-lg)",
						objectFit: "cover",
						borderRadius: "var(--radius-sm)",
					}}
				/>
			)}
			<div>
				<strong>事实（可编辑）:</strong>
				<div
					style={{
						marginTop: "var(--space-sm)",
						display: "grid",
						gridTemplateColumns: "5em 1fr",
						gap: "3px var(--space-lg)",
						alignItems: "center",
					}}
				>
					{GOSSIP_FACT_KEYS.map((key) => {
						const rawVal = topic.facts[key];
						const isNull = rawVal == null || rawVal === "";
						return (
							<React.Fragment key={key}>
								<div
									className="text-xs text-muted"
									style={{ textAlign: "right" }}
								>
									{isNull && (
										<span
											style={{
												color: "var(--color-warning)",
												marginRight: 2,
											}}
											title="待补充"
										>
											⚠
										</span>
									)}
									{key}
								</div>
								<input
									type="text"
									className="field-input"
									value={editedFacts?.[key] ?? rawVal ?? ""}
									onChange={(e) => onFactChange(key, e.target.value)}
									disabled={busy}
									style={{
										fontSize: "var(--font-xs)",
										padding: "1px var(--space-sm)",
									}}
								/>
							</React.Fragment>
						);
					})}
				</div>
			</div>
			{topic.rawContent?.body && (
				<div
					style={{
						marginTop: "var(--space-lg)",
						maxHeight: 120,
						overflow: "auto",
						color: "var(--color-text-muted)",
						fontSize: "var(--font-xs)",
					}}
				>
					<strong>原始内容(前300字):</strong>
					<div style={{ marginTop: "var(--space-xs)" }}>
						{topic.rawContent.body.slice(0, 300)}…
					</div>
				</div>
			)}
		</div>
	);
}
