-- =============================================================================
-- User Personality Table
-- Stores per-user personality preferences for personalized AI responses
-- =============================================================================

-- Main personality table
CREATE TABLE IF NOT EXISTS user_personality (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,

  -- Core tone preference (default: balanced = warm Poke-like)
  tone_preset TEXT DEFAULT 'balanced'
    CHECK (tone_preset IN ('professional', 'casual', 'supportive', 'sassy', 'coaching', 'balanced')),

  -- Communication style
  verbosity TEXT DEFAULT 'medium'
    CHECK (verbosity IN ('brief', 'medium', 'detailed')),
  emoji_usage TEXT DEFAULT 'moderate'
    CHECK (emoji_usage IN ('none', 'minimal', 'moderate', 'frequent')),

  -- Name preferences
  preferred_name TEXT,           -- How user wants to be called
  assistant_name TEXT DEFAULT 'Cortex',  -- What they call the AI

  -- Behavior flags
  proactive_suggestions INTEGER DEFAULT 1,  -- Offer help proactively
  memory_acknowledgment INTEGER DEFAULT 1,  -- "I remember you mentioned..."
  gentle_reminders INTEGER DEFAULT 1,       -- Commitment nudges

  -- Advanced (learned over time)
  communication_notes TEXT,      -- Free-form notes about style
  learned_preferences TEXT,      -- JSON of learned patterns

  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Index for fast user lookup
CREATE INDEX IF NOT EXISTS idx_user_personality_user
  ON user_personality(user_id);
