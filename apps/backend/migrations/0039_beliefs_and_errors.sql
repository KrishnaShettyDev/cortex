-- Beliefs table (cognitive layer)
-- Stores synthesized beliefs, values, and patterns about the user
CREATE TABLE IF NOT EXISTS beliefs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  belief TEXT NOT NULL,
  category TEXT, -- 'value' | 'preference' | 'habit' | 'relationship' | 'goal'
  confidence REAL DEFAULT 0.5, -- 0.0 to 1.0
  evidence_count INTEGER DEFAULT 1,
  first_observed_at INTEGER DEFAULT (unixepoch()),
  last_reinforced_at INTEGER DEFAULT (unixepoch()),
  created_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_beliefs_user ON beliefs(user_id, confidence DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_beliefs_unique ON beliefs(user_id, belief);

-- Belief evidence linking table
-- Links beliefs to the memories that support them
CREATE TABLE IF NOT EXISTS belief_evidence (
  belief_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  strength REAL DEFAULT 1.0, -- How strongly this memory supports the belief
  created_at INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY (belief_id, memory_id),
  FOREIGN KEY (belief_id) REFERENCES beliefs(id) ON DELETE CASCADE,
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_belief_evidence_belief ON belief_evidence(belief_id);
CREATE INDEX IF NOT EXISTS idx_belief_evidence_memory ON belief_evidence(memory_id);

-- Error logs table for production debugging
-- Stores structured error information for analysis
CREATE TABLE IF NOT EXISTS error_logs (
  id TEXT PRIMARY KEY,
  error_type TEXT, -- 'unhandled' | 'api' | 'queue' | 'cron' | etc
  message TEXT,
  stack TEXT,
  context TEXT, -- JSON stringified context
  user_id TEXT,
  path TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_error_logs_time ON error_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_type ON error_logs(error_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_user ON error_logs(user_id, created_at DESC);
