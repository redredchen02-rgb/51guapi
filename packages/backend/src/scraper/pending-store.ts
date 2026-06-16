import type { FactsBlock, GossipFactsBlock } from "@51guapi/shared";
import {
	type BetterSqlite3DB,
	getDb,
	pendingWriteQueue,
} from "./pending-db.js";
import type { RawContent } from "./site-adapter.js";
import type { EnrichedContext } from "./web-enricher.js";

export type PendingStatus = "pending" | "approved" | "rejected";

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
 *   score = fieldCompleteness × freshnessDecay × (1 − publishedPenalty)
 * - fieldCompleteness: {title, body, facts, coverImageUrl} 中非空字段占比
 * - freshnessDecay: exp(-daysSinceCreation / 7)，半衰期约 5 天
 * - publishedPenalty: 0.8（已发布 source_title 匹配），否则 0
 */
function computeScore(topic: PendingTopic, db: BetterSqlite3DB): number {
	const hasTitle = topic.title.trim().length > 0;
	const hasBody = !!topic.rawContent?.body?.trim();
	const hasFacts = Object.values(topic.facts ?? {}).some(
		(v) => v !== null && v !== undefined && v !== "",
	);
	const hasCover = !!topic.coverImageUrl;
	const fieldCompleteness =
		[hasTitle, hasBody, hasFacts, hasCover].filter(Boolean).length / 4;

	const parsedTs = Date.parse(topic.createdAt);
	const daysSince = Number.isNaN(parsedTs)
		? 0
		: (Date.now() - parsedTs) / (1000 * 60 * 60 * 24);
	const freshnessDecay = Math.exp(-daysSince / 7);

	let publishedPenalty = 0;
	try {
		const publishedTitles = getPublishedTitles(db);
		if (publishedTitles.has(topic.title)) publishedPenalty = 0.8;
	} catch {
		// 旧版 DB 不含 published_posts 表，跳过惩罚项
	}

	return fieldCompleteness * freshnessDecay * (1 - publishedPenalty);
}

// 缓存已发布的标题，避免 N+1 查询
let _publishedTitlesCache: Set<string> | null = null;

function getPublishedTitles(db: BetterSqlite3DB): Set<string> {
	if (_publishedTitlesCache) return _publishedTitlesCache;
	try {
		const rows = db
			.prepare("SELECT DISTINCT source_title FROM published_posts")
			.all() as { source_title: string }[];
		_publishedTitlesCache = new Set(
			rows.map((r) => r.source_title).filter(Boolean),
		);
	} catch {
		// published_posts 表可能不存在
		_publishedTitlesCache = new Set();
	}
	return _publishedTitlesCache;
}

export function invalidatePublishedTitlesCache(): void {
	_publishedTitlesCache = null;
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

		const score = computeScore(topic, db);

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
