-- =============================================================================
-- Memory Contradictions Table
-- Tracks when new information contradicts existing memories
-- =============================================================================

-- Main contradictions table
CREATE TABLE IF NOT EXISTS memory_contradictions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  new_memory_id TEXT NOT NULL,
  existing_memory_id TEXT NOT NULL,
  conflict_type TEXT NOT NULL CHECK (conflict_type IN ('date_mismatch', 'fact_conflict', 'status_change', 'quantity_mismatch')),
  confidence REAL NOT NULL DEFAULT 0.7,
  description TEXT,
  resolved INTEGER NOT NULL DEFAULT 0,
  resolution TEXT CHECK (resolution IN ('keep_new', 'keep_existing', 'keep_both', NULL)),
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (new_memory_id) REFERENCES memories(id) ON DELETE CASCADE,
  FOREIGN KEY (existing_memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

-- Index for fast lookup of unresolved contradictions
CREATE INDEX IF NOT EXISTS idx_contradictions_user_unresolved
  ON memory_contradictions(user_id, resolved) WHERE resolved = 0;

-- Index for memory lookups
CREATE INDEX IF NOT EXISTS idx_contradictions_new_memory
  ON memory_contradictions(new_memory_id);

CREATE INDEX IF NOT EXISTS idx_contradictions_existing_memory
  ON memory_contradictions(existing_memory_id);

-- Add reminder tracking column to commitments if not exists
-- (for commitment surfacing in chat)
ALTER TABLE commitments ADD COLUMN reminded INTEGER DEFAULT 0;
