import type { SlotDiff } from "./draft-diff";
import { scrubSnapshot } from "./secret-scrub";
import type { FieldFillResult, SafetyMode } from "./types";

// 填充/发布轨迹(工作区即状态,借 Webwright 理念)。每条发布落盘可审计记录,
// 作回放/回滚依据。脱敏是**运行时内存预写闸门**(非 git hook):快照清洗失败即不存(fail-closed)。
// 完整性:local:trajectory 可被任意扩展上下文改写 → v1 接受并文档化,加 seq + 轻量 hash 链做
// **篡改可检**(非阻止)。幂等标记(publish-dispatched)走另一存储键,不经此快照闸门。

export interface TrajectoryRecord {
	id: string;
	topic: string;
	/** 结构化字段填充结果(无值,天然低敏)。 */
	fields: FieldFillResult[];
	/** 已清洗 DOM 快照;清洗失败则省略(绝不存原始)。 */
	snapshot?: string;
	publishUrl?: string;
	status: string;
	ts: string;
	/** 是否以草稿/隐藏态发布(R9)。 */
	publishedAsDraft?: boolean;
	/** 序号 + hash 链:篡改可检。 */
	seq: number;
	hash: string;
	/** 发布档位(R6a 全档位度量)。旧记录无此字段。 */
	mode?: SafetyMode;
	/** 发布时是否手动改稿(直发率判断依据)。 */
	hasManualEdit?: boolean;
	/** LLM token 用量(R6b);不可得时为估算,estimated=true。 */
	llmCostTokens?: { prompt: number; completion: number; estimated?: boolean };
	/** 草稿生成耗时(ms)。 */
	generationDurationMs?: number;
	/** AI 原稿与最终发布草稿的 slot 级 diff(R5b)。 */
	slotDiff?: SlotDiff;
}

export interface TrajectoryInput {
	id: string;
	topic: string;
	fields: FieldFillResult[];
	/** 原始 DOM 快照(可选);经脱敏闸门后才落 record.snapshot。 */
	rawSnapshot?: string;
	publishUrl?: string;
	status: string;
	ts: string;
	publishedAsDraft?: boolean;
	mode?: SafetyMode;
	hasManualEdit?: boolean;
	llmCostTokens?: { prompt: number; completion: number; estimated?: boolean };
	generationDurationMs?: number;
	slotDiff?: SlotDiff;
}

const GENESIS_HASH = "0";

/** 极简非加密哈希(FNV-1a 32bit),用于"篡改可检"链(检测而非防止)。 */
function fnv1a(str: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < str.length; i += 1) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h.toString(16).padStart(8, "0");
}

/** 记录的规范化串(不含 hash 字段),用于链式哈希。 */
function canonical(rec: Omit<TrajectoryRecord, "hash">): string {
	return JSON.stringify([
		rec.seq,
		rec.id,
		rec.topic,
		rec.fields,
		rec.snapshot ?? null,
		rec.publishUrl ?? null,
		rec.status,
		rec.ts,
		rec.publishedAsDraft ?? null,
	]);
}

export interface BuildResult {
	record: TrajectoryRecord;
	/** 提供了 rawSnapshot 但清洗失败被丢弃(fail-closed)。 */
	snapshotDropped: boolean;
}

/** 构建一条 record(脱敏闸门 + 链式哈希)。seq/prevHash 由调用方按链尾传入。 */
export function buildRecord(
	input: TrajectoryInput,
	seq: number,
	prevHash: string,
): BuildResult {
	let snapshot: string | undefined;
	let snapshotDropped = false;
	if (input.rawSnapshot !== undefined) {
		const scrub = scrubSnapshot(input.rawSnapshot);
		if (scrub.ok) snapshot = scrub.snapshot;
		else snapshotDropped = true; // 清洗后仍含机密 → 绝不存原始
	}

	const base: Omit<TrajectoryRecord, "hash"> = {
		id: input.id,
		topic: input.topic,
		fields: input.fields,
		...(snapshot !== undefined ? { snapshot } : {}),
		...(input.publishUrl ? { publishUrl: input.publishUrl } : {}),
		status: input.status,
		ts: input.ts,
		...(input.publishedAsDraft !== undefined
			? { publishedAsDraft: input.publishedAsDraft }
			: {}),
		...(input.mode !== undefined ? { mode: input.mode } : {}),
		...(input.hasManualEdit !== undefined
			? { hasManualEdit: input.hasManualEdit }
			: {}),
		...(input.llmCostTokens !== undefined
			? { llmCostTokens: input.llmCostTokens }
			: {}),
		...(input.generationDurationMs !== undefined
			? { generationDurationMs: input.generationDurationMs }
			: {}),
		...(input.slotDiff !== undefined ? { slotDiff: input.slotDiff } : {}),
		seq,
	};
	const hash = fnv1a(prevHash + canonical(base));
	return { record: { ...base, hash }, snapshotDropped };
}

/** 追加一条 record 到链尾(纯函数,返回新数组 + 元信息)。 */
export function appendRecord(
	list: TrajectoryRecord[],
	input: TrajectoryInput,
): { list: TrajectoryRecord[]; snapshotDropped: boolean } {
	const last = list[list.length - 1];
	const seq = last ? last.seq + 1 : 1;
	const prevHash = last ? last.hash : GENESIS_HASH;
	const { record, snapshotDropped } = buildRecord(input, seq, prevHash);
	return { list: [...list, record], snapshotDropped };
}

/** 校验链:seq 连续且每条 hash 与重算一致 → 未被篡改。 */
export function verifyTrajectory(list: TrajectoryRecord[]): boolean {
	let prevHash = GENESIS_HASH;
	for (let i = 0; i < list.length; i += 1) {
		const rec = list[i]!;
		const expectedSeq = i === 0 ? 1 : list[i - 1]!.seq + 1;
		if (rec.seq !== expectedSeq) return false;
		const { hash, ...rest } = rec;
		if (fnv1a(prevHash + canonical(rest)) !== hash) return false;
		prevHash = hash;
	}
	return true;
}

/** 可回滚项:有 publishUrl 的 confirmed 记录(撤下/改回依据)。 */
export function rollbackTargets(list: TrajectoryRecord[]): TrajectoryRecord[] {
	return list.filter((r) => r.status === "publish-confirmed" && !!r.publishUrl);
}
