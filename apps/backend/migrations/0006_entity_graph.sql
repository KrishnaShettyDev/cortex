-- Migration 0006: Entity & Relationship Graph
-- Creates tables for entity extraction, relationship tracking, and knowledge graph

-- =============================================================================
-- ENTITIES TABLE
-- =============================================================================
-- Core nodes in the knowledge graph (people, companies, projects, places, events)

CREATE TABLE IF NOT EXISTS entities (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT NOT NULL,
    container_tag TEXT NOT NULL DEFAULT 'default',

    -- Core attributes
    name TEXT NOT NULL,
    canonical_name TEXT NOT NULL, -- Normalized name for deduplication
    entity_type TEXT NOT NULL CHECK (entity_type IN ('person', 'company', 'project', 'place', 'event', 'other')),

    -- Flexible attributes (JSON)
    -- Examples:
    -- person: {"role": "CEO", "company": "Lightspeed", "email": "...", "phone": "..."}
    -- company: {"industry": "VC", "stage": "Series A", "size": "50-100"}
    -- project: {"status": "active", "deadline": "2025-02-01"}
    attributes TEXT NOT NULL DEFAULT '{}',

    -- Importance scoring
    importance_score REAL DEFAULT 0.5 CHECK (importance_score >= 0 AND importance_score <= 1),
    mention_count INTEGER DEFAULT 0,

    -- Timestamps
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_mentioned TEXT, -- Last time this entity was mentioned in a memory

    -- Constraints
    UNIQUE(user_id, canonical_name, entity_type)
);

-- =============================================================================
-- ENTITY RELATIONSHIPS TABLE
-- =============================================================================
-- Edges in the knowledge graph

CREATE TABLE IF NOT EXISTS entity_relationships (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT NOT NULL,

    -- Graph edge
    source_entity_id TEXT NOT NULL,
    target_entity_id TEXT NOT NULL,
    relationship_type TEXT NOT NULL,
    -- Examples: 'works_for', 'reports_to', 'founded', 'invested_in',
    --           'met_at', 'collaborates_with', 'part_of'

    -- Relationship attributes (JSON)
    -- Examples: {"since": "2023-01-01", "title": "Senior Engineer", "confidence": 0.9}
    attributes TEXT NOT NULL DEFAULT '{}',

    -- Temporal validity (bi-temporal model)
    valid_from TEXT NOT NULL DEFAULT (datetime('now')),
    valid_to TEXT, -- NULL = still valid

    -- Evidence
    source_memory_ids TEXT NOT NULL DEFAULT '[]', -- JSON array of memory IDs that support this relationship
    confidence REAL DEFAULT 0.8 CHECK (confidence >= 0 AND confidence <= 1),

    -- Timestamps
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    -- Constraints
    CHECK (source_entity_id != target_entity_id), -- No self-relationships
    CHECK (valid_to IS NULL OR valid_to > valid_from),
    FOREIGN KEY (source_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
    FOREIGN KEY (target_entity_id) REFERENCES entities(id) ON DELETE CASCADE
);

-- =============================================================================
-- MEMORY-ENTITY LINKS TABLE
-- =============================================================================
-- Many-to-many relationship between memories and entities

CREATE TABLE IF NOT EXISTS memory_entities (
    memory_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('subject', 'object', 'mentioned', 'context')),

    -- Confidence in the link
    confidence REAL DEFAULT 0.9 CHECK (confidence >= 0 AND confidence <= 1),

    PRIMARY KEY (memory_id, entity_id),
    FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
    FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Entities indexes
CREATE INDEX idx_entities_user_type ON entities(user_id, entity_type);
CREATE INDEX idx_entities_canonical ON entities(user_id, canonical_name);
CREATE INDEX idx_entities_importance ON entities(user_id, importance_score DESC);
CREATE INDEX idx_entities_last_mentioned ON entities(user_id, last_mentioned DESC);
CREATE INDEX idx_entities_container ON entities(user_id, container_tag);

-- Relationships indexes
CREATE INDEX idx_relationships_source ON entity_relationships(source_entity_id, valid_to);
CREATE INDEX idx_relationships_target ON entity_relationships(target_entity_id, valid_to);
CREATE INDEX idx_relationships_type ON entity_relationships(user_id, relationship_type, valid_to);
CREATE INDEX idx_relationships_valid ON entity_relationships(user_id, valid_to) WHERE valid_to IS NULL;

-- Memory-entity links indexes
CREATE INDEX idx_memory_entities_memory ON memory_entities(memory_id);
CREATE INDEX idx_memory_entities_entity ON memory_entities(entity_id);
CREATE INDEX idx_memory_entities_role ON memory_entities(role);
