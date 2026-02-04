# Cortex API Documentation

**Base URL**: `https://askcortex.plutas.in`

**Version**: v3

## Authentication

All API requests require authentication via one of:

### API Key (Recommended for integrations)
```
X-API-Key: ctx_your_api_key_here
```

### JWT Token (Mobile/Web apps)
```
Authorization: Bearer <jwt_token>
```

## Multi-Tenancy

All endpoints support `container_tag` for multi-tenant isolation:
```
?container_tag=work
```

Default: `default`

---

## Memory Endpoints

### Create Memory
```http
POST /v3/memories
Content-Type: application/json

{
  "content": "Meeting with John about Q1 goals. He prefers morning meetings.",
  "source": "manual",
  "metadata": {
    "custom_field": "value"
  },
  "event_date": "2024-01-15T10:00:00Z"
}
```

**Response:**
```json
{
  "memory": {
    "id": "mem_abc123",
    "user_id": "user_123",
    "content": "Meeting with John about Q1 goals...",
    "source": "manual",
    "container_tag": "default",
    "processing_status": "queued",
    "created_at": "2024-01-15T10:00:00Z"
  },
  "job": {
    "id": "job_xyz789",
    "status": "queued"
  }
}
```

### List Memories
```http
GET /v3/memories?limit=20&offset=0&sort=created_at&order=desc
```

### Get Memory
```http
GET /v3/memories/:id
```

### Update Memory
```http
PUT /v3/memories/:id
Content-Type: application/json

{
  "content": "Updated content...",
  "importance_score": 0.8
}
```

### Delete Memory
```http
DELETE /v3/memories/:id
```

### Search Memories
```http
POST /v3/search
Content-Type: application/json

{
  "query": "Q1 goals",
  "limit": 10,
  "mode": "hybrid",
  "min_importance": 0.3
}
```

**Response:**
```json
{
  "memories": [
    {
      "id": "mem_abc123",
      "content": "Meeting with John about Q1 goals...",
      "score": 0.92,
      "relevance": "high"
    }
  ],
  "total": 15,
  "search_time": 45
}
```

### Recall Context
```http
POST /v3/recall
Content-Type: application/json

{
  "query": "What are my goals?",
  "k": 10,
  "include_profile": true,
  "include_entities": true
}
```

**Response:**
```json
{
  "context": "## User Context\n\nBased on your memories...",
  "memories": [...],
  "profile": {
    "static_facts": [...],
    "dynamic_facts": [...]
  },
  "entities": [...]
}
```

---

## Entity Endpoints

### List Entities
```http
GET /v3/entities?type=person&min_importance=0.5&limit=20
```

### Get Entity
```http
GET /v3/entities/:id
```

### Get Entity Relationships
```http
GET /v3/entities/:id/relationships
```

### Get Entity Memories
```http
GET /v3/entities/:id/memories?limit=10
```

### Search Entities
```http
GET /v3/graph/search?q=John&limit=10
```

### Graph Statistics
```http
GET /v3/graph/stats
```

**Response:**
```json
{
  "total_entities": 156,
  "total_relationships": 423,
  "entities_by_type": {
    "person": 89,
    "organization": 34,
    "place": 22,
    "concept": 11
  },
  "average_connections": 2.7
}
```

---

## Cognitive Layer

### Learnings

```http
GET /v3/learnings?category=preferences&status=active&limit=20
```

```http
GET /v3/learnings/:id
```

```http
GET /v3/learnings/by-category
```

### Beliefs

```http
GET /v3/beliefs?domain=work&type=preference&limit=20
```

```http
GET /v3/beliefs/:id
```

```http
GET /v3/beliefs/by-domain
```

```http
GET /v3/beliefs/conflicts
```

### Commitments

```http
GET /v3/commitments?status=pending&type=deadline&limit=20
```

```http
GET /v3/commitments/:id
```

```http
GET /v3/commitments/overdue
```

```http
POST /v3/commitments/:id/complete
```

```http
POST /v3/commitments/:id/cancel
Content-Type: application/json

{
  "reason": "No longer needed"
}
```

---

## Relationship Intelligence

### Health Scores
```http
GET /v3/relationships/health
GET /v3/relationships/health/:entityId
```

**Response:**
```json
{
  "health_scores": [
    {
      "entity_id": "ent_123",
      "entity_name": "John Smith",
      "health_score": 0.72,
      "health_status": "attention_needed",
      "factors": {
        "recency": { "score": 0.6, "days_since": 15 },
        "frequency": { "score": 0.8, "interaction_count": 12 },
        "sentiment": { "score": 0.7, "trend": "stable" }
      },
      "recommendations": [
        "Schedule a catch-up call with John"
      ]
    }
  ]
}
```

### Nudges
```http
GET /v3/relationships/nudges?priority=high&limit=10
```

```http
POST /v3/relationships/nudges/:id/dismiss
```

---

## Temporal API

### Time Travel Query
```http
POST /v3/time-travel
Content-Type: application/json

{
  "as_of_date": "2024-01-15T00:00:00Z",
  "query": "goals"
}
```

### Memory History
```http
GET /v3/memories/:id/history
```

### Currently Valid Memories
```http
GET /v3/memories/current?type=episodic&min_importance=0.5
```

### Superseded Memories
```http
GET /v3/memories/superseded?start_date=2024-01-01&end_date=2024-06-01
```

### Timeline
```http
GET /v3/temporal/timeline?start_date=2024-01-01&end_date=2024-12-31
```

### Entity Timeline
```http
GET /v3/temporal/entity/:entityId/timeline
```

---

## Profile

### Get Profile
```http
GET /v3/profile
```

**Response:**
```json
{
  "static_facts": [
    {
      "id": "fact_123",
      "fact": "User is a software engineer",
      "confidence": 0.95
    }
  ],
  "dynamic_facts": [
    {
      "id": "fact_456",
      "fact": "Currently working on project X",
      "confidence": 0.8
    }
  ],
  "summary": "Software engineer working on project X..."
}
```

---

## Briefing

### Generate Briefing
```http
POST /v3/briefing/generate
Content-Type: application/json

{
  "location": {
    "lat": 37.7749,
    "lon": -122.4194
  },
  "timezone": "America/Los_Angeles"
}
```

**Response:**
```json
{
  "date": "2024-01-15",
  "summary": "Good morning! You have 3 meetings today...",
  "priorities": [...],
  "calendar": [...],
  "commitments": [...],
  "nudges": [...],
  "weather": {
    "temperature": 65,
    "condition": "Partly Cloudy"
  }
}
```

---

## Sync Connections

### List Connections
```http
GET /v3/sync/connections
```

### Create Connection
```http
POST /v3/sync/connections
Content-Type: application/json

{
  "provider": "gmail",
  "account_id": "...",
  "sync_frequency": "hourly"
}
```

### Update Connection
```http
PATCH /v3/sync/connections/:id
Content-Type: application/json

{
  "sync_enabled": true,
  "sync_frequency": "daily"
}
```

### Delete Connection
```http
DELETE /v3/sync/connections/:id
```

### Trigger Sync
```http
POST /v3/sync/connections/:id/sync
```

### Sync Status
```http
GET /v3/sync/status
```

---

## Notifications

### Register Push Token
```http
POST /notifications/register
Content-Type: application/json

{
  "push_token": "ExponentPushToken[...]",
  "platform": "ios",
  "token_type": "expo"
}
```

### Unregister Token
```http
POST /notifications/unregister
Content-Type: application/json

{
  "push_token": "ExponentPushToken[...]"
}
```

### Get Preferences
```http
GET /notifications/preferences
```

### Update Preferences
```http
PUT /notifications/preferences
Content-Type: application/json

{
  "timezone": "America/New_York",
  "enable_morning_briefing": true,
  "morning_briefing_time": "08:00",
  "quiet_hours_enabled": true,
  "quiet_hours_start": "22:00",
  "quiet_hours_end": "07:00"
}
```

### Test Notification
```http
POST /notifications/test
```

### Notification Status
```http
GET /notifications/status
```

---

## Error Responses

All errors follow this format:

```json
{
  "error": "Not found",
  "message": "Memory not found",
  "code": "MEMORY_NOT_FOUND"
}
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request - Invalid input |
| 401 | Unauthorized - Invalid/missing auth |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found |
| 429 | Too Many Requests - Rate limited |
| 500 | Internal Server Error |

### Error Codes

| Code | Description |
|------|-------------|
| `UNAUTHORIZED` | Missing or invalid authentication |
| `TOKEN_EXPIRED` | JWT token has expired |
| `MEMORY_NOT_FOUND` | Memory ID doesn't exist |
| `ENTITY_NOT_FOUND` | Entity ID doesn't exist |
| `VALIDATION_ERROR` | Request body validation failed |
| `RATE_LIMITED` | Too many requests |

---

## Rate Limits

| Endpoint Type | Limit |
|---------------|-------|
| Search/Recall | 30 req/min |
| Write operations | 60 req/min |
| Read operations | 120 req/min |

Rate limit headers:
```
X-RateLimit-Limit: 30
X-RateLimit-Remaining: 25
X-RateLimit-Reset: 1704067200
```

---

## SDKs

### TypeScript/JavaScript
```bash
npm install @cortex/memory
```

```typescript
import { CortexClient } from '@cortex/memory';

const cortex = new CortexClient({ apiKey: 'ctx_...' });
const results = await cortex.memories.search({ query: 'goals' });
```

### MCP Server (Claude Desktop)
See `/packages/mcp-server` for Claude Desktop integration.

---

## Webhooks

### Composio Webhook
```http
POST /webhooks/composio
Headers:
  webhook-signature: v1,<base64_signature>
  webhook-id: <message_id>
  webhook-timestamp: <unix_timestamp>
```

Supported triggers:
- `GMAIL_NEW_GMAIL_MESSAGE`
- `GOOGLECALENDAR_EVENT_CREATED`
- `GOOGLECALENDAR_EVENT_UPDATED`
- `GOOGLECALENDAR_EVENT_DELETED`

### Webhook Health
```http
GET /webhooks/health
```
