import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { BetterSqlite3DB } from "../scraper/pending-db.js";

const _require = createRequire(import.meta.url);
const Database = _require("better-sqlite3") as typeof import("better-sqlite3");

// Inlined so migrations work in both tsx (dev) and compiled dist (prod).
const MIGRATIONS: Record<string, string> = {
	"001-initial.sql": `\
CREATE TABLE IF NOT EXISTS pending_topics (
  id              TEXT PRIMARY KEY,
  source_url      TEXT NOT NULL,
  site_name       TEXT NOT NULL,
  title           TEXT NOT NULL,
  raw_content     TEXT NOT NULL,
  facts           TEXT NOT NULL,
  confidence      REAL NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending','approved','rejected')),
  rejected_reason  TEXT,
  cover_image_url  TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_topics(status);
CREATE INDEX IF NOT EXISTS idx_pending_created ON pending_topics(created_at DESC);`,
	"002-config-store.sql": `\
CREATE TABLE IF NOT EXISTS config_store (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);`,
	"003-published-posts.sql": `\
CREATE TABLE IF NOT EXISTS published_posts (
  id                 TEXT PRIMARY KEY,
  batch_item_id      TEXT,
  source_title       TEXT,
  publish_url        TEXT UNIQUE,
  publish_url_source TEXT,
  published_at       TEXT,
  outcome            TEXT DEFAULT NULL,
  last_checked_at    TEXT DEFAULT NULL,
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_published_publish_url ON published_posts(publish_url);
CREATE INDEX IF NOT EXISTS idx_published_outcome ON published_posts(outcome);`,
	"005-score-column.sql": `\
ALTER TABLE pending_topics ADD COLUMN score REAL DEFAULT NULL;`,
	"004-source-url-unique.sql": `\
DELETE FROM pending_topics WHERE rowid NOT IN (
  SELECT MIN(rowid) FROM pending_topics GROUP BY source_url
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_source_url ON pending_topics(source_url);`,
	"006-enrichment.sql": `\
ALTER TABLE pending_topics ADD COLUMN enrichment TEXT DEFAULT NULL;`,
	"007-batches.sql": `\
CREATE TABLE IF NOT EXISTS batches (
  id               TEXT PRIMARY KEY,
  tab_id           INTEGER NOT NULL,
  authorized_host  TEXT NOT NULL,
  items            TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_batches_updated ON batches(updated_at DESC);`,
	"008-add-domain.sql": `\
ALTER TABLE pending_topics ADD COLUMN domain TEXT NOT NULL DEFAULT 'acg'
  CHECK(domain IN ('acg', 'gossip'));
CREATE INDEX IF NOT EXISTS idx_pending_domain ON pending_topics(domain);`,
	// U6 多渠道:操作者新增的爬取渠道域名。运行时与 env ALLOWED_HOSTS 取并集喂给 SSRF allowlist。
	// hostname 存 punycode(ASCII)形态;path_prefix/max_bytes 为单渠道越权/放大兜底(已在
	// generic-adapter 抓取时强制);max_depth 为翻页页数上限(list-discovery 跟随「下一页」最多 N 页,预设 1=单页)。
	// created_by/created_at/reason 为审计栏位。
	"009-channels.sql": `\
CREATE TABLE IF NOT EXISTS channels (
  id            TEXT PRIMARY KEY,
  hostname      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  path_prefix   TEXT NOT NULL DEFAULT '/',
  max_depth     INTEGER NOT NULL DEFAULT 1,
  max_bytes     INTEGER NOT NULL DEFAULT 5242880,
  created_by    TEXT NOT NULL,
  reason        TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_channels_hostname ON channels(hostname);`,
	// 移除发布时代残留:published_posts 表无任何写入者(发布机器已删除),其回访
	// 机制(revisit-job)与「不发布、不写回」硬约束矛盾,一并下线。DROP IF EXISTS
	// 对全新 DB 是 no-op(003 create-then-drop),对既有 DB 清掉空表。
	"010-drop-published-posts.sql": `\
DROP TABLE IF EXISTS published_posts;`,
	// 移除发布时代残留:batches 表(007 建)无任何后端写入者(发布机器已删,扩展侧
	// batch 状态走 chrome.storage,不依赖此表)。DROP IF EXISTS 对全新 DB 是 no-op
	// (007 create-then-drop),对既有 DB 清掉空表。
	"011-drop-batches.sql": `\
DROP TABLE IF EXISTS batches;`,
};

export function runMigrations(dbPath: string): void {
	const dataDir = dirname(dbPath);
	if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

	const db: BetterSqlite3DB = new Database(dbPath);
	db.pragma("journal_mode = WAL");
	db.pragma("foreign_keys = ON");

	db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,
      applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

	const applied = new Set(
		(
			db.prepare("SELECT name FROM _migrations").all() as { name: string }[]
		).map((r) => r.name),
	);

	const names = Object.keys(MIGRATIONS).sort();
	const insert = db.prepare("INSERT INTO _migrations (name) VALUES (?)");

	for (const name of names) {
		if (applied.has(name)) continue;
		db.exec(MIGRATIONS[name]);
		insert.run(name);
		console.log(`[migration] Applied: ${name}`);
	}

	db.close();
}
