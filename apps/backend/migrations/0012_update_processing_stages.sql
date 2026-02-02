-- Migration: Update processing_jobs status CHECK constraint to include new stages
-- The pipeline needs additional stages: temporal_extraction, entity_extraction, importance_scoring, commitment_extraction

-- Step 1: Create new table with updated constraint
CREATE TABLE processing_jobs_new (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  container_tag TEXT NOT NULL DEFAULT 'default',

  -- Status tracking (updated with new stages)
  status TEXT NOT NULL CHECK (status IN (
    'queued',
    'extracting',
    'chunking',
    'embedding',
    'indexing',
    'temporal_extraction',
    'entity_extraction',
    'importance_scoring',
    'commitment_extraction',
    'done',
    'failed'
  )),
  current_step TEXT NOT NULL CHECK (current_step IN (
    'queued',
    'extracting',
    'chunking',
    'embedding',
    'indexing',
    'temporal_extraction',
    'entity_extraction',
    'importance_scoring',
    'commitment_extraction',
    'done',
    'failed'
  )),
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

-- Step 2: Copy existing data
INSERT INTO processing_jobs_new
SELECT * FROM processing_jobs;

-- Step 3: Drop old table
DROP TABLE processing_jobs;

-- Step 4: Rename new table
ALTER TABLE processing_jobs_new RENAME TO processing_jobs;

-- Step 5: Recreate indexes
CREATE INDEX idx_processing_jobs_memory ON processing_jobs(memory_id);
CREATE INDEX idx_processing_jobs_user ON processing_jobs(user_id);
CREATE INDEX idx_processing_jobs_status ON processing_jobs(status);
