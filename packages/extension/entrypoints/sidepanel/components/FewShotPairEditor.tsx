import type { FewShotPair } from "@51guapi/shared";

const MAX_PAIRS = 8;

interface Props {
	pairs: FewShotPair[];
	onChange: (pairs: FewShotPair[]) => void;
	importBanner?: string;
	onImport?: () => void;
}

export function FewShotPairEditor({
	pairs,
	onChange,
	importBanner,
	onImport,
}: Props) {
	function updatePair(index: number, field: "input" | "output", value: string) {
		const next = pairs.map((p, i) =>
			i === index ? { ...p, [field]: value } : p,
		);
		onChange(next);
	}

	function deletePair(index: number) {
		onChange(pairs.filter((_, i) => i !== index));
	}

	function movePair(index: number, dir: -1 | 1) {
		const next = [...pairs];
		const target = index + dir;
		if (target < 0 || target >= next.length) return;
		const a = next[target];
		const b = next[index];
		if (!a || !b) return;
		[next[index], next[target]] = [a, b];
		onChange(next);
	}

	function addPair() {
		if (pairs.length >= MAX_PAIRS) return;
		onChange([...pairs, { input: "", output: "" }]);
	}

	return (
		<div>
			{importBanner && onImport && (
				<div className="banner-warning">
					{importBanner}
					<button
						type="button"
						onClick={onImport}
						className="btn btn-sm"
						style={{
							marginLeft: "var(--space-md)",
							background: "var(--color-warning)",
							color: "#fff",
							border: "none",
						}}
					>
						导入
					</button>
				</div>
			)}

			{pairs.map((pair, i) => (
				<div
					key={pair.input}
					className="card"
					style={{
						padding: "var(--space-lg)",
						marginBottom: "var(--space-lg)",
					}}
				>
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
							marginBottom: "var(--space-sm)",
						}}
					>
						<span className="text-xs text-muted">范例 {i + 1}</span>
						<div style={{ display: "flex", gap: "var(--space-sm)" }}>
							<button
								type="button"
								disabled={i === 0}
								onClick={() => movePair(i, -1)}
								className="btn btn-plain btn-sm"
								aria-label="上移"
							>
								↑
							</button>
							<button
								type="button"
								disabled={i === pairs.length - 1}
								onClick={() => movePair(i, 1)}
								className="btn btn-plain btn-sm"
								aria-label="下移"
							>
								↓
							</button>
							<button
								type="button"
								onClick={() => deletePair(i)}
								className="btn btn-plain btn-sm text-error"
								style={{ borderColor: "var(--color-error-border)" }}
								aria-label="删除"
							>
								✕
							</button>
						</div>
					</div>
					<label
						htmlFor={`fsp-input-${i}`}
						className="text-xs text-secondary"
						style={{ display: "block", marginBottom: "var(--space-xs)" }}
					>
						输入上下文
					</label>
					<textarea
						id={`fsp-input-${i}`}
						className="field-input"
						style={{ resize: "vertical", minHeight: 48 }}
						value={pair.input}
						placeholder="topic + facts…"
						onChange={(e) => updatePair(i, "input", e.target.value)}
					/>
					<label
						htmlFor={`fsp-output-${i}`}
						className="text-xs text-secondary"
						style={{
							display: "block",
							margin: "var(--space-sm) 0 var(--space-xs)",
						}}
					>
						范例输出
					</label>
					<textarea
						id={`fsp-output-${i}`}
						className="field-input"
						style={{ resize: "vertical", minHeight: 48 }}
						value={pair.output}
						placeholder="期望的 AI 输出正文…"
						onChange={(e) => updatePair(i, "output", e.target.value)}
					/>
				</div>
			))}

			<button
				type="button"
				onClick={addPair}
				disabled={pairs.length >= MAX_PAIRS}
				className="btn btn-plain btn-sm"
				style={{
					width: "100%",
					marginTop: "var(--space-sm)",
					color:
						pairs.length >= MAX_PAIRS
							? "var(--color-text-disabled)"
							: "var(--color-info)",
					borderColor:
						pairs.length >= MAX_PAIRS
							? "var(--color-border-light)"
							: "var(--color-info-border)",
				}}
			>
				{pairs.length >= MAX_PAIRS
					? `已达上限（${MAX_PAIRS}/${MAX_PAIRS}），请先删除旧条目`
					: "+ 添加范例"}
			</button>
		</div>
	);
}
