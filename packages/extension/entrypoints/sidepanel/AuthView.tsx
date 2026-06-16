import { useState } from "react";
import { login } from "../../lib/auth-client";

export function AuthView({ onLogin }: { onLogin: () => void }) {
	const [password, setPassword] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!password.trim()) {
			setError("请输入密码");
			return;
		}
		setLoading(true);
		setError("");
		const result = await login(password);
		setLoading(false);
		if (result.ok) {
			onLogin();
		} else {
			setError(result.error ?? "登录失败");
		}
	}

	return (
		<div style={{ padding: "var(--space-2xl)", textAlign: "center" }}>
			<h2 style={{ fontSize: "var(--font-xl)", margin: "0 0 var(--space-xl)" }}>
				登录
			</h2>
			<form onSubmit={handleSubmit}>
				<div className="field-label">密码</div>
				<input
					type="password"
					className="field-input"
					value={password}
					disabled={loading}
					onChange={(e) => setPassword(e.target.value)}
				/>
				{error && (
					<>
						<p
							role="alert"
							className="text-error text-base"
							style={{ margin: "var(--space-md) 0 0" }}
						>
							{error}
						</p>
						{error.includes("无法连接") && (
							<div
								style={{
									marginTop: "var(--space-md)",
									padding: "var(--space-md)",
									background: "rgba(255,255,255,0.05)",
									borderRadius: "6px",
									textAlign: "left",
									fontSize: "var(--font-sm)",
									color: "var(--color-text-muted, #aaa)",
									lineHeight: 1.6,
								}}
							>
								<strong style={{ color: "var(--color-text, #ddd)" }}>
									启动后端：
								</strong>
								<br />
								在项目目录执行（macOS / Linux / Windows 通用）：
								<br />
								<code
									style={{
										display: "block",
										margin: "4px 0",
										padding: "4px 8px",
										background: "rgba(0,0,0,0.3)",
										borderRadius: "4px",
										fontFamily: "monospace",
										fontSize: "11px",
										userSelect: "all",
									}}
								>
									node scripts/setup.mjs
								</code>
							</div>
						)}
					</>
				)}
				<button
					type="submit"
					disabled={loading}
					className="btn btn-primary"
					style={{ marginTop: "var(--space-xl)" }}
				>
					{loading ? "登录中…" : "登录"}
				</button>
			</form>
		</div>
	);
}
