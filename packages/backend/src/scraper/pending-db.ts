// SQLite 持久层初始化。
// better-sqlite3 是 CJS native addon，在 NodeNext ESM 下必须用 createRequire 导入。

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "../migrations/runner.js";

const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Database = _require("better-sqlite3") as typeof import("better-sqlite3");

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR =
	process.env.PUBLISHER_DATA_DIR || join(__dirname, "..", "..", "data");
export const DB_PATH = join(DATA_DIR, "pending.db");

export type BetterSqlite3DB = InstanceType<typeof Database>;

let _db: BetterSqlite3DB | null = null;

export function initPendingDb(): BetterSqlite3DB {
	if (_db) return _db;

	runMigrations(DB_PATH);

	_db = new Database(DB_PATH);
	_db.pragma("journal_mode = WAL");
	_db.pragma("foreign_keys = ON");

	return _db;
}

export function getDb(): BetterSqlite3DB {
	if (!_db)
		throw new Error("pending DB not initialized — call initPendingDb() first");
	return _db;
}

/** 關閉並清除 singleton，供測試隔離用（每次 cleanData 後呼叫）。 */
export function resetPendingDb(): void {
	if (_db) {
		_db.close();
		_db = null;
	}
}

export { pendingWriteQueue } from "./pending-queue.js";
