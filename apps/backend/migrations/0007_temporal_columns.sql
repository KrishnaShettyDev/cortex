-- Migration 0007: Temporal Intelligence
-- Adds bi-temporal columns to memories for time-travel queries and knowledge updates

-- =============================================================================
-- EXTEND MEMORIES TABLE WITH TEMPORAL COLUMNS
-- =============================================================================

-- valid_from: When this fact became true (default: when we learned it)
ALTER TABLE memories ADD COLUMN valid_from TEXT;

-- valid_to: When this fact ceased to be true (NULL = still true)
ALTER TABLE memories ADD COLUMN valid_to TEXT;

-- event_date: When the event described in the memory happened
ALTER TABLE memories ADD COLUMN event_date TEXT;

-- supersedes: ID of memory this memory supersedes (for knowledge updates)
ALTER TABLE memories ADD COLUMN supersedes TEXT;

-- superseded_by: ID of memory that superseded this one
ALTER TABLE memories ADD COLUMN superseded_by TEXT;

-- memory_type: episodic (event-based) or semantic (fact-based)
ALTER TABLE memories ADD COLUMN memory_type TEXT;

-- =============================================================================
-- MIGRATE EXISTING DATA
-- =============================================================================

-- Set valid_from and event_date for existing memories
UPDATE memories
SET valid_from = created_at,
    event_date = created_at,
    memory_type = 'episodic'
WHERE valid_from IS NULL;

-- =============================================================================
-- INDEXES FOR TEMPORAL QUERIES
-- =============================================================================

-- Index for "currently valid" queries
CREATE INDEX idx_memories_temporal_validity
  ON memories(user_id, valid_to)
  WHERE valid_to IS NULL;

-- Index for time-travel queries
CREATE INDEX idx_memories_valid_range
  ON memories(user_id, valid_from, valid_to);

-- Index for event-based queries
CREATE INDEX idx_memories_event_date
  ON memories(user_id, event_date DESC)
  WHERE event_date IS NOT NULL;

-- Index for supersession chains
CREATE INDEX idx_memories_supersedes
  ON memories(supersedes)
  WHERE supersedes IS NOT NULL;

-- Index for memory type
CREATE INDEX idx_memories_type
  ON memories(user_id, memory_type);
