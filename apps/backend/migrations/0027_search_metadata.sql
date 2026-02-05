-- Migration: Supermemory++ Phase 2 - Search Metadata
-- Purpose: Precomputed search hints for fast hybrid retrieval

CREATE TABLE IF NOT EXISTS memory_search_meta (
  memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,

  -- BM25 keyword data
  tokens TEXT,               -- JSON array of normalized tokens for keyword search
  token_count INTEGER,       -- Total token count for length normalization

  -- Precomputed scores
  recency_score REAL DEFAULT 1.0,   -- Decay score based on age
  importance_boost REAL DEFAULT 0.0, -- From importance_score

  -- Pinning & priority
  pinned INTEGER DEFAULT 0,         -- User-pinned for priority
  priority_boost REAL DEFAULT 0.0,  -- Additional boost factor

  -- Content characteristics
  content_length INTEGER,
  has_entities INTEGER DEFAULT 0,
  has_commitments INTEGER DEFAULT 0,
  has_temporal INTEGER DEFAULT 0,

  updated_at TEXT DEFAULT (datetime('now'))
);

-- Index for pinned items (fast fetch)
CREATE INDEX IF NOT EXISTS idx_search_meta_pinned
  ON memory_search_meta(pinned)
  WHERE pinned = 1;

-- Index for recency-based queries
CREATE INDEX IF NOT EXISTS idx_search_meta_recency
  ON memory_search_meta(recency_score DESC);
