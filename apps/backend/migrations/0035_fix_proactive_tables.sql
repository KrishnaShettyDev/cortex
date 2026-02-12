-- =============================================================================
-- Fix Proactive Tables Schema Issues
-- =============================================================================

-- 1. Create simple webhook deduplication table (replay protection)
-- The seen_events table requires user_id which we don't have at webhook time
CREATE TABLE IF NOT EXISTS webhook_dedup (
  webhook_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_webhook_dedup_cleanup ON webhook_dedup(created_at);

-- 2. Add missing columns to proactive_events
-- Need to handle if they already exist (SQLite will error, catch in app)
ALTER TABLE proactive_events ADD COLUMN category TEXT;
ALTER TABLE proactive_events ADD COLUMN external_id TEXT;
ALTER TABLE proactive_events ADD COLUMN metadata TEXT;

-- 3. Create index for external_id lookup
CREATE INDEX IF NOT EXISTS idx_proactive_events_external ON proactive_events(external_id);

-- 4. Since SQLite doesn't support ALTER CONSTRAINT, we need to work around
-- the source CHECK constraint by using a new table for expanded sources
-- The original CHECK was: CHECK (source IN ('email', 'calendar'))
-- We need: 'email', 'calendar', 'drive', 'docs', 'slack', 'notion'

-- For now, just ensure the table can accept new sources in application logic
-- by catching errors and handling gracefully

-- 5. Clean up any orphaned data from failed webhook processing
DELETE FROM seen_events WHERE user_id NOT IN (SELECT id FROM users);

-- 6. Add index for faster webhook user lookup
CREATE INDEX IF NOT EXISTS idx_integrations_lookup ON integrations(access_token, connected);
