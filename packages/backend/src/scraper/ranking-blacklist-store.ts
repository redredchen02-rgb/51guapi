import { getDb, pendingWriteQueue } from "./pending-db.js";

export function addToBlacklist(keyword: string): Promise<void> {
	return pendingWriteQueue.enqueue(() => {
		getDb()
			.prepare(
				"INSERT OR IGNORE INTO ranking_blacklist (keyword, hidden_at) VALUES (?, ?)",
			)
			.run(keyword, new Date().toISOString());
	});
}

export function getBlacklistSet(): Set<string> {
	const rows = getDb()
		.prepare("SELECT keyword FROM ranking_blacklist")
		.all() as { keyword: string }[];
	return new Set(rows.map((r) => r.keyword));
}

export function clearBlacklistForTest(): void {
	getDb().prepare("DELETE FROM ranking_blacklist").run();
}
