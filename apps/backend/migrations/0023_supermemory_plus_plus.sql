-- Migration: Supermemory++ Architecture Upgrade
-- Purpose: Drop over-engineered cognitive layer, add 4-layer memory hierarchy
--
-- This migration removes the unused beliefs, outcomes, learnings, and sleep
-- compute systems (which had 0 users and added complexity without value),
-- and prepares the schema for Supermemory++ architecture.

-- ============================================
-- PHASE 1: DROP COGNITIVE LAYER TABLES
-- ============================================

-- Drop views first (they depend on tables)
DROP VIEW IF EXISTS v_beliefs_with_evidence;
DROP VIEW IF EXISTS v_outcomes_summary;
DROP VIEW IF EXISTS v_source_effectiveness;

-- Drop cognitive layer tables (unused - had 0 entries in production)
DROP TABLE IF EXISTS belief_conflicts;
DROP TABLE IF EXISTS belief_evidence;
DROP TABLE IF EXISTS beliefs;
DROP TABLE IF EXISTS outcome_sources;
DROP TABLE IF EXISTS outcomes;
DROP TABLE IF EXISTS learning_evidence;
DROP TABLE IF EXISTS learnings;
DROP TABLE IF EXISTS learning_backfill_progress;
DROP TABLE IF EXISTS session_contexts;
DROP TABLE IF EXISTS sleep_jobs;

-- ============================================
-- PHASE 2: ADD SUPERMEMORY++ COLUMNS TO MEMORIES
-- ============================================

-- Memory layer classification (4-layer hierarchy)
-- working: current session context (ephemeral)
-- episodic: past interactions/events (already exists as memory_type)
-- semantic: facts, entities, knowledge (already exists as memory_type)
-- procedural: learned workflows/patterns
ALTER TABLE memories ADD COLUMN layer TEXT DEFAULT 'episodic';

-- Document date - when the content was created/ingested (distinct from event_date)
-- event_date = when the described event occurred
-- document_date = when we received/processed this info
ALTER TABLE memories ADD COLUMN document_date TEXT;

-- Content hash for efficient deduplication
ALTER TABLE memories ADD COLUMN content_hash TEXT;

-- ============================================
-- PHASE 3: MIGRATE EXISTING DATA
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

-- Generate content hashes for existing memories (SQLite doesn't have native hash)
-- This will be done by the application on next access

-- ============================================
-- PHASE 4: ENHANCED INDEXES
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

-- ============================================
-- PHASE 5: ENHANCE MEMORY RELATIONS FOR SUPERMEMORY++
-- ============================================

-- Add confidence and relation subtype columns to memory_relations
ALTER TABLE memory_relations ADD COLUMN confidence REAL DEFAULT 1.0;
ALTER TABLE memory_relations ADD COLUMN evidence TEXT;

-- Index for relation confidence filtering
CREATE INDEX IF NOT EXISTS idx_memory_relations_confidence
  ON memory_relations(relation_type, confidence DESC);

-- ============================================
-- PHASE 6: ENHANCE ENTITIES FOR KNOWLEDGE GRAPH
-- ============================================

-- Check if canonical_name exists, add if not (for entity deduplication)
-- Note: SQLite doesn't support IF NOT EXISTS for ALTER TABLE ADD COLUMN
-- This may fail silently if column already exists

ALTER TABLE entities ADD COLUMN canonical_name TEXT;
ALTER TABLE entities ADD COLUMN attributes TEXT;
ALTER TABLE entities ADD COLUMN first_seen TEXT;
ALTER TABLE entities ADD COLUMN last_seen TEXT;

-- Migrate existing entity data
UPDATE entities
SET canonical_name = LOWER(TRIM(name)),
    first_seen = created_at,
    last_seen = created_at
WHERE canonical_name IS NULL;

-- Index for entity canonical name lookups
CREATE INDEX IF NOT EXISTS idx_entities_canonical
  ON entities(canonical_name);

-- ============================================
-- PHASE 7: ENHANCE ENTITY RELATIONS FOR TEMPORAL VALIDITY
-- ============================================

ALTER TABLE entity_relationships ADD COLUMN confidence REAL DEFAULT 1.0;
ALTER TABLE entity_relationships ADD COLUMN evidence_memory_ids TEXT;

-- ============================================
-- COMPLETE
-- ============================================
-- Supermemory++ base schema is now ready.
-- Features enabled:
-- 1. 4-layer memory hierarchy (working, episodic, semantic, procedural)
-- 2. Enhanced temporal grounding (document_date vs event_date)
-- 3. Content deduplication via hash
-- 4. Confidence-scored relations
-- 5. Knowledge graph with canonical entities
