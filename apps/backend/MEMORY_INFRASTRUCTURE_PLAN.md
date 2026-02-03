# Cortex Memory Infrastructure: Implementation Plan
**Goal:** Build the world's best memory infrastructure that beats Supermemory on every metric

**Timeline:** 10 weeks
**Target:** LongMemEval score >70%, <400ms latency, production-ready at scale

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                   CORTEX MEMORY ENGINE v2.0                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  INGESTION LAYER                                               │
│  ├── Entity Extraction (people, companies, projects, places)   │
│  ├── Relationship Detection (works_for, manages, met_at)       │
│  ├── Temporal Resolution (event_date extraction)               │
│  ├── Commitment Extraction (promises, deadlines)               │
│  └── Conflict Detection (contradictions, updates)              │
│                                                                 │
│  STORAGE LAYER (Bi-Temporal Model)                            │
│  ├── Memories (valid_from, valid_to, event_date)              │
│  ├── Entities (people, companies, projects, places)           │
│  ├── Entity Relationships (works_for, reports_to, etc.)       │
│  ├── Commitments (promises, deadlines, status)                │
│  └── User Profiles (static + dynamic facts)                   │
│                                                                 │
│  INTELLIGENCE LAYER                                            │
│  ├── Temporal Reasoning (time-travel queries, validity)       │
│  ├── Graph Traversal (relationship queries)                   │
│  ├── Conflict Resolution (AUDN + temporal superseding)        │
│  ├── Memory Consolidation (episodic → semantic)               │
│  ├── Relationship Health (scoring, neglect detection)         │
│  └── Proactive Intelligence (nudges, meeting prep)            │
│                                                                 │
│  RETRIEVAL LAYER                                              │
│  ├── Hybrid Search (vector + graph + temporal)               │
│  ├── Profile Injection (always-on context)                   │
│  ├── Entity Resolution (disambiguate references)             │
│  ├── Relevance Ranking (importance × recency × access)       │
│  └── Sub-400ms Response Time                                 │
│                                                                 │
│  API LAYER                                                     │
│  ├── REST API (v3 endpoints)                                  │
│  ├── MCP Server (universal access)                            │
│  ├── Webhooks (real-time updates)                             │
│  └── SDK (TypeScript, Python)                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Entity & Relationship Graph (Week 1-2)

### Objectives
- Extract entities (people, companies, projects, places) from memories
- Build entity deduplication and linking system
- Create relationship graph
- Enable graph-based queries

### Database Schema

```sql
-- Entities: Core nodes in the knowledge graph
CREATE TABLE entities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    container_tag TEXT NOT NULL DEFAULT 'default',

    -- Core attributes
    name TEXT NOT NULL,
    entity_type TEXT NOT NULL, -- 'person', 'company', 'project', 'place', 'event'
    canonical_name TEXT, -- Normalized name for deduplication

    -- Attributes (flexible JSONB for entity-specific data)
    attributes JSONB DEFAULT '{}',
    -- Examples:
    -- person: {role: "CEO", company: "Lightspeed", email: "...", phone: "..."}
    -- company: {industry: "VC", stage: "Series A", size: "50-100"}
    -- project: {status: "active", deadline: "2025-02-01"}

    -- Vector embedding for similarity search
    embedding vector(1536),

    -- Importance scoring
    importance_score REAL DEFAULT 0.5, -- 0-1
    mention_count INTEGER DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_mentioned TIMESTAMPTZ,

    -- Constraints
    CONSTRAINT valid_importance CHECK (importance_score >= 0 AND importance_score <= 1),
    CONSTRAINT valid_entity_type CHECK (entity_type IN ('person', 'company', 'project', 'place', 'event', 'other'))
);

-- Entity Relationships: Edges in the knowledge graph
CREATE TABLE entity_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,

    -- Graph edge
    source_entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    target_entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    relationship_type TEXT NOT NULL,
    -- Examples: 'works_for', 'reports_to', 'founded', 'invested_in',
    --           'met_at', 'collaborates_with', 'part_of'

    -- Relationship attributes
    attributes JSONB DEFAULT '{}',
    -- Examples: {since: "2023-01-01", title: "Senior Engineer", confidence: 0.9}

    -- Temporal validity
    valid_from TIMESTAMPTZ DEFAULT NOW(),
    valid_to TIMESTAMPTZ, -- NULL = still valid

    -- Evidence
    source_memory_ids UUID[], -- Memories that support this relationship
    confidence REAL DEFAULT 0.8,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints
    CONSTRAINT no_self_relationship CHECK (source_entity_id != target_entity_id),
    CONSTRAINT valid_confidence CHECK (confidence >= 0 AND confidence <= 1),
    CONSTRAINT valid_dates CHECK (valid_to IS NULL OR valid_to > valid_from)
);

-- Memory-Entity Links: Connect memories to entities they mention
CREATE TABLE memory_entities (
    memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    role TEXT NOT NULL, -- 'subject', 'object', 'mentioned', 'context'

    -- Confidence in the link
    confidence REAL DEFAULT 0.9,

    PRIMARY KEY (memory_id, entity_id)
);

-- Indexes for performance
CREATE INDEX idx_entities_user_type ON entities(user_id, entity_type);
CREATE INDEX idx_entities_canonical_name ON entities(user_id, canonical_name);
CREATE INDEX idx_entities_embedding ON entities USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_entities_importance ON entities(user_id, importance_score DESC);

CREATE INDEX idx_relationships_source ON entity_relationships(source_entity_id, valid_to) WHERE valid_to IS NULL;
CREATE INDEX idx_relationships_target ON entity_relationships(target_entity_id, valid_to) WHERE valid_to IS NULL;
CREATE INDEX idx_relationships_type ON entity_relationships(user_id, relationship_type, valid_to) WHERE valid_to IS NULL;

CREATE INDEX idx_memory_entities_memory ON memory_entities(memory_id);
CREATE INDEX idx_memory_entities_entity ON memory_entities(entity_id);
```

### Implementation Tasks

#### Task 1.1: Entity Extraction Pipeline
**File:** `src/lib/entities/extractor.ts`

```typescript
/**
 * Entity Extractor
 *
 * Extracts structured entities from unstructured memory content.
 * Uses LLM to identify people, companies, projects, places, and events.
 */

export interface ExtractedEntity {
  name: string;
  entity_type: 'person' | 'company' | 'project' | 'place' | 'event' | 'other';
  attributes: Record<string, any>;
  confidence: number;
  mentions: string[]; // Text snippets where entity was mentioned
}

export interface ExtractedRelationship {
  source_entity: string; // Entity name
  target_entity: string;
  relationship_type: string;
  attributes: Record<string, any>;
  confidence: number;
  evidence: string; // Text supporting this relationship
}

export interface EntityExtractionResult {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
}

export class EntityExtractor {
  constructor(
    private llm: LLMClient,
    private embedder: EmbeddingModel
  ) {}

  async extract(
    content: string,
    context: {
      user_id: string;
      created_at: string;
      known_entities?: Entity[]; // For disambiguation
    }
  ): Promise<EntityExtractionResult> {
    const prompt = this.buildExtractionPrompt(content, context);
    const extracted = await this.llm.generate(prompt, {
      response_format: 'json',
      temperature: 0.1 // Low temp for consistency
    });

    return this.parseAndValidate(extracted);
  }

  private buildExtractionPrompt(content: string, context: any): string {
    return `
Extract entities and relationships from this text with high precision.

TEXT:
"""
${content}
"""

CONTEXT:
- Date: ${context.created_at}
- Known entities: ${context.known_entities?.map(e => e.name).join(', ') || 'None'}

EXTRACTION RULES:
1. ENTITIES: Extract people, companies, projects, places, events
   - For PEOPLE: Include role, company, contact info if mentioned
   - For COMPANIES: Include industry, stage, size if mentioned
   - For PROJECTS: Include status, deadline, stakeholders if mentioned
   - For PLACES: Include type (city, venue, address)
   - For EVENTS: Include date, location, attendees

2. RELATIONSHIPS: Extract how entities relate
   - works_for: Person works at Company
   - reports_to: Person reports to Person
   - founded: Person founded Company
   - invested_in: Company invested in Company
   - met_at: Person met Person at Event/Place
   - part_of: Project part of Company
   - manages: Person manages Project

3. CONFIDENCE: Rate 0-1 based on explicitness
   - 1.0: Explicitly stated ("Sarah is CEO of Acme")
   - 0.8: Strongly implied ("Sarah from Acme mentioned...")
   - 0.6: Weakly implied ("Sarah sent the deck")
   - Don't extract if confidence < 0.6

4. DISAMBIGUATION: If entity name matches known entity, use same name

OUTPUT FORMAT:
{
  "entities": [
    {
      "name": "Sarah Chen",
      "entity_type": "person",
      "attributes": {
        "role": "Partner",
        "company": "Lightspeed Venture Partners",
        "email": "sarah@lightspeed.com"
      },
      "confidence": 0.95,
      "mentions": ["Sarah Chen from Lightspeed", "Sarah mentioned the deck"]
    }
  ],
  "relationships": [
    {
      "source_entity": "Sarah Chen",
      "target_entity": "Lightspeed Venture Partners",
      "relationship_type": "works_for",
      "attributes": {"title": "Partner", "since": "2023"},
      "confidence": 0.95,
      "evidence": "Sarah Chen from Lightspeed Venture Partners"
    }
  ]
}
`;
  }

  private parseAndValidate(extracted: any): EntityExtractionResult {
    // Validate schema
    // Normalize names
    // Filter by confidence
    return extracted;
  }
}
```

#### Task 1.2: Entity Deduplication & Linking
**File:** `src/lib/entities/deduplicator.ts`

```typescript
/**
 * Entity Deduplicator
 *
 * Prevents duplicate entities by matching against existing entities.
 * Uses name normalization + embedding similarity + LLM verification.
 */

export class EntityDeduplicator {
  constructor(
    private db: D1Database,
    private embedder: EmbeddingModel,
    private llm: LLMClient
  ) {}

  async deduplicateAndLink(
    extracted: ExtractedEntity[],
    userId: string,
    containerTag: string
  ): Promise<Entity[]> {
    const linkedEntities: Entity[] = [];

    for (const extractedEntity of extracted) {
      // Step 1: Exact name match (after normalization)
      const canonicalName = this.normalizeName(extractedEntity.name);
      const exactMatch = await this.findExactMatch(userId, canonicalName);

      if (exactMatch) {
        // Update existing entity
        await this.updateEntity(exactMatch, extractedEntity);
        linkedEntities.push(exactMatch);
        continue;
      }

      // Step 2: Fuzzy name match (Levenshtein distance)
      const fuzzyMatches = await this.findFuzzyMatches(
        userId,
        extractedEntity.name,
        extractedEntity.entity_type
      );

      if (fuzzyMatches.length > 0) {
        // Use LLM to verify if it's the same entity
        const match = await this.verifyMatch(extractedEntity, fuzzyMatches);
        if (match) {
          await this.mergeEntities(match, extractedEntity);
          linkedEntities.push(match);
          continue;
        }
      }

      // Step 3: Embedding similarity (for typos, aliases)
      const embedding = await this.embedder.embed(
        `${extractedEntity.entity_type}: ${extractedEntity.name}`
      );

      const similarEntities = await this.findSimilarByEmbedding(
        userId,
        embedding,
        extractedEntity.entity_type
      );

      if (similarEntities.length > 0) {
        const match = await this.verifyMatch(extractedEntity, similarEntities);
        if (match) {
          await this.mergeEntities(match, extractedEntity);
          linkedEntities.push(match);
          continue;
        }
      }

      // Step 4: No match found, create new entity
      const newEntity = await this.createEntity(
        userId,
        containerTag,
        extractedEntity,
        embedding
      );
      linkedEntities.push(newEntity);
    }

    return linkedEntities;
  }

  private normalizeName(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, '');
  }

  private async verifyMatch(
    extracted: ExtractedEntity,
    candidates: Entity[]
  ): Promise<Entity | null> {
    const prompt = `
Are these the same entity?

NEW ENTITY:
- Name: ${extracted.name}
- Type: ${extracted.entity_type}
- Attributes: ${JSON.stringify(extracted.attributes)}

EXISTING ENTITIES:
${candidates.map((e, i) => `
${i + 1}. ${e.name} (${e.entity_type})
   Attributes: ${JSON.stringify(e.attributes)}
   Mentioned ${e.mention_count} times
`).join('\n')}

Determine if the new entity matches any existing entity.
Consider: name variations, typos, aliases, nicknames.

Return JSON:
{
  "is_match": true/false,
  "matched_entity_id": "uuid" or null,
  "confidence": 0-1,
  "reason": "explanation"
}
`;

    const result = await this.llm.generate(prompt, { response_format: 'json' });

    if (result.is_match && result.confidence > 0.8) {
      return candidates.find(e => e.id === result.matched_entity_id) || null;
    }

    return null;
  }

  private async createEntity(
    userId: string,
    containerTag: string,
    extracted: ExtractedEntity,
    embedding: number[]
  ): Promise<Entity> {
    const entity = await this.db.prepare(`
      INSERT INTO entities (
        user_id, container_tag, name, canonical_name, entity_type,
        attributes, embedding, importance_score, mention_count, last_mentioned
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).bind(
      userId,
      containerTag,
      extracted.name,
      this.normalizeName(extracted.name),
      extracted.entity_type,
      JSON.stringify(extracted.attributes),
      JSON.stringify(embedding),
      this.calculateImportance(extracted),
      1,
      new Date().toISOString()
    ).first();

    return entity;
  }

  private async updateEntity(
    existing: Entity,
    extracted: ExtractedEntity
  ): Promise<void> {
    // Merge attributes
    const mergedAttributes = {
      ...existing.attributes,
      ...extracted.attributes
    };

    await this.db.prepare(`
      UPDATE entities
      SET
        attributes = ?,
        mention_count = mention_count + 1,
        last_mentioned = ?,
        updated_at = ?
      WHERE id = ?
    `).bind(
      JSON.stringify(mergedAttributes),
      new Date().toISOString(),
      new Date().toISOString(),
      existing.id
    ).run();
  }
}
```

#### Task 1.3: Relationship Graph Builder
**File:** `src/lib/entities/relationship-builder.ts`

```typescript
/**
 * Relationship Builder
 *
 * Creates and maintains the entity relationship graph.
 * Handles relationship creation, updates, and temporal validity.
 */

export class RelationshipBuilder {
  constructor(
    private db: D1Database,
    private llm: LLMClient
  ) {}

  async buildRelationships(
    extractedRelationships: ExtractedRelationship[],
    entityMap: Map<string, Entity>, // Name -> Entity mapping
    userId: string,
    memoryId: string
  ): Promise<EntityRelationship[]> {
    const relationships: EntityRelationship[] = [];

    for (const rel of extractedRelationships) {
      const sourceEntity = entityMap.get(rel.source_entity);
      const targetEntity = entityMap.get(rel.target_entity);

      if (!sourceEntity || !targetEntity) {
        console.warn(`Entities not found for relationship: ${rel.source_entity} -> ${rel.target_entity}`);
        continue;
      }

      // Check if relationship already exists
      const existing = await this.findExistingRelationship(
        sourceEntity.id,
        targetEntity.id,
        rel.relationship_type
      );

      if (existing) {
        // Update existing relationship
        await this.updateRelationship(existing, rel, memoryId);
        relationships.push(existing);
      } else {
        // Create new relationship
        const newRel = await this.createRelationship(
          userId,
          sourceEntity.id,
          targetEntity.id,
          rel,
          memoryId
        );
        relationships.push(newRel);
      }
    }

    return relationships;
  }

  private async createRelationship(
    userId: string,
    sourceId: string,
    targetId: string,
    extracted: ExtractedRelationship,
    memoryId: string
  ): Promise<EntityRelationship> {
    const relationship = await this.db.prepare(`
      INSERT INTO entity_relationships (
        user_id, source_entity_id, target_entity_id, relationship_type,
        attributes, valid_from, confidence, source_memory_ids
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).bind(
      userId,
      sourceId,
      targetId,
      extracted.relationship_type,
      JSON.stringify(extracted.attributes),
      new Date().toISOString(),
      extracted.confidence,
      JSON.stringify([memoryId])
    ).first();

    return relationship;
  }

  private async updateRelationship(
    existing: EntityRelationship,
    extracted: ExtractedRelationship,
    memoryId: string
  ): Promise<void> {
    // Add memory to source_memory_ids
    const memoryIds = [...existing.source_memory_ids, memoryId];

    // Merge attributes
    const mergedAttributes = {
      ...existing.attributes,
      ...extracted.attributes
    };

    // Increase confidence with more evidence
    const newConfidence = Math.min(
      1.0,
      existing.confidence + (extracted.confidence * 0.1)
    );

    await this.db.prepare(`
      UPDATE entity_relationships
      SET
        attributes = ?,
        confidence = ?,
        source_memory_ids = ?,
        updated_at = ?
      WHERE id = ?
    `).bind(
      JSON.stringify(mergedAttributes),
      newConfidence,
      JSON.stringify(memoryIds),
      new Date().toISOString(),
      existing.id
    ).run();
  }

  async queryGraph(
    userId: string,
    query: string
  ): Promise<GraphQueryResult> {
    // Examples:
    // "Who works at Lightspeed?" → Find entities with works_for relationship to Lightspeed
    // "Who does Sarah report to?" → Find target of reports_to relationship from Sarah
    // "All people I met at conferences" → Find people with met_at relationship to event entities

    const queryPlan = await this.parseGraphQuery(query, userId);
    return await this.executeGraphQuery(queryPlan, userId);
  }

  private async parseGraphQuery(query: string, userId: string): Promise<any> {
    // Get user's entities for context
    const entities = await this.db.prepare(`
      SELECT id, name, entity_type
      FROM entities
      WHERE user_id = ?
      LIMIT 50
    `).bind(userId).all();

    const prompt = `
Convert this natural language query into a graph traversal plan.

QUERY: "${query}"

AVAILABLE ENTITIES:
${entities.results.map(e => `- ${e.name} (${e.entity_type})`).join('\n')}

AVAILABLE RELATIONSHIP TYPES:
- works_for, reports_to, manages
- founded, invested_in
- met_at, collaborates_with
- part_of

OUTPUT graph traversal plan as JSON:
{
  "operation": "find_entities" | "traverse_relationships",
  "start_entity": "entity_name" or null,
  "relationship_types": ["works_for", "reports_to"],
  "target_entity_type": "person" | "company" | null,
  "filters": {"entity_type": "person"},
  "direction": "outgoing" | "incoming" | "both"
}
`;

    return await this.llm.generate(prompt, { response_format: 'json' });
  }
}
```

---

## Phase 2: Temporal Intelligence (Week 3-4)

### Objectives
- Implement bi-temporal data model (valid time + transaction time)
- Build temporal conflict resolution
- Enable time-travel queries
- Track knowledge updates

### Database Migrations

```sql
-- Extend memories table with temporal columns
ALTER TABLE memories ADD COLUMN valid_from TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE memories ADD COLUMN valid_to TIMESTAMPTZ;
ALTER TABLE memories ADD COLUMN event_date TIMESTAMPTZ;
ALTER TABLE memories ADD COLUMN supersedes UUID REFERENCES memories(id);
ALTER TABLE memories ADD COLUMN superseded_by UUID REFERENCES memories(id);
ALTER TABLE memories ADD COLUMN memory_type TEXT DEFAULT 'episodic';

-- Add constraint
ALTER TABLE memories ADD CONSTRAINT valid_temporal_range
  CHECK (valid_to IS NULL OR valid_to > valid_from);

-- Migrate existing data
UPDATE memories
SET valid_from = created_at,
    event_date = created_at
WHERE valid_from IS NULL;

-- Index for temporal queries
CREATE INDEX idx_memories_temporal_validity
  ON memories(user_id, valid_to)
  WHERE valid_to IS NULL;

CREATE INDEX idx_memories_event_date
  ON memories(user_id, event_date DESC)
  WHERE event_date IS NOT NULL;
```

### Implementation Tasks

#### Task 2.1: Temporal Resolver
**File:** `src/lib/temporal/resolver.ts`

```typescript
/**
 * Temporal Resolver
 *
 * Resolves relative dates ("last Thursday", "next week") to absolute timestamps.
 * Handles event_date extraction from memories.
 */

export class TemporalResolver {
  constructor(private llm: LLMClient) {}

  async resolveEventDate(
    content: string,
    referenceDate: Date
  ): Promise<Date | null> {
    const prompt = `
Extract the event date from this text.

TEXT: "${content}"
REFERENCE DATE: ${referenceDate.toISOString()} (when this was said/written)

RULES:
1. Absolute dates: "January 15", "2025-01-15" → return exact date
2. Relative dates: "last Thursday", "next week" → resolve relative to reference date
3. Future references: "next Friday", "in 3 days" → calculate from reference
4. Past references: "last month", "two weeks ago" → calculate from reference
5. No date mentioned: return null

Return JSON:
{
  "event_date": "2025-01-11T00:00:00Z" or null,
  "confidence": 0-1,
  "original_phrase": "last Thursday"
}
`;

    const result = await this.llm.generate(prompt, { response_format: 'json' });
    return result.event_date ? new Date(result.event_date) : null;
  }
}
```

#### Task 2.2: Temporal Conflict Resolution
**File:** `src/lib/temporal/conflict-resolver.ts`

```typescript
/**
 * Temporal Conflict Resolver
 *
 * Handles contradictions and updates in temporal context.
 * Implements sophisticated AUDN logic with temporal awareness.
 */

export interface ConflictResolution {
  action: 'add' | 'update' | 'supersede' | 'noop';
  existing_memory_id?: string;
  valid_to_date?: Date;
  reason: string;
  confidence: number;
}

export class TemporalConflictResolver {
  constructor(
    private db: D1Database,
    private llm: LLMClient,
    private embedder: EmbeddingModel
  ) {}

  async resolveConflict(
    newMemory: {
      content: string;
      event_date?: Date;
      created_at: Date;
    },
    userId: string
  ): Promise<ConflictResolution> {
    // Find potentially conflicting memories
    const embedding = await this.embedder.embed(newMemory.content);
    const candidates = await this.findConflictCandidates(
      userId,
      embedding,
      newMemory.event_date
    );

    if (candidates.length === 0) {
      return {
        action: 'add',
        reason: 'No conflicts found',
        confidence: 1.0
      };
    }

    // Use LLM to determine relationship
    return await this.analyzeConflict(newMemory, candidates);
  }

  private async analyzeConflict(
    newMemory: any,
    candidates: Memory[]
  ): Promise<ConflictResolution> {
    const prompt = `
Analyze the relationship between this new memory and existing memories.

NEW MEMORY:
- Content: "${newMemory.content}"
- Event Date: ${newMemory.event_date?.toISOString() || 'unknown'}
- Created At: ${newMemory.created_at.toISOString()}

EXISTING MEMORIES:
${candidates.map((m, i) => `
${i + 1}. "${m.content}"
   - Valid From: ${m.valid_from}
   - Valid To: ${m.valid_to || 'present'}
   - Event Date: ${m.event_date || 'unknown'}
`).join('\n')}

DETERMINE THE RELATIONSHIP:

1. SUPERSEDE: New memory contradicts or updates existing memory
   Example: "I love Adidas" → "Adidas sucks, switching to Puma"
   Action: Set valid_to on old memory, create new memory with supersedes link

2. UPDATE: New memory adds detail to existing memory without contradiction
   Example: "Met Sarah" → "Sarah from Lightspeed gave great feedback"
   Action: Merge information, keep single memory

3. ADD: New memory is independent despite similarity
   Example: "Had coffee with Sarah Monday" → "Had lunch with Sarah Wednesday"
   Action: Create new memory, they're separate events

4. NOOP: New memory is redundant
   Example: "Met Sarah at conference" → "I met Sarah at the conference"
   Action: Don't create duplicate

Return JSON:
{
  "action": "supersede" | "update" | "add" | "noop",
  "existing_memory_id": "uuid" or null,
  "valid_to_date": "ISO date" or null,
  "reason": "explanation",
  "confidence": 0-1
}
`;

    return await this.llm.generate(prompt, { response_format: 'json' });
  }

  private async findConflictCandidates(
    userId: string,
    embedding: number[],
    eventDate?: Date
  ): Promise<Memory[]> {
    // Find semantically similar memories that are currently valid
    const query = `
      WITH similar AS (
        SELECT
          id, content, valid_from, valid_to, event_date,
          1 - (embedding <=> $1) as similarity
        FROM memories
        WHERE user_id = $2
          AND valid_to IS NULL
          AND (embedding <=> $1) < 0.15
      )
      SELECT * FROM similar
      WHERE similarity > 0.85
      ORDER BY similarity DESC
      LIMIT 5
    `;

    const results = await this.db.prepare(query)
      .bind(JSON.stringify(embedding), userId)
      .all();

    return results.results;
  }
}
```

---

## Phase 3: Memory Consolidation & Decay (Week 5-6)

### Objectives
- Implement importance scoring
- Build memory decay system
- Create consolidation (episodic → semantic)
- Add access pattern tracking

### Implementation Tasks

#### Task 3.1: Importance Scorer
**File:** `src/lib/memory/importance-scorer.ts`

```typescript
/**
 * Importance Scorer
 *
 * Calculates and updates memory importance scores.
 * Factors: mentions, recency, user engagement, entity importance
 */

export class ImportanceScorer {
  async scoreMemory(memory: Memory, context: ScoringContext): Promise<number> {
    // Base score from content analysis
    const contentScore = await this.analyzeContent(memory.content);

    // Recency factor (newer = more important)
    const recencyScore = this.calculateRecency(memory.created_at);

    // Access pattern (more accessed = more important)
    const accessScore = this.calculateAccessScore(
      memory.access_count,
      memory.last_accessed
    );

    // Entity importance (mentions of important entities)
    const entityScore = await this.calculateEntityScore(memory.id);

    // Commitment score (contains commitments = important)
    const commitmentScore = await this.hasCommitments(memory.id) ? 0.3 : 0;

    // Weighted average
    return (
      contentScore * 0.3 +
      recencyScore * 0.2 +
      accessScore * 0.2 +
      entityScore * 0.2 +
      commitmentScore * 0.1
    );
  }

  private async analyzeContent(content: string): Promise<number> {
    const prompt = `
Rate the long-term importance of this memory (0-1).

MEMORY: "${content}"

SCORING CRITERIA:
1.0: Critical information (commitments, major life events, key decisions)
0.8: Important facts (relationships, preferences, goals)
0.6: Useful context (recent events, project updates)
0.4: Minor details (casual mentions, passing comments)
0.2: Trivial information (generic statements, small talk)

Return just the score as a number between 0 and 1.
`;

    const score = await this.llm.generate(prompt);
    return parseFloat(score);
  }
}
```

#### Task 3.2: Memory Decay System
**File:** `src/lib/memory/decay-manager.ts`

```typescript
/**
 * Decay Manager
 *
 * Implements brain-inspired memory decay and consolidation.
 * Runs periodically to archive low-importance memories.
 */

export class DecayManager {
  private readonly DECAY_RATE = 0.1; // 10% per month if not accessed
  private readonly MIN_IMPORTANCE = 0.2;
  private readonly CONSOLIDATION_THRESHOLD = 0.3;

  async runDecayCycle(userId: string): Promise<DecayStats> {
    // Update importance scores based on time + access
    await this.applyDecay(userId);

    // Consolidate low-importance episodic memories
    const consolidated = await this.consolidateMemories(userId);

    // Archive very low importance memories
    const archived = await this.archiveMemories(userId);

    return { consolidated, archived };
  }

  private async consolidateMemories(userId: string): Promise<number> {
    // Get low-importance episodic memories
    const lowImportance = await this.db.prepare(`
      SELECT id, content, event_date, importance_score
      FROM memories
      WHERE user_id = ?
        AND memory_type = 'episodic'
        AND importance_score < ?
        AND valid_to IS NULL
        AND created_at < NOW() - INTERVAL '30 days'
      ORDER BY event_date
    `).bind(userId, this.CONSOLIDATION_THRESHOLD).all();

    if (lowImportance.results.length < 5) {
      return 0;
    }

    // Cluster similar memories
    const clusters = await this.clusterMemories(lowImportance.results);

    let consolidatedCount = 0;

    for (const cluster of clusters) {
      // Extract semantic facts
      const semanticFacts = await this.extractSemanticFacts(cluster);

      if (semanticFacts) {
        // Create consolidated semantic memory
        await this.createSemanticMemory(userId, semanticFacts);

        // Archive original episodic memories
        await this.archiveMemoryCluster(cluster);

        consolidatedCount += cluster.length;
      }
    }

    return consolidatedCount;
  }

  private async extractSemanticFacts(cluster: Memory[]): Promise<string | null> {
    const prompt = `
These episodic memories are being consolidated into semantic facts.

EPISODIC MEMORIES:
${cluster.map(m => `- ${m.content} (${m.event_date})`).join('\n')}

Extract any lasting SEMANTIC facts worth preserving:
- Patterns of behavior
- Preferences that emerged
- Relationships that developed
- Skills or knowledge acquired

Return ONLY high-level facts, not specific events.
If nothing valuable to preserve, return null.

Examples:
- "User frequently meets Sarah for coffee" (from multiple coffee meetings)
- "User prefers morning meetings" (from scheduling patterns)
- "User is learning Spanish" (from multiple language mentions)
`;

    const result = await this.llm.generate(prompt);
    return result === 'null' ? null : result;
  }
}
```

---

## Phase 4: Commitment Tracking (Week 5-6)

### Database Schema

```sql
CREATE TABLE commitments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    container_tag TEXT NOT NULL DEFAULT 'default',

    -- Commitment details
    description TEXT NOT NULL,
    commitment_type TEXT NOT NULL, -- 'promise_made', 'promise_received', 'deadline', 'meeting_followup'

    -- Participants (entities)
    made_by_entity_id UUID REFERENCES entities(id),
    made_to_entity_id UUID REFERENCES entities(id),

    -- Temporal info
    commitment_date TIMESTAMPTZ NOT NULL, -- When commitment was made
    due_date TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    -- Status
    status TEXT DEFAULT 'active', -- 'active', 'completed', 'overdue', 'cancelled'

    -- Source
    source_memory_id UUID NOT NULL REFERENCES memories(id),

    -- Metadata
    priority TEXT DEFAULT 'medium', -- 'high', 'medium', 'low'
    tags TEXT[] DEFAULT '{}',

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT valid_commitment_type CHECK (commitment_type IN ('promise_made', 'promise_received', 'deadline', 'meeting_followup')),
    CONSTRAINT valid_status CHECK (status IN ('active', 'completed', 'overdue', 'cancelled'))
);

CREATE INDEX idx_commitments_user_status ON commitments(user_id, status, due_date);
CREATE INDEX idx_commitments_due_date ON commitments(due_date) WHERE status = 'active';
```

### Implementation

#### Task 4.1: Commitment Extractor
**File:** `src/lib/commitments/extractor.ts`

```typescript
/**
 * Commitment Extractor
 *
 * Extracts promises, deadlines, and commitments from memories.
 */

export class CommitmentExtractor {
  async extract(
    memory: Memory,
    entities: Entity[]
  ): Promise<ExtractedCommitment[]> {
    const prompt = `
Extract commitments from this message.

MESSAGE: "${memory.content}"
DATE: ${memory.created_at}
PARTICIPANTS: ${entities.map(e => `${e.name} (${e.entity_type})`).join(', ')}

COMMITMENT TYPES:
1. promise_made: User promised to do something
   Example: "I'll send you the deck by Friday"

2. promise_received: Someone promised to do something for user
   Example: "Arjun said he'd review the prototype next week"

3. deadline: Time-bound task or deliverable
   Example: "The investor deck is due by Feb 1"

4. meeting_followup: Action item from a meeting
   Example: "Send Sarah the case study after our call"

For each commitment, extract:
- description: What needs to be done
- commitment_type: One of the above types
- made_by: Who made the commitment (use "user" or entity name)
- made_to: Who receives the benefit (use "user" or entity name)
- due_date: When it's due (resolve relative dates)
- priority: high/medium/low based on urgency and importance

Return JSON array:
[
  {
    "description": "Send investor deck to Arjun",
    "commitment_type": "promise_made",
    "made_by": "user",
    "made_to": "Arjun",
    "due_date": "2025-02-07T17:00:00Z",
    "priority": "high"
  }
]
`;

    const extracted = await this.llm.generate(prompt, { response_format: 'json' });
    return this.parseCommitments(extracted, memory, entities);
  }
}
```

---

## Quality Standards

### Performance Targets
- **Retrieval Latency:** <400ms p99
- **Ingestion Throughput:** >100 memories/sec
- **Graph Query:** <200ms for 2-hop traversal
- **Memory Accuracy:** >95% on entity extraction
- **Temporal Accuracy:** >90% on date resolution

### Testing Requirements
- Unit tests for all core functions
- Integration tests for pipelines
- LongMemEval benchmark: >70% overall score
- Load testing: 10K memories per user
- Multi-tenancy isolation verified

### Code Quality
- TypeScript strict mode
- Comprehensive error handling
- Structured logging with context
- Metrics tracking for all operations
- Documentation for all public APIs

---

## Success Metrics

### Week 2 Milestone
- [ ] Entity extraction working (>90% accuracy)
- [ ] Entity deduplication preventing duplicates
- [ ] Relationship graph queryable
- [ ] "Who works at X?" queries working

### Week 4 Milestone
- [ ] Temporal conflict resolution working
- [ ] Time-travel queries enabled
- [ ] "What did I think in June?" queries working
- [ ] Knowledge updates tracked correctly

### Week 6 Milestone
- [ ] Memory decay running automatically
- [ ] Consolidation creating semantic facts
- [ ] Commitment extraction working
- [ ] Importance scoring operational

### Week 10 Milestone
- [ ] LongMemEval score >70%
- [ ] Latency <400ms p99
- [ ] All integrations working
- [ ] Production-ready deployment

---

This is world-class memory infrastructure. Let's build it.
