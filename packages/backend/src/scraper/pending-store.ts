import type {
	FactsBlock,
	GossipFactsBlock,
	VerificationResult,
} from "@51guapi/shared";
import { isGossipFactsBlock } from "@51guapi/shared";
import { getDb, pendingWriteQueue } from "./pending-db.js";
import type { RawContent } from "./site-adapter.js";

export type PendingStatus = "pending" | "approved" | "rejected";

// 机械字段:来源连结=原文 URL,几乎恒非空,算进 facts 完整度等于白送分。与
// gossip-fact-extractor 的 confidence 口径保持一致(两处都剔除)。
const MECHANICAL_FACT_KEYS = new Set<string>(["來源連結"]);

const VALID_STATUSES: Set<string> = new Set([
	"pending",
	"approved",
	"rejected",
]);

function isValidPendingStatus(status: string): status is PendingStatus {
	return VALID_STATUSES.has(status);
}

export interface PendingTopic {
	id: string;
	sourceUrl: string;
	siteName: string;
	title: string;
	rawContent?: RawContent;
	facts: FactsBlock | GossipFactsBlock;
	confidence: number;
	status: PendingStatus;
	rejectedReason?: string;
	coverImageUrl?: string;
	score?: number;
	domain?: "acg" | "gossip";
	/** 内容指纹（跨 URL 去重；U3）。 */
	contentFingerprint?: string;
	/** 入池前验证结果（逐项判定/原因，供 UI 标红；U3）。 */
	verification?: VerificationResult;
	/** 人工二次核对通过时间戳；NULL=未核对，题材池只收非 NULL（U4）。 */
	verifiedAt?: string;
	createdAt: string;
	updatedAt: string;
}

export interface PendingTopicPatch {
	facts?: FactsBlock | GossipFactsBlock;
	confidence?: number;
	status?: PendingStatus;
	rejectedReason?: string;
	domain?: "acg" | "gossip";
}

interface PendingRow {
	id: string;
	source_url: string;
	site_name: string;
	title: string;
	raw_content: string;
	facts: string;
	confidence: number;
	status: string;
	rejected_reason: string | null;
	cover_image_url: string | null;
	score: number | null;
	domain: string;
	content_fingerprint: string | null;
	verification: string | null;
	verified_at: string | null;
	created_at: string;
	updated_at: string;
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T;
function safeJsonParse<T>(
	raw: string | null | undefined,
	fallback: undefined,
): T | undefined;
function safeJsonParse<T>(
	raw: string | null | undefined,
	fallback: T | undefined,
): T | undefined {
	if (!raw) return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

function rowToTopic(row: PendingRow): PendingTopic {
	const domain = row.domain === "gossip" ? "gossip" : "acg";
	return {
		id: row.id,
		sourceUrl: row.source_url,
		siteName: row.site_name,
		title: row.title,
		rawContent: safeJsonParse<RawContent>(row.raw_content, undefined),
		facts: safeJsonParse<FactsBlock | GossipFactsBlock>(row.facts, {}),
		confidence: row.confidence,
		status: isValidPendingStatus(row.status) ? row.status : "pending",
		rejectedReason: row.rejected_reason ?? undefined,
		coverImageUrl: row.cover_image_url ?? undefined,
		score: row.score ?? undefined,
		domain,
		contentFingerprint: row.content_fingerprint ?? undefined,
		verification: safeJsonParse<VerificationResult>(
			row.verification,
			undefined,
		),
		verifiedAt: row.verified_at ?? undefined,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

/**
 * 计算选题质量分 (0–1):
 *   score = fieldCompleteness × freshnessDecay × confidenceFactor
 * - fieldCompleteness: title/body/cover(布尔) + facts 真实非空占比(连续),取均值
 * - confidenceFactor: 0.5 + 0.5×confidence(软化,confidence=0 不归零)
 * - freshnessDecay: exp(-freshnessDays / 7)，新鲜度按事件/发布时间(见 freshnessDays)
 */
function computeScore(topic: PendingTopic): number {
	const hasTitle = topic.title.trim().length > 0 ? 1 : 0;
	const hasBody = topic.rawContent?.body?.trim() ? 1 : 0;
	const hasCover = topic.coverImageUrl ? 1 : 0;
	// facts 完整度用「真实非空占比」(0..1) 而非「任一非空即满分」——否则只填 1 个
	// 字段的垃圾草稿与 8 事实全满的优质草稿同分,排序失真。剔除机械字段(来源连结=原文
	// URL,LLM 几乎恒能填),与 gossip-fact-extractor 的 confidence 口径一致,避免白送分。
	const factsEntries = Object.entries(topic.facts ?? {}).filter(
		([k]) => !MECHANICAL_FACT_KEYS.has(k),
	);
	const factsCompleteness = factsEntries.length
		? factsEntries.filter(([, v]) => v !== null && v !== undefined && v !== "")
				.length / factsEntries.length
		: 0;
	const fieldCompleteness =
		(hasTitle + hasBody + hasCover + factsCompleteness) / 4;

	const freshnessDecay = Math.exp(-freshnessDays(topic) / 7);

	// confidence 因子:把提炼置信度纳入排序,但用 0.5+0.5×confidence 软化——confidence=0
	// 的旧数据不被归零(仍按完整度计分),高 confidence 则获加成。
	const confidenceFactor = 0.5 + 0.5 * clamp01(topic.confidence);

	return fieldCompleteness * freshnessDecay * confidenceFactor;
}

function clamp01(n: number): number {
	if (Number.isNaN(n)) return 0;
	return Math.max(0, Math.min(1, n));
}

/** 时间未知时的中性新鲜度天数:decay=exp(-7/7)≈0.37,中等档。 */
const NEUTRAL_FRESHNESS_DAYS = 7;

/**
 * 新鲜度参照「天数」:只认事件/发布时间。基准依序取:
 *   rawContent.metadata.publishedTime → facts.發生時間。
 * 任一不可解析(如「2024年5月」)即跳到下一个。负值(未来时间)归 0。
 * **皆缺失/不可解析 → 中性兜底(NEUTRAL_FRESHNESS_DAYS),绝不回退 createdAt(入库时间)。**
 * 理由(R2):createdAt≈now 会让「无日期的旧瓜」恒判满分新鲜、排到有日期的近期瓜之上,
 * 反噬时间窗目标。时间未知应判中性(交人工二次核对),而非冒充最新。
 */
function freshnessDays(topic: PendingTopic): number {
	const facts = topic.facts as Record<string, unknown> | undefined;
	const candidates = [
		topic.rawContent?.metadata?.publishedTime,
		typeof facts?.發生時間 === "string" ? facts.發生時間 : undefined,
	];
	for (const c of candidates) {
		if (!c) continue;
		const ts = Date.parse(c);
		if (!Number.isNaN(ts)) {
			return Math.max(0, (Date.now() - ts) / (1000 * 60 * 60 * 24));
		}
	}
	return NEUTRAL_FRESHNESS_DAYS;
}

export async function pendingTopicExistsBySourceUrl(
	url: string,
): Promise<boolean> {
	const db = getDb();
	return (
		db.prepare("SELECT 1 FROM pending_topics WHERE source_url = ?").get(url) !==
		undefined
	);
}

/**
 * 批量存在性查询：返回 urls 中已在 pending_topics 的 source_url 集合。
 * 单次 WHERE IN (...) 代替 discover 端点 O(n) 逐 URL .get()，最多 200 条仍一次 roundtrip。
 * 空 urls 返回空 Set（不发 SQL 以避免 IN() 语法错误）。
 */
export function pendingTopicsExistingBySourceUrls(urls: string[]): Set<string> {
	if (urls.length === 0) return new Set();
	const db = getDb();
	const placeholders = urls.map(() => "?").join(", ");
	const rows = db
		.prepare(
			`SELECT source_url FROM pending_topics WHERE source_url IN (${placeholders})`,
		)
		.all(...urls) as { source_url: string }[];
	return new Set(rows.map((r) => r.source_url));
}

/** 内容指纹是否已存在（跨 URL 去重；命中视为「疑似重复」，由调用方软标处理）。 */
export async function pendingTopicExistsByFingerprint(
	fingerprint: string,
): Promise<boolean> {
	if (!fingerprint) return false;
	const db = getDb();
	return (
		db
			.prepare("SELECT 1 FROM pending_topics WHERE content_fingerprint = ?")
			.get(fingerprint) !== undefined
	);
}

export async function loadPendingTopic(
	id: string,
): Promise<PendingTopic | null> {
	const db = getDb();
	const row = db.prepare("SELECT * FROM pending_topics WHERE id = ?").get(id) as
		| PendingRow
		| undefined;
	return row ? rowToTopic(row) : null;
}

export async function savePendingTopic(
	topic: PendingTopic,
): Promise<{ inserted: boolean }> {
	const db = getDb();
	topic.updatedAt = new Date().toISOString();
	return pendingWriteQueue.enqueue(() => {
		// 跨会话去重：source_url 已存在但 id 不同 → 跳过，不插入
		const existing = db
			.prepare("SELECT id FROM pending_topics WHERE source_url = ?")
			.get(topic.sourceUrl) as { id: string } | undefined;

		if (existing && existing.id !== topic.id) {
			return { inserted: false };
		}

		const score = computeScore(topic);

		try {
			db.prepare(
				`
      INSERT INTO pending_topics
        (id, source_url, site_name, title, raw_content, facts, confidence, status,
         rejected_reason, cover_image_url, score, domain,
         content_fingerprint, verification, verified_at, created_at, updated_at)
      VALUES
        (@id, @sourceUrl, @siteName, @title, @rawContent, @facts, @confidence, @status,
         @rejectedReason, @coverImageUrl, @score, @domain,
         @contentFingerprint, @verification, @verifiedAt, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        source_url = excluded.source_url,
        site_name  = excluded.site_name,
        title      = excluded.title,
        raw_content = excluded.raw_content,
        facts      = excluded.facts,
        confidence = excluded.confidence,
        status     = excluded.status,
        rejected_reason = excluded.rejected_reason,
        cover_image_url = excluded.cover_image_url,
        score      = excluded.score,
        domain     = excluded.domain,
        content_fingerprint = excluded.content_fingerprint,
        verification = excluded.verification,
        verified_at = excluded.verified_at,
        updated_at = excluded.updated_at
    `,
			).run({
				id: topic.id,
				sourceUrl: topic.sourceUrl,
				siteName: topic.siteName,
				title: topic.title,
				rawContent: topic.rawContent ? JSON.stringify(topic.rawContent) : "{}",
				facts: JSON.stringify(topic.facts),
				confidence: topic.confidence,
				status: topic.status,
				rejectedReason: topic.rejectedReason ?? null,
				coverImageUrl: topic.coverImageUrl ?? null,
				score,
				domain: topic.domain ?? "acg",
				contentFingerprint: topic.contentFingerprint ?? null,
				verification: topic.verification
					? JSON.stringify(topic.verification)
					: null,
				verifiedAt: topic.verifiedAt ?? null,
				createdAt: topic.createdAt,
				updatedAt: topic.updatedAt,
			});
		} catch (e: unknown) {
			// UNIQUE constraint on source_url — treat as duplicate
			if (
				typeof e === "object" &&
				e !== null &&
				"code" in e &&
				(e as { code: string }).code === "SQLITE_CONSTRAINT_UNIQUE"
			) {
				return { inserted: false };
			}
			throw e;
		}

		// existing 且同 id → upsert 更新；不存在 → 新插入
		return { inserted: existing === undefined };
	});
}

export async function listPendingTopics(
	limit?: number,
	status?: PendingStatus,
	sortBy?: "score" | "created_at",
	domain?: "acg" | "gossip",
): Promise<PendingTopic[]> {
	const db = getDb();
	const cap = Math.min(Math.max(limit ?? 50, 1), 500);
	// 使用 COALESCE 替代 NULLS LAST 以兼容旧版 SQLite (< 3.30.0)
	const orderCol =
		sortBy === "score" ? "COALESCE(score, 0) DESC" : "created_at DESC";

	const conditions: string[] = [];
	const params: unknown[] = [];
	if (status !== undefined) {
		conditions.push("status = ?");
		params.push(status);
	}
	if (domain !== undefined) {
		conditions.push("domain = ?");
		params.push(domain);
	}
	const where =
		conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
	params.push(cap);

	const rows = db
		.prepare(
			`SELECT * FROM pending_topics ${where} ORDER BY ${orderCol} LIMIT ?`,
		)
		.all(...params) as PendingRow[];
	return rows.map(rowToTopic);
}

/** 只拉 facts 欄位用於 theme 計數，不受 500 列表上限限制。格式無效的 row 靜默過濾。 */
export function listGossipPendingFacts(onlyVerified: boolean): GossipFactsBlock[] {
	const db = getDb();
	const sql = onlyVerified
		? "SELECT facts FROM pending_topics WHERE domain = 'gossip' AND status = 'pending' AND verified_at IS NOT NULL"
		: "SELECT facts FROM pending_topics WHERE domain = 'gossip' AND status = 'pending'";
	const rows = db.prepare(sql).all() as { facts: string }[];
	return rows
		.map((r) => safeJsonParse<unknown>(r.facts, null))
		.filter((v): v is GossipFactsBlock => isGossipFactsBlock(v));
}

export async function deletePendingTopic(id: string): Promise<void> {
	const db = getDb();
	await pendingWriteQueue.enqueue(() => {
		db.prepare("DELETE FROM pending_topics WHERE id = ?").run(id);
	});
}

export async function updatePendingTopicStatus(
	id: string,
	status: PendingStatus,
	rejectedReason?: string,
): Promise<PendingTopic | null> {
	const db = getDb();
	const now = new Date().toISOString();
	return pendingWriteQueue.enqueue(() => {
		const result = db
			.prepare(
				"UPDATE pending_topics SET status = ?, rejected_reason = ?, updated_at = ? WHERE id = ? RETURNING *",
			)
			.get(status, rejectedReason ?? null, now, id) as PendingRow | undefined;
		return result ? rowToTopic(result) : null;
	});
}
