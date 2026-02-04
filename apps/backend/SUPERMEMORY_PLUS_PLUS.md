# Supermemory++ Architecture

## Overview

Cortex is being rebuilt as **Supermemory++** - a memory layer that outperforms Supermemory through:

1. **4-Layer Memory Hierarchy** (working, episodic, semantic, procedural)
2. **True Temporal Grounding** (document date vs event date)
3. **Relationship Versioning** with confidence scores
4. **Feedback-Driven Evolution**

---

## Memory Layer Hierarchy

| Layer | Purpose | Persistence | Example |
|-------|---------|-------------|---------|
| **Working** | Current session context | Session-scoped | "User is asking about project X" |
| **Episodic** | Past interactions/events | Long-term | "Met Alice at conference on Jan 5" |
| **Semantic** | Facts, entities, knowledge | Long-term | "Alice works at Acme Corp" |
| **Procedural** | Learned workflows/patterns | Long-term | "User prefers bullet points" |

---

## Database Schema (New)

### Core Tables

```sql
-- Main memory store (replaces old memories table)
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  container_tag TEXT DEFAULT 'default',

  -- Content
  content TEXT NOT NULL,
  content_hash TEXT,  -- For dedup

  -- Memory classification
  layer TEXT CHECK(layer IN ('working', 'episodic', 'semantic', 'procedural')) DEFAULT 'episodic',
  memory_type TEXT,  -- sub-type within layer

  -- Temporal grounding (Supermemory's key feature)
  document_date TEXT,  -- When the content was created/ingested
  event_date TEXT,     -- When the described event occurred
  valid_from TEXT,     -- When this memory became valid
  valid_to TEXT,       -- When this memory was superseded

  -- Versioning
  version INTEGER DEFAULT 1,
  is_current INTEGER DEFAULT 1,
  parent_id TEXT REFERENCES memories(id),
  root_id TEXT,

  -- Processing
  processing_status TEXT DEFAULT 'pending',

  -- Importance & access
  importance_score REAL DEFAULT 0.5,
  access_count INTEGER DEFAULT 0,
  last_accessed TEXT,

  -- Source tracking
  source TEXT,  -- manual, voice, photo, email, calendar, chat
  source_metadata JSON,

  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_memories_user_layer ON memories(user_id, layer, is_current);
CREATE INDEX idx_memories_temporal ON memories(user_id, event_date, valid_from);
CREATE INDEX idx_memories_content_hash ON memories(content_hash);

-- Memory relationships (evolution tracking)
CREATE TABLE memory_relations (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES memories(id),
  target_id TEXT NOT NULL REFERENCES memories(id),
  relation_type TEXT CHECK(relation_type IN (
    'updates',      -- New info replaces old
    'extends',      -- New info adds to old
    'derives',      -- New info synthesized from old
    'contradicts',  -- New info conflicts with old
    'supersedes'    -- Temporal supersession
  )),
  confidence REAL DEFAULT 1.0,
  evidence TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_relations_source ON memory_relations(source_id);
CREATE INDEX idx_relations_target ON memory_relations(target_id);

-- Entities (semantic layer)
CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  container_tag TEXT DEFAULT 'default',

  name TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  entity_type TEXT CHECK(entity_type IN (
    'person', 'organization', 'project', 'place',
    'event', 'concept', 'product', 'skill'
  )),

  -- Rich attributes
  attributes JSON,

  -- Scoring
  importance_score REAL DEFAULT 0.5,
  mention_count INTEGER DEFAULT 0,

  -- Temporal
  first_seen TEXT,
  last_seen TEXT,

  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_entities_user_type ON entities(user_id, entity_type);
CREATE INDEX idx_entities_canonical ON entities(canonical_name);

-- Entity relationships (knowledge graph)
CREATE TABLE entity_relations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,

  source_entity_id TEXT REFERENCES entities(id),
  target_entity_id TEXT REFERENCES entities(id),

  relation_type TEXT,  -- works_at, knows, manages, founded, etc.

  -- Temporal validity
  valid_from TEXT,
  valid_to TEXT,

  -- Confidence & evidence
  confidence REAL DEFAULT 1.0,
  evidence_memory_ids JSON,  -- Which memories support this

  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_entity_relations_source ON entity_relations(source_entity_id);
CREATE INDEX idx_entity_relations_target ON entity_relations(target_entity_id);

-- Memory-Entity links
CREATE TABLE memory_entities (
  memory_id TEXT REFERENCES memories(id),
  entity_id TEXT REFERENCES entities(id),
  mention_type TEXT,  -- subject, object, mentioned
  confidence REAL DEFAULT 1.0,
  PRIMARY KEY (memory_id, entity_id)
);

-- User profiles (dynamic facts)
CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  container_tag TEXT DEFAULT 'default',

  -- Profile entry
  category TEXT,  -- personal, work, preferences, etc.
  key TEXT NOT NULL,
  value TEXT NOT NULL,

  -- Confidence & evidence
  confidence REAL DEFAULT 1.0,
  source_memory_ids JSON,

  -- Temporal
  valid_from TEXT,
  valid_to TEXT,

  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_profiles_user ON profiles(user_id, category);

-- Timelines (for temporal queries)
CREATE TABLE timeline_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,

  memory_id TEXT REFERENCES memories(id),
  entity_id TEXT REFERENCES entities(id),

  event_type TEXT,  -- meeting, decision, milestone, etc.
  event_date TEXT NOT NULL,

  title TEXT,
  description TEXT,

  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_timeline_user_date ON timeline_events(user_id, event_date);

-- Feedback (for learning loop)
CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,

  query TEXT,
  memory_ids JSON,  -- Which memories were returned

  helpful INTEGER,  -- 1 = yes, 0 = no
  correction TEXT,  -- User's correction if unhelpful

  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

---

## API Design (v3 - Clean)

### Memory Operations

```
POST   /v3/memories              - Add memory (with AUDN dedup)
GET    /v3/memories              - List memories (with filters)
GET    /v3/memories/:id          - Get memory with relations
PUT    /v3/memories/:id          - Update memory (creates version)
DELETE /v3/memories/:id          - Soft delete memory
GET    /v3/memories/:id/history  - Get version history
GET    /v3/memories/:id/related  - Get related memories
```

### Search & Retrieval

```
POST /v3/search         - Hybrid search (vector + keyword + graph)
POST /v3/recall         - Intelligent recall with context
POST /v3/timeline       - Temporal query ("what happened in Q1?")
POST /v3/graph/traverse - Graph traversal query
```

### Entities & Knowledge Graph

```
GET  /v3/entities              - List entities
GET  /v3/entities/:id          - Get entity with relationships
GET  /v3/entities/:id/memories - Get memories mentioning entity
GET  /v3/graph/path            - Find path between entities
GET  /v3/graph/neighbors       - Get entity neighborhood
```

### Profile

```
GET  /v3/profile         - Get user profile
POST /v3/profile/update  - Force profile refresh
```

### Feedback

```
POST /v3/feedback        - Submit feedback on recall quality
```

---

## Processing Pipeline

```
Input (text/voice/photo)
    │
    ▼
┌─────────────────────────────────┐
│ 1. NORMALIZE                    │
│    - Transcribe audio           │
│    - OCR images                 │
│    - Extract text               │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│ 2. TEMPORAL GROUNDING           │
│    - Extract document_date      │
│    - Extract event_date         │
│    - Determine memory layer     │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│ 3. DEDUPLICATION (AUDN)         │
│    - Vector similarity check    │
│    - Decide: ADD/UPDATE/NOOP    │
│    - Create relations           │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│ 4. EMBED & INDEX                │
│    - Generate embedding         │
│    - Store in Vectorize         │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│ 5. ENTITY EXTRACTION            │
│    - Extract entities           │
│    - Dedupe against known       │
│    - Extract relationships      │
│    - Build knowledge graph      │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│ 6. PROFILE UPDATE               │
│    - Extract profile facts      │
│    - Update user profile        │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│ 7. TIMELINE                     │
│    - Create timeline events     │
│    - Link to entities           │
└─────────────────────────────────┘
```

---

## Retrieval Strategy

### Hybrid Search

```typescript
async function hybridSearch(query: string, options: SearchOptions) {
  // 1. Vector search (semantic similarity)
  const vectorResults = await vectorSearch(query, {
    topK: options.limit * 2,
    minScore: 0.7,
  });

  // 2. Keyword search (BM25-style)
  const keywordResults = await keywordSearch(query, {
    limit: options.limit,
  });

  // 3. Timeline filter (if temporal query)
  if (options.timeRange) {
    results = filterByTimeRange(results, options.timeRange);
  }

  // 4. Graph expansion (get related memories)
  const expanded = await expandWithRelations(results);

  // 5. Merge and rank
  const merged = mergeAndRank(vectorResults, keywordResults, expanded, {
    vectorWeight: 0.5,
    keywordWeight: 0.2,
    graphWeight: 0.3,
  });

  // 6. Profile injection
  const profile = await getProfile(userId);

  return {
    memories: merged.slice(0, options.limit),
    profile,
    timeline: extractTimeline(merged),
  };
}
```

### Graph Traversal

```typescript
async function findPath(entity1: string, entity2: string, maxHops: number = 3) {
  // BFS through entity_relations
  // Return: Entity1 → [relation] → Entity2 → [relation] → Entity3
}

async function getNeighborhood(entityId: string, depth: number = 2) {
  // Get all entities within N hops
  // Include relationship types and confidence
}
```

---

## Migration Plan

### Phase 1: Cleanup (Day 1-2)
- [ ] Delete beliefs system
- [ ] Delete outcomes system
- [ ] Delete learnings system
- [ ] Delete legacy /api/* routes
- [ ] Fix TypeScript errors

### Phase 2: New Schema (Day 3-4)
- [ ] Create new migration files
- [ ] Run migrations
- [ ] Update types

### Phase 3: Core Engine (Day 5-8)
- [ ] Temporal grounding in ingestion
- [ ] Enhanced AUDN with relations
- [ ] Entity extraction + graph building
- [ ] Profile engine

### Phase 4: Retrieval (Day 9-11)
- [ ] Hybrid search with graph
- [ ] Timeline queries
- [ ] Graph traversal API

### Phase 5: API & Mobile (Day 12-14)
- [ ] Clean v3 API
- [ ] Update mobile app
- [ ] Documentation

---

## Competitive Advantages vs Supermemory

| Feature | Supermemory | Supermemory++ |
|---------|-------------|---------------|
| Memory layers | Implicit | Explicit 4-layer |
| Temporal grounding | Yes | Enhanced (doc vs event date) |
| Graph relations | Yes | + Confidence + Evolution |
| Timeline queries | Limited | First-class support |
| Feedback loop | Optional | Built-in |
| Profile | Yes | + Auto-inference |
| Graph traversal | Basic | Path finding + neighborhoods |
