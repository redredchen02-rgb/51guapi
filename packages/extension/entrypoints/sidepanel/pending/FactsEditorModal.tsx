import { GOSSIP_FACT_KEYS } from "@51guapi/shared";
import React from "react";
import type { PendingTopic } from "../../../lib/pending-client";

interface Props {
	topic: PendingTopic;
	/** localFacts[topic.id] 切片(主组件持有);undefined 时回落 topic.facts[key]。 */
	editedFacts: Record<string, string> | undefined;
	busy: boolean;
	onFactChange: (key: string, value: string) => void;
	/** 人工二次核对:点「确认核对」→ 置 verified（进题材池）。U4。 */
	onVerify?: () => void;
	verifying?: boolean;
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
	onVerify,
	verifying,
}: Props) {
	// 未溯源字段（验证关 grounding 判定）:改值后由后端 PATCH 重跑 grounding 刷新。
	const unsourced = new Set(topic.verification?.grounding?.unsourced ?? []);
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
			{(() => {
				const entities = (editedFacts?.當事人 ?? topic.facts.當事人 ?? "")
					.split(/[,，]/)
					.map((s) => s.trim())
					.filter(Boolean);
				if (entities.length === 0) return null;
				return (
					<div
						style={{
							marginBottom: "var(--space-md)",
							padding: "var(--space-md)",
							backgroundColor: "rgba(0, 0, 0, 0.02)",
							borderRadius: "var(--radius-md)",
							border: "1px dashed var(--color-border-lighter)",
						}}
					>
						<div
							className="font-semibold text-xs text-muted"
							style={{ marginBottom: "var(--space-xs)" }}
						>
							👥 当事人图谱:
						</div>
						<div
							style={{
								display: "flex",
								flexWrap: "wrap",
								alignItems: "center",
								gap: "var(--space-xs)",
							}}
						>
							{entities.map((name, idx) => (
								<React.Fragment key={name}>
									{idx > 0 && (
										<span
											style={{
												color: "var(--color-primary)",
												fontWeight: "bold",
											}}
										>
											↔
										</span>
									)}
									<span
										style={{
											background: "rgba(24, 144, 255, 0.1)",
											color: "#1890ff",
											padding: "2px 8px",
											borderRadius: "var(--radius-sm)",
											fontSize: "var(--font-xs)",
											fontWeight: "bold",
										}}
									>
										{name}
									</span>
								</React.Fragment>
							))}
						</div>
					</div>
				);
			})()}
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
									{unsourced.has(key) && (
										<span
											style={{
												color: "var(--color-error, #cf1322)",
												marginRight: 2,
											}}
											title="未溯源:原文中找不到此值，改值后会自动重新核验"
										>
											⛔
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
			{onVerify && (
				<div
					style={{
						marginTop: "var(--space-lg)",
						display: "flex",
						alignItems: "center",
						gap: "var(--space-md)",
					}}
				>
					{topic.verifiedAt ? (
						<span className="text-xs" style={{ color: "var(--color-success)" }}>
							✅ 已核对 · 已进题材池
						</span>
					) : (
						<button
							type="button"
							className="btn btn-sm btn-primary"
							onClick={onVerify}
							disabled={busy || verifying}
						>
							{verifying ? "确认中…" : "确认核对（进题材池）"}
						</button>
					)}
				</div>
			)}
		</div>
	);
}
