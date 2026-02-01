-- Add processing status to memories table

ALTER TABLE memories ADD COLUMN processing_status TEXT NOT NULL DEFAULT 'queued';
ALTER TABLE memories ADD COLUMN processing_error TEXT;

-- Update existing memories to 'done' status
UPDATE memories SET processing_status = 'done' WHERE processing_status = 'queued';

-- Create index on processing status for queue workers
CREATE INDEX IF NOT EXISTS idx_memories_processing_status ON memories(processing_status) WHERE processing_status != 'done';
