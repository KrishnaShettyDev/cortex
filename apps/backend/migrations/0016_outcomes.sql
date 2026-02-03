-- Migration: Outcome Tracking Tables
-- Purpose: Track actions, feedback, and enable the learning loop

-- ============================================
-- OUTCOMES TABLE
-- ============================================
-- Tracks actions taken by the system and their outcomes.
-- Enables the learning loop by connecting actions to feedback.

CREATE TABLE IF NOT EXISTS outcomes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,

  -- What action was taken
  action_type TEXT NOT NULL CHECK (action_type IN (
    'recall', 'suggestion', 'prediction', 'answer', 'recommendation', 'completion'
  )),
  action_content TEXT NOT NULL,
  action_context TEXT,  -- JSON: query/prompt that triggered this

  -- What informed the action
  reasoning_trace TEXT,  -- JSON: ReasoningTrace object

  -- Outcome
  outcome_signal TEXT NOT NULL DEFAULT 'unknown' CHECK (outcome_signal IN (
    'positive', 'negative', 'neutral', 'unknown'
  )),
  outcome_source TEXT CHECK (outcome_source IN (
    'explicit_feedback', 'implicit_positive', 'implicit_negative', 'follow_up', 'inferred'
  )),
  outcome_details TEXT,  -- JSON: additional context

  -- Timing
  action_at TEXT NOT NULL,
  outcome_at TEXT,

  -- Propagation tracking
  feedback_propagated INTEGER NOT NULL DEFAULT 0 CHECK (feedback_propagated IN (0, 1)),
  propagated_at TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================
-- OUTCOME SOURCES TABLE
-- ============================================
-- Links outcomes to the memories/learnings/beliefs that informed them.
-- Enables feedback propagation to update confidence scores.

CREATE TABLE IF NOT EXISTS outcome_sources (
  id TEXT PRIMARY KEY,
  outcome_id TEXT NOT NULL,

  source_type TEXT NOT NULL CHECK (source_type IN ('memory', 'learning', 'belief')),
  source_id TEXT NOT NULL,

  -- How much this source contributed to the action (0.0 to 1.0)
  contribution_weight REAL NOT NULL DEFAULT 1.0,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (outcome_id) REFERENCES outcomes(id) ON DELETE CASCADE,

  -- Prevent duplicate source links
  UNIQUE (outcome_id, source_type, source_id)
);

-- ============================================
-- INDEXES
-- ============================================

-- User lookups
CREATE INDEX IF NOT EXISTS idx_outcomes_user_id
  ON outcomes(user_id);

-- User + action type
CREATE INDEX IF NOT EXISTS idx_outcomes_user_action_type
  ON outcomes(user_id, action_type);

-- User + outcome signal (for finding unpropagated feedback)
CREATE INDEX IF NOT EXISTS idx_outcomes_user_signal
  ON outcomes(user_id, outcome_signal);

-- Unpropagated outcomes (for batch processing)
CREATE INDEX IF NOT EXISTS idx_outcomes_unpropagated
  ON outcomes(feedback_propagated, outcome_signal)
  WHERE feedback_propagated = 0 AND outcome_signal != 'unknown';

-- Time-based queries
CREATE INDEX IF NOT EXISTS idx_outcomes_action_at
  ON outcomes(user_id, action_at DESC);

CREATE INDEX IF NOT EXISTS idx_outcomes_outcome_at
  ON outcomes(user_id, outcome_at DESC);

-- Outcome sources
CREATE INDEX IF NOT EXISTS idx_outcome_sources_outcome
  ON outcome_sources(outcome_id);

CREATE INDEX IF NOT EXISTS idx_outcome_sources_source
  ON outcome_sources(source_type, source_id);

-- ============================================
-- VIEWS
-- ============================================

-- Outcomes with source counts
CREATE VIEW IF NOT EXISTS v_outcomes_summary AS
SELECT
  o.id,
  o.user_id,
  o.action_type,
  o.outcome_signal,
  o.action_at,
  o.outcome_at,
  o.feedback_propagated,
  COUNT(os.id) as source_count,
  SUM(CASE WHEN os.source_type = 'memory' THEN 1 ELSE 0 END) as memory_count,
  SUM(CASE WHEN os.source_type = 'learning' THEN 1 ELSE 0 END) as learning_count,
  SUM(CASE WHEN os.source_type = 'belief' THEN 1 ELSE 0 END) as belief_count
FROM outcomes o
LEFT JOIN outcome_sources os ON o.id = os.outcome_id
GROUP BY o.id;

-- Source effectiveness view
CREATE VIEW IF NOT EXISTS v_source_effectiveness AS
SELECT
  os.source_type,
  os.source_id,
  COUNT(*) as total_uses,
  SUM(CASE WHEN o.outcome_signal = 'positive' THEN 1 ELSE 0 END) as positive_count,
  SUM(CASE WHEN o.outcome_signal = 'negative' THEN 1 ELSE 0 END) as negative_count,
  SUM(CASE WHEN o.outcome_signal = 'neutral' THEN 1 ELSE 0 END) as neutral_count,
  AVG(os.contribution_weight) as avg_contribution
FROM outcome_sources os
JOIN outcomes o ON os.outcome_id = o.id
WHERE o.outcome_signal != 'unknown'
GROUP BY os.source_type, os.source_id;
