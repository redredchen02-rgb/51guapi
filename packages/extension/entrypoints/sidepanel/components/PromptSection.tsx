import type { FewShotPair } from "@51guapi/shared";
import type { PromptTemplate } from "../../../lib/prompt-client";
import { DEFAULT_SETTINGS } from "../../../lib/storage";
import { FewShotPairEditor } from "./FewShotPairEditor";

const MAX_PAIRS = 8;

interface PromptSectionProps {
	promptTemplate: string;
	fewShotPairs: FewShotPair[];
	prompts: PromptTemplate[];
	selectedPromptId: string;
	promptStatus: string;
	setPromptTemplate: (v: string) => void;
	setFewShotPairs: (pairs: FewShotPair[]) => void;
	onLoadPrompts: () => void;
	onSelectPrompt: (id: string) => void;
	onSavePromptToBackend: (name: string) => Promise<void>;
}

export function PromptSection({
	promptTemplate,
	fewShotPairs,
	prompts,
	selectedPromptId,
	promptStatus,
	setPromptTemplate,
	setFewShotPairs,
	onLoadPrompts,
	onSelectPrompt,
	onSavePromptToBackend,
}: PromptSectionProps) {
	async function handleSaveToBackend() {
		const name = window.prompt("命名此模板:");
		if (!name) return;
		await onSavePromptToBackend(name);
	}

	return (
		<>
			{/* Few-shot 範例 */}
			<div className="card">
				<div className="field-group">
					<div className="field-label" id="fewshot-label">
						Few-shot 范例
						<span
							className="font-normal text-muted"
							style={{ marginLeft: "var(--space-sm)" }}
						>
							({fewShotPairs.length}/{MAX_PAIRS})
						</span>
					</div>
					<FewShotPairEditor pairs={fewShotPairs} onChange={setFewShotPairs} />
				</div>
			</div>

			{/* Prompt 模板 */}
			<div className="card">
				<div className="field-group">
					<label className="field-label">
						Prompt 模板(占位符:{"{{topic}}"} 选题 / {"{{facts}}"} 事实块 /{" "}
						{"{{fewshot}}"} 范例)
						<button
							type="button"
							className="btn btn-plain btn-sm ml-sm"
							onClick={() => setPromptTemplate(DEFAULT_SETTINGS.promptTemplate)}
						>
							恢复默认
						</button>
					</label>
					<textarea
						className="field-input"
						style={{ minHeight: 120 }}
						value={promptTemplate}
						onChange={(e) => setPromptTemplate(e.target.value)}
					/>
				</div>
				<p className="field-hint">
					源接地:AI 只用 {"{{facts}}"}{" "}
					里给的事实润色,缺的标【待补】,连结只用给定
					URL——防止编造作品事实/连结。
				</p>
			</div>

			<hr className="divider" />

			{/* Prompt 管理 */}
			<div className="card">
				<div className="field-group">
					<label className="field-label">
						Prompt 管理
						<button
							type="button"
							className="btn btn-plain btn-sm ml-sm"
							onClick={onLoadPrompts}
						>
							从后端加载
						</button>
					</label>
					{prompts.length > 0 && (
						<select
							className="field-input"
							style={{ marginBottom: "var(--space-sm)" }}
							value={selectedPromptId}
							onChange={(e) => onSelectPrompt(e.target.value)}
						>
							<option value="">-- 选择模板 --</option>
							{prompts.map((p) => (
								<option key={p.id} value={p.id}>
									{p.name}
								</option>
							))}
						</select>
					)}
					<button
						type="button"
						className="btn btn-plain btn-sm"
						style={{ marginTop: "var(--space-xs)" }}
						onClick={() => void handleSaveToBackend()}
					>
						保存到后端
					</button>
					{promptStatus && <p className="field-hint">{promptStatus}</p>}
				</div>
			</div>
		</>
	);
}
