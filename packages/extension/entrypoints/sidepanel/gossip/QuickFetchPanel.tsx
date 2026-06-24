import { useState } from "react";
import { getCurrentTabUrl } from "../../../lib/current-tab";
import { fetchGossipTopicFromUrl } from "../../../lib/gossip-client";
import { btn } from "./styles";

type TabsQueryFn = (info: {
	active: boolean;
	currentWindow: boolean;
}) => Promise<Array<{ url?: string }>>;

interface Props {
	onTopicAdded: () => void;
	/** 可注入 fetch，用于测试。 */
	fetchFn?: typeof fetch;
	/** 可注入 tabs.query，用于测试。 */
	tabsQueryFn?: TabsQueryFn;
}

function isSupportedUrl(url: string): boolean {
	return /^https?:\/\//i.test(url);
}

/** 统一 SSRF allowlist 错误识别(来自 ssrf-guard.ts "Host not in allowlist")。 */
function isAllowlistError(msg: string): boolean {
	return msg.includes("not in allowlist");
}

export function QuickFetchPanel({ onTopicAdded, fetchFn, tabsQueryFn }: Props) {
	const [urlInput, setUrlInput] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");

	async function executeFetch(url: string, clearInput: boolean) {
		if (!isSupportedUrl(url)) {
			setError("只支持 http/https 链接，请检查 URL 格式");
			return;
		}
		let siteName: string;
		try {
			siteName = new URL(url).hostname;
		} catch {
			setError("URL 格式无效");
			return;
		}
		setBusy(true);
		setError("");
		try {
			await fetchGossipTopicFromUrl(url, siteName, fetchFn);
			if (clearInput) setUrlInput("");
			onTopicAdded();
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			if (msg === "DUPLICATE_URL") {
				// 与现有 GossipView.handleGenerate 行为一致:去重视为成功
				if (clearInput) setUrlInput("");
				onTopicAdded();
			} else if (isAllowlistError(msg)) {
				setError("该域名未在渠道白名单，请先在下方「可爬取渠道」中添加该域名");
			} else {
				setError(msg);
			}
		} finally {
			setBusy(false);
		}
	}

	async function handleCurrentTab() {
		setError("");
		const url = await getCurrentTabUrl(tabsQueryFn);
		if (!url) {
			setError("当前标签页不是有效网页（仅支持 http/https）");
			return;
		}
		await executeFetch(url, false);
	}

	async function handleManualFetch() {
		await executeFetch(urlInput.trim(), true);
	}

	return (
		<div
			style={{
				border: "1px solid #d9d9d9",
				borderRadius: 6,
				padding: 10,
				marginBottom: 12,
			}}
		>
			<div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
				快速抓取
			</div>
			<button
				type="button"
				onClick={() => void handleCurrentTab()}
				disabled={busy}
				style={{
					...btn,
					background: "#1677ff",
					color: "white",
					marginBottom: 8,
					width: "100%",
					textAlign: "center",
				}}
			>
				{busy ? "抓取中…" : "📋 抓取当前页面"}
			</button>
			<div style={{ display: "flex", gap: 6 }}>
				<input
					type="url"
					placeholder="或粘贴 URL (https://...)"
					value={urlInput}
					onChange={(e) => setUrlInput(e.target.value)}
					disabled={busy}
					style={{
						flex: 1,
						padding: "4px 6px",
						fontSize: 12,
						border: "1px solid #d9d9d9",
						borderRadius: 4,
					}}
				/>
				<button
					type="button"
					onClick={() => void handleManualFetch()}
					disabled={busy || !urlInput.trim()}
					style={{ ...btn, background: "#1677ff", color: "white" }}
				>
					{busy ? "抓取中…" : "🔗 抓取"}
				</button>
			</div>
			{error && (
				<div style={{ fontSize: 12, color: "#cf1322", marginTop: 6 }}>
					{error}
				</div>
			)}
		</div>
	);
}
