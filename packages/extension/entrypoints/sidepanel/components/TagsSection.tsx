interface TagsSectionProps {
	tagsText: string;
	reviewCriteriaPrompt: string;
	setTagsText: (v: string) => void;
	setReviewCriteriaPrompt: (v: string) => void;
}

export function TagsSection({
	tagsText,
	reviewCriteriaPrompt,
	setTagsText,
	setReviewCriteriaPrompt,
}: TagsSectionProps) {
	return (
		<div className="card">
			<div className="field-group">
				<label htmlFor="tags" className="field-label">
					推荐标签清单 (每行一个或逗号分隔)
				</label>
				<textarea
					id="tags"
					className="field-input"
					style={{ minHeight: 80 }}
					placeholder={"漢化\n無修正\n校園日常\n…（约 20–50 条为宜）"}
					value={tagsText}
					onChange={(e) => setTagsText(e.target.value)}
				/>
			</div>
			<p className="field-hint">
				AI 生成时只从此列表选择标签；留空则仅约束分类不约束标签。
			</p>

			<div className="field-group">
				<label htmlFor="review-criteria" className="field-label">
					AI 评审标准（Phase 3，留空使用内置四维标准）
				</label>
				<textarea
					id="review-criteria"
					className="field-input"
					style={{ minHeight: 80 }}
					placeholder={
						"留空=内置四维标准(内容丰富度/社群语气/标题质量/分类准确)。\n如需自定义,请按 JSON 格式写入各维度标准。"
					}
					value={reviewCriteriaPrompt}
					onChange={(e) => setReviewCriteriaPrompt(e.target.value)}
				/>
			</div>
			<p className="field-hint">
				内置标准覆盖：内容丰富度 / 社群语气 / 标题质量 / 分类准确。Phase 3
				启用后每条草稿生成后自动评审。
			</p>
		</div>
	);
}
