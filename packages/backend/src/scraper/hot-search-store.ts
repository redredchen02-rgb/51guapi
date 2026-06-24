import { getDb, pendingWriteQueue } from "./pending-db.js";

export interface HotSearchKeyword {
	id: string;
	keyword: string;
	platform: "baidu" | "weibo" | "douyin" | "xiaohongshu";
	heatScore: number;
	rankPosition: number;
	capturedAt: string;
	expiresAt: string;
}

interface HotSearchRow {
	id: string;
	keyword: string;
	platform: string;
	heat_score: number;
	rank_position: number;
	captured_at: string;
	expires_at: string;
}

function rowToKeyword(row: HotSearchRow): HotSearchKeyword {
	return {
		id: row.id,
		keyword: row.keyword,
		platform: row.platform as HotSearchKeyword["platform"],
		heatScore: row.heat_score,
		rankPosition: row.rank_position,
		capturedAt: row.captured_at,
		expiresAt: row.expires_at,
	};
}

export function upsertHotSearchBatch(rows: HotSearchKeyword[]): void {
	pendingWriteQueue.enqueue(() => {
		const db = getDb();
		const stmt = db.prepare(`
			INSERT OR REPLACE INTO hot_search_keywords
			  (id, keyword, platform, heat_score, rank_position, captured_at, expires_at)
			VALUES (@id, @keyword, @platform, @heatScore, @rankPosition, @capturedAt, @expiresAt)
		`);
		const insertAll = db.transaction((items: HotSearchKeyword[]) => {
			for (const row of items) stmt.run(row);
		});
		insertAll(rows);
	});
}

export function listHotSearchKeywords(): HotSearchKeyword[] {
	const now = new Date().toISOString();
	const rows = getDb()
		.prepare(
			"SELECT * FROM hot_search_keywords WHERE expires_at > ? ORDER BY platform, rank_position ASC",
		)
		.all(now) as HotSearchRow[];
	return rows.map(rowToKeyword);
}

export function cleanupExpiredHotSearch(): void {
	pendingWriteQueue.enqueue(() => {
		const now = new Date().toISOString();
		getDb()
			.prepare("DELETE FROM hot_search_keywords WHERE expires_at <= ?")
			.run(now);
	});
}

export function clearHotSearchForTest(): void {
	getDb().prepare("DELETE FROM hot_search_keywords").run();
}
