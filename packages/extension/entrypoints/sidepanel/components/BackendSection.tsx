import { useState } from "react";
import type { ConnectionTestResult } from "../../../lib/connection-test";

interface BackendSectionProps {
	backendUrl: string;
	setBackendUrl: (v: string) => void;
	onTestConnection: () => Promise<ConnectionTestResult>;
}

export function BackendSection({
	backendUrl,
	setBackendUrl,
	onTestConnection,
}: BackendSectionProps) {
	const [testing, setTesting] = useState(false);
	const [testResult, setTestResult] = useState<ConnectionTestResult | null>(
		null,
	);

	async function handleTest() {
		setTesting(true);
		setTestResult(null);
		try {
			setTestResult(await onTestConnection());
		} finally {
			setTesting(false);
		}
	}

	return (
		<div className="card">
			<div className="section-header">后端连接（可选）</div>
			<div className="field-group">
				<label htmlFor="backend-url" className="field-label">
					后端 URL（http://localhost:3002）
				</label>
				<input
					id="backend-url"
					className="field-input"
					value={backendUrl}
					placeholder="http://localhost:3002"
					onChange={(e) => setBackendUrl(e.target.value)}
				/>
			</div>
			<div className="field-group">
				<button
					type="button"
					className="btn btn-plain btn-sm"
					onClick={() => void handleTest()}
					disabled={testing}
				>
					{testing ? "测试中…" : "测试连接"}
				</button>
				{testResult && (
					<p
						role="status"
						className={`field-hint ${testResult.status === "ok" ? "text-success" : "text-warning"}`}
					>
						{testResult.status === "ok"
							? "✓ 連線成功"
							: "✗ 連線失敗，請確認 URL"}
					</p>
				)}
			</div>
		</div>
	);
}
