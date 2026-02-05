-- Migration: Supermemory++ Phase 2 - Timeline Events
-- Purpose: Store extracted event dates for temporal grounding

CREATE TABLE IF NOT EXISTS memory_events (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,

  -- Temporal data
  event_date TEXT NOT NULL,  -- ISO 8601 date/datetime
  event_type TEXT,           -- 'meeting', 'deadline', 'milestone', 'recurring', etc.

  -- Extraction metadata
  extraction_method TEXT DEFAULT 'heuristic',  -- 'heuristic', 'llm', 'user_provided'
  confidence REAL DEFAULT 0.8,
  source_text TEXT,          -- The text snippet that contained the date

  -- Additional context
  metadata TEXT,             -- JSON: recurring patterns, timezone, etc.

  created_at TEXT DEFAULT (datetime('now'))
);

-- Index for time-range queries (the critical temporal query)
CREATE INDEX IF NOT EXISTS idx_memory_events_date
  ON memory_events(event_date);

-- Index for memory lookup
CREATE INDEX IF NOT EXISTS idx_memory_events_memory
  ON memory_events(memory_id);

-- Compound index for user timeline queries (via join)
CREATE INDEX IF NOT EXISTS idx_memory_events_date_type
  ON memory_events(event_date, event_type);
