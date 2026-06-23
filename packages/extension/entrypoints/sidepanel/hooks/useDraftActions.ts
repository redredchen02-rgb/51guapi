import type { ContentDraft, GossipFactsBlock } from "@51guapi/shared";
import { GOSSIP_FACT_KEYS } from "@51guapi/shared";
import { useState } from "react";
import type { PendingTopic } from "../../../lib/pending-client";
import {
	fetchPendingTopics,
	patchPendingTopic,
	setPendingVerified,
	updatePendingStatus,
} from "../../../lib/pending-client";
import type { useDraftGeneration } from "./useDraftGeneration";

interface DraftActionsInput {
	topics: PendingTopic[];
	localFacts: Record<string, Record<string, string>>;
	selected: Set<string>;
	setSelected: (fn: (prev: Set<string>) => Set<string>) => void;
	generate: ReturnType<typeof useDraftGeneration>["generate"];
	refresh: () => Promise<void>;
	refreshThemes: () => Promise<void>;
	onDraftReady: (payload: {
		draft: ContentDraft;
		facts: GossipFactsBlock;
	}) => void;
	onError: (msg: string) => void;
}

function buildGossipPrompt(
	topic: PendingTopic,
	editedFacts?: Record<string, string>,
): string {
	const facts = editedFacts ?? topic.facts;
	const lines = GOSSIP_FACT_KEYS.filter(
		(k) => facts[k] != null && facts[k] !== "",
	).map((k) => `- ${k}：${facts[k]}`);
	const factsBlock =
		lines.length > 0
			? `\n\n【吃瓜事实】（只能使用以下事实，严禁编造）：\n${lines.join("\n")}`
			: "";
	return `${topic.title || topic.sourceUrl}${factsBlock}`;
}

function toGossipFacts(facts: Record<string, string>): GossipFactsBlock {
	const out = {} as GossipFactsBlock;
	for (const key of GOSSIP_FACT_KEYS) {
		const value = facts[key];
		out[key] = value == null || value === "" ? null : value;
	}
	return out;
}

export function useDraftActions({
	topics,
	localFacts,
	selected,
	setSelected,
	generate,
	refresh,
	refreshThemes,
	onDraftReady,
	onError,
}: DraftActionsInput) {
	const [busy, setBusy] = useState(false);
	const [approveError, setApproveError] = useState<string | null>(null);
	const [verifyingId, setVerifyingId] = useState<string | null>(null);
	const [quickDraftConfirm, setQuickDraftConfirm] = useState<{
		topics: PendingTopic[];
	} | null>(null);
	const [quickDraftStatus, setQuickDraftStatus] = useState("");

	async function handleVerify(id: string) {
		setVerifyingId(id);
		try {
			const edited = localFacts[id];
			if (edited) await patchPendingTopic(id, { facts: edited });
			const ok = await setPendingVerified(id, true);
			if (ok) {
				await refresh();
				await refreshThemes();
			}
		} catch {
			onError("核对失败,请重试。");
		} finally {
			setVerifyingId(null);
		}
	}

	async function handleApproveSelected() {
		if (selected.size === 0) return;
		const t = topics.find((t) => selected.has(t.id));
		if (!t) return;
		setBusy(true);
		setApproveError(null);
		try {
			const edited = localFacts[t.id];
			if (edited) await patchPendingTopic(t.id, { facts: edited });
			const approvedFacts = toGossipFacts(edited ?? t.facts);
			const prompt = buildGossipPrompt(t, edited);
			const result = await generate(prompt, { facts: approvedFacts });
			if (result.status === "exception") throw result.error;
			if (result.status === "ok") {
				await updatePendingStatus(t.id, "approved");
				setSelected((prev) => {
					const next = new Set(prev);
					next.delete(t.id);
					return next;
				});
				onDraftReady({ draft: result.draft, facts: approvedFacts });
			} else {
				setApproveError(
					result.status === "no-key"
						? "后端缺少 LLM_API_KEY,请在 packages/backend/.env 中配置后重启服务"
						: `生成草稿失败：${result.error}`,
				);
			}
		} catch (err) {
			setApproveError(
				`生成草稿失败：${err instanceof Error ? err.message : "请重试"}`,
			);
		} finally {
			setBusy(false);
		}
	}

	async function handleRejectSelected() {
		if (selected.size === 0) return;
		setBusy(true);
		try {
			const selectedTopics = topics.filter((t) => selected.has(t.id));
			await Promise.all(
				selectedTopics.map((t) =>
					updatePendingStatus(t.id, "rejected", "other"),
				),
			);
			setSelected(() => new Set());
			await refresh();
		} catch {
			onError("操作失败,请重试。");
		} finally {
			setBusy(false);
		}
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
			const top = sorted[0];
			if (!top) {
				setQuickDraftStatus("待审池暂无选题，请先抓取");
				return;
			}
			setQuickDraftStatus("");
			setQuickDraftConfirm({ topics: [top] });
		} catch {
			setQuickDraftStatus("获取选题失败，请重试");
		}
	}

	async function handleQuickDraftConfirm() {
		if (!quickDraftConfirm) return;
		const [t] = quickDraftConfirm.topics;
		if (!t) return;
		setQuickDraftConfirm(null);
		setQuickDraftStatus("");
		setBusy(true);
		setApproveError(null);
		try {
			const edited = localFacts[t.id];
			if (edited) await patchPendingTopic(t.id, { facts: edited });
			const approvedFacts = toGossipFacts(edited ?? t.facts);
			const prompt = buildGossipPrompt(t, edited);
			const result = await generate(prompt, { facts: approvedFacts });
			if (result.status === "exception") throw result.error;
			if (result.status === "ok") {
				await updatePendingStatus(t.id, "approved");
				setSelected(() => new Set());
				onDraftReady({ draft: result.draft, facts: approvedFacts });
			} else {
				setApproveError(
					result.status === "no-key"
						? "后端缺少 LLM_API_KEY,请在 packages/backend/.env 中配置后重启服务"
						: `生成草稿失败：${result.error}`,
				);
			}
		} catch (err) {
			onError(`操作失败：${err instanceof Error ? err.message : "请重试"}`);
		} finally {
			setBusy(false);
		}
	}

	return {
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
	};
}
