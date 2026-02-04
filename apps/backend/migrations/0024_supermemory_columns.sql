-- Migration: Supermemory++ Architecture Upgrade - Phase 2: Add Columns
-- Purpose: Add 4-layer memory hierarchy columns

-- ============================================
-- ADD SUPERMEMORY++ COLUMNS TO MEMORIES
-- ============================================

-- Memory layer classification (4-layer hierarchy)
ALTER TABLE memories ADD COLUMN layer TEXT DEFAULT 'episodic';

-- Document date - when the content was created/ingested
ALTER TABLE memories ADD COLUMN document_date TEXT;

-- Content hash for efficient deduplication
ALTER TABLE memories ADD COLUMN content_hash TEXT;

-- ============================================
-- MIGRATE EXISTING DATA
-- ============================================

-- Set layer based on existing memory_type
UPDATE memories
SET layer = CASE
  WHEN memory_type = 'semantic' THEN 'semantic'
  WHEN memory_type = 'episodic' THEN 'episodic'
  ELSE 'episodic'
END
WHERE layer IS NULL;

-- Set document_date to created_at for existing memories
UPDATE memories
SET document_date = created_at
WHERE document_date IS NULL;

-- ============================================
-- ADD INDEXES
-- ============================================

-- Index for layer queries
CREATE INDEX IF NOT EXISTS idx_memories_layer
  ON memories(user_id, layer)
  WHERE valid_to IS NULL AND is_forgotten = 0;

-- Index for deduplication
CREATE INDEX IF NOT EXISTS idx_memories_content_hash
  ON memories(content_hash)
  WHERE content_hash IS NOT NULL;

-- Index for temporal grounding queries
CREATE INDEX IF NOT EXISTS idx_memories_temporal_ground
  ON memories(user_id, document_date, event_date)
  WHERE valid_to IS NULL;
