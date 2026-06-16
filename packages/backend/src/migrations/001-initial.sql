CREATE TABLE IF NOT EXISTS pending_topics (
  id             TEXT PRIMARY KEY,
  source_url     TEXT NOT NULL,
  site_name      TEXT NOT NULL,
  title          TEXT NOT NULL,
  raw_content    TEXT NOT NULL,
  facts          TEXT NOT NULL,
  confidence     REAL NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK(status IN ('pending','approved','rejected')),
  rejected_reason TEXT,
  cover_image_url TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_topics(status);
CREATE INDEX IF NOT EXISTS idx_pending_created ON pending_topics(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_source_url ON pending_topics(source_url);
