/**
 * @cortex/memory - Official TypeScript SDK for Cortex Memory API
 *
 * @example
 * ```typescript
 * import { CortexClient } from '@cortex/memory';
 *
 * const cortex = new CortexClient({ apiKey: 'ctx_...' });
 *
 * // Add memories
 * await cortex.memories.create({
 *   content: 'Meeting with John about Q1 goals',
 *   source: 'manual',
 * });
 *
 * // Search memories
 * const results = await cortex.memories.search({ query: 'Q1 goals' });
 *
 * // Get contextual recall
 * const context = await cortex.recall({
 *   query: 'What are my goals?',
 *   include_profile: true,
 * });
 *
 * // Get daily briefing
 * const briefing = await cortex.getBriefing();
 * ```
 */

// Main client
export { CortexClient, CortexError } from './client';

// All types
export type {
  // Configuration
  CortexConfig,

  // Memory types
  Memory,
  CreateMemoryParams,
  UpdateMemoryParams,
  SearchParams,
  RecallParams,
  SearchResult,
  RecallResult,
  MemoryListParams,

  // Entity types
  Entity,
  EntityRelationship,
  EntityListParams,
  GraphStats,

  // Relationship intelligence
  RelationshipHealth,
  Nudge,

  // Cognitive types
  Learning,
  Belief,
  Commitment,

  // Profile types
  ProfileData,
  ProfileFact,

  // Temporal types
  TimelineEvent,
  MemoryHistory,

  // Briefing types
  DailyBriefing,
  BriefingItem,
  WeatherInfo,

  // Sync types
  SyncConnection,
  SyncStatus,

  // API types
  APIResponse,
  APIError,
  PaginatedResponse,
  ListParams,
} from './types';
