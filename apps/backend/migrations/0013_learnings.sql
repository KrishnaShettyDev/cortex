-- Migration: Add learnings for cognitive layer
-- Purpose: Track patterns, preferences, and insights extracted from memories

-- Learnings table
CREATE TABLE IF NOT EXISTS learnings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  container_tag TEXT NOT NULL DEFAULT 'default',

  -- Core learning data
  category TEXT NOT NULL, -- 'preference', 'habit', 'relationship', 'work_pattern', 'health', 'interest', 'routine', 'communication', 'decision_style', 'value', 'goal', 'skill', 'other'
  statement TEXT NOT NULL, -- The actual learning: "User prefers morning meetings"
  reasoning TEXT NOT NULL, -- Why we learned this

  -- Strength and confidence
  strength TEXT NOT NULL DEFAULT 'weak', -- 'weak', 'moderate', 'strong', 'definitive'
  confidence REAL NOT NULL DEFAULT 0.5, -- 0-1 confidence in this learning
  evidence_count INTEGER NOT NULL DEFAULT 1, -- Number of memories supporting this

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'invalidated', 'superseded', 'archived'
  invalidated_by TEXT, -- Memory ID that invalidated this
  superseded_by TEXT, -- Learning ID that supersedes this

  -- Temporal validity
  first_observed TEXT NOT NULL, -- When we first saw evidence
  last_reinforced TEXT NOT NULL, -- When we last saw confirming evidence
  valid_from TEXT, -- Temporal validity start
  valid_to TEXT, -- Temporal validity end (if invalidated)

  -- Metadata
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (invalidated_by) REFERENCES memories(id),
  FOREIGN KEY (superseded_by) REFERENCES learnings(id)
);

-- Learning evidence table (links learnings to memories)
CREATE TABLE IF NOT EXISTS learning_evidence (
  id TEXT PRIMARY KEY,
  learning_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,

  -- Evidence type
  evidence_type TEXT NOT NULL DEFAULT 'supports', -- 'supports', 'contradicts', 'neutral'

  -- Context
  excerpt TEXT NOT NULL, -- Relevant text from memory
  confidence REAL NOT NULL DEFAULT 0.5, -- Confidence this memory supports/contradicts

  created_at TEXT NOT NULL,

  FOREIGN KEY (learning_id) REFERENCES learnings(id) ON DELETE CASCADE,
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,

  UNIQUE(learning_id, memory_id)
);

-- Indexes for efficient queries
-- Primary query: Get active learnings by user and category
CREATE INDEX idx_learnings_user_category ON learnings(user_id, category, status)
WHERE status = 'active';

-- Query by user and strength (for profile building)
CREATE INDEX idx_learnings_user_strength ON learnings(user_id, strength)
WHERE status = 'active';

-- Query by user and status
CREATE INDEX idx_learnings_user_status ON learnings(user_id, status);

-- Full-text search on statement (for semantic matching)
CREATE INDEX idx_learnings_statement ON learnings(user_id, statement);

-- Query by container tag
CREATE INDEX idx_learnings_container ON learnings(user_id, container_tag)
WHERE status = 'active';

-- Evidence lookup by learning
CREATE INDEX idx_evidence_learning ON learning_evidence(learning_id);

-- Evidence lookup by memory (for conflict detection)
CREATE INDEX idx_evidence_memory ON learning_evidence(memory_id);

-- Recent learnings (for profile summary)
CREATE INDEX idx_learnings_recent ON learnings(user_id, last_reinforced DESC)
WHERE status = 'active';

-- Confidence-based queries
CREATE INDEX idx_learnings_confidence ON learnings(user_id, confidence DESC)
WHERE status = 'active';
