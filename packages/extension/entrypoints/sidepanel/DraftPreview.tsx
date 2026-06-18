import type { ContentDraft, GossipFactsBlock } from "@51guapi/shared";
import { DraftReviewPanel } from "./DraftReviewPanel.js";
import { ExportPanel } from "./ExportPanel.js";

function Field({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="field-group">
			<div className="field-label">{label}</div>
			{children}
		</div>
	);
}

export function DraftPreview({
	draft,
	onChange,
	facts,
}: {
	draft: ContentDraft;
	onChange: (d: ContentDraft) => void;
	facts?: GossipFactsBlock | null;
}) {
	const set = (patch: Partial<ContentDraft>) =>
		onChange({ ...draft, ...patch });
	return (
		<div>
			<Field label="标题">
				<input
					className="field-input"
					value={draft.title}
					onChange={(e) => set({ title: e.target.value })}
				/>
			</Field>
			<Field label="副标题">
				<input
					className="field-input"
					value={draft.subtitle}
					onChange={(e) => set({ subtitle: e.target.value })}
				/>
			</Field>
			<Field label="分类(瓜的类型,如 出軌/塌房/緋聞)">
				<input
					className="field-input"
					value={draft.category}
					onChange={(e) => set({ category: e.target.value })}
				/>
			</Field>
			<Field label="标签(逗号分隔)">
				<input
					className="field-input"
					value={draft.tags.join(", ")}
					onChange={(e) =>
						set({
							tags: e.target.value
								.split(",")
								.map((t) => t.trim())
								.filter(Boolean),
						})
					}
				/>
			</Field>
			<Field label="描述">
				<textarea
					className="field-input"
					style={{ minHeight: 44 }}
					value={draft.description}
					onChange={(e) => set({ description: e.target.value })}
				/>
			</Field>
			<Field label="正文(HTML 源码)">
				<textarea
					className="field-input"
					style={{ minHeight: 120, fontFamily: "monospace" }}
					value={draft.body}
					onChange={(e) => set({ body: e.target.value })}
				/>
			</Field>
			<details style={{ marginBottom: "var(--space-md)" }}>
				<summary className="text-sm text-muted" style={{ cursor: "pointer" }}>
					非 AI 字段(人工设定)
				</summary>
				<div style={{ marginTop: "var(--space-lg)" }}>
					<Field label="封面图 URL(仅预览,MVP 不自动填,请人工上传)">
						<input
							className="field-input"
							value={draft.coverImageUrl}
							onChange={(e) => set({ coverImageUrl: e.target.value })}
						/>
					</Field>
					{draft.coverImageUrl && (
						<img
							src={draft.coverImageUrl}
							alt="封面预览"
							style={{
								maxWidth: "100%",
								maxHeight: 120,
								borderRadius: "var(--radius-md)",
								marginTop: "var(--space-sm)",
							}}
						/>
					)}
				</div>
			</details>
			<DraftReviewPanel draft={draft} onApply={onChange} />
			<ExportPanel draft={draft} facts={facts} />
		</div>
	);
}
