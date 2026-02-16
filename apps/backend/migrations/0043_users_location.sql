-- Migration: Add location columns to users table
-- Fixes: D1_ERROR: no such column: latitude

-- Add latitude and longitude columns for location-aware features
ALTER TABLE users ADD COLUMN latitude REAL;
ALTER TABLE users ADD COLUMN longitude REAL;

-- Index for location queries
CREATE INDEX IF NOT EXISTS idx_users_location
  ON users(id)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
