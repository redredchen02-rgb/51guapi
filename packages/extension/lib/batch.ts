import type { ContentDraft, FactsBlock } from "@51guapi/shared";

// 生成专用批次类型(U1:发布/填充状态机已拆除)。
// 这里只保留「逐条生成草稿 → 存盘 → 侧栏读取预览」所需的最小状态面。
// 完整的发布/填充状态机已随发布机器一并删除;若后续需要更细的生成状态,
// 由 U6 就地新增,不复用旧发布状态机。

/** 生成阶段状态:排队 → 生成中 → 已生成草稿(待预览/导出)/ 失败。 */
export type BatchItemStatus =
	| "queued"
	| "generating"
	| "filled"
	| "awaiting-approval"
	| "error";

// RUN_BATCH 管线保留 ACG FactsBlock 类型（不迁移到 GossipFactsBlock），
// 因为吃瓜管线使用 GENERATE_DRAFT 单条路径，不经过批量处理器。
export interface BatchItem {
	id: string;
	topic: string;
	facts?: FactsBlock;
	status: BatchItemStatus;
	coverImageUrl?: string;
	draft?: ContentDraft;
	error?: string;
	userEdited?: boolean;
	llmCostTokens?: { prompt: number; completion: number; estimated?: boolean };
	generationDurationMs?: number;
	pendingTopicId?: string;
	enrichment?: string;
}

export interface Batch {
	id: string;
	tabId: number;
	createdAt: string;
	items: BatchItem[];
}

/** 加载时的轻量恢复:把上次 SW 被杀时卡在 generating 的条目标记为 error,可重试。 */
export function recoverBatch(batch: Batch): Batch {
	let changed = false;
	const items = batch.items.map((it) => {
		if (it.status === "generating") {
			changed = true;
			return {
				...it,
				status: "error" as const,
				error: "SW restarted during generation",
			};
		}
		return it;
	});
	return changed ? { ...batch, items } : batch;
}

export function createBatch(
	id: string,
	tabId: number,
	topics: string[],
	now: string,
	genItemId: (index: number) => string,
	facts?: (FactsBlock | undefined)[],
	coverImageUrls?: (string | undefined)[],
	pendingTopicIds?: (string | undefined)[],
	enrichments?: (string | undefined)[],
): Batch {
	return {
		id,
		tabId,
		createdAt: now,
		items: topics.map((topic, i) => {
			const f = facts?.[i];
			const cover = coverImageUrls?.[i];
			const tid = pendingTopicIds?.[i];
			const enr = enrichments?.[i];
			return {
				id: genItemId(i),
				topic,
				status: "queued" as const,
				...(f ? { facts: f } : {}),
				...(cover ? { coverImageUrl: cover } : {}),
				...(tid ? { pendingTopicId: tid } : {}),
				...(enr ? { enrichment: enr } : {}),
			};
		}),
	};
}

function patchItem(
	batch: Batch,
	itemId: string,
	patch: Partial<BatchItem>,
): Batch {
	return {
		...batch,
		items: batch.items.map((it) =>
			it.id === itemId ? { ...it, ...patch } : it,
		),
	};
}

export function markGenerating(batch: Batch, itemId: string): Batch {
	return patchItem(batch, itemId, { status: "generating", userEdited: false });
}

/** 草稿生成完成 → filled(= 已生成、待预览/导出)。 */
export function markFilled(
	batch: Batch,
	itemId: string,
	draft: ContentDraft,
	llmCostTokens?: BatchItem["llmCostTokens"],
	generationDurationMs?: number,
): Batch {
	return patchItem(batch, itemId, {
		status: "filled",
		draft,
		...(llmCostTokens ? { llmCostTokens } : {}),
		...(generationDurationMs != null ? { generationDurationMs } : {}),
	});
}

export function markGenerateFailed(
	batch: Batch,
	itemId: string,
	error: string,
): Batch {
	return patchItem(batch, itemId, { status: "error", error });
}
