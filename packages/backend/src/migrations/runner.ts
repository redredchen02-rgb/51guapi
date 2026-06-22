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
	// 存储统一(P6-2):prompt 模板从 JSON 文件迁入 SQLite。few_shot_pairs 存 JSON 数组串。
	// 注意:MIGRATIONS 按 Object.keys().sort() 字典序执行,故 key 必须零填充三位。
	"012-prompt-templates.sql": `\
CREATE TABLE IF NOT EXISTS prompt_templates (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  template        TEXT NOT NULL,
  few_shot_pairs  TEXT NOT NULL DEFAULT '[]',
  model           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prompt_templates_updated ON prompt_templates(updated_at DESC);`,
	// 存储统一(P6-2):吃瓜站点配置从 JSON 文件迁入 SQLite。enabled 存 0/1。
	"013-gossip-sites.sql": `\
CREATE TABLE IF NOT EXISTS gossip_sites (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  list_url    TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gossip_sites_updated ON gossip_sites(updated_at DESC);`,
	// 自用模式种子(plan 2026-06-18-003):一次性重置 channels 表为单条 51cg1.com。
	// 有意清除运行时积累的垃圾域名(操作者确认现有为垃圾);_migrations 保证只跑一次,
	// 之后用户在 UI 新增的渠道不会被重置。51cg1.com 为 ASCII,直插 hostname 与
	// normalizeChannelHost 归一值等价;读取时完整 SSRF 守卫(safeFetch/resolveAndPin)
	// 仍全程生效。不在 ssrf-allowlist.ts 引入任何硬编码默认,空即全拒语义不变。
	// created_at 用 ISO 形态(与 insertChannel 的 new Date().toISOString() 一致),
	// 使 listChannels 的字符串排序在种子与 UI 新增渠道之间表现一致。
	"014-seed-channels.sql": `\
DELETE FROM channels;
INSERT INTO channels
  (id, hostname, display_name, path_prefix, max_depth, max_bytes, created_by, reason, created_at)
VALUES
  ('seed-51cg1', '51cg1.com', '51cg1', '/', 1, 5242880, 'seed', '默认种子渠道',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));`,
	// 入池前验证关(plan 004 U3):content_fingerprint 供跨 URL 内容去重(查库,加索引);
	// verification 存 verifyCrawledTopic 结果 JSON(逐项判定/原因,供 UI 标红);verified_at 为
	// 人工二次核对通过时间戳(NULL=未核对,题材池只收非 NULL)。用列而非新 status 枚举——status
	// 有 CHECK 约束,加值需整表重建;布尔/时间戳列更轻、可逆。_migrations 表保证只跑一次。
	// 注:并发期 014 被 self-use 种子占用,本迁移改用 015(键须零填充三位,字典序在 014 之后)。
	"015-pending-verification.sql": `\
ALTER TABLE pending_topics ADD COLUMN content_fingerprint TEXT DEFAULT NULL;
ALTER TABLE pending_topics ADD COLUMN verification TEXT DEFAULT NULL;
ALTER TABLE pending_topics ADD COLUMN verified_at TEXT DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_pending_fingerprint ON pending_topics(content_fingerprint);`,
	// A8:移除 Web 富化子栈 —— drop 死列 enrichment(006 加,移除全部读写者后已无消费者)。
	// better-sqlite3 内置 SQLite ≥3.35 支持 DROP COLUMN,单语句。对全新 clone 是 006-add→
	// 016-drop 净为无此列;对既有库直接清掉该列及其数据(已无消费者,无 down-migration,
	// 回滚靠 A8 前置的 data 时间戳备份)。
	"016-drop-enrichment.sql": `\
ALTER TABLE pending_topics DROP COLUMN enrichment;`,
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
