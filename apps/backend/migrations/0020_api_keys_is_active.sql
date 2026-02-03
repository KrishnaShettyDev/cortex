-- Migration: Add is_active column to api_keys table
-- This enables proper API key revocation without deletion

-- Add is_active column with default value of 1 (active)
ALTER TABLE api_keys ADD COLUMN is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1));

-- Create index for efficient lookup of active keys
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(key_hash) WHERE is_active = 1;
