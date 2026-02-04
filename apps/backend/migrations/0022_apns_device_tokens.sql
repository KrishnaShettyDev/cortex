-- APNs Device Token Support
-- Adds token_type column to distinguish between APNs and Expo tokens

-- Add token_type column (apns for native iOS, expo for Expo push)
ALTER TABLE push_tokens ADD COLUMN token_type TEXT DEFAULT 'expo' CHECK (token_type IN ('apns', 'expo'));

-- Create index for token type queries
CREATE INDEX IF NOT EXISTS idx_push_tokens_type ON push_tokens(user_id, token_type) WHERE is_active = 1;

-- Update notification_log to track APNs-specific fields
ALTER TABLE notification_log ADD COLUMN apns_id TEXT;
ALTER TABLE notification_log ADD COLUMN delivery_channel TEXT DEFAULT 'expo' CHECK (delivery_channel IN ('apns', 'expo'));
