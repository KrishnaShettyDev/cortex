-- Migration: Add missing junction tables
-- Fixes: no such table: entity_mentions, commitment_entities

-- Entity mentions junction table (links entities to memories where they're mentioned)
CREATE TABLE IF NOT EXISTS entity_mentions (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  mention_type TEXT DEFAULT 'direct', -- 'direct', 'indirect', 'inferred'
  confidence REAL DEFAULT 1.0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE,
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_entity_mentions_entity ON entity_mentions(entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_mentions_memory ON entity_mentions(memory_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_mentions_unique ON entity_mentions(entity_id, memory_id);

-- Commitment entities junction table (links commitments to related entities)
CREATE TABLE IF NOT EXISTS commitment_entities (
  commitment_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  role TEXT DEFAULT 'related', -- 'to', 'from', 'about', 'related'
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (commitment_id, entity_id),
  FOREIGN KEY (commitment_id) REFERENCES commitments(id) ON DELETE CASCADE,
  FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_commitment_entities_commitment ON commitment_entities(commitment_id);
CREATE INDEX IF NOT EXISTS idx_commitment_entities_entity ON commitment_entities(entity_id);
