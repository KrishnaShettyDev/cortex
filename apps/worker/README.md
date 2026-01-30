# Cortex Edge API - Cloudflare Workers

Fast, global API powered by Cloudflare Workers, D1, and Vectorize.

## Setup

### Prerequisites

```bash
npm install -g wrangler
wrangler login
```

### 1. Install Dependencies

```bash
cd apps/worker
npm install
```

### 2. Create D1 Database

```bash
wrangler d1 create cortex-production
```

Copy the `database_id` from the output and update `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "cortex-production"
database_id = "your-database-id-here"
```

### 3. Initialize Database Schema

```bash
wrangler d1 execute cortex-production --file=schema.sql
```

### 4. Create Vectorize Index

```bash
wrangler vectorize create cortex-embeddings --dimensions=1536 --metric=cosine
```

### 5. Create R2 Bucket

```bash
wrangler r2 bucket create cortex-uploads
```

### 6. Set Secrets

```bash
# JWT secret (use a strong random string)
wrangler secret put JWT_SECRET

# OpenAI API key
wrangler secret put OPENAI_API_KEY

# Composio API key (for integrations)
wrangler secret put COMPOSIO_API_KEY

# Google Client ID (optional, defaults to iOS client ID)
wrangler secret put GOOGLE_CLIENT_ID
```

## Development

### Local Development

```bash
npm run dev
```

This starts the worker locally at `http://localhost:8787`

### Test Auth Endpoints

**Apple Sign In:**
```bash
curl -X POST http://localhost:8787/auth/apple \
  -H "Content-Type: application/json" \
  -d '{
    "identityToken": "your-apple-identity-token",
    "user": {
      "name": {
        "givenName": "John",
        "familyName": "Doe"
      }
    }
  }'
```

**Google Sign In:**
```bash
curl -X POST http://localhost:8787/auth/google \
  -H "Content-Type: application/json" \
  -d '{
    "idToken": "your-google-id-token"
  }'
```

**Refresh Token:**
```bash
curl -X POST http://localhost:8787/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refresh_token": "your-refresh-token"
  }'
```

### Test Protected Endpoints

**List Memories:**
```bash
curl http://localhost:8787/api/memories?limit=10&offset=0&source=chat \
  -H "Authorization: Bearer your-access-token"
```

**Get Single Memory:**
```bash
curl http://localhost:8787/api/memories/memory-id \
  -H "Authorization: Bearer your-access-token"
```

**Create Memory:**
```bash
curl -X POST http://localhost:8787/api/memories \
  -H "Authorization: Bearer your-access-token" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Met with John about Q4 planning",
    "source": "manual",
    "metadata": {
      "people": ["John"],
      "tags": ["meeting", "planning"],
      "timestamp": "2026-01-30T10:00:00Z"
    }
  }'
```

**Update Memory:**
```bash
curl -X PATCH http://localhost:8787/api/memories/memory-id \
  -H "Authorization: Bearer your-access-token" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Updated content",
    "metadata": {
      "tags": ["important", "follow-up"]
    }
  }'
```

**Delete Memory:**
```bash
curl -X DELETE http://localhost:8787/api/memories/memory-id \
  -H "Authorization: Bearer your-access-token"
```

**Search Memories:**
```bash
curl -X POST http://localhost:8787/api/search \
  -H "Authorization: Bearer your-access-token" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "meetings with John",
    "limit": 5,
    "source": "manual"
  }'
```

**Chat (Simple):**
```bash
curl -X POST http://localhost:8787/api/chat \
  -H "Authorization: Bearer your-access-token" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "What did I discuss with John?",
    "model": "gpt-4o-mini",
    "contextLimit": 5
  }'
```

**Chat (With History):**
```bash
curl -X POST http://localhost:8787/api/chat \
  -H "Authorization: Bearer your-access-token" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Tell me more about that",
    "history": [
      {"role": "user", "content": "What did I discuss with John?"},
      {"role": "assistant", "content": "You discussed Q4 planning..."}
    ],
    "model": "gpt-4o-mini",
    "contextLimit": 5
  }'
```

## Deployment

### Deploy to Production

```bash
npm run deploy
```

Your API will be deployed to: `https://cortex-api.your-subdomain.workers.dev`

### Custom Domain (Optional)

1. Add a route in `wrangler.toml`:

```toml
routes = [
  { pattern = "api.askcortex.plutas.in/*", zone_name = "plutas.in" }
]
```

2. Deploy:

```bash
wrangler deploy
```

## API Endpoints

### Public Endpoints

- `GET /health` - Health check
- `POST /auth/apple` - Apple Sign In
- `POST /auth/google` - Google Sign In
- `POST /auth/refresh` - Refresh access token

### Protected Endpoints (require JWT)

**Memories:**
- `GET /api/memories` - List memories with pagination
  - Query params: `limit`, `offset`, `source`
- `GET /api/memories/:id` - Get single memory
- `POST /api/memories` - Create memory with embeddings
  - Body: `{ content, source?, metadata? }`
- `PATCH /api/memories/:id` - Update memory
  - Body: `{ content?, source?, metadata? }`
- `DELETE /api/memories/:id` - Delete memory

**Search & Chat:**
- `POST /api/search` - Search memories using vector similarity
  - Body: `{ query, limit?, source? }`
- `POST /api/chat` - Chat with AI using memory context
  - Body: `{ message, history?, model?, contextLimit? }`
  - Retrieves relevant memories and generates personalized responses
  - Supports conversation history for multi-turn chats

## Architecture

```
Hono (Fast routing)
  ↓
D1 (SQLite at edge - user data, memories, sessions)
  ↓
Vectorize (Vector embeddings for semantic search)
  ↓
R2 (Media storage)
```

## Environment Variables

Set these using `wrangler secret put SECRET_NAME`:

- `JWT_SECRET` - Secret key for signing JWT tokens (required)
- `OPENAI_API_KEY` - OpenAI API key for embeddings and chat (required)
- `COMPOSIO_API_KEY` - Composio API key for integrations (required)
- `GOOGLE_CLIENT_ID` - Google OAuth client ID (optional, defaults to iOS client)

## Database Schema

See `schema.sql` for the complete schema:

- **users** - User accounts
- **memories** - User memories and thoughts
- **memory_metadata** - Memory metadata (entities, location, people, tags)
- **integrations** - OAuth integrations (Google, Apple)
- **sessions** - JWT refresh tokens

## Performance

Target metrics:
- Response time: <200ms (vs 1.5s old backend)
- Global deployment: 330+ edge locations
- Cold start: <10ms
- Database queries: <5ms (D1 at edge)

## Migration from Old Backend

See `/MIGRATION.md` for details on the migration from Python backend.

Key improvements:
- 98% code reduction (30,000 → 500 lines)
- 87% faster response time
- 93% fewer dependencies
- Global edge deployment (was single region)
