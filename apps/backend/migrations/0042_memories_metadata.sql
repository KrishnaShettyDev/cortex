-- Migration: Add metadata column to memories table
-- Fixes: D1_ERROR: no such column: m.metadata

-- Add metadata column to memories for storing JSON metadata
ALTER TABLE memories ADD COLUMN metadata TEXT;

-- Create index for queries that filter by metadata
CREATE INDEX IF NOT EXISTS idx_memories_metadata
  ON memories(user_id)
  WHERE metadata IS NOT NULL;
