-- Migration 0010: Provenance Tracking
-- Full chain of custody for extractions and derivations

-- Extraction audit log: tracks all extractions from memories
CREATE TABLE IF NOT EXISTS extraction_log (
  id TEXT PRIMARY KEY,
  extraction_type TEXT NOT NULL CHECK(extraction_type IN ('entity', 'relationship', 'fact', 'commitment', 'temporal')),
  source_memory_id TEXT NOT NULL,
  extracted_entity_id TEXT, -- FK to entities (nullable)
  extracted_relationship_id TEXT, -- FK to entity_relationships (nullable)
  extracted_data JSON NOT NULL, -- Full extraction result for audit
  extractor_version TEXT, -- Code version for auditing (e.g., 'v1.0.0')
  confidence REAL CHECK(confidence >= 0 AND confidence <= 1),
  created_at TEXT NOT NULL,
  user_id TEXT NOT NULL,
  container_tag TEXT NOT NULL,

  FOREIGN KEY (source_memory_id) REFERENCES memories(id) ON DELETE CASCADE,
  FOREIGN KEY (extracted_entity_id) REFERENCES entities(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for extraction log queries
CREATE INDEX IF NOT EXISTS idx_extraction_source ON extraction_log(source_memory_id);
CREATE INDEX IF NOT EXISTS idx_extraction_entity ON extraction_log(extracted_entity_id) WHERE extracted_entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_extraction_user ON extraction_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_extraction_type ON extraction_log(extraction_type, created_at DESC);

-- Provenance chain: tracks derivation relationships between artifacts
CREATE TABLE IF NOT EXISTS provenance_chain (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL, -- Original artifact ID
  source_type TEXT NOT NULL CHECK(source_type IN ('memory', 'entity', 'relationship', 'commitment', 'fact')),
  derived_id TEXT NOT NULL, -- Derived artifact ID
  derived_type TEXT NOT NULL CHECK(derived_type IN ('memory', 'entity', 'relationship', 'commitment', 'fact')),
  derivation_type TEXT NOT NULL CHECK(derivation_type IN ('extracted', 'consolidated', 'inferred', 'superseded', 'merged')),
  processing_job_id TEXT, -- Link to processing_jobs table (nullable)
  created_at TEXT NOT NULL,
  metadata JSON, -- Additional context (e.g., extraction confidence, consolidation details)

  user_id TEXT NOT NULL,
  container_tag TEXT NOT NULL,

  FOREIGN KEY (processing_job_id) REFERENCES processing_jobs(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for provenance chain queries
CREATE INDEX IF NOT EXISTS idx_provenance_source ON provenance_chain(source_id, source_type);
CREATE INDEX IF NOT EXISTS idx_provenance_derived ON provenance_chain(derived_id, derived_type);
CREATE INDEX IF NOT EXISTS idx_provenance_user ON provenance_chain(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_provenance_job ON provenance_chain(processing_job_id) WHERE processing_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_provenance_type ON provenance_chain(derivation_type, created_at DESC);

-- Composite index for bidirectional graph traversal
CREATE INDEX IF NOT EXISTS idx_provenance_graph ON provenance_chain(source_id, source_type, derived_id, derived_type);
