import React, { useCallback, useEffect, useState } from "react";
import { downloadFile, exportTopicsAsCSV } from "../../lib/export";
import { resolveAdminTabId, runBatch } from "../../lib/messaging";
import {
	fetchAdapters,
	fetchPendingTopics,
	type PendingTopic,
	patchPendingTopic,
	triggerScrape,
	updatePendingStatus,
} from "../../lib/pending-client";
import { Loading } from "./Loading";

interface QuickDraftConfirm {
	topics: PendingTopic[];
}

interface Props {
	onBack: () => void;
	onBatchStarted: () => void;
	onError: (msg: string) => void;
}

const FACTS_KEYS = [
	"作品名",
	"集数",
	"制作",
	"漢化",
	"無修",
	"题材",
	"简介",
] as const;

export function PendingTopicsView({ onBack, onBatchStarted, onError }: Props) {
	const [topics, setTopics] = useState<PendingTopic[]>([]);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [localFacts, setLocalFacts] = useState<
		Record<string, Record<string, string>>
	>({});
	const [adapters, setAdapters] = useState<string[]>([]);
	const [scrapeStatus, setScrapeStatus] = useState("");
	const [busy, setBusy] = useState(false);
	const [loading, setLoading] = useState(true);
	const [hideLowScore, setHideLowScore] = useState(false);
	const [quickDraftConfirm, setQuickDraftConfirm] =
		useState<QuickDraftConfirm | null>(null);
	const [quickDraftStatus, setQuickDraftStatus] = useState("");

	const refresh = useCallback(async () => {
		setLoading(true);
		const list = await fetchPendingTopics({
			status: "pending",
			sort_by: "score",
			domain: "gossip",
		});
		setTopics(list);
		setLoading(false);
	}, []);

	useEffect(() => {
		void refresh();
		void fetchAdapters().then(setAdapters);
	}, [refresh]);

	function toggleSelect(id: string) {
		setSelected((prev) => {
			const next = new Set(prev);
			next.has(id) ? next.delete(id) : next.add(id);
			return next;
		});
	}

	function initLocalFacts(id: string, facts: Record<string, string>) {
		setLocalFacts((prev) => {
			if (prev[id] !== undefined) return prev;
			return { ...prev, [id]: { ...facts } };
		});
	}

	function toggleExpand(id: string, facts: Record<string, string>) {
		setExpanded((prev) => {
			const next = new Set(prev);
			next.has(id) ? next.delete(id) : next.add(id);
			return next;
		});
		initLocalFacts(id, facts);
	}

	function setFactField(id: string, key: string, value: string) {
		setLocalFacts((prev) => ({
			...prev,
			[id]: { ...(prev[id] ?? {}), [key]: value },
		}));
	}

	async function handleApproveSelected() {
		if (selected.size === 0) return;
		setBusy(true);
		try {
			const selectedTopics = topics.filter((t) => selected.has(t.id));

			await Promise.all(
				selectedTopics.map(async (t) => {
					const edited = localFacts[t.id];
					if (edited) await patchPendingTopic(t.id, { facts: edited });
					await updatePendingStatus(t.id, "approved");
				}),
			);

			const adminTabId = await resolveAdminTabId();
			if (adminTabId == null) {
				onError("未找到目标页标签——请先在浏览器打开目标页。");
				setBusy(false);
				return;
			}

			const topicList = selectedTopics.map((t) => t.title || t.sourceUrl);
			const factsList = selectedTopics.map((t) => localFacts[t.id] ?? t.facts);
			const coverUrls = selectedTopics.map((t) => t.coverImageUrl ?? "");
			const hasCoverUrls = coverUrls.some((u) => u !== "");
			await runBatch(
				topicList,
				adminTabId,
				factsList.length > 0 ? factsList : undefined,
				hasCoverUrls ? coverUrls : undefined,
			);

			setSelected(new Set());
			onBatchStarted();
		} catch {
			onError("操作失败,请重试。");
		} finally {
			setBusy(false);
		}
	}

	async function handleTriggerScrape() {
		const site = adapters[0] ?? null;
		if (!site) return;
		setScrapeStatus("抓取中…");
		try {
			await triggerScrape(site);
			await refresh();
		} finally {
			setScrapeStatus("");
		}
	}

	async function handleRejectSelected() {
		if (selected.size === 0) return;
		setBusy(true);
		try {
			const selectedTopics = topics.filter((t) => selected.has(t.id));
			await Promise.all(
				selectedTopics.map((t) =>
					updatePendingStatus(t.id, "rejected", "manual reject"),
				),
			);
			setSelected(new Set());
			await refresh();
		} catch {
			onError("操作失败,请重试。");
		} finally {
			setBusy(false);
		}
	}

	function handleExportCsv() {
		if (topics.length === 0) return;
		const csv = exportTopicsAsCSV(topics);
		const date = new Date().toISOString().slice(0, 10);
		downloadFile(`topics-${date}.csv`, csv, "text/csv");
	}

	async function handleQuickDraft() {
		setQuickDraftStatus("备稿中…");
		setQuickDraftConfirm(null);
		try {
			const sorted = await fetchPendingTopics({
				status: "pending",
				sort_by: "score",
				domain: "gossip",
			});
			if (sorted.length === 0) {
				setQuickDraftStatus("待审池暂无选题，请先抓取");
				return;
			}
			const top = sorted.slice(0, 3);
			setQuickDraftStatus("");
			setQuickDraftConfirm({ topics: top });
		} catch {
			setQuickDraftStatus("获取选题失败，请重试");
		}
	}

	async function handleQuickDraftConfirm() {
		if (!quickDraftConfirm) return;
		const confirmedTopics = quickDraftConfirm.topics;
		setQuickDraftConfirm(null);
		setQuickDraftStatus("");
		setSelected(new Set(confirmedTopics.map((t) => t.id)));
		setBusy(true);
		try {
			await Promise.all(
				confirmedTopics.map(async (t) => {
					const edited = localFacts[t.id];
					if (edited) await patchPendingTopic(t.id, { facts: edited });
					await updatePendingStatus(t.id, "approved");
				}),
			);
			const adminTabId = await resolveAdminTabId();
			if (adminTabId == null) {
				onError("未找到目标页标签——请先在浏览器打开目标页。");
				setBusy(false);
				return;
			}
			const topicList = confirmedTopics.map((t) => t.title || t.sourceUrl);
			const factsList = confirmedTopics.map((t) => localFacts[t.id] ?? t.facts);
			const coverUrls = confirmedTopics.map((t) => t.coverImageUrl ?? "");
			const hasCoverUrls = coverUrls.some((u) => u !== "");
			await runBatch(
				topicList,
				adminTabId,
				factsList.length > 0 ? factsList : undefined,
				hasCoverUrls ? coverUrls : undefined,
			);
			setSelected(new Set());
			onBatchStarted();
		} catch {
			onError("操作失败，请重试。");
		} finally {
			setBusy(false);
		}
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
			<nav className="flex-between mb-md">
				<h1 style={{ fontSize: "var(--font-xl)", margin: 0 }}>待审核选题</h1>
				<div className="flex gap-sm" style={{ alignItems: "center" }}>
					<button
						type="button"
						disabled={busy || adapters.length === 0}
						onClick={() => void handleQuickDraft()}
						className="btn btn-primary btn-sm"
					>
						{quickDraftStatus === "备稿中…" ? "备稿中…" : "今日一键备稿"}
					</button>
					<button
						type="button"
						disabled={busy || adapters.length === 0}
						onClick={() => void handleTriggerScrape()}
						className="btn btn-sm"
						style={{
							background:
								adapters.length > 0
									? "var(--color-warning)"
									: "var(--color-border-lighter)",
							color:
								adapters.length > 0 ? "#fff" : "var(--color-text-disabled)",
						}}
					>
						⚡ 立即抓取
					</button>
					<button
						type="button"
						disabled={topics.length === 0}
						onClick={handleExportCsv}
						className="btn btn-plain btn-sm"
					>
						导出 CSV
					</button>
					<button
						type="button"
						onClick={() => void refresh()}
						className="btn btn-plain btn-sm"
					>
						↻ 刷新
					</button>
					<button
						type="button"
						onClick={onBack}
						className="btn btn-plain btn-sm"
					>
						← 返回
					</button>
				</div>
			</nav>
			{scrapeStatus && (
				<div
					className="text-warning"
					style={{
						fontSize: "var(--font-sm)",
						marginBottom: "var(--space-sm)",
					}}
				>
					{scrapeStatus}
				</div>
			)}

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
				<div
					className="banner-info"
					style={{ marginBottom: "var(--space-md)" }}
				>
					<div
						className="font-semibold"
						style={{ marginBottom: "var(--space-lg)" }}
					>
						将生成 {quickDraftConfirm.topics.length} 篇草稿：
					</div>
					<ul
						style={{
							margin: "0 0 var(--space-md) 0",
							paddingLeft: "var(--space-xl)",
						}}
					>
						{quickDraftConfirm.topics.map((t) => (
							<li
								key={t.id}
								style={{
									marginBottom: "var(--space-xs)",
									fontSize: "var(--font-sm)",
									color: "var(--color-text)",
								}}
							>
								{t.title || t.sourceUrl}
							</li>
						))}
					</ul>
					<div style={{ display: "flex", gap: "var(--space-md)" }}>
						<button
							type="button"
							onClick={() => void handleQuickDraftConfirm()}
							disabled={busy}
							className="btn btn-primary btn-sm"
						>
							确认生成
						</button>
						<button
							type="button"
							onClick={() => {
								setQuickDraftConfirm(null);
								setQuickDraftStatus("");
							}}
							disabled={busy}
							className="btn btn-plain btn-sm"
						>
							取消
						</button>
					</div>
				</div>
			)}

			{loading && <Loading />}

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
						可通过后端 POST /api/v1/scraper/trigger 抓取新内容。
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
						{topics.some((t) => (t.qualityScore ?? t.confidence) < 0.3) && (
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
							.filter(
								(t) => !hideLowScore || (t.qualityScore ?? t.confidence) >= 0.3,
							)
							.map((t) => {
								const score = t.qualityScore ?? t.confidence;
								const isHigh = score >= 0.7;
								const isMed = score >= 0.4 && score < 0.7;
								return (
									<li
										key={t.id}
										style={{
											border: `1px solid ${isHigh ? "var(--color-success)" : "var(--color-border-lighter)"}`,
											borderRadius: "var(--radius-md)",
											marginBottom: "var(--space-sm)",
											opacity: score < 0.3 ? 0.6 : 1,
										}}
									>
										<div
											style={{
												display: "flex",
												alignItems: "center",
												padding: "var(--space-lg) var(--space-md)",
											}}
										>
											<input
												type="checkbox"
												checked={selected.has(t.id)}
												onChange={() => toggleSelect(t.id)}
												style={{ marginRight: "var(--space-md)" }}
												disabled={busy}
											/>
											<div style={{ flex: 1, minWidth: 0 }}>
												<div
													className="font-semibold"
													style={{
														fontSize: "var(--font-base)",
														overflow: "hidden",
														textOverflow: "ellipsis",
														whiteSpace: "nowrap",
														display: "flex",
														alignItems: "center",
														gap: 6,
													}}
												>
													{isHigh && (
														<span
															style={{
																fontSize: "var(--font-xs)",
																background: "var(--color-success)",
																color: "#fff",
																padding: "1px 5px",
																borderRadius: 4,
																flexShrink: 0,
															}}
														>
															高潜力
														</span>
													)}
													<span
														style={{
															overflow: "hidden",
															textOverflow: "ellipsis",
															whiteSpace: "nowrap",
														}}
													>
														{t.title || t.sourceUrl}
													</span>
												</div>
												<div
													className="text-xs text-muted"
													style={{ marginTop: "var(--space-xs)" }}
												>
													{t.siteName} ·{" "}
													<span
														style={{
															color: isHigh
																? "var(--color-success)"
																: isMed
																	? "var(--color-warning)"
																	: "var(--color-text-disabled)",
														}}
													>
														評分 {Math.round(score * 100)}
													</span>
													{" · "}
													{t.sourceUrl.slice(0, 50)}
												</div>
											</div>
											<button
												type="button"
												onClick={() => toggleExpand(t.id, t.facts)}
												aria-expanded={expanded.has(t.id)}
												className="btn btn-plain btn-sm text-secondary"
											>
												{expanded.has(t.id) ? "收起" : "详情"}
											</button>
										</div>

										{expanded.has(t.id) && (
											<div
												className="expand-enter"
												style={{
													padding: "var(--space-lg) var(--space-xl)",
													fontSize: "var(--font-sm)",
													borderTop: "1px solid var(--color-border-lighter)",
												}}
											>
												{t.coverImageUrl && (
													<img
														src={t.coverImageUrl}
														alt="封面"
														style={{
															maxHeight: 60,
															marginBottom: "var(--space-lg)",
															objectFit: "cover",
															borderRadius: "var(--radius-sm)",
														}}
													/>
												)}
												<div>
													<strong>事实（可编辑）:</strong>
													<div
														style={{
															marginTop: "var(--space-sm)",
															display: "grid",
															gridTemplateColumns: "4em 1fr",
															gap: "3px var(--space-lg)",
															alignItems: "center",
														}}
													>
														{FACTS_KEYS.map((key) => (
															<React.Fragment key={key}>
																<div
																	className="text-xs text-muted"
																	style={{ textAlign: "right" }}
																>
																	{key}
																</div>
																<input
																	type="text"
																	className="field-input"
																	value={
																		(localFacts[t.id] ?? t.facts)[key] ?? ""
																	}
																	onChange={(e) =>
																		setFactField(t.id, key, e.target.value)
																	}
																	disabled={busy}
																	style={{
																		fontSize: "var(--font-xs)",
																		padding: "1px var(--space-sm)",
																	}}
																/>
															</React.Fragment>
														))}
													</div>
												</div>
												{t.rawContent?.body && (
													<div
														style={{
															marginTop: "var(--space-lg)",
															maxHeight: 120,
															overflow: "auto",
															color: "var(--color-text-muted)",
															fontSize: "var(--font-xs)",
														}}
													>
														<strong>原始内容(前300字):</strong>
														<div style={{ marginTop: "var(--space-xs)" }}>
															{t.rawContent.body.slice(0, 300)}…
														</div>
													</div>
												)}
											</div>
										)}
									</li>
								);
							})}
					</ul>

					<div
						style={{
							display: "flex",
							gap: "var(--space-md)",
							marginTop: "var(--space-xl)",
						}}
					>
						<button
							type="button"
							onClick={() => void handleApproveSelected()}
							disabled={selected.size === 0 || busy}
							className="btn btn-primary"
						>
							{busy ? "处理中…" : `批准 (${selected.size}) → 批量`}
						</button>
						<button
							type="button"
							onClick={() => void handleRejectSelected()}
							disabled={selected.size === 0 || busy}
							className="btn btn-plain"
							style={{
								borderColor: "var(--color-border)",
								color:
									selected.size > 0 && !busy
										? "var(--color-error)"
										: "var(--color-text-disabled)",
							}}
						>
							拒绝
						</button>
					</div>
				</>
			)}
		</main>
	);
}
