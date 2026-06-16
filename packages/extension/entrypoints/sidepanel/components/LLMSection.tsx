import { useState } from "react";

interface LLMSectionProps {
	endpoint: string;
	model: string;
	fallbackModel: string;
	getApiKey: () => string;
	setEndpoint: (v: string) => void;
	setModel: (v: string) => void;
	setFallbackModel: (v: string) => void;
	setApiKey: (v: string) => void;
}

export function LLMSection({
	endpoint,
	model,
	fallbackModel,
	getApiKey,
	setEndpoint,
	setModel,
	setFallbackModel,
	setApiKey,
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
			<div className="field-group">
				<label htmlFor="api-key" className="field-label">
					API Key
				</label>
				<input
					id="api-key"
					className="field-input"
					type="password"
					autoComplete="off"
					value={getApiKey()}
					onChange={(e) => setApiKey(e.target.value)}
				/>
			</div>
			<p className="field-hint">
				⚠️ key
				以明文存储于本地浏览器(chrome.storage.local),并会随请求发往上面配置的
				endpoint。请只配置可信地址,建议使用权限受限的专用 key。
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
