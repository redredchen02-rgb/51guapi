import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dataDirEnv } from "../config/data-dir.js";
import { getDb, pendingWriteQueue } from "./pending-db.js";

export interface GossipSiteConfig {
	id: string;
	name: string;
	listUrl: string;
	enabled: boolean;
	createdAt: string;
	updatedAt: string;
	lastDiscoverAt?: string | null;
	lastDiscoverCount?: number | null;
}

export interface GossipSiteCreate {
	name: string;
	listUrl: string;
}

// ---- SQLite 持久层（gossip_sites 表;原 JSON 文件轨已迁入,见 migration 013） ----

interface GossipSiteRow {
	id: string;
	name: string;
	list_url: string;
	enabled: number;
	created_at: string;
	updated_at: string;
	last_discover_at: string | null;
	last_discover_count: number | null;
}

function rowToSite(row: GossipSiteRow): GossipSiteConfig {
	return {
		id: row.id,
		name: row.name,
		listUrl: row.list_url,
		enabled: row.enabled !== 0,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		lastDiscoverAt: row.last_discover_at ?? null,
		lastDiscoverCount: row.last_discover_count ?? null,
	};
}

function insertSite(c: GossipSiteConfig, replace: boolean): void {
	const verb = replace ? "INSERT OR REPLACE" : "INSERT OR IGNORE";
	getDb()
		.prepare(
			`${verb} INTO gossip_sites
			   (id, name, list_url, enabled, created_at, updated_at)
			 VALUES (@id, @name, @listUrl, @enabled, @createdAt, @updatedAt)`,
		)
		.run({
			id: c.id,
			name: c.name,
			listUrl: c.listUrl,
			enabled: c.enabled ? 1 : 0,
			createdAt: c.createdAt,
			updatedAt: c.updatedAt,
		});
}

/** discover 完成後更新站點的最後爬取時間和新增條目數（migration 018 新增欄位）。 */
export function updateDiscoverStats(id: string, count: number): void {
	pendingWriteQueue.enqueue(() => {
		getDb()
			.prepare(
				"UPDATE gossip_sites SET last_discover_at = ?, last_discover_count = ? WHERE id = ?",
			)
			.run(new Date().toISOString(), count, id);
	});
}

// ---- 一次性 JSON→SQLite backfill（幂等;现网通常 0 行,目录多不存在） ----
const GOSSIP_SITES_DIR = join(
	dataDirEnv() ||
		join(dirname(new URL(import.meta.url).pathname), "..", "data"),
	"gossip-sites",
);

let backfilled = false;

async function ensureBackfilled(): Promise<void> {
	if (backfilled) return;
	backfilled = true;
	let files: string[];
	try {
		files = (await readdir(GOSSIP_SITES_DIR)).filter((f) =>
			f.endsWith(".json"),
		);
	} catch {
		return; // 目录不存在 → 无遗留 JSON,纯 SQLite。
	}
	for (const f of files) {
		try {
			const raw = JSON.parse(
				await readFile(join(GOSSIP_SITES_DIR, f), "utf-8"),
			) as GossipSiteConfig;
			insertSite(raw, false); // INSERT OR IGNORE:不覆盖已迁入的
		} catch {
			// 跳过坏/不可读文件
		}
	}
}

/** 测试用:重置 backfill 一次性闸（仅供 *.test.ts）。 */
export function __resetBackfillForTest(): void {
	backfilled = false;
}

export async function listGossipSites(): Promise<GossipSiteConfig[]> {
	await ensureBackfilled();
	const rows = getDb()
		.prepare("SELECT * FROM gossip_sites ORDER BY updated_at DESC")
		.all() as GossipSiteRow[];
	return rows.map(rowToSite);
}

export async function getGossipSite(
	id: string,
): Promise<GossipSiteConfig | null> {
	await ensureBackfilled();
	const row = getDb()
		.prepare("SELECT * FROM gossip_sites WHERE id = ?")
		.get(id) as GossipSiteRow | undefined;
	return row ? rowToSite(row) : null;
}

export async function saveGossipSite(config: GossipSiteConfig): Promise<void> {
	await ensureBackfilled();
	// 刷新 updatedAt（整笔覆盖写入,非增量更新）。
	insertSite({ ...config, updatedAt: new Date().toISOString() }, true);
}

export async function deleteGossipSite(id: string): Promise<boolean> {
	await ensureBackfilled();
	const info = getDb().prepare("DELETE FROM gossip_sites WHERE id = ?").run(id);
	return info.changes > 0;
}
