# Cortex - Clean Architecture

**Rewritten from scratch with Supermemory-inspired stack.**

## Architecture

```
Cloudflare Workers (Edge API - Global, <50ms)
  ↓
Hono (Fast, type-safe routing)
  ↓
D1 (SQLite at the edge - structured data)
+ Vectorize (Vector embeddings - semantic search)
+ R2 (Media storage - images, audio)
```

## Structure

```
cortex/
├── packages/
│   ├── core/          # Memory engine (TypeScript)
│   ├── integrations/  # Gmail, Calendar (TODO)
│   └── api/           # Shared API types (TODO)
│
├── apps/
│   ├── worker/        # Cloudflare Worker (Edge API)
│   └── mobile/        # React Native app
│
└── backend-legacy/    # Old Python backend (archived)
```

## Key Differences from Old Stack

| Old (backend-legacy) | New (current) |
|---------------------|---------------|
| 47 services | 1 clean memory engine |
| Python + FastAPI | TypeScript + Hono |
| PostgreSQL (single region) | D1 (global edge) |
| pgvector | Vectorize (optimized) |
| No caching | Cloudflare KV (TODO) |
| ~1.5s response | <200ms target |

## Setup

### Prerequisites
```bash
npm install -g wrangler
wrangler login
```

### Install & Deploy
```bash
npm install
cd apps/worker
wrangler d1 create cortex-production
# Copy database_id to wrangler.toml
wrangler d1 execute cortex-production --file=schema.sql
wrangler deploy
```

No more service spaghetti. Clean, fast, scalable.
