-- Migration: Add commitments tracking
-- Purpose: Track promises, deadlines, and follow-ups from memories

-- Commitments table
CREATE TABLE IF NOT EXISTS commitments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,

  -- Commitment details
  commitment_type TEXT NOT NULL, -- 'promise', 'deadline', 'follow_up', 'meeting', 'deliverable'
  description TEXT NOT NULL,

  -- Participants
  to_entity_id TEXT, -- Who the commitment is to (entity ID)
  to_entity_name TEXT, -- Entity name for quick access
  from_entity_id TEXT, -- Who made the commitment (usually user)

  -- Temporal fields
  due_date TEXT, -- When the commitment is due
  reminder_date TEXT, -- When to send reminder

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'completed', 'cancelled', 'overdue'
  priority TEXT DEFAULT 'medium', -- 'low', 'medium', 'high', 'critical'

  -- Context
  context TEXT, -- Additional context about the commitment
  tags TEXT, -- JSON array of tags

  -- Completion tracking
  completed_at TEXT,
  completion_note TEXT,

  -- Metadata
  extraction_confidence REAL DEFAULT 0.5, -- Confidence in extraction (0-1)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (memory_id) REFERENCES memories(id),
  FOREIGN KEY (to_entity_id) REFERENCES entities(id),
  FOREIGN KEY (from_entity_id) REFERENCES entities(id)
);

-- Indexes for commitment queries
CREATE INDEX idx_commitments_user_status ON commitments(user_id, status);
CREATE INDEX idx_commitments_due_date ON commitments(user_id, due_date)
WHERE status = 'pending' AND due_date IS NOT NULL;
CREATE INDEX idx_commitments_memory ON commitments(memory_id);
CREATE INDEX idx_commitments_entity ON commitments(to_entity_id)
WHERE to_entity_id IS NOT NULL;
CREATE INDEX idx_commitments_type ON commitments(user_id, commitment_type, status);

-- Commitment reminders table (for scheduled nudges)
CREATE TABLE IF NOT EXISTS commitment_reminders (
  id TEXT PRIMARY KEY,
  commitment_id TEXT NOT NULL,
  user_id TEXT NOT NULL,

  -- Reminder details
  reminder_type TEXT NOT NULL, -- 'due_soon', 'overdue', 'follow_up'
  scheduled_for TEXT NOT NULL,
  sent_at TEXT,

  -- Status
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'sent', 'cancelled'

  created_at TEXT NOT NULL,

  FOREIGN KEY (commitment_id) REFERENCES commitments(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_reminders_scheduled ON commitment_reminders(status, scheduled_for)
WHERE status = 'pending';
CREATE INDEX idx_reminders_commitment ON commitment_reminders(commitment_id);
