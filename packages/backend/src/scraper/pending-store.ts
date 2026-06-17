import type { FactsBlock, GossipFactsBlock } from "@51guapi/shared";
import { getDb, pendingWriteQueue } from "./pending-db.js";
import type { RawContent } from "./site-adapter.js";
import type { EnrichedContext } from "./web-enricher.js";

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
	enrichment?: EnrichedContext;
	domain?: "acg" | "gossip";
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
	enrichment: string | null;
	domain: string;
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
		enrichment: safeJsonParse<EnrichedContext>(row.enrichment, undefined),
		domain,
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

/**
 * 新鲜度参照「天数」:优先事件/发布时间,createdAt(入库时间)仅兜底。
 * 否则刚爬的 3 年前旧瓜会因 createdAt≈now 恒判新鲜。基准依序取:
 *   rawContent.metadata.publishedTime → facts.發生時間 → createdAt。
 * 任一不可解析(如「2024年5月」)即跳到下一个;全失败退回 createdAt。负值(未来时间)归 0。
 */
function freshnessDays(topic: PendingTopic): number {
	const facts = topic.facts as Record<string, unknown> | undefined;
	const candidates = [
		topic.rawContent?.metadata?.publishedTime,
		typeof facts?.發生時間 === "string" ? facts.發生時間 : undefined,
		topic.createdAt,
	];
	for (const c of candidates) {
		if (!c) continue;
		const ts = Date.parse(c);
		if (!Number.isNaN(ts)) {
			return Math.max(0, (Date.now() - ts) / (1000 * 60 * 60 * 24));
		}
	}
	return 0;
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
         rejected_reason, cover_image_url, score, enrichment, domain, created_at, updated_at)
      VALUES
        (@id, @sourceUrl, @siteName, @title, @rawContent, @facts, @confidence, @status,
         @rejectedReason, @coverImageUrl, @score, @enrichment, @domain, @createdAt, @updatedAt)
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
        enrichment = excluded.enrichment,
        domain     = excluded.domain,
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
				enrichment: topic.enrichment ? JSON.stringify(topic.enrichment) : null,
				domain: topic.domain ?? "gossip",
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
