import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api-fetch";
import {
	type ExtensionCounters,
	getExtensionCounters,
} from "../../lib/storage";

interface Props {
	onBack: () => void;
}

interface BackendMetrics {
	scraperSuccess: number;
	scraperFailed: number;
	draftsSuccess: number;
	draftsFailed: number;
}

function parsePrometheus(text: string): BackendMetrics {
	const num = (pattern: RegExp) => {
		const m = text.match(pattern);
		return m ? Number(m[1]) : 0;
	};
	return {
		scraperSuccess: num(
			/publisher_scraper_runs_total\{status="success"\}\s+(\d+)/,
		),
		scraperFailed: num(
			/publisher_scraper_runs_total\{status="failed"\}\s+(\d+)/,
		),
		draftsSuccess: num(/publisher_drafts_total\{status="success"\}\s+(\d+)/),
		draftsFailed: num(/publisher_drafts_total\{status="failed"\}\s+(\d+)/),
	};
}

function rate(success: number, failed: number): string {
	const total = success + failed;
	if (total === 0) return "—";
	return `${Math.round((success / total) * 100)}%`;
}

const card: React.CSSProperties = {
	background: "#f8f9fa",
	borderRadius: 8,
	padding: "12px 16px",
	marginBottom: 10,
};

const cardTitle: React.CSSProperties = {
	fontSize: 11,
	color: "#666",
	marginBottom: 4,
};

const cardValue: React.CSSProperties = {
	fontSize: 22,
	fontWeight: 700,
	color: "#1a1a1a",
};

const cardNote: React.CSSProperties = {
	fontSize: 10,
	color: "#999",
	marginTop: 2,
};

export function MetricsView({ onBack }: Props) {
	const [backend, setBackend] = useState<BackendMetrics | null>(null);
	const [backendOffline, setBackendOffline] = useState(false);
	const [counters, setCounters] = useState<ExtensionCounters | null>(null);

	useEffect(() => {
		const [metricsP, countersP] = [
			apiFetch("/api/v1/metrics")
				.then((r) => r.text())
				.then(parsePrometheus)
				.catch(() => null),
			getExtensionCounters().catch(() => null),
		];
		Promise.allSettled([metricsP, countersP]).then(([mRes, cRes]) => {
			if (mRes.status === "fulfilled" && mRes.value) {
				setBackend(mRes.value);
			} else {
				setBackendOffline(true);
			}
			if (cRes.status === "fulfilled" && cRes.value) {
				setCounters(cRes.value);
			}
		});
	}, []);

	return (
		<div style={{ padding: 16 }}>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 8,
					marginBottom: 16,
				}}
			>
				<button
					type="button"
					onClick={onBack}
					style={{
						background: "none",
						border: "none",
						cursor: "pointer",
						fontSize: 16,
						padding: 0,
					}}
				>
					←
				</button>
				<strong>数据指标</strong>
			</div>

			<div style={card}>
				<div style={cardTitle}>内容抓取成功率</div>
				<div style={cardValue}>
					{backendOffline
						? "后端离线"
						: backend
							? rate(backend.scraperSuccess, backend.scraperFailed)
							: "—"}
				</div>
				<div style={cardNote}>
					自上次后端启动（publisher_scraper_runs_total）
				</div>
			</div>

			<div style={card}>
				<div style={cardTitle}>草稿生成成功率</div>
				<div style={cardValue}>
					{backendOffline
						? "后端离线"
						: backend
							? rate(backend.draftsSuccess, backend.draftsFailed)
							: "—"}
				</div>
				<div style={cardNote}>自上次后端启动（publisher_drafts_total）</div>
			</div>

			<div style={card}>
				<div style={cardTitle}>批次完成数</div>
				<div style={cardValue}>{counters?.batchesCompleted ?? "—"}</div>
				<div style={cardNote}>跨会话累计（本地存储）</div>
			</div>

			{!backendOffline &&
				backend &&
				backend.scraperSuccess === 0 &&
				backend.scraperFailed === 0 &&
				backend.draftsSuccess === 0 &&
				(!counters || counters.batchesCompleted === 0) && (
					<p
						style={{
							textAlign: "center",
							color: "#999",
							fontSize: 12,
							marginTop: 16,
						}}
					>
						暂无数据，完成一次批次任务后将显示统计
					</p>
				)}
		</div>
	);
}
