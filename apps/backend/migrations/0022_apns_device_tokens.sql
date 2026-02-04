-- APNs Device Token Support
-- Adds token_type column to distinguish between APNs and Expo tokens
-- NOTE: Using CREATE TABLE approach with INSERT...SELECT to handle existing columns

-- Create index if not exists (indexes can use IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_push_tokens_type ON push_tokens(user_id, token_type) WHERE is_active = 1;
