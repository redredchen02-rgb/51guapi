import { useCallback, useEffect, useState } from "react";
import { login } from "../../lib/auth-client";

// 自用模式:免密登入。挂载时自动向本地后端取 token;成功即进入主界面,
// 失败(通常是后端未启动)则显示启动提示与「重试」按钮。无密码输入。
export function AuthView({ onLogin }: { onLogin: () => void }) {
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");

	const connect = useCallback(async () => {
		setLoading(true);
		setError("");
		const result = await login();
		if (result.ok) {
			onLogin();
			return;
		}
		setError(result.error ?? "连接失败");
		setLoading(false);
	}, [onLogin]);

	useEffect(() => {
		void connect();
	}, [connect]);

	return (
		<div style={{ padding: "var(--space-2xl)", textAlign: "center" }}>
			<h2 style={{ fontSize: "var(--font-xl)", margin: "0 0 var(--space-xl)" }}>
				连接后端
			</h2>
			<p
				className="text-base"
				style={{ color: "var(--color-text-muted, #aaa)", margin: 0 }}
			>
				自用模式无需密码,正在连接本地后端…
			</p>
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
							在项目目录执行：
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
								bash scripts/start-backend.sh
							</code>
						</div>
					)}
				</>
			)}
			<button
				type="button"
				onClick={() => void connect()}
				disabled={loading}
				className="btn btn-primary"
				style={{ marginTop: "var(--space-xl)" }}
			>
				{loading ? "连接中…" : "重试"}
			</button>
		</div>
	);
}
