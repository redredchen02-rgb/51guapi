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

	it("幂等:重复 runMigrations 不报错且不重复应用", () => {
		const path = freshDbPath();
		runMigrations(path);
		const first = appliedMigrations(path);
		expect(() => runMigrations(path)).not.toThrow();
		const second = appliedMigrations(path);
		expect(second).toEqual(first);
	});
});
