-- Migration: Add learning backfill progress tracking
-- Purpose: Track progress of learning extraction backfill jobs

CREATE TABLE IF NOT EXISTS learning_backfill_progress (
  id TEXT PRIMARY KEY,

  -- Progress tracking
  total_memories INTEGER NOT NULL DEFAULT 0,
  processed_memories INTEGER NOT NULL DEFAULT 0,
  learnings_extracted INTEGER NOT NULL DEFAULT 0,
  conflicts_detected INTEGER NOT NULL DEFAULT 0,
  skipped_memories INTEGER NOT NULL DEFAULT 0,
  failed_memories INTEGER NOT NULL DEFAULT 0,

  -- Resume support
  last_processed_id TEXT,

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'running', -- 'running', 'completed', 'paused', 'failed'
  current_batch INTEGER NOT NULL DEFAULT 0,
  total_batches INTEGER NOT NULL DEFAULT 0,

  -- Timestamps
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Index for status queries
CREATE INDEX IF NOT EXISTS idx_backfill_status ON learning_backfill_progress(status);
