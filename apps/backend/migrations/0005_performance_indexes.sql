-- Performance Optimization Indexes
-- Migration: 0005_performance_indexes.sql
-- Created: 2026-02-01

-- ============================================================================
-- MEMORIES TABLE - Query Optimization
-- ============================================================================

-- Composite index for tenant scoped queries (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_memories_user_container_created
ON memories(user_id, container_tag, created_at DESC);

-- Composite index for search queries with filters
CREATE INDEX IF NOT EXISTS idx_memories_user_container_status
ON memories(user_id, container_tag, processing_status);

-- Index for version lookups
CREATE INDEX IF NOT EXISTS idx_memories_root_version
ON memories(root_memory_id, version DESC)
WHERE is_latest = 1;

-- Index for parent relationship queries
CREATE INDEX IF NOT EXISTS idx_memories_parent
ON memories(parent_memory_id)
WHERE parent_memory_id IS NOT NULL;

-- ============================================================================
-- PROCESSING JOBS TABLE - Query Optimization
-- ============================================================================

-- Composite index for job status queries (most common)
CREATE INDEX IF NOT EXISTS idx_jobs_user_container_status_created
ON processing_jobs(user_id, container_tag, status, created_at DESC);

-- Index for retry queries
CREATE INDEX IF NOT EXISTS idx_jobs_status_retry
ON processing_jobs(status, retry_count)
WHERE status = 'failed' AND retry_count < max_retries;

-- Index for cleanup queries (old jobs)
CREATE INDEX IF NOT EXISTS idx_jobs_completed_at
ON processing_jobs(completed_at)
WHERE completed_at IS NOT NULL;

-- ============================================================================
-- MEMORY CHUNKS TABLE - Query Optimization
-- ============================================================================

-- Composite index for chunk lookups
CREATE INDEX IF NOT EXISTS idx_chunks_memory_position
ON memory_chunks(memory_id, position);

-- Index for vector_id lookups (from Vectorize)
CREATE INDEX IF NOT EXISTS idx_chunks_vector
ON memory_chunks(vector_id);

-- ============================================================================
-- MEMORY RELATIONS TABLE - Query Optimization
-- ============================================================================

-- Index for forward relations (from_memory_id)
CREATE INDEX IF NOT EXISTS idx_relations_from_type
ON memory_relations(from_memory_id, relation_type);

-- Index for backward relations (to_memory_id)
CREATE INDEX IF NOT EXISTS idx_relations_to_type
ON memory_relations(to_memory_id, relation_type);

-- ============================================================================
-- CLEANUP - Remove redundant indexes
-- ============================================================================

-- Drop single-column indexes that are covered by composite indexes
-- (D1 will use leftmost prefix of composite index)

-- Keep these single-column indexes (not covered by composites):
-- - idx_memories_processing_status (for status-only queries)
-- - idx_processing_jobs_memory_id (for memory lookup)
-- - idx_processing_jobs_user_id (for user-only stats)
-- - idx_processing_jobs_status (for global status queries)

-- ============================================================================
-- ANALYZE - Update query planner statistics
-- ============================================================================

-- D1 doesn't support ANALYZE, but SQLite auto-analyzes on certain operations
-- The indexes above will be used automatically by the query planner
