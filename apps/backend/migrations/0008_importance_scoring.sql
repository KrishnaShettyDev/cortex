-- Migration: Add importance scoring and access tracking columns
-- Purpose: Support memory importance calculation and decay management

-- Add importance scoring column
ALTER TABLE memories ADD COLUMN importance_score REAL;

-- Add access tracking columns
ALTER TABLE memories ADD COLUMN access_count INTEGER;
ALTER TABLE memories ADD COLUMN last_accessed TEXT;

-- Set defaults for existing memories
UPDATE memories
SET importance_score = 0.5,
    access_count = 0
WHERE importance_score IS NULL;

-- Create indexes for importance-based queries
CREATE INDEX idx_memories_importance ON memories(user_id, importance_score DESC)
WHERE valid_to IS NULL AND is_forgotten = 0;

CREATE INDEX idx_memories_consolidation_candidates ON memories(user_id, importance_score, created_at)
WHERE memory_type = 'episodic' AND valid_to IS NULL AND is_forgotten = 0;

-- Index for access tracking
CREATE INDEX idx_memories_last_accessed ON memories(user_id, last_accessed DESC)
WHERE last_accessed IS NOT NULL;
