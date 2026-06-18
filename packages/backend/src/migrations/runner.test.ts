import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runMigrations } from "./runner.js";

const _require = createRequire(import.meta.url);
const Database = _require("better-sqlite3") as typeof import("better-sqlite3");

let dbPath = "";

function freshDbPath(): string {
	dbPath = join(
		tmpdir(),
		`guapi-migr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`,
	);
	return dbPath;
}

function tableExists(path: string, name: string): boolean {
	const db = new Database(path, { readonly: true });
	const row = db
		.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
		.get(name) as { name: string } | undefined;
	db.close();
	return row !== undefined;
}

function appliedMigrations(path: string): Set<string> {
	const db = new Database(path, { readonly: true });
	const rows = db.prepare("SELECT name FROM _migrations").all() as {
		name: string;
	}[];
	db.close();
	return new Set(rows.map((r) => r.name));
}

function columnNames(path: string, table: string): Set<string> {
	const db = new Database(path, { readonly: true });
	const rows = db.prepare(`PRAGMA table_info(${table})`).all() as {
		name: string;
	}[];
	db.close();
	return new Set(rows.map((r) => r.name));
}

function channelRows(path: string): Record<string, unknown>[] {
	const db = new Database(path, { readonly: true });
	const rows = db.prepare("SELECT * FROM channels").all() as Record<
		string,
		unknown
	>[];
	db.close();
	return rows;
}

const INSERT_CHANNEL =
	"INSERT INTO channels (id, hostname, display_name, path_prefix, max_depth, max_bytes, created_by, reason, created_at) VALUES (?,?,?,?,?,?,?,?,?)";

describe("migration runner", () => {
	afterEach(() => {
		if (dbPath) {
			for (const suffix of ["", "-wal", "-shm"]) {
				rmSync(`${dbPath}${suffix}`, { force: true });
			}
			dbPath = "";
		}
	});

	it("全新 DB 跑完迁移后 batches / published_posts 表均不存在", () => {
		const path = freshDbPath();
		runMigrations(path);
		expect(tableExists(path, "batches")).toBe(false);
		expect(tableExists(path, "published_posts")).toBe(false);
	});

	it("活表 pending_topics / channels 仍在(确认 drop 未误伤)", () => {
		const path = freshDbPath();
		runMigrations(path);
		expect(tableExists(path, "pending_topics")).toBe(true);
		expect(tableExists(path, "channels")).toBe(true);
	});

	it("011-drop-batches 被记入 _migrations", () => {
		const path = freshDbPath();
		runMigrations(path);
		expect(appliedMigrations(path).has("011-drop-batches.sql")).toBe(true);
	});

	it("015 加入 content_fingerprint / verification / verified_at 列(U3)", () => {
		const path = freshDbPath();
		runMigrations(path);
		const cols = columnNames(path, "pending_topics");
		expect(cols.has("content_fingerprint")).toBe(true);
		expect(cols.has("verification")).toBe(true);
		expect(cols.has("verified_at")).toBe(true);
		expect(appliedMigrations(path).has("015-pending-verification.sql")).toBe(
			true,
		);
	});

	it("幂等:重复 runMigrations 不报错且不重复应用", () => {
		const path = freshDbPath();
		runMigrations(path);
		const first = appliedMigrations(path);
		expect(() => runMigrations(path)).not.toThrow();
		const second = appliedMigrations(path);
		expect(second).toEqual(first);
	});

	it("种子:全新 DB 跑完迁移后 channels 恰有一条 51cg1.com", () => {
		const path = freshDbPath();
		runMigrations(path);
		const rows = channelRows(path);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			hostname: "51cg1.com",
			display_name: "51cg1",
			path_prefix: "/",
			max_depth: 1,
			max_bytes: 5242880,
			created_by: "seed",
		});
	});

	it("种子重置:既有垃圾域名被一次性清除,只留 51cg1.com", () => {
		const path = freshDbPath();
		runMigrations(path);
		// 模拟运行时积累的垃圾,并让 014 重跑(从 _migrations 移除)以验证 DELETE 清场。
		const db = new Database(path);
		db.prepare(INSERT_CHANNEL).run(
			"junk1",
			"h96.com",
			"h96",
			"/",
			1,
			5242880,
			"operator",
			"",
			"now",
		);
		db.prepare("DELETE FROM _migrations WHERE name = ?").run(
			"014-seed-channels.sql",
		);
		db.close();
		runMigrations(path);
		expect(channelRows(path).map((r) => r.hostname)).toEqual(["51cg1.com"]);
	});

	it("幂等:014 应用后用户新增渠道在重跑时不被重置", () => {
		const path = freshDbPath();
		runMigrations(path);
		const db = new Database(path);
		db.prepare(INSERT_CHANNEL).run(
			"u1",
			"added-by-user.com",
			"added",
			"/",
			1,
			5242880,
			"operator",
			"",
			"now",
		);
		db.close();
		// 014 已记入 _migrations → 重跑不应再执行 DELETE,用户渠道保留。
		runMigrations(path);
		expect(
			channelRows(path)
				.map((r) => r.hostname)
				.sort(),
		).toEqual(["51cg1.com", "added-by-user.com"].sort());
	});
});
