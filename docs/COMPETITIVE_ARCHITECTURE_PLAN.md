# Cortex Competitive Architecture Plan

> **Date**: January 2025
> **Goal**: Compete with Supermemory and Zep in the AI Memory API market
> **Timeline**: 4-5 months to competitive product

---

## Table of Contents

1. [Market Research](#market-research)
   - [Supermemory Analysis](#supermemory-analysis)
   - [Zep Analysis](#zep-analysis)
   - [Comparison Matrix](#comparison-matrix)
2. [Cortex's Position](#cortexs-position)
   - [Current State](#current-state)
   - [Unfair Advantages](#unfair-advantages)
   - [Gaps to Close](#gaps-to-close)
3. [Target Architecture](#target-architecture)
   - [Speed Infrastructure](#layer-1-speed-infrastructure)
   - [Accuracy Infrastructure](#layer-2-accuracy-infrastructure)
   - [Unique Differentiators](#layer-3-unique-differentiators)
4. [Implementation Roadmap](#implementation-roadmap)
5. [API Design](#api-design)
6. [Benchmark Targets](#benchmark-targets)
7. [Investment Required](#investment-required)
8. [Go-to-Market Position](#go-to-market-position)

---

## Market Research

### Supermemory Analysis

**Source**: [supermemory.ai](https://supermemory.ai/), [GitHub](https://github.com/supermemoryai/supermemory), [Research](https://supermemory.ai/research)

#### What They Do
- Universal Memory API for AI apps
- Developer-focused, not consumer
- Open source core

#### Technical Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 SUPERMEMORY ARCHITECTURE                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  EDGE LAYER (Cloudflare)                                   │
│  ├── Workers for compute                                   │
│  ├── KV for hot cache                                      │
│  ├── Durable Objects for persistence                       │
│  └── Global distribution                                   │
│                                                             │
│  MEMORY LAYERS (Brain-Inspired)                            │
│  ├── Hot Memory: Recent/frequent (<10ms)                   │
│  ├── Warm Memory: Vector search (<100ms)                   │
│  └── Cold Memory: Full archive (<400ms)                    │
│                                                             │
│  DATA PROCESSING                                           │
│  ├── Chunk-based ingestion                                 │
│  ├── Contextual memory generation                          │
│  ├── Semantic fingerprinting                               │
│  └── Relationship tracking (updates/extends/derives)       │
│                                                             │
│  STORAGE                                                   │
│  ├── PostgreSQL + Drizzle ORM                              │
│  ├── Custom vector engine                                  │
│  └── Semantic graph                                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Key Innovations
1. **Hierarchical Memory Layers** - Hot/warm/cold like human brain
2. **Smart Decay** - Less relevant info fades automatically
3. **Contextual Memories** - Resolve ambiguous references inline
4. **Relational Versioning**:
   - `updates`: Handle contradictions (state mutations)
   - `extends`: Add supplementary info
   - `derives`: Second-order inferences

#### Performance
- **Retrieval**: <400ms (claims 10x faster than Zep)
- **Scale**: 50M tokens per user, 5B tokens daily
- **Benchmark**: 81.6% on LongMemEval

#### Tech Stack
- TypeScript (67.8%)
- Remix (frontend)
- Cloudflare Workers + KV + Durable Objects
- PostgreSQL + Drizzle ORM
- Hono (HTTP API)

---

### Zep Analysis

**Source**: [getzep.com](https://www.getzep.com/), [arXiv Paper](https://arxiv.org/abs/2501.13956), [Blog](https://blog.getzep.com/state-of-the-art-agent-memory/)

#### What They Do
- Temporal Knowledge Graph for agent memory
- Context engineering platform
- Research-backed (published paper)

#### Technical Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    ZEP ARCHITECTURE                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  THREE-TIER KNOWLEDGE GRAPH G = (N, E, φ)                  │
│                                                             │
│  EPISODE SUBGRAPH (Gₑ) - Raw Data                          │
│  ├── Messages, text, JSON                                  │
│  ├── Non-lossy storage                                     │
│  └── Foundation for extraction                             │
│           │                                                 │
│           ↓ Extract                                         │
│                                                             │
│  SEMANTIC ENTITY SUBGRAPH (Gₛ) - Facts                     │
│  ├── Entities (people, places, concepts)                   │
│  ├── Relationships (edges with validity)                   │
│  └── Bi-temporal timestamps                                │
│           │                                                 │
│           ↓ Cluster                                         │
│                                                             │
│  COMMUNITY SUBGRAPH (Gc) - High-level                      │
│  ├── Grouped entities (label propagation)                  │
│  ├── Domain summaries                                      │
│  └── Global understanding                                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Key Innovations

1. **Bi-Temporal Model** (Critical for accuracy)
   ```
   Fact: "Sarah works at Google"

   Timeline T (Event):
   - t_valid   = 2024-06-01  (when she started)
   - t_invalid = NULL        (still true)

   Timeline T' (Transaction):
   - t_created = 2024-06-15  (when user told agent)
   - t_expired = NULL        (not superseded)
   ```

2. **Hybrid Search Strategy**
   - φcos: Cosine semantic similarity (embeddings)
   - φbm25: Okapi BM25 full-text search (Lucene)
   - φbfs: Breadth-first search (graph traversal)
   - Merge with Reciprocal Rank Fusion (RRF)

3. **Reranking Pipeline**
   - RRF (Reciprocal Rank Fusion)
   - MMR (Maximal Marginal Relevance)
   - Episode-mention frequency
   - Cross-encoder LLMs

#### Performance
- **Retrieval**: <200ms P95
- **Benchmark**: 71.2% on LongMemEval (but better temporal reasoning)
- **Temporal Reasoning**: 48.2% improvement over baseline
- **Multi-session**: 30.7% improvement over baseline
- **Efficiency**: 1.6k tokens vs 115k (98% reduction)

#### Tech Stack
- Graphiti (open source library)
- Neo4j (graph database)
- BGE-m3 (embeddings)
- GPT-4o-mini (graph construction)

---

### Comparison Matrix

| Feature | Supermemory | Zep | Notes |
|---------|-------------|-----|-------|
| **Speed** | <400ms | <200ms P95 | Supermemory optimized for speed |
| **Accuracy (LongMemEval)** | 81.6% | 71.2% | Different benchmarks favor different systems |
| **Temporal Reasoning** | Basic | Excellent (+48%) | Zep's bi-temporal is superior |
| **Multi-session** | Good | Excellent (+31%) | Zep handles context across sessions better |
| **Architecture** | Layered cache | Knowledge graph | Different approaches |
| **Open Source** | Yes | Graphiti library | Both have OSS components |
| **Integrations** | None | None | Neither has Calendar/Email |
| **Relationship Tracking** | Basic relations | Entities only | Neither has social graph |
| **Consumer App** | No | No | Both are developer APIs |
| **Pricing** | $5-15/mo start | Free tier + enterprise | Similar |

---

## Cortex's Position

### Current State

| Component | Status | Quality |
|-----------|--------|---------|
| Memory Storage | PostgreSQL + pgvector | Good |
| Embedding | OpenAI ada-002 | Good |
| Search | Vector similarity only | Basic |
| Facts/Entities | MemoryFact model exists | Good foundation |
| Relationships | RelationshipIntelligenceService | Excellent |
| Calendar | Full Google Calendar integration | Excellent |
| Email | Full Gmail integration | Excellent |
| FSRS | FSRSService integrated | Excellent |
| Caching | None | Gap |
| Temporal | document_date only | Gap |
| Speed | ~1.5s response | Gap |

### Unfair Advantages

These are things Supermemory and Zep **cannot easily copy**:

| Advantage | Why It Matters | Why They Don't Have It |
|-----------|----------------|------------------------|
| **Calendar Integration** | Real temporal grounding, schedule context | They're APIs, not apps |
| **Email Integration** | Rich context, relationship signals, commitments | They're APIs, not apps |
| **Relationship Graph** | Social intelligence, "who said what to whom" | They have entities, not relationships |
| **Working Consumer App** | Proof it works, real user feedback, iteration | They're developer tools |
| **FSRS Cognitive Science** | Scientifically-backed retrieval scoring | They use basic relevance |
| **Proactive Features** | Anticipation, not just recall | They're reactive only |
| **Mobile App** | Real-world usage, voice input | They're server-side only |

### Gaps to Close

| Gap | Supermemory Has | Zep Has | We Need |
|-----|-----------------|---------|---------|
| **Speed** | <400ms | <200ms | <100ms target |
| **Caching** | 3-layer (hot/warm/cold) | - | Redis + Edge |
| **Temporal** | Basic | Bi-temporal | Add t_valid/t_invalid |
| **Hybrid Search** | Yes | Yes (3 methods + RRF) | Add BM25 + fusion |
| **Edge Deploy** | Cloudflare | - | Cloudflare Workers |
| **Async Pipeline** | Yes | Yes | Improve ours |

---

## Target Architecture

### Layer 1: Speed Infrastructure

**Goal**: Match and beat Supermemory's speed (<100ms P95)

```
┌─────────────────────────────────────────────────────────────┐
│  EDGE LAYER (Cloudflare Workers + KV)                       │
│  ├── Global distribution (<50ms latency anywhere)           │
│  ├── Hot memory cache (last 24h per user)                   │
│  ├── Pre-computed embeddings                                │
│  ├── User context cache (model, timezone, prefs)            │
│  └── Request routing & auth                                 │
└─────────────────────────────────────────────────────────────┘
          │
          ↓ Cache miss
┌─────────────────────────────────────────────────────────────┐
│  WARM CACHE (Redis Cluster)                                 │
│  ├── Recent memories (7 days)                               │
│  ├── Entity index (fast lookup)                             │
│  ├── Relationship graph (hot paths)                         │
│  ├── Embedding cache                                        │
│  └── Session state                                          │
└─────────────────────────────────────────────────────────────┘
          │
          ↓ Cache miss
┌─────────────────────────────────────────────────────────────┐
│  COLD STORAGE (PostgreSQL + pgvector)                       │
│  ├── Full memory archive                                    │
│  ├── Complete knowledge graph                               │
│  ├── Audit trail                                            │
│  └── Complex queries                                        │
└─────────────────────────────────────────────────────────────┘
```

### Layer 2: Accuracy Infrastructure

**Goal**: Match and beat Zep's accuracy (85%+ on LongMemEval)

```
┌─────────────────────────────────────────────────────────────┐
│  KNOWLEDGE GRAPH (PostgreSQL + Extensions)                  │
│                                                             │
│  EPISODES (Raw Data)                                        │
│  ├── Conversations (chat messages)                          │
│  ├── Documents (uploaded files)                             │
│  ├── Events (calendar, emails)                              │
│  ├── Non-lossy storage                                      │
│  └── source_type, source_id for provenance                  │
│           │                                                 │
│           ↓ Extract                                         │
│                                                             │
│  FACTS (Atomic, Bi-Temporal)                                │
│  ├── fact_text: "Sarah works at Google"                     │
│  ├── t_valid: When fact became true                         │
│  ├── t_invalid: When fact stopped being true (nullable)     │
│  ├── t_created: When we learned this                        │
│  ├── t_expired: When superseded (nullable)                  │
│  ├── confidence: 0.0-1.0                                    │
│  ├── source_episode_id: Provenance                          │
│  └── superseded_by_id: For knowledge updates                │
│           │                                                 │
│           ↓ Link                                            │
│                                                             │
│  ENTITIES + RELATIONSHIPS                                   │
│  ├── entity_type: person, org, place, concept               │
│  ├── canonical_name: Resolved name                          │
│  ├── aliases: ["Sarah", "Sarah Chen", "sarah@acme.com"]     │
│  ├── relationship_type: manager, friend, colleague          │
│  ├── relationship_strength: 0.0-1.0                         │
│  ├── last_interaction: Timestamp                            │
│  └── interaction_count: Frequency                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Hybrid Search Strategy**:

```
Query: "What did Sarah say about the budget?"
         │
         ├──→ Entity Search ──────────────────→ "Sarah" + "budget"
         │    (pg_trgm, exact match)              Fast, precise
         │
         ├──→ Vector Search ──────────────────→ Semantic similarity
         │    (pgvector, cosine)                  Fuzzy matching
         │
         ├──→ Temporal Filter ────────────────→ Recent first
         │    (timestamp ordering)                Recency bias
         │
         ├──→ Relationship Filter ────────────→ From known contacts
         │    (Cortex exclusive)                  Social context
         │
         └──→ Reciprocal Rank Fusion ─────────→ Merge results
                                                  Balanced ranking
```

### Layer 3: Unique Differentiators

**These make Cortex different from both competitors**:

```
┌─────────────────────────────────────────────────────────────┐
│  INTEGRATION LAYER (Cortex Exclusive)                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  CALENDAR INTELLIGENCE                                      │
│  ├── Auto-ingest events as memories                         │
│  ├── Temporal grounding ("the meeting last Tuesday")        │
│  ├── Attendee → Relationship auto-linking                   │
│  ├── Schedule-aware retrieval                               │
│  └── Meeting prep context                                   │
│                                                             │
│  EMAIL INTELLIGENCE                                         │
│  ├── Thread ingestion as episodes                           │
│  ├── Commitment extraction ("I'll send it Monday")          │
│  ├── Relationship signal extraction                         │
│  ├── Topic clustering                                       │
│  └── Urgency detection                                      │
│                                                             │
│  RELATIONSHIP INTELLIGENCE                                  │
│  ├── Social graph with health scores                        │
│  ├── Interaction patterns & frequency                       │
│  ├── Important dates (birthdays, anniversaries)             │
│  ├── Promises & commitments tracking                        │
│  └── Context-aware "who" resolution                         │
│       ("my manager" → "Sarah Chen")                         │
│                                                             │
│  COGNITIVE SCIENCE (FSRS-6)                                 │
│  ├── Retrievability scoring per memory                      │
│  ├── Spaced repetition for important facts                  │
│  ├── Forgetting curve modeling                              │
│  ├── Memory strength tracking                               │
│  └── Optimal review scheduling                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Roadmap

### Phase 1: Foundation (Weeks 1-4)

| Week | Component | Work | Outcome |
|------|-----------|------|---------|
| 1 | Redis Setup | Deploy Redis, create CacheService | Caching layer ready |
| 1 | Service Interfaces | Clean up service boundaries | API-ready architecture |
| 2 | Bi-temporal Model | Add t_valid/t_invalid to MemoryFact | Temporal accuracy |
| 2 | Fact Superseding | Logic for knowledge updates | Handle contradictions |
| 3 | Hybrid Search | Add BM25 (pg_trgm), implement RRF | Better recall |
| 3 | Entity Resolution | Merge duplicate entities | Clean graph |
| 4 | Async Pipeline | Background job queue for extraction | Non-blocking UX |
| 4 | Testing | Unit tests, integration tests | Quality assurance |

**Deliverable**: Foundation that supports both consumer app and future API

### Phase 2: Speed (Weeks 5-8)

| Week | Component | Work | Outcome |
|------|-----------|------|---------|
| 5 | Memory Caching | Recent memories in Redis | 80% cache hit |
| 5 | Context Caching | User model, timezone in memory | Faster personalization |
| 6 | Embedding Cache | Pre-compute on ingest, cache queries | No query-time embedding |
| 6 | Model Routing | GPT-4o-mini for simple queries | 2x faster, 10x cheaper |
| 7 | Cloudflare Workers | Edge proxy setup | Global distribution |
| 7 | KV Hot Cache | Last 24h memories at edge | <50ms for recent |
| 8 | Load Testing | Benchmark performance | Verify <100ms P95 |
| 8 | Optimization | Profile and fix bottlenecks | Meet targets |

**Deliverable**: <100ms P95 retrieval (faster than both competitors)

### Phase 3: Accuracy (Weeks 9-12)

| Week | Component | Work | Outcome |
|------|-----------|------|---------|
| 9 | Temporal Parser | Extract event dates from text | "Last week" works |
| 9 | Relationship Linking | Auto-link people to graph | Social context |
| 10 | Knowledge Validity | Full superseding logic | Accurate facts |
| 10 | Confidence Scoring | Fact confidence from source | Abstention support |
| 11 | FSRS Integration | Retrievability in search ranking | Cognitive edge |
| 11 | Calendar Auto-ingest | Events → Memories pipeline | Temporal grounding |
| 12 | Email Auto-ingest | Threads → Episodes pipeline | Rich context |
| 12 | Benchmark Testing | Run LongMemEval locally | Measure accuracy |

**Deliverable**: 85%+ on LongMemEval (beat both competitors)

### Phase 4: Differentiation (Weeks 13-16)

| Week | Component | Work | Outcome |
|------|-----------|------|---------|
| 13 | Relationship API | Expose graph queries | Unique feature |
| 13 | "Who" Resolution | Natural language → entity | "My manager" works |
| 14 | Commitment Tracking | Extract and track promises | Proactive reminders |
| 14 | Integration Connectors | Calendar/Email as API | Unique feature |
| 15 | Proactive Surfacing | Surface relevant without asking | Anticipation |
| 15 | Memory Strength | FSRS dashboard | User visibility |
| 16 | Mobile SDK | React Native integration | Mobile-first |
| 16 | Documentation | API docs, guides | Developer ready |

**Deliverable**: Features no competitor has

### Phase 5: Go to Market (Weeks 17-20)

| Week | Component | Work | Outcome |
|------|-----------|------|---------|
| 17 | Public API | Auth, rate limits, versioning | Developer access |
| 17 | API Keys | Self-service key generation | Onboarding |
| 18 | SDKs | Python, TypeScript, Go | Easy integration |
| 18 | Pricing | Tiers, usage metering | Revenue |
| 19 | Benchmarks | Run and publish results | Credibility |
| 19 | Open Source | Core library release | Community |
| 20 | Launch | Product Hunt, Hacker News | Awareness |
| 20 | Iterate | User feedback incorporation | Product-market fit |

**Deliverable**: Competitive product in market

---

## API Design

### Simple API (Match Supermemory)

```python
import cortex

# Initialize
client = cortex.Client(api_key="ctx_...")

# Add memory
client.add(
    content="Sarah got promoted to VP of Engineering",
    user_id="user_123"
)

# Search
results = client.search(
    query="What happened with Sarah?",
    user_id="user_123",
    limit=5
)

# Returns
[
    {
        "content": "Sarah got promoted to VP of Engineering",
        "score": 0.95,
        "created_at": "2025-01-15T10:30:00Z",
        "metadata": {...}
    }
]
```

### Rich API (Match Zep + Extend)

```python
# Add with metadata
client.add(
    content="Sarah mentioned she's switching to the new project next month",
    user_id="user_123",
    metadata={
        "event_date": "2025-02-01",           # When it will happen
        "document_date": "2025-01-15",        # When user said it
        "people": ["sarah@acme.com"],         # Auto-link to relationship
        "source": "chat",                      # Provenance
        "confidence": 0.9                      # How sure we are
    }
)

# Search with filters
results = client.search(
    query="What's happening with projects?",
    user_id="user_123",
    filters={
        "after": "2025-01-01",
        "people": ["sarah@acme.com"],
        "min_confidence": 0.7
    },
    include_relationships=True
)
```

### Cortex-Exclusive Features

```python
# Integration-aware ingestion
client.add_from_calendar(
    event_id="gcal_abc123",
    user_id="user_123"
)

client.add_from_email(
    thread_id="gmail_xyz789",
    user_id="user_123"
)

# Relationship-aware search
results = client.search(
    query="What did my manager say about the budget?",
    user_id="user_123",
    resolve_relationships=True  # "my manager" → "Sarah Chen"
)

# Get relationship context
relationships = client.get_relationships(
    user_id="user_123",
    include_health_scores=True,
    include_recent_interactions=True
)

# Proactive retrieval (what's relevant right now)
relevant = client.get_relevant_now(
    user_id="user_123",
    context={
        "current_time": "2025-01-15T09:00:00Z",
        "location": "office",
        "upcoming_meeting": "standup with Sarah"
    }
)
```

---

## Benchmark Targets

| Benchmark | Supermemory | Zep | Cortex Target |
|-----------|-------------|-----|---------------|
| **LongMemEval Overall** | 81.6% | 71.2% | **85%+** |
| **Single-session** | 97% | 93% | **98%** |
| **Preference Recall** | 70% | 57% | **80%** |
| **Knowledge Update** | 88% | 83% | **95%** |
| **Temporal Reasoning** | 77% | 62%+48% | **90%** |
| **Multi-session** | 71% | 58%+31% | **85%** |
| **Retrieval Latency (P95)** | <400ms | <200ms | **<100ms** |
| **Retrieval Latency (P50)** | ~200ms | ~100ms | **<50ms** |

### How We Beat Both

1. **Speed**: Supermemory's caching + our edge layer = fastest
2. **Temporal**: Zep's bi-temporal model + our calendar integration = best temporal
3. **Multi-session**: Graph structure + relationship context = best continuity
4. **Unique**: Relationship resolution ("my manager") = no competitor has this

---

## Investment Required

### Infrastructure Costs

| Item | Monthly Cost | Notes |
|------|--------------|-------|
| Cloudflare Workers | $5 base + usage | ~$20-50 at scale |
| Cloudflare KV | Included | 1GB free, $0.50/GB after |
| Redis Cloud | $0-30 | Free tier for start |
| PostgreSQL | Current | Already have |
| OpenAI API | Current | Model routing reduces 50% |
| **Total Additional** | **$25-80/mo** | Minimal infrastructure cost |

### Engineering Investment

| Phase | Duration | Focus |
|-------|----------|-------|
| Foundation | 4 weeks | Architecture, data model |
| Speed | 4 weeks | Caching, edge deployment |
| Accuracy | 4 weeks | Search, temporal, knowledge |
| Differentiation | 4 weeks | Unique features, integrations |
| Go to Market | 4 weeks | API, SDKs, launch |
| **Total** | **20 weeks** | ~5 months full-time |

---

## Go-to-Market Position

### Competitive Positioning

```
┌─────────────────────────────────────────────────────────────┐
│                   MEMORY API MARKET                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                        ACCURACY                             │
│                           ↑                                 │
│                           │                                 │
│              Zep ●        │        ● CORTEX (target)        │
│                           │          - Fast AND accurate    │
│                           │          - Has integrations     │
│           Mem0 ●          │          - Relationship-aware   │
│                           │                                 │
│                           │        ● Supermemory            │
│  ─────────────────────────┼─────────────────────→ SPEED    │
│                           │                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### The Pitch

> **Cortex Memory API**
>
> The only memory infrastructure that understands people, not just text.
>
> **Why Cortex?**
> - **Faster than Supermemory**: <100ms P95 retrieval
> - **More accurate than Zep**: 85%+ on LongMemEval
> - **Built-in integrations**: Calendar, Email, CRM (they have none)
> - **Relationship-aware**: Knows "my manager" means Sarah
> - **Cognitive science**: FSRS-6 for optimal recall
> - **Proven**: Powers a consumer app with real users
>
> ```python
> import cortex
>
> # Simple
> cortex.add("Sarah got promoted to VP", user_id="u123")
> cortex.search("What happened with my manager?", user_id="u123")
> # → Returns Sarah's promotion (knows Sarah = manager)
>
> # Powerful
> cortex.add_from_calendar(event_id="gcal_123", user_id="u123")
> cortex.get_relevant_now(user_id="u123", context={...})
> ```

### Target Customers

| Segment | Use Case | Why Cortex Wins |
|---------|----------|-----------------|
| **AI Assistants** | Personal/work assistants | Relationship context |
| **CRM Tools** | Customer memory | Integration support |
| **Healthcare** | Patient context | Temporal accuracy |
| **Legal Tech** | Case memory | Knowledge updates |
| **Education** | Student learning | FSRS cognitive science |

---

## Summary

### What We're Building

A memory infrastructure that is:
1. **Faster** than Supermemory (<100ms vs <400ms)
2. **More accurate** than Zep (85%+ vs 71%)
3. **Uniquely differentiated** with integrations and relationships

### Why We Can Win

1. **Supermemory** is fast but lacks integrations and relationship intelligence
2. **Zep** is accurate but complex and lacks real-world integrations
3. **Cortex** can be both fast AND accurate, PLUS has unique features

### The Path

1. **Weeks 1-4**: Build foundation (caching, temporal, hybrid search)
2. **Weeks 5-8**: Achieve speed (<100ms)
3. **Weeks 9-12**: Achieve accuracy (85%+)
4. **Weeks 13-16**: Ship unique features
5. **Weeks 17-20**: Launch to market

---

## References

- [Supermemory Website](https://supermemory.ai/)
- [Supermemory GitHub](https://github.com/supermemoryai/supermemory)
- [Supermemory Research](https://supermemory.ai/research)
- [Supermemory Architecture Blog](https://supermemory.ai/blog/memory-engine/)
- [Zep Website](https://www.getzep.com/)
- [Zep Paper (arXiv)](https://arxiv.org/abs/2501.13956)
- [Zep State of the Art Blog](https://blog.getzep.com/state-of-the-art-agent-memory/)
- [Graphiti (Zep's OSS library)](https://github.com/getzep/graphiti)
- [AI Memory Tools Comparison](https://www.cognee.ai/blog/deep-dives/ai-memory-tools-evaluation)
- [Cloudflare Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare KV Pricing](https://developers.cloudflare.com/kv/platform/pricing/)
