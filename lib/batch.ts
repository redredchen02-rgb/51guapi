import type { ContentDraft, FieldFillResult } from "./types";

// 批量发布队列状态机(纯函数,无副作用/不碰 chrome)。
// background 拿它做编排,把异步效果(生成/填充/发布)的结果喂进来推进状态。
//
// 注意:后台只有**一个**新增表单,N 条草稿不能同时填进去(会互相覆盖)。
// 故批量在生成阶段**存草稿**(item.draft),审核看存的草稿数据;批准时再逐条
// 填进表单 → 发布。'filled' 在此语境 = "草稿已生成、待审",真正的表单填充发生在发布前。
//
// 安全脊柱(评审 reliability/adversarial 收敛):
//   - 幂等:发布前 background await 写 publish-dispatched,再发准许(见 publish-orchestrator)。
//   - 崩溃恢复:重启见 publish-dispatched 无回执 → needs-human-verification 隔离,**绝不自动重发**。
//   - 隔离退出:needs-human-verification 只能经显式人工动作离开;新批次不得重入已隔离同选题。
//   - 急停:KILL 把未发布项打到 aborted;已 confirmed 不回退;在途 dispatched 不动(在飞)。

export type BatchItemStatus =
	| "queued"
	| "generating"
	| "filled"
	| "awaiting-approval"
	| "publish-dispatched"
	| "publish-confirmed"
	| "needs-human-verification"
	| "aborted"
	| "error";

export interface BatchItem {
	id: string;
	topic: string;
	status: BatchItemStatus;
	/** 生成阶段存下的草稿;批准时填进表单 + 发布。 */
	draft?: ContentDraft;
	publishUrl?: string;
	error?: string;
	/** 操作者在批量审核界面是否手动编辑了草稿(直发率分母判断依据)。 */
	userEdited?: boolean;
	/** LLM 实际 token 用量(来自 response.usage;不可得时为估算,estimated=true)。 */
	llmCostTokens?: { prompt: number; completion: number; estimated?: boolean };
	/** 草稿生成耗时(ms)。 */
	generationDurationMs?: number;
	/** 填充字段结果(供 degrade 聚合 U4 使用)。 */
	fillResults?: FieldFillResult[];
	/** 发布时草稿快照(供 R5b slot-level diff 用)。 */
	publishedDraft?: ContentDraft;
}

export interface Batch {
	id: string;
	/** 钉住的目标 tab;每步发布前 background 须断言活动 tab==此 id 且 host 在名单。 */
	tabId: number;
	/** 创建时记录的授权 host(供 UI 字面展示核对)。 */
	authorizedHost: string;
	items: BatchItem[];
	createdAt: string;
}

export type BatchPhase =
	| "empty"
	| "generating"
	| "awaiting-approval"
	| "publishing"
	| "done";

const TERMINAL: ReadonlySet<BatchItemStatus> = new Set([
	"publish-confirmed",
	"aborted",
	"error",
	"needs-human-verification",
]);

export function isTerminal(s: BatchItemStatus): boolean {
	return TERMINAL.has(s);
}

export function createBatch(
	id: string,
	tabId: number,
	authorizedHost: string,
	topics: string[],
	now: string,
	genItemId: (index: number) => string,
): Batch {
	return {
		id,
		tabId,
		authorizedHost,
		createdAt: now,
		items: topics.map((topic, i) => ({
			id: genItemId(i),
			topic,
			status: "queued" as const,
		})),
	};
}

/** 不可变更新某一项;patch 合并进该项。其余项不动。 */
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

/** 仅当该项处于 expected 状态之一才推进(否则原样返回,防越级转移)。 */
function transition(
	batch: Batch,
	itemId: string,
	from: BatchItemStatus | BatchItemStatus[],
	patch: Partial<BatchItem>,
): Batch {
	const froms = Array.isArray(from) ? from : [from];
	const item = batch.items.find((it) => it.id === itemId);
	if (!item || !froms.includes(item.status)) return batch;
	return patchItem(batch, itemId, patch);
}

export function markGenerating(batch: Batch, itemId: string): Batch {
	return transition(batch, itemId, "queued", {
		status: "generating",
		userEdited: false,
	});
}

export function markFilled(
	batch: Batch,
	itemId: string,
	draft: ContentDraft,
	llmCostTokens?: BatchItem["llmCostTokens"],
	generationDurationMs?: number,
): Batch {
	return transition(batch, itemId, ["generating", "queued"], {
		status: "filled",
		draft,
		// 快照 AI 原稿(shallow copy;ContentDraft 含 string[] 但 batch 操作始终替换整个字段)。
		publishedDraft: { ...draft },
		...(llmCostTokens !== undefined ? { llmCostTokens } : {}),
		...(generationDurationMs !== undefined ? { generationDurationMs } : {}),
	});
}

/** 记录填充结果(degrade 聚合数据源)。不改变状态,仅 patch fillResults。 */
export function storeFillResults(
	batch: Batch,
	itemId: string,
	fillResults: FieldFillResult[],
): Batch {
	return patchItem(batch, itemId, { fillResults });
}

export function markGenerateFailed(
	batch: Batch,
	itemId: string,
	error: string,
): Batch {
	// 单条生成/填充失败标 error,不阻断其余。
	return transition(batch, itemId, ["queued", "generating", "filled"], {
		status: "error",
		error,
	});
}

/** 全部 filled 项 → awaiting-approval(批量呈现给人审)。 */
export function presentForApproval(batch: Batch): Batch {
	return {
		...batch,
		items: batch.items.map((it) =>
			it.status === "filled"
				? { ...it, status: "awaiting-approval" as const }
				: it,
		),
	};
}

export function markDispatched(batch: Batch, itemId: string): Batch {
	return transition(batch, itemId, "awaiting-approval", {
		status: "publish-dispatched",
	});
}

export function markConfirmed(
	batch: Batch,
	itemId: string,
	publishUrl?: string,
): Batch {
	return transition(batch, itemId, "publish-dispatched", {
		status: "publish-confirmed",
		...(publishUrl ? { publishUrl } : {}),
	});
}

/** 已回执但确未触发(no-publish-target / content-unreachable)→ 清回 error,不隔离。 */
export function markPublishFailed(
	batch: Batch,
	itemId: string,
	error: string,
): Batch {
	return transition(batch, itemId, "publish-dispatched", {
		status: "error",
		error,
	});
}

/** 急停:未发布项 → aborted;已 confirmed/terminal 不回退;在途 dispatched 不动(在飞)。 */
export function abortBatch(batch: Batch): Batch {
	const ABORTABLE: ReadonlySet<BatchItemStatus> = new Set([
		"queued",
		"generating",
		"filled",
		"awaiting-approval",
	]);
	return {
		...batch,
		items: batch.items.map((it) =>
			ABORTABLE.has(it.status) ? { ...it, status: "aborted" as const } : it,
		),
	};
}

/** 崩溃恢复:任何 publish-dispatched(无回执)→ needs-human-verification 隔离,绝不自动重发。 */
export function recoverBatch(batch: Batch): Batch {
	return {
		...batch,
		items: batch.items.map((it) =>
			it.status === "publish-dispatched"
				? {
						...it,
						status: "needs-human-verification" as const,
						error: "recovered-dispatched-no-confirm",
					}
				: it,
		),
	};
}

/** 显式人工退出隔离(人工已在后台核对)→ aborted 终态,v1 不自动重发。 */
export function releaseQuarantine(batch: Batch, itemId: string): Batch {
	return transition(batch, itemId, "needs-human-verification", {
		status: "aborted",
		error: "quarantine-released",
	});
}

/** 已隔离项的选题集合(新批次须排除,防自动重入同选题)。 */
export function quarantinedTopics(batch: Batch): string[] {
	return batch.items
		.filter((it) => it.status === "needs-human-verification")
		.map((it) => it.topic);
}

/** 从候选选题里剔除被隔离的同选题(去重保序)。 */
export function filterReentrantTopics(
	topics: string[],
	blocked: string[],
): string[] {
	const blockedSet = new Set(blocked);
	return topics.filter((t) => !blockedSet.has(t));
}

export function batchPhase(batch: Batch): BatchPhase {
	if (batch.items.length === 0) return "empty";
	const statuses = batch.items.map((it) => it.status);
	if (statuses.some((s) => s === "queued" || s === "generating"))
		return "generating";
	if (statuses.some((s) => s === "publish-dispatched")) return "publishing";
	if (statuses.some((s) => s === "filled" || s === "awaiting-approval"))
		return "awaiting-approval";
	return "done"; // 全部 terminal
}

export interface BatchSummary {
	total: number;
	awaitingApproval: number;
	confirmed: number;
	errored: number;
	quarantined: number;
	aborted: number;
}

export function batchSummary(batch: Batch): BatchSummary {
	const count = (s: BatchItemStatus) =>
		batch.items.filter((it) => it.status === s).length;
	return {
		total: batch.items.length,
		awaitingApproval: count("awaiting-approval"),
		confirmed: count("publish-confirmed"),
		errored: count("error"),
		quarantined: count("needs-human-verification"),
		aborted: count("aborted"),
	};
}
