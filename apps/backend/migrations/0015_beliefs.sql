-- Migration: Belief System Tables
-- Purpose: Store beliefs with Bayesian confidence tracking, evidence links, and conflict detection

-- ============================================
-- BELIEFS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS beliefs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,

  -- Core belief content
  proposition TEXT NOT NULL,
  belief_type TEXT NOT NULL, -- 'fact', 'preference', 'capability', 'state', 'relationship', 'intention', 'identity'
  domain TEXT, -- Optional categorization (health, work, relationships, etc.)

  -- Bayesian confidence tracking
  prior_confidence REAL NOT NULL DEFAULT 0.5,
  current_confidence REAL NOT NULL DEFAULT 0.5,
  confidence_history TEXT, -- JSON array of {timestamp, confidence, reason, evidenceId?}

  -- Evidence tracking
  supporting_count INTEGER NOT NULL DEFAULT 0,
  contradicting_count INTEGER NOT NULL DEFAULT 0,

  -- Temporal validity
  valid_from TEXT, -- When belief became true (if known)
  valid_to TEXT, -- When belief expires/expired (if applicable)

  -- Dependencies (for belief chains)
  depends_on TEXT, -- JSON array of belief IDs this belief depends on

  -- Source tracking
  derived_from_learning TEXT REFERENCES learnings(id) ON DELETE SET NULL,

  -- Status
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'uncertain', 'invalidated', 'superseded', 'archived'
  superseded_by TEXT REFERENCES beliefs(id) ON DELETE SET NULL,
  invalidation_reason TEXT,

  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  -- Foreign key
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for beliefs
CREATE INDEX IF NOT EXISTS idx_beliefs_user ON beliefs(user_id);
CREATE INDEX IF NOT EXISTS idx_beliefs_user_status ON beliefs(user_id, status);
CREATE INDEX IF NOT EXISTS idx_beliefs_user_type ON beliefs(user_id, belief_type);
CREATE INDEX IF NOT EXISTS idx_beliefs_confidence ON beliefs(user_id, current_confidence DESC);
CREATE INDEX IF NOT EXISTS idx_beliefs_domain ON beliefs(user_id, domain);
CREATE INDEX IF NOT EXISTS idx_beliefs_derived_from ON beliefs(derived_from_learning);
CREATE INDEX IF NOT EXISTS idx_beliefs_temporal ON beliefs(valid_from, valid_to);

-- ============================================
-- BELIEF EVIDENCE TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS belief_evidence (
  id TEXT PRIMARY KEY,
  belief_id TEXT NOT NULL REFERENCES beliefs(id) ON DELETE CASCADE,

  -- Source of evidence
  memory_id TEXT REFERENCES memories(id) ON DELETE SET NULL,
  learning_id TEXT REFERENCES learnings(id) ON DELETE SET NULL,

  -- Evidence details
  evidence_type TEXT NOT NULL, -- 'direct', 'inferred', 'learned', 'validated', 'contradicted'
  supports INTEGER NOT NULL DEFAULT 1, -- 1 = supports, 0 = contradicts
  strength REAL NOT NULL DEFAULT 0.5, -- 0.0 to 1.0
  notes TEXT,

  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for belief_evidence
CREATE INDEX IF NOT EXISTS idx_belief_evidence_belief ON belief_evidence(belief_id);
CREATE INDEX IF NOT EXISTS idx_belief_evidence_memory ON belief_evidence(memory_id);
CREATE INDEX IF NOT EXISTS idx_belief_evidence_learning ON belief_evidence(learning_id);
CREATE INDEX IF NOT EXISTS idx_belief_evidence_type ON belief_evidence(belief_id, evidence_type);

-- ============================================
-- BELIEF CONFLICTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS belief_conflicts (
  id TEXT PRIMARY KEY,

  -- The two conflicting beliefs
  belief_a_id TEXT NOT NULL REFERENCES beliefs(id) ON DELETE CASCADE,
  belief_b_id TEXT NOT NULL REFERENCES beliefs(id) ON DELETE CASCADE,

  -- Conflict details
  conflict_type TEXT NOT NULL, -- 'contradiction', 'overlap', 'temporal'
  description TEXT NOT NULL,

  -- Resolution
  resolved INTEGER NOT NULL DEFAULT 0, -- 0 = unresolved, 1 = resolved
  resolution TEXT, -- How it was resolved
  winner_id TEXT REFERENCES beliefs(id) ON DELETE SET NULL,

  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

-- Indexes for belief_conflicts
CREATE INDEX IF NOT EXISTS idx_belief_conflicts_a ON belief_conflicts(belief_a_id);
CREATE INDEX IF NOT EXISTS idx_belief_conflicts_b ON belief_conflicts(belief_b_id);
CREATE INDEX IF NOT EXISTS idx_belief_conflicts_unresolved ON belief_conflicts(resolved) WHERE resolved = 0;

-- ============================================
-- HELPER VIEW: Active beliefs with evidence count
-- ============================================
CREATE VIEW IF NOT EXISTS v_beliefs_with_evidence AS
SELECT
  b.*,
  COUNT(be.id) as total_evidence_count,
  SUM(CASE WHEN be.supports = 1 THEN 1 ELSE 0 END) as supporting_evidence_count,
  SUM(CASE WHEN be.supports = 0 THEN 1 ELSE 0 END) as contradicting_evidence_count
FROM beliefs b
LEFT JOIN belief_evidence be ON be.belief_id = b.id
WHERE b.status = 'active'
GROUP BY b.id;
