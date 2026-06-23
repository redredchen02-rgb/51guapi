import type { ContentDraft, ReviewResult } from "@51guapi/shared";
import { useState } from "react";
import {
	mergeRewriteResult,
	reviewDraft,
	rewriteDraft,
} from "../../lib/llm.js";
import { getSettings } from "../../lib/storage.js";

type Phase = "idle" | "reviewing" | "reviewed" | "rewriting" | "rewritten";

/**
 * AI 润色 / 改写面板:调后端 review/rewrite 端点,展示维度反馈,人工采纳改写结果。
 * - 采纳经 mergeRewriteResult:只改未达标维度,id/coverImageUrl 保留 original。
 * - 硬约束:只改本地草稿、绝不写回任何站点;改写正文仅以 textarea 只读源码展示,
 *   不做 HTML 渲染(沿用 DraftPreview 的 no-live-XSS 姿态;若未来加渲染须先消毒)。
 */
export function DraftReviewPanel({
	draft,
	onApply,
}: {
	draft: ContentDraft;
	onApply: (d: ContentDraft) => void;
}) {
	const [phase, setPhase] = useState<Phase>("idle");
	const [result, setResult] = useState<ReviewResult | null>(null);
	const [candidate, setCandidate] = useState<ContentDraft | null>(null);
	const [error, setError] = useState<string | null>(null);
	// 记录出错的操作,供错误态的「重试」重放对应请求(review 失败回 idle、rewrite 失败回 reviewed)。
	const [failedOp, setFailedOp] = useState<"review" | "rewrite" | null>(null);

	const failedDims = (result?.dimensions ?? [])
		.filter((d) => !d.pass)
		.map((d) => d.name);
	const busy = phase === "reviewing" || phase === "rewriting";

	async function runReview() {
		setError(null);
		setFailedOp(null);
		setCandidate(null);
		setPhase("reviewing");
		const settings = await getSettings();
		const res = await reviewDraft(draft, settings.reviewCriteriaPrompt, {
			settings,
			apiKey: "", // LlmDeps.apiKey 执行时被忽略(后端用自身 key)
		});
		if (!res.ok) {
			setError(res.error);
			setFailedOp("review");
			setPhase("idle");
			return;
		}
		setResult(res.result);
		setPhase("reviewed");
	}

	async function runRewrite() {
		setError(null);
		setFailedOp(null);
		setPhase("rewriting");
		const settings = await getSettings();
		const res = await rewriteDraft(draft, failedDims, {
			settings,
			apiKey: "", // LlmDeps.apiKey 执行时被忽略(后端用自身 key)
		});
		if (!res.ok) {
			setError(res.error);
			setFailedOp("rewrite");
			setPhase("reviewed");
			return;
		}
		setCandidate(mergeRewriteResult(draft, res.draft, failedDims));
		setPhase("rewritten");
	}

	function accept() {
		if (candidate) onApply(candidate);
		reset();
	}

	function reset() {
		setPhase("idle");
		setResult(null);
		setCandidate(null);
		setError(null);
		setFailedOp(null);
	}

	return (
		<div style={{ marginTop: "var(--space-lg)" }}>
			<div className="field-label">AI 润色 / 改写</div>
			<div
				style={{ display: "flex", gap: "var(--space-sm)", flexWrap: "wrap" }}
			>
				<button type="button" onClick={runReview} disabled={busy}>
					{phase === "reviewing" ? "评审中…" : "AI 评审"}
				</button>
				{phase !== "idle" && !busy && (
					<button type="button" onClick={reset}>
						清除
					</button>
				)}
			</div>

			{error && (
				<div
					role="alert"
					className="text-sm"
					style={{
						marginTop: "var(--space-sm)",
						color: "#c0392b",
						display: "flex",
						alignItems: "center",
						gap: "var(--space-md)",
					}}
				>
					<span style={{ flex: 1 }}>{error}</span>
					{failedOp && (
						<button
							type="button"
							onClick={failedOp === "review" ? runReview : runRewrite}
							disabled={busy}
							style={{ whiteSpace: "nowrap", flexShrink: 0 }}
						>
							重试
						</button>
					)}
				</div>
			)}

			{result && (
				<div style={{ marginTop: "var(--space-sm)" }}>
					<ul style={{ margin: 0, paddingLeft: "var(--space-lg)" }}>
						{(result.dimensions ?? []).map((d) => (
							<li key={d.name} className="text-sm">
								{d.pass ? "✅" : "❌"} {d.name}
								{d.reason ? `:${d.reason}` : ""}
							</li>
						))}
					</ul>
					{failedDims.length > 0 && phase === "reviewed" && (
						<button
							type="button"
							onClick={runRewrite}
							style={{ marginTop: "var(--space-sm)" }}
						>
							改写未达标维度({failedDims.length})
						</button>
					)}
					{failedDims.length === 0 && (
						<div
							className="text-sm text-muted"
							style={{ marginTop: "var(--space-sm)" }}
						>
							全部维度通过,无需改写。
						</div>
					)}
				</div>
			)}

			{phase === "rewriting" && (
				<div
					className="text-sm text-muted"
					style={{ marginTop: "var(--space-sm)" }}
				>
					改写中…
				</div>
			)}

			{candidate && phase === "rewritten" && (
				<div style={{ marginTop: "var(--space-sm)" }}>
					<div className="field-label">改写结果(正文源码,确认后采纳)</div>
					<textarea
						className="field-input"
						readOnly
						value={candidate.body}
						style={{ minHeight: 120, fontFamily: "monospace", width: "100%" }}
					/>
					<div
						style={{
							display: "flex",
							gap: "var(--space-sm)",
							marginTop: "var(--space-sm)",
						}}
					>
						<button type="button" onClick={accept}>
							采纳
						</button>
						<button type="button" onClick={reset}>
							放弃
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
