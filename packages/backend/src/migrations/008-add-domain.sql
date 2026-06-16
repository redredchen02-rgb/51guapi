-- 為 pending_topics 加 domain 欄位，區分 acg / gossip 選題。
-- 現有資料自動獲得 'acg' 預設值，不影響現有 ACG pipeline。
ALTER TABLE pending_topics ADD COLUMN domain TEXT NOT NULL DEFAULT 'acg'
  CHECK(domain IN ('acg', 'gossip'));

CREATE INDEX IF NOT EXISTS idx_pending_domain ON pending_topics(domain);
