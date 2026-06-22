import type { ContentDraft, GossipFactsBlock } from "@51guapi/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { isAuthenticated } from "../../lib/auth-client";
import { buildPrompt } from "../../lib/messaging";
import {
	clearCurrentDraft,
	getCurrentDraft,
	getSettings,
} from "../../lib/storage";
import { AuthView } from "./AuthView";
import { ErrorDisplay } from "./components/ErrorDisplay";
import { Toast } from "./components/Toast";
import { DraftPreview } from "./DraftPreview";
import { GossipView } from "./GossipView";
import { useAutoSave } from "./hooks/useAutoSave";
import { useDraftGeneration } from "./hooks/useDraftGeneration";
import { useErrorHandler } from "./hooks/useErrorHandler";
import { useErrorLogger } from "./hooks/useErrorLogger";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useLoadingState } from "./hooks/useLoadingState";
import { useOperationHistory } from "./hooks/useOperationHistory";
import { Loading } from "./Loading";
import { MetricsView } from "./MetricsView";
import { DraftActionButtons } from "./main/DraftActionButtons";
import { GenerationPanel } from "./main/GenerationPanel";
import { LogPanel } from "./main/LogPanel";
import { MainHeader } from "./main/MainHeader";
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
	const [draftFacts, setDraftFacts] = useState<GossipFactsBlock | null>(null);
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
	const { generate } = useDraftGeneration();
	const { saveDraft } = useAutoSave();
	const genTokenRef = useRef(0);
	const generationProgressRef = useRef<ReturnType<typeof setInterval> | null>(
		null,
	);

	const clearGenerationProgress = useCallback(() => {
		if (generationProgressRef.current) {
			clearInterval(generationProgressRef.current);
			generationProgressRef.current = null;
		}
	}, []);

	useEffect(() => {
		void (async () => {
			const saved = await getCurrentDraft();
			if (saved) {
				setDraft(saved.draft);
				setDraftFacts(saved.facts);
				setMode("draft");
			}
			const authed = await isAuthenticated();
			setAuthenticated(authed);
			setView(authed ? "main" : "auth");
			setAuthChecking(false);
		})();
	}, []);

	useEffect(() => {
		return () => clearGenerationProgress();
	}, [clearGenerationProgress]);

	function updateDraft(
		next: ContentDraft,
		facts = draftFacts,
		immediate = false,
	) {
		setDraft(next);
		saveDraft(next, facts, immediate);
	}

	async function handleGenerate() {
		if (!topic.trim()) {
			handleError("请先输入主题。");
			return;
		}
		clearError();
		setMode("generating");
		loadingState.startLoading("正在生成草稿...");
		clearGenerationProgress();
		let progress = 0;
		generationProgressRef.current = setInterval(() => {
			progress = Math.min(progress + 10, 90);
			loadingState.updateProgress(progress);
		}, 500);
		try {
			const token = ++genTokenRef.current;
			const settings = await getSettings();
			const result = await generate(
				buildPrompt(settings.promptTemplate, topic),
			);
			// exception 等同原 catch:不经 token 守卫(原代码 requestGenerate 抛错
			// 时直接进 catch,跳过 token 比对),故先于 token 比对处理。
			if (result.status === "exception") {
				const err = result.error;
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
				return;
			}
			if (token !== genTokenRef.current) return;
			if (result.status === "ok") {
				setDraftFacts(null);
				updateDraft(result.draft, null, true);
				setMode("draft");
				loadingState.completeLoading();
				void recordOperation({ type: "generate", topic, success: true });
			} else {
				const errMsg =
					result.status === "no-key"
						? "后端缺少 LLM_API_KEY,请在 packages/backend/.env 中配置后重启服务"
						: result.error;
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
		} finally {
			clearGenerationProgress();
		}
	}

	function cancelGenerate() {
		genTokenRef.current++;
		clearGenerationProgress();
		setMode(draft ? "draft" : "empty");
		loadingState.completeLoading();
	}

	function handleNext() {
		void clearCurrentDraft();
		setDraft(null);
		setDraftFacts(null);
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
				saveDraft(draft, draftFacts, true);
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
				onDraftReady={({ draft, facts }) => {
					setDraftFacts(facts);
					updateDraft(draft, facts, true);
					setMode("draft");
					setView("main");
				}}
				onError={handleError}
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
			<MainHeader
				authenticated={authenticated}
				onAuthClick={() => {
					if (!authenticated) setView("auth");
				}}
				onOpenSettings={() => setView("settings")}
				onToggleLogs={() => {
					setShowLogs(!showLogs);
					if (!showLogs) void retrieveLogs();
				}}
				onOpenGossip={() => setView("gossip")}
				onOpenPending={() => setView("pending")}
				onOpenMetrics={() => setView("metrics")}
			/>

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
				<LogPanel
					logs={logs}
					onExport={() => {
						const exported = exportLogs();
						void navigator.clipboard?.writeText(exported);
					}}
					onClear={() => void clearLogs()}
				/>
			)}

			<GenerationPanel
				mode={mode}
				topic={topic}
				busy={busy}
				hasDraft={!!draft}
				progress={loadingState.progress}
				progressLabel={loadingState.message}
				onTopicChange={setTopic}
				onCancel={cancelGenerate}
			/>

			{draft && mode !== "generating" && (
				<DraftPreview draft={draft} onChange={updateDraft} facts={draftFacts} />
			)}

			{toast && (
				<Toast
					message={toast.message}
					type={toast.type}
					onClose={() => setToast(null)}
				/>
			)}

			<DraftActionButtons
				mode={mode}
				busy={busy}
				hasDraft={!!draft}
				onGenerate={handleGenerate}
				onCopy={copyBody}
				onNext={handleNext}
			/>
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
