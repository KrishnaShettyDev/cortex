-- Proactive nudges table for storing generated nudges
CREATE TABLE IF NOT EXISTS proactive_nudges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  nudge_type TEXT NOT NULL, -- 'follow_up', 'reminder', 'suggestion', etc.
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  entity_id TEXT, -- Related entity (person, company, etc.)
  priority INTEGER DEFAULT 0,
  suggested_action TEXT,
  dismissed INTEGER DEFAULT 0,
  acted INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  dismissed_at TEXT,
  acted_at TEXT
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_proactive_nudges_user ON proactive_nudges(user_id);
CREATE INDEX IF NOT EXISTS idx_proactive_nudges_user_active ON proactive_nudges(user_id, dismissed, acted);
