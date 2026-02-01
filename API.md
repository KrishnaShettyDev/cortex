# Cortex API Documentation

**Base URL**: `https://askcortex.plutas.in`

**Authentication**: Bearer token in `Authorization` header

---

## Quick Start

```bash
# Get your API key
# 1. Visit https://app.askcortex.plutas.in/settings
# 2. Copy your API key

export CORTEX_API_KEY="your-api-key-here"

# Add a memory
curl -X POST https://askcortex.plutas.in/v3/memories \
  -H "Authorization: Bearer $CORTEX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"content": "I prefer TypeScript over JavaScript for all projects"}'

# Search memories
curl -X POST https://askcortex.plutas.in/v3/search \
  -H "Authorization: Bearer $CORTEX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"q": "programming preferences", "limit": 5}'
```

---

## Core Endpoints

### 1. Add Memory

**POST** `/v3/memories`

Add a new memory with smart deduplication (AUDN cycle).

```typescript
interface AddMemoryRequest {
  content: string;           // Required: Memory content
  source?: string;           // Optional: Source (e.g., "api", "chrome_extension")
  containerTag?: string;     // Optional: Project/namespace (default: "default")
  metadata?: {               // Optional: Structured metadata
    tags?: string[];
    entities?: string[];
    people?: string[];
    location?: {
      lat: number;
      lon: number;
      name: string;
    };
    timestamp?: string;
  };
  useAUDN?: boolean;         // Optional: Enable AUDN cycle (default: true)
}

interface AddMemoryResponse {
  id: string;
  content: string;
  processing_status: 'queued' | 'noop' | 'done';
  audn_action?: 'add' | 'update' | 'noop' | 'delete_and_add';
  audn_reason?: string;
  updated_existing?: string;  // ID of updated memory (if UPDATE)
  created_at: string;
}
```

**Example:**

```bash
curl -X POST https://askcortex.plutas.in/v3/memories \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Working on Cortex memory infrastructure",
    "source": "api",
    "metadata": {
      "tags": ["work", "cortex"],
      "people": ["team"]
    }
  }'
```

**Response:**

```json
{
  "id": "mem_abc123",
  "content": "Working on Cortex memory infrastructure",
  "processing_status": "queued",
  "audn_action": "add",
  "created_at": "2026-01-31T14:00:00Z"
}
```

**AUDN Actions:**
- `add`: New memory created (no similar memories found)
- `update`: Enhanced existing memory (created new version)
- `noop`: Duplicate detected, no action taken
- `delete_and_add`: Contradicted old memory, created new

---

### 2. List Memories

**GET** `/v3/memories`

List all memories for the authenticated user.

```typescript
interface ListMemoriesParams {
  limit?: number;        // Max results (default: 50, max: 100)
  offset?: number;       // Pagination offset (default: 0)
  containerTag?: string; // Filter by project/namespace
}

interface ListMemoriesResponse {
  memories: Array<{
    id: string;
    content: string;
    source: string;
    metadata?: {
      tags?: string[];
      entities?: string[];
      people?: string[];
      // ... other metadata
    };
    created_at: string;
    updated_at: string;
  }>;
  total: number;
}
```

**Example:**

```bash
curl -X GET 'https://askcortex.plutas.in/v3/memories?limit=10&offset=0' \
  -H "Authorization: Bearer $TOKEN"
```

---

### 3. Update Memory

**PUT** `/v3/memories/:id`

Update an existing memory (creates new version with relationship).

```typescript
interface UpdateMemoryRequest {
  content: string;
  relationType?: 'updates' | 'extends'; // default: 'updates'
}

interface UpdateMemoryResponse {
  id: string;               // New version ID
  content: string;
  version: number;          // Incremented version
  created_at: string;
}
```

**Example:**

```bash
curl -X PUT https://askcortex.plutas.in/v3/memories/mem_abc123 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "Updated content here"}'
```

---

### 4. Delete Memory

**DELETE** `/v3/memories/:id`

Soft delete (forget) a memory.

```bash
curl -X DELETE https://askcortex.plutas.in/v3/memories/mem_abc123 \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**

```json
{
  "success": true
}
```

---

### 5. Search Memories

**POST** `/v3/search`

Hybrid search with optional reranking.

```typescript
interface SearchRequest {
  q: string;                  // Required: Search query
  limit?: number;             // Max results (default: 10)
  containerTag?: string;      // Filter by project/namespace
  searchMode?: 'hybrid' | 'vector' | 'keyword'; // default: 'hybrid'
  includeProfile?: boolean;   // Include user profile (default: true)
  rerank?: boolean;           // Use LLM reranking (default: false)
}

interface SearchResponse {
  memories: Array<{
    id: string;
    content: string;
    score: number;           // Relevance score 0-1
    source: string;
    created_at: string;
  }>;
  chunks: Array<{            // Document chunks
    id: string;
    content: string;
    score: number;
    document_id: string;
    created_at: string;
  }>;
  profile?: {                // User profile (if includeProfile: true)
    static: string[];
    dynamic: string[];
  };
  timing: number;            // Query time in ms
  total: number;
}
```

**Example (Basic):**

```bash
curl -X POST https://askcortex.plutas.in/v3/search \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "q": "TypeScript projects",
    "limit": 5
  }'
```

**Example (With Reranking):**

```bash
curl -X POST https://askcortex.plutas.in/v3/search \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "q": "TypeScript projects",
    "limit": 10,
    "rerank": true,
    "searchMode": "hybrid"
  }'
```

**Search Modes:**
- `hybrid`: Vector (70%) + Keyword (30%) - **recommended**
- `vector`: Semantic similarity only
- `keyword`: Exact/fuzzy text matching only

**Performance:**
- Hybrid (cached): ~50ms
- Hybrid (uncached): ~250ms
- With reranking: +150ms

---

### 6. Recall (LLM Context)

**POST** `/v3/recall`

Search and format results for LLM injection.

```typescript
interface RecallRequest {
  q: string;
  limit?: number;
  format?: 'json' | 'markdown'; // default: 'json'
}

interface RecallResponse {
  context: string;  // Formatted context for LLM (if format: 'markdown')
  // OR
  memories: [...];  // Structured results (if format: 'json')
  timing: number;
}
```

**Example:**

```bash
curl -X POST https://askcortex.plutas.in/v3/recall \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "q": "work preferences",
    "limit": 5,
    "format": "markdown"
  }'
```

**Response:**

```json
{
  "context": "# User Profile\n\n## Static Facts\n- Prefers TypeScript...\n\n## Relevant Memories\n1. Working on Cortex...",
  "timing": 124
}
```

---

### 7. Get Profile

**GET** `/v3/profile`

Get user profile (static + dynamic facts).

```bash
curl -X GET https://askcortex.plutas.in/v3/profile \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**

```json
{
  "static": [
    "Prefers TypeScript over JavaScript",
    "Lives in San Francisco",
    "Works at Anthropic"
  ],
  "dynamic": [
    "Working on Cortex memory infrastructure (last 7 days)",
    "Interested in AUDN cycles (recent queries)"
  ]
}
```

---

## Rate Limits

- **Free**: 1,000 requests/day, 10 req/sec
- **Pro**: 100,000 requests/day, 50 req/sec
- **Team**: 1M requests/day, 200 req/sec

Rate limit headers:
```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 956
X-RateLimit-Reset: 1706716800
```

---

## Error Responses

All errors follow this format:

```json
{
  "error": "Error message here",
  "code": "ERROR_CODE",
  "details": {} // Optional
}
```

**Common Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 400 | INVALID_REQUEST | Missing required fields |
| 401 | UNAUTHORIZED | Invalid/missing API key |
| 404 | NOT_FOUND | Memory/resource not found |
| 429 | RATE_LIMIT_EXCEEDED | Too many requests |
| 500 | INTERNAL_ERROR | Server error |

---

## SDKs

### JavaScript/TypeScript

```bash
npm install @cortex/sdk
```

```typescript
import { Cortex } from '@cortex/sdk';

const cortex = new Cortex({ apiKey: process.env.CORTEX_API_KEY });

// Add memory
const memory = await cortex.memories.create({
  content: 'I prefer TypeScript',
});

// Search
const results = await cortex.search({
  query: 'programming preferences',
  limit: 5,
  rerank: true,
});
```

### Python

```bash
pip install cortex-sdk
```

```python
from cortex import Cortex

cortex = Cortex(api_key=os.environ['CORTEX_API_KEY'])

# Add memory
memory = cortex.memories.create(
    content='I prefer TypeScript'
)

# Search
results = cortex.search(
    query='programming preferences',
    limit=5,
    rerank=True
)
```

---

## Webhooks (Coming Soon)

Subscribe to events:
- `memory.created`
- `memory.updated`
- `memory.deleted`
- `search.performed`

---

## Best Practices

### 1. Use AUDN Cycle

Always keep `useAUDN: true` (default) to prevent duplicates:

```javascript
// Good
await cortex.memories.create({
  content: 'New info',
  useAUDN: true, // default
});

// Bad
await cortex.memories.create({
  content: 'New info',
  useAUDN: false, // will create duplicates!
});
```

### 2. Enable Reranking for Important Queries

Use `rerank: true` when accuracy matters:

```javascript
// User-facing search
const results = await cortex.search({
  query: userInput,
  rerank: true, // +15% precision
});

// Background/bulk search
const results = await cortex.search({
  query: bulkQuery,
  rerank: false, // faster
});
```

### 3. Use Container Tags for Multi-Tenancy

Isolate memories by project/user:

```javascript
await cortex.memories.create({
  content: 'Project-specific info',
  containerTag: 'project_alpha',
});

// Search within container
const results = await cortex.search({
  query: 'info',
  containerTag: 'project_alpha',
});
```

### 4. Cache Profile Calls

Profiles change rarely, cache for 1 hour:

```javascript
let profileCache = null;
let profileCacheTime = 0;

async function getProfile() {
  if (Date.now() - profileCacheTime > 3600000) {
    profileCache = await cortex.profile.get();
    profileCacheTime = Date.now();
  }
  return profileCache;
}
```

---

## Performance Tips

1. **Use hybrid search** (default) for best accuracy/speed tradeoff
2. **Enable reranking** only when needed (+150ms latency)
3. **Batch operations** when adding multiple memories
4. **Cache search results** client-side for repeated queries
5. **Use container tags** to scope searches (faster)

---

## Support

- **Docs**: https://docs.askcortex.plutas.in
- **Issues**: https://github.com/yourusername/cortex/issues
- **Email**: support@askcortex.plutas.in
- **Discord**: https://discord.gg/cortex

---

*Last updated: January 31, 2026*
*API version: v3*
