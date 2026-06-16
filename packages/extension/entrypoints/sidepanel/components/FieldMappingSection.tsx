interface FieldMappingSectionProps {
	mappingText: string;
	setMappingText: (v: string) => void;
	onResetMapping: () => void;
}

export function FieldMappingSection({
	mappingText,
	setMappingText,
	onResetMapping,
}: FieldMappingSectionProps) {
	return (
		<div className="card">
			<div className="field-group">
				<label className="field-label">
					字段映射(JSON)
					<button
						type="button"
						className="btn btn-plain btn-sm ml-sm"
						onClick={onResetMapping}
					>
						恢复默认
					</button>
				</label>
				<textarea
					className="field-input"
					style={{
						minHeight: 140,
						fontFamily: "monospace",
						fontSize: "var(--font-xs)",
					}}
					value={mappingText}
					onChange={(e) => setMappingText(e.target.value)}
				/>
			</div>
		</div>
	);
}
