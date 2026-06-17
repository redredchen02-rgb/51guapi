import type { ContentDraft } from "@51guapi/shared";
import { useEffect, useRef, useState } from "react";
import { isAuthenticated } from "../../lib/auth-client";
import { buildPrompt, requestGenerate } from "../../lib/messaging";
import {
	clearCurrentDraft,
	getCurrentDraft,
	getSettings,
} from "../../lib/storage";
import { AuthView } from "./AuthView";
import { ErrorDisplay } from "./components/ErrorDisplay";
import { KeyboardShortcutsHelp } from "./components/KeyboardShortcutsHelp";
import { ProgressBar } from "./components/ProgressBar";
import { Toast } from "./components/Toast";
import { DraftPreview } from "./DraftPreview";
import { GossipView } from "./GossipView";
import { MetricsView } from "./MetricsView";
import { useAutoSave } from "./hooks/useAutoSave";
import { useErrorHandler } from "./hooks/useErrorHandler";
import { useErrorLogger } from "./hooks/useErrorLogger";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useLoadingState } from "./hooks/useLoadingState";
import { useOperationHistory } from "./hooks/useOperationHistory";
import { Loading } from "./Loading";
import { PendingTopicsView } from "./PendingTopicsView";
import { Settings } from "./Settings";

type Mode = "empty" | "generating" | "draft";

export function App() {
	const [view, setView] = useState<
		"main" | "settings" | "pending" | "auth" | "gossip" | "metrics"
	>("main");
	const [mode, setMode] = useState<Mode>("empty");
	const [topic, setTopic] = useState("");
	const [draft, setDraft] = useState<ContentDraft | null>(null);
	const { error, handleError, clearError } = useErrorHandler();
	const { logs, logError, retrieveLogs, clearLogs, exportLogs } =
		useErrorLogger();
	const [showLogs, setShowLogs] = useState(false);
	const { recordOperation } = useOperationHistory();
	const [toast, setToast] = useState<{
		message: string;
		type: "success" | "error" | "info";
	} | null>(null);
	const [authenticated, setAuthenticated] = useState(false);
	const [authChecking, setAuthChecking] = useState(true);
	const loadingState = useLoadingState();
	const { saveDraft } = useAutoSave();
	const promptTemplateRef = useRef("");
	const genTokenRef = useRef(0);

	useEffect(() => {
		void (async () => {
			const [s, saved] = await Promise.all([getSettings(), getCurrentDraft()]);
			promptTemplateRef.current = s.promptTemplate;
			if (saved) {
				setDraft(saved);
				setMode("draft");
			}
			const authed = await isAuthenticated();
			setAuthenticated(authed);
			setView(authed ? "main" : "auth");
			setAuthChecking(false);
		})();
	}, []);

	function updateDraft(next: ContentDraft) {
		setDraft(next);
		saveDraft(next);
	}

	async function handleGenerate() {
		if (!topic.trim()) {
			handleError("请先输入主题。");
			return;
		}
		clearError();
		setMode("generating");
		loadingState.startLoading("正在生成草稿...");
		const progressInterval = setInterval(() => {
			loadingState.updateProgress(Math.min(loadingState.progress + 10, 90));
		}, 500);
		try {
			const token = ++genTokenRef.current;
			const res = await requestGenerate(
				buildPrompt(promptTemplateRef.current, topic),
			);
			if (token !== genTokenRef.current) return;
			if (res.ok) {
				updateDraft(res.draft);
				setMode("draft");
				loadingState.completeLoading();
				void recordOperation({ type: "generate", topic, success: true });
			} else {
				const errMsg =
					res.kind === "no-key" ? `${res.error}(点右上角设置)` : res.error;
				handleError(errMsg);
				setMode(draft ? "draft" : "empty");
				loadingState.completeLoading();
				void logError(new Error(errMsg), { topic, action: "generate" });
				void recordOperation({
					type: "generate",
					topic,
					success: false,
					details: { error: errMsg },
				});
			}
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : "生成失败";
			handleError(errMsg);
			setMode(draft ? "draft" : "empty");
			loadingState.completeLoading();
			void logError(err instanceof Error ? err : new Error(errMsg), {
				topic,
				action: "generate",
			});
			void recordOperation({
				type: "generate",
				topic,
				success: false,
				details: { error: errMsg },
			});
		} finally {
			clearInterval(progressInterval);
		}
	}

	function cancelGenerate() {
		genTokenRef.current++;
		setMode(draft ? "draft" : "empty");
		loadingState.completeLoading();
	}

	function handleNext() {
		void clearCurrentDraft();
		setDraft(null);
		setTopic("");
		clearError();
		setMode("empty");
	}

	function copyBody() {
		if (draft) {
			void navigator.clipboard?.writeText(draft.body);
			setToast({ message: "正文已复制", type: "success" });
		}
	}

	useKeyboardShortcuts({
		onGenerate: handleGenerate,
		onNext: handleNext,
		onSave: () => {
			if (draft) {
				saveDraft(draft, true);
			}
		},
	});

	if (authChecking) {
		return <Loading />;
	}

	if (view === "auth") {
		return (
			<Wrap>
				<AuthView
					onLogin={() => {
						setAuthenticated(true);
						setView("main");
					}}
				/>
			</Wrap>
		);
	}

	if (view === "settings")
		return (
			<Wrap>
				<Settings onClose={() => setView("main")} />
			</Wrap>
		);
	if (view === "pending")
		return (
			<PendingTopicsView
				onBack={() => setView("main")}
				onBatchStarted={() => setView("main")}
				onError={(msg) => handleError(msg)}
			/>
		);
	if (view === "gossip")
		return (
			<Wrap>
				<GossipView
					onBack={() => setView("main")}
					onTopicAdded={() => setView("pending")}
				/>
			</Wrap>
		);
	if (view === "metrics")
		return (
			<Wrap>
				<MetricsView onBack={() => setView("main")} />
			</Wrap>
		);

	const busy = mode === "generating";

	return (
		<Wrap>
			<header className="app-header">
				<div className="app-title-row">
					<div>
						<h1 style={{ fontSize: "var(--font-xl)", margin: 0 }}>
							吃瓜小帮手
						</h1>
						<div className="text-sm text-secondary" style={{ marginTop: 3 }}>
							抓取选题 → AI 生成草稿 → 预览编辑 → 导出
						</div>
					</div>
					<div className="app-actions">
						<button
							type="button"
							onClick={() => {
								if (!authenticated) setView("auth");
							}}
							className={`status-pill ${authenticated ? "success" : "error"}`}
							style={{
								cursor: authenticated ? "default" : "pointer",
								userSelect: "none",
							}}
						>
							{authenticated ? "已登录" : "未登录"}
						</button>
						<button
							type="button"
							onClick={() => setView("settings")}
							className="btn btn-plain btn-sm"
							aria-label="设置"
						>
							⚙ 设置
						</button>
						<KeyboardShortcutsHelp />
						<button
							type="button"
							onClick={() => {
								setShowLogs(!showLogs);
								if (!showLogs) void retrieveLogs();
							}}
							className="btn btn-plain btn-sm"
							aria-label="错误日志"
						>
							📋 日志
						</button>
					</div>
				</div>

				<nav className="workflow-grid" aria-label="主要工作流">
					<button
						type="button"
						onClick={() => setView("gossip")}
						className="workflow-card primary"
					>
						<span className="workflow-card-title">吃瓜素材</span>
						<span className="workflow-card-desc">
							抓取来源、提炼事实,进入待审池
						</span>
					</button>
					<button
						type="button"
						onClick={() => setView("pending")}
						className="workflow-card"
					>
						<span className="workflow-card-title">待审池</span>
						<span className="workflow-card-desc">补事实、挑选进入批量生成</span>
					</button>
					<button
						type="button"
						onClick={() => setView("metrics")}
						className="workflow-card"
					>
						<span className="workflow-card-title">数据指标</span>
						<span className="workflow-card-desc">
							抓取成功率、草稿生成率、批次完成数
						</span>
					</button>
				</nav>
			</header>

			{error && (
				<ErrorDisplay
					message={error}
					onRetry={() => {
						if (mode === "generating" || mode === "empty" || mode === "draft") {
							handleGenerate();
						}
					}}
					onDismiss={clearError}
				/>
			)}

			{showLogs && (
				<div
					className="card surface-muted"
					style={{
						maxHeight: 200,
						overflowY: "auto",
						marginBottom: "var(--space-lg)",
					}}
				>
					<div
						className="flex-between"
						style={{ marginBottom: "var(--space-md)" }}
					>
						<span className="font-semibold">错误日志</span>
						<div style={{ display: "flex", gap: "var(--space-md)" }}>
							<button
								type="button"
								onClick={() => {
									const exported = exportLogs();
									void navigator.clipboard?.writeText(exported);
								}}
								className="btn-icon text-info"
								style={{ fontSize: "var(--font-sm)" }}
							>
								导出
							</button>
							<button
								type="button"
								onClick={() => void clearLogs()}
								className="btn-icon text-error"
								style={{ fontSize: "var(--font-sm)" }}
							>
								清空
							</button>
						</div>
					</div>

					{logs.length === 0 ? (
						<div className="text-muted">暂无错误日志</div>
					) : (
						<div
							style={{
								display: "flex",
								flexDirection: "column",
								gap: "var(--space-md)",
							}}
						>
							{logs.map((log) => (
								<div
									key={log.id}
									className="surface-elevated"
									style={{ padding: "var(--space-md)" }}
								>
									<div
										className="text-error"
										style={{ marginBottom: "var(--space-sm)" }}
									>
										{log.message}
									</div>
									<div className="text-muted text-xs">
										{new Date(log.timestamp).toLocaleString()}
									</div>
								</div>
							))}
						</div>
					)}
				</div>
			)}

			{(mode === "empty" ||
				mode === "generating" ||
				(mode === "draft" && !draft)) && (
				<div style={{ marginBottom: "var(--space-lg)" }}>
					<textarea
						className="field-input"
						style={{ minHeight: 60, padding: "var(--space-lg)" }}
						placeholder="输入选题/主题,例如:介绍某条吃瓜素材的看点"
						value={topic}
						disabled={busy}
						onChange={(e) => setTopic(e.target.value)}
					/>
				</div>
			)}

			{mode === "generating" && (
				<div style={{ marginBottom: "var(--space-lg)" }}>
					<ProgressBar
						progress={loadingState.progress}
						label={loadingState.message}
					/>
					<button
						type="button"
						onClick={cancelGenerate}
						className="btn btn-plain btn-sm"
						style={{ marginTop: "var(--space-lg)" }}
					>
						取消
					</button>
				</div>
			)}

			{draft && mode !== "generating" && (
				<DraftPreview draft={draft} onChange={updateDraft} />
			)}

			{toast && (
				<Toast
					message={toast.message}
					type={toast.type}
					onClose={() => setToast(null)}
				/>
			)}

			<div
				style={{
					display: "flex",
					gap: "var(--space-md)",
					marginTop: "var(--space-xl)",
				}}
			>
				{(mode === "empty" || mode === "generating" || mode === "draft") && (
					<button
						type="button"
						onClick={handleGenerate}
						disabled={busy}
						className="btn btn-primary"
					>
						生成草稿
					</button>
				)}
				{draft && (
					<button
						type="button"
						onClick={copyBody}
						disabled={busy}
						className="btn btn-plain"
					>
						复制正文
					</button>
				)}
				{draft && (
					<button
						type="button"
						onClick={handleNext}
						disabled={busy}
						className="btn btn-plain"
					>
						下一条
					</button>
				)}
			</div>
		</Wrap>
	);
}

function Wrap({ children }: { children: React.ReactNode }) {
	return (
		<main
			className="glass-panel fade-in"
			style={{ padding: "var(--space-xl)", margin: "12px auto", maxWidth: 480 }}
		>
			{children}
		</main>
	);
}
