-- Migration: Supermemory++ Phase 2 - Profile Engine
-- Purpose: Store persistent user/agent profile facts for ranking bias

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  container_tag TEXT DEFAULT 'default',

  -- Profile fact
  category TEXT NOT NULL,    -- 'preference', 'context', 'behavior', 'identity'
  key TEXT NOT NULL,         -- e.g., 'communication_style', 'expertise_areas', 'timezone'
  value TEXT NOT NULL,       -- JSON-encoded value

  -- Confidence & source
  confidence REAL DEFAULT 1.0,
  source TEXT DEFAULT 'user',  -- 'user', 'inferred', 'system'

  -- Evidence tracking
  evidence_memory_ids TEXT,  -- JSON array of memory IDs that support this fact
  evidence_count INTEGER DEFAULT 1,

  -- Temporal validity
  valid_from TEXT,
  valid_to TEXT,             -- NULL = currently valid

  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),

  -- Unique constraint: one active fact per key per user
  UNIQUE(user_id, container_tag, key)
);

-- Index for user profile lookups
CREATE INDEX IF NOT EXISTS idx_profiles_user
  ON profiles(user_id, container_tag);

-- Index for category-based queries
CREATE INDEX IF NOT EXISTS idx_profiles_category
  ON profiles(user_id, category);

-- Index for source filtering (find inferred vs explicit)
CREATE INDEX IF NOT EXISTS idx_profiles_source
  ON profiles(user_id, source);
