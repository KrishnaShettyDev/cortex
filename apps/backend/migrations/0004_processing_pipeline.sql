-- Processing Pipeline Tables
-- Migration: 0004_processing_pipeline.sql
-- Created: 2026-02-01

-- ============================================================================
-- Processing Jobs Table
-- ============================================================================
-- Tracks document processing jobs with full observability
-- Status flow: queued → extracting → chunking → embedding → indexing → done

CREATE TABLE IF NOT EXISTS processing_jobs (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  container_tag TEXT NOT NULL DEFAULT 'default',

  -- Status tracking
  status TEXT NOT NULL CHECK (status IN ('queued', 'extracting', 'chunking', 'embedding', 'indexing', 'done', 'failed')),
  current_step TEXT NOT NULL CHECK (current_step IN ('queued', 'extracting', 'chunking', 'embedding', 'indexing', 'done', 'failed')),
  steps TEXT NOT NULL, -- JSON array of ProcessingStep objects

  -- Metrics
  metrics TEXT NOT NULL, -- JSON object with all metrics

  -- Retry logic
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  last_error TEXT,

  -- Timestamps
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,

  -- Indexes for queries
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

-- Indexes for processing_jobs
CREATE INDEX IF NOT EXISTS idx_processing_jobs_user_id ON processing_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_status ON processing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_memory_id ON processing_jobs(memory_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_created_at ON processing_jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_user_status ON processing_jobs(user_id, status);

-- ============================================================================
-- Memory Chunks Table
-- ============================================================================
-- Stores chunked content for retrieval and reference

CREATE TABLE IF NOT EXISTS memory_chunks (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  vector_id TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL,
  position INTEGER NOT NULL,
  token_count INTEGER NOT NULL,
  metadata TEXT, -- JSON object with chunk metadata
  created_at TEXT NOT NULL,

  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

-- Indexes for memory_chunks
CREATE INDEX IF NOT EXISTS idx_memory_chunks_memory_id ON memory_chunks(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_chunks_vector_id ON memory_chunks(vector_id);
CREATE INDEX IF NOT EXISTS idx_memory_chunks_position ON memory_chunks(memory_id, position);

-- ============================================================================
-- Add processing status to memories table (if not exists)
-- ============================================================================
-- Track which memories have been processed

-- Note: SQLite doesn't support ALTER TABLE IF NOT EXISTS
-- These will fail silently if columns already exist
-- Check manually before running if unsure
