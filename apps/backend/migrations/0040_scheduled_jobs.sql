-- Migration: Event-Driven Job Scheduling System
-- Replaces polling-based crons with scheduled jobs for exact-time execution

-- Scheduled Jobs Table
CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  job_type TEXT NOT NULL,  -- 'meeting_prep' | 'commitment_reminder' | 'nudge_send' | 'briefing_send' | 'email_digest'
  scheduled_for INTEGER NOT NULL,  -- Unix timestamp (seconds)
  payload TEXT NOT NULL DEFAULT '{}',  -- JSON with job-specific data
  status TEXT DEFAULT 'pending',  -- 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  created_at INTEGER DEFAULT (unixepoch()),
  processed_at INTEGER,
  error TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- THE KEY INDEX: Find due jobs efficiently
-- This makes the every-minute cron O(1) for finding due jobs
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_due
ON scheduled_jobs(scheduled_for, status)
WHERE status = 'pending';

-- Index for user's pending jobs
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_user
ON scheduled_jobs(user_id, job_type, status);

-- Index for cleanup of old completed jobs
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_completed
ON scheduled_jobs(status, processed_at)
WHERE status IN ('completed', 'failed', 'cancelled');

-- Prevent duplicate pending jobs for same event
CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_jobs_unique
ON scheduled_jobs(user_id, job_type, json_extract(payload, '$.eventId'))
WHERE status = 'pending' AND json_extract(payload, '$.eventId') IS NOT NULL;

-- Prevent duplicate pending commitment reminders
CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_jobs_commitment_unique
ON scheduled_jobs(user_id, job_type, json_extract(payload, '$.commitmentId'))
WHERE status = 'pending' AND json_extract(payload, '$.commitmentId') IS NOT NULL;
