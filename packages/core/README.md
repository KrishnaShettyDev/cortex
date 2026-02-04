# @cortex/memory

Official TypeScript SDK for the Cortex Memory API. Build AI applications with persistent, contextual memory.

## Installation

```bash
npm install @cortex/memory
# or
pnpm add @cortex/memory
# or
yarn add @cortex/memory
```

## Quick Start

```typescript
import { CortexClient } from '@cortex/memory';

// Initialize with API key
const cortex = new CortexClient({
  apiKey: 'ctx_your_api_key',
});

// Add a memory
const memory = await cortex.memories.create({
  content: 'Meeting with John about Q1 goals. He prefers morning meetings.',
  source: 'manual',
});

// Search memories
const results = await cortex.memories.search({
  query: 'Q1 goals',
  limit: 10,
});

// Get contextual recall (for AI assistants)
const context = await cortex.recall({
  query: 'What are my meetings about?',
  include_profile: true,
});

console.log(context.context); // Formatted context for LLM injection
```

## Features

### Memory Management

```typescript
// Create memory
const memory = await cortex.memories.create({
  content: 'Important information...',
  source: 'manual', // 'chat' | 'email' | 'calendar' | 'manual' | 'auto' | 'voice'
  metadata: { custom: 'data' },
});

// List memories
const { memories, total } = await cortex.memories.list({
  limit: 20,
  sort: 'created_at',
  order: 'desc',
});

// Update memory
await cortex.memories.update(memory.id, {
  content: 'Updated content...',
});

// Delete memory
await cortex.memories.delete(memory.id);

// Search with hybrid mode
const results = await cortex.memories.search({
  query: 'find relevant memories',
  mode: 'hybrid', // vector + keyword + reranking
  limit: 10,
});
```

### Entity Graph

```typescript
// List entities (people, places, organizations)
const { entities } = await cortex.entities.list({
  type: 'person',
  min_importance: 0.5,
});

// Get entity relationships
const relationships = await cortex.entities.getRelationships(entityId);

// Get memories mentioning an entity
const memories = await cortex.entities.getMemories(entityId);

// Search entities
const people = await cortex.entities.search('John');

// Get graph statistics
const stats = await cortex.entities.getStats();
```

### Relationship Intelligence

```typescript
// Get relationship health scores
const health = await cortex.relationships.getHealth();

// Get proactive nudges
const nudges = await cortex.relationships.getNudges({
  priority: 'high',
  limit: 5,
});

// Dismiss a nudge
await cortex.relationships.dismissNudge(nudgeId);
```

### Cognitive Layer (Learnings, Beliefs, Commitments)

```typescript
// Get user learnings
const { learnings } = await cortex.learnings.list({
  category: 'preferences',
});

// Get beliefs by domain
const beliefsByDomain = await cortex.beliefs.getByDomain();

// Get belief conflicts
const conflicts = await cortex.beliefs.getConflicts();

// Get commitments
const { commitments } = await cortex.commitments.list({
  status: 'pending',
});

// Get overdue commitments
const overdue = await cortex.commitments.getOverdue();

// Mark commitment complete
await cortex.commitments.markComplete(commitmentId);
```

### Temporal Queries

```typescript
// Time travel - what was true on a specific date
const pastMemories = await cortex.temporal.timeTravel('2024-01-15');

// Get memory version history
const history = await cortex.temporal.getMemoryHistory(memoryId);

// Get timeline of events
const timeline = await cortex.temporal.getTimeline({
  start_date: '2024-01-01',
  end_date: '2024-12-31',
});

// Get currently valid memories (not superseded)
const current = await cortex.temporal.getCurrentMemories();
```

### Daily Briefing

```typescript
// Get personalized daily briefing
const briefing = await cortex.getBriefing({
  location: { lat: 37.7749, lon: -122.4194 },
  timezone: 'America/Los_Angeles',
});

console.log(briefing.summary);
console.log(briefing.priorities);
console.log(briefing.commitments);
console.log(briefing.nudges);
```

### Sync Connections

```typescript
// List sync connections (Gmail, Calendar)
const connections = await cortex.sync.listConnections();

// Get sync status
const status = await cortex.sync.getStatus();

// Trigger manual sync
await cortex.sync.triggerSync(connectionId);
```

## Configuration

```typescript
const cortex = new CortexClient({
  // Required: API key or JWT token
  apiKey: 'ctx_...',
  // OR
  token: 'jwt_token_from_auth',

  // Optional settings
  baseUrl: 'https://askcortex.plutas.in', // Custom API URL
  containerTag: 'default', // Multi-tenancy container
  timeout: 30000, // Request timeout in ms
});
```

## Error Handling

```typescript
import { CortexClient, CortexError } from '@cortex/memory';

try {
  await cortex.memories.get('invalid-id');
} catch (error) {
  if (error instanceof CortexError) {
    console.log(error.message); // Error message
    console.log(error.status);  // HTTP status code
    console.log(error.code);    // Error code (e.g., 'MEMORY_NOT_FOUND')
  }
}
```

## TypeScript Support

Full TypeScript support with comprehensive type definitions:

```typescript
import type {
  Memory,
  Entity,
  Learning,
  Belief,
  Commitment,
  SearchResult,
  RecallResult,
  DailyBriefing,
} from '@cortex/memory';
```

## API Reference

See [docs.askcortex.in](https://docs.askcortex.in) for complete API documentation.

## License

MIT
