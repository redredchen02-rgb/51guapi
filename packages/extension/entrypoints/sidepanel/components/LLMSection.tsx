import { useState } from "react";

interface LLMSectionProps {
	endpoint: string;
	model: string;
	fallbackModel: string;
	setEndpoint: (v: string) => void;
	setModel: (v: string) => void;
	setFallbackModel: (v: string) => void;
}

export function LLMSection({
	endpoint,
	model,
	fallbackModel,
	setEndpoint,
	setModel,
	setFallbackModel,
}: LLMSectionProps) {
	const [fallbackOpen, setFallbackOpen] = useState(!!fallbackModel);

	return (
		<div className="card">
			<div className="section-header">LLM 配置</div>
			<div className="field-group">
				<label htmlFor="endpoint" className="field-label">
					LLM Endpoint (https://)
				</label>
				<input
					id="endpoint"
					className="field-input"
					value={endpoint}
					placeholder="https://api.openai.com/v1/chat/completions"
					onChange={(e) => setEndpoint(e.target.value)}
				/>
			</div>
			<div className="field-group">
				<label htmlFor="model" className="field-label">
					模型名
				</label>
				<input
					id="model"
					className="field-input"
					value={model}
					onChange={(e) => setModel(e.target.value)}
				/>
			</div>
			<p className="field-hint">
				API Key 由后端服务 .env 中的 LLM_API_KEY 提供,扩展不会保存或发送 LLM
				密钥。
			</p>

			<div className="card" style={{ marginTop: "var(--space-lg)" }}>
				<button
					type="button"
					aria-expanded={fallbackOpen}
					onClick={() => setFallbackOpen((v) => !v)}
					className="btn-icon text-secondary"
					style={{
						width: "100%",
						textAlign: "left",
						fontSize: "var(--font-sm)",
						padding: 0,
					}}
				>
					{fallbackOpen ? "▼" : "▶"} 备用 LLM 模型
					{fallbackModel ? " (已配置)" : " (可选)"}
				</button>
				{fallbackOpen && (
					<div style={{ marginTop: "var(--space-lg)" }}>
						<p className="field-hint">主模型失败时自动回退。留空即不启用。</p>
						<div className="field-group">
							<label htmlFor="fallback-model" className="field-label">
								备用模型名(可选)
							</label>
							<input
								id="fallback-model"
								className="field-input"
								value={fallbackModel}
								onChange={(e) => setFallbackModel(e.target.value)}
							/>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
