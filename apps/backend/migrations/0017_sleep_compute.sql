-- ============================================
-- SLEEP COMPUTE JOBS TABLE
-- ============================================
-- Tracks background cognitive processing jobs.

CREATE TABLE IF NOT EXISTS sleep_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,

  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('scheduled', 'manual', 'threshold')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'running', 'completed', 'failed', 'skipped'
  )),

  -- Task results
  tasks_completed TEXT,  -- JSON array of TaskResult
  tasks_failed TEXT,     -- JSON array of TaskResult

  -- Metrics
  total_tasks INTEGER NOT NULL DEFAULT 0,
  completed_tasks INTEGER NOT NULL DEFAULT 0,
  failed_tasks INTEGER NOT NULL DEFAULT 0,

  -- Timing
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms INTEGER,

  -- Error tracking
  error_message TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================
-- SESSION CONTEXT TABLE
-- ============================================
-- Pre-computed context for fast session startup.
-- One active context per user (latest wins).

CREATE TABLE IF NOT EXISTS session_contexts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,

  -- Pre-computed context (JSON)
  context_data TEXT NOT NULL,

  -- Metadata
  generated_at TEXT NOT NULL,
  generated_by_job TEXT,  -- sleep_job ID that generated this

  -- Validity
  expires_at TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (generated_by_job) REFERENCES sleep_jobs(id) ON DELETE SET NULL
);

-- ============================================
-- INDEXES
-- ============================================

-- Job lookups
CREATE INDEX IF NOT EXISTS idx_sleep_jobs_user
  ON sleep_jobs(user_id);

CREATE INDEX IF NOT EXISTS idx_sleep_jobs_user_status
  ON sleep_jobs(user_id, status);

CREATE INDEX IF NOT EXISTS idx_sleep_jobs_created
  ON sleep_jobs(user_id, created_at DESC);

-- Session context (latest per user)
CREATE INDEX IF NOT EXISTS idx_session_ctx_user
  ON session_contexts(user_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_session_ctx_expiry
  ON session_contexts(expires_at);
