import type { ContentDraft, GossipFactsBlock } from "@51guapi/shared";
import { isGossipFactsBlock } from "@51guapi/shared";
import { useState } from "react";
import { downloadFile, exportTopicsAsCSV } from "../../lib/export";
import { requestGenerateArticle } from "../../lib/messaging";
import { useDraftActions } from "./hooks/useDraftActions";
import { useDraftGeneration } from "./hooks/useDraftGeneration";
import { useThemes } from "./hooks/useThemes";
import { useTopicEditing } from "./hooks/useTopicEditing";
import { useTopicSelection } from "./hooks/useTopicSelection";
import { useTopics } from "./hooks/useTopics";
import { Loading } from "./Loading";
import { BulkActionBar } from "./pending/BulkActionBar";
import { GenerateConfirmDialog } from "./pending/GenerateConfirmDialog";
import { ThemePicker } from "./pending/ThemePicker";
import { TopicListItem } from "./pending/TopicListItem";
import { TopicsToolbar } from "./pending/TopicsToolbar";

interface Props {
	onBack: () => void;
	onDraftReady: (payload: {
		draft: ContentDraft;
		facts: GossipFactsBlock;
		qualityWarnings?: string[];
	}) => void;
	onError: (msg: string) => void;
}

export function PendingTopicsView({ onBack, onDraftReady, onError }: Props) {
	const {
		themes,
		themesLoading,
		selectedTheme,
		setSelectedTheme,
		refreshThemes,
	} = useThemes();
	const { topics, loading, hideLowScore, setHideLowScore, refresh } =
		useTopics(selectedTheme);
	const { selected, setSelected, toggleSelect } = useTopicSelection();
	const { expanded, localFacts, toggleExpand, setFactField } =
		useTopicEditing();
	const { generate } = useDraftGeneration();
	const {
		busy,
		approveError,
		verifyingId,
		quickDraftConfirm,
		setQuickDraftConfirm,
		quickDraftStatus,
		setQuickDraftStatus,
		handleVerify,
		handleApproveSelected,
		handleRejectSelected,
		handleQuickDraft,
		handleQuickDraftConfirm,
	} = useDraftActions({
		topics,
		localFacts,
		selected,
		setSelected,
		generate,
		refresh,
		refreshThemes,
		onDraftReady,
		onError,
	});

	const [generatingArticleId, setGeneratingArticleId] = useState<string | null>(
		null,
	);

	async function handleGenerateArticle(topicId: string) {
		setGeneratingArticleId(topicId);
		try {
			const result = await requestGenerateArticle(topicId);
			if (!result.ok) {
				onError(`文章生成失败：${result.error}`);
				return;
			}
			const topic = topics.find((t) => t.id === topicId);
			const facts = topic?.facts;
			if (!isGossipFactsBlock(facts)) {
				onError("选题 facts 不是有效的 GossipFactsBlock，无法生成文章。");
				return;
			}
			onDraftReady({
				draft: result.draft,
				facts,
				qualityWarnings: result.qualityWarnings,
			});
		} catch (err) {
			onError(`文章生成失败：${err instanceof Error ? err.message : "请重试"}`);
		} finally {
			setGeneratingArticleId(null);
		}
	}

	function handleExportCsv() {
		if (topics.length === 0) return;
		const csv = exportTopicsAsCSV(topics);
		const date = new Date().toISOString().slice(0, 10);
		downloadFile(`topics-${date}.csv`, csv, "text/csv");
	}

	return (
		<main
			className="fade-in"
			style={{
				fontFamily: "system-ui, sans-serif",
				padding: "var(--space-lg)",
				fontSize: "var(--font-md)",
			}}
		>
			<TopicsToolbar
				busy={busy}
				topicsEmpty={topics.length === 0}
				quickDraftStatus={quickDraftStatus}
				onQuickDraft={() => void handleQuickDraft()}
				onExportCsv={handleExportCsv}
				onRefresh={() => void refresh()}
				onBack={onBack}
			/>

			{quickDraftStatus && !quickDraftConfirm && (
				<div
					className={
						quickDraftStatus.startsWith("待审池") ? "text-muted" : "text-info"
					}
					style={{
						fontSize: "var(--font-sm)",
						marginBottom: "var(--space-sm)",
					}}
				>
					{quickDraftStatus}
				</div>
			)}

			{quickDraftConfirm && (
				<GenerateConfirmDialog
					topics={quickDraftConfirm.topics}
					busy={busy}
					onConfirm={() => void handleQuickDraftConfirm()}
					onCancel={() => {
						setQuickDraftConfirm(null);
						setQuickDraftStatus("");
					}}
				/>
			)}

			{loading && <Loading />}

			{!loading && (
				<ThemePicker
					themes={themes}
					selected={selectedTheme}
					onSelect={setSelectedTheme}
					loading={themesLoading}
				/>
			)}

			{!loading && selectedTheme && (
				<div
					className="text-xs"
					style={{
						margin: "0 0 var(--space-sm)",
						padding: "var(--space-xs) var(--space-sm)",
						borderRadius: "var(--radius-sm)",
						background: "var(--color-info-bg, #e6f4ff)",
						color: "var(--color-text-muted)",
					}}
				>
					📁 题材池「{selectedTheme}」· 仅显示已核对的瓜(点「全部」返回待审列表)
				</div>
			)}

			{!loading && topics.length === 0 && (
				<div
					className="text-center text-muted"
					style={{ marginTop: "var(--space-xl)" }}
				>
					暂无待审核选题。
					<div
						style={{
							marginTop: "var(--space-md)",
							fontSize: "var(--font-sm)",
							color: "var(--color-text-disabled)",
						}}
					>
						可在「吃瓜站点」页发现文章并生成入池。
					</div>
				</div>
			)}

			{topics.length > 0 && (
				<>
					<div
						className="flex-between"
						style={{ marginBottom: "var(--space-md)", alignItems: "center" }}
					>
						<span className="text-sm text-muted">
							{topics.length} 条待审核 · 已选 {selected.size} 条
						</span>
						{topics.some((t) => (t.score ?? t.confidence) < 0.3) && (
							<button
								type="button"
								className="btn btn-plain btn-sm"
								onClick={() => setHideLowScore((v) => !v)}
								style={{ fontSize: "var(--font-xs)" }}
							>
								{hideLowScore ? "显示全部" : "折叠低分（< 0.3）"}
							</button>
						)}
					</div>

					<ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
						{topics
							.filter((t) => !hideLowScore || (t.score ?? t.confidence) >= 0.3)
							.map((t) => (
								<TopicListItem
									key={t.id}
									topic={t}
									checked={selected.has(t.id)}
									expanded={expanded.has(t.id)}
									editedFacts={localFacts[t.id]}
									busy={busy}
									onToggleSelect={() => toggleSelect(t.id)}
									onToggleExpand={() => toggleExpand(t.id, t.facts)}
									onFactChange={(key, value) => setFactField(t.id, key, value)}
									onVerify={() => handleVerify(t.id)}
									verifying={verifyingId === t.id}
									onGenerateArticle={
										isGossipFactsBlock(t.facts)
											? () => void handleGenerateArticle(t.id)
											: undefined
									}
									generatingArticle={generatingArticleId === t.id}
									generatingAnyArticle={generatingArticleId !== null}
								/>
							))}
					</ul>

					<BulkActionBar
						selectedCount={selected.size}
						busy={busy}
						approveError={approveError}
						onApprove={() => void handleApproveSelected()}
						onReject={() => void handleRejectSelected()}
						onRetryApprove={() => void handleApproveSelected()}
					/>
				</>
			)}
		</main>
	);
}
