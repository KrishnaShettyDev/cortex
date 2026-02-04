-- Migration: Failed Jobs / Dead Letter Queue
-- Stores permanently failed jobs for manual review and retry

CREATE TABLE IF NOT EXISTS failed_jobs (
  id TEXT PRIMARY KEY,
  -- Original job info
  original_job_id TEXT NOT NULL,
  job_type TEXT NOT NULL,  -- 'processing', 'sync', 'webhook', etc.
  -- Tenant scoping
  user_id TEXT NOT NULL,
  container_tag TEXT NOT NULL DEFAULT 'default',
  -- Job data
  payload TEXT NOT NULL,  -- JSON blob of original message
  -- Failure info
  error_message TEXT,
  error_stack TEXT,
  failure_count INTEGER NOT NULL DEFAULT 1,
  first_failed_at TEXT NOT NULL,
  last_failed_at TEXT NOT NULL,
  -- Resolution
  status TEXT NOT NULL DEFAULT 'failed',  -- 'failed', 'retrying', 'resolved', 'ignored'
  resolved_at TEXT,
  resolved_by TEXT,  -- user who resolved it
  resolution_notes TEXT,
  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_failed_jobs_user_status ON failed_jobs(user_id, status);
CREATE INDEX IF NOT EXISTS idx_failed_jobs_type_status ON failed_jobs(job_type, status);
CREATE INDEX IF NOT EXISTS idx_failed_jobs_created ON failed_jobs(created_at DESC);
