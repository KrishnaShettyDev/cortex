/**
 * Cortex Memory SDK - Type Definitions
 * Complete TypeScript types for the Cortex API
 */

// ============================================================================
// Client Configuration
// ============================================================================

export interface CortexConfig {
  /** API base URL (default: https://askcortex.plutas.in) */
  baseUrl?: string;
  /** API key for authentication (starts with ctx_) */
  apiKey?: string;
  /** JWT token for authentication (from mobile/web app) */
  token?: string;
  /** Container tag for multi-tenancy (default: 'default') */
  containerTag?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Custom fetch implementation (for testing) */
  fetch?: typeof fetch;
}

// ============================================================================
// Memory Types
// ============================================================================

export interface Memory {
  id: string;
  user_id: string;
  content: string;
  source?: 'chat' | 'email' | 'calendar' | 'manual' | 'auto' | 'voice';
  container_tag: string;

  // Versioning
  version: number;
  is_latest: boolean;
  parent_memory_id?: string;
  root_memory_id?: string;

  // Temporal
  event_date?: string;
  valid_from?: string;
  valid_to?: string;
  supersedes?: string;
  superseded_by?: string;

  // Processing
  processing_status: 'queued' | 'extracting' | 'embedding' | 'indexing' | 'done' | 'failed';
  importance_score?: number;
  memory_type?: 'episodic' | 'semantic' | 'procedural';

  // Metadata
  metadata?: Record<string, unknown>;

  // Timestamps
  created_at: string;
  updated_at: string;
}

export interface CreateMemoryParams {
  content: string;
  source?: Memory['source'];
  metadata?: Record<string, unknown>;
  event_date?: string;
}

export interface UpdateMemoryParams {
  content?: string;
  metadata?: Record<string, unknown>;
  importance_score?: number;
}

export interface SearchParams {
  query: string;
  limit?: number;
  mode?: 'hybrid' | 'vector' | 'keyword';
  include_superseded?: boolean;
  as_of_date?: string;
  min_importance?: number;
  entity_filter?: string[];
}

export interface RecallParams {
  query: string;
  context?: string;
  k?: number;
  include_profile?: boolean;
  include_entities?: boolean;
}

export interface SearchResult {
  memories: Array<Memory & { score: number; relevance: string }>;
  total: number;
  query_embedding_time?: number;
  search_time?: number;
}

export interface RecallResult {
  context: string;
  memories: Memory[];
  profile?: ProfileData;
  entities?: Entity[];
  timing?: Record<string, number>;
}

// ============================================================================
// Entity Types
// ============================================================================

export interface Entity {
  id: string;
  user_id: string;
  name: string;
  entity_type: 'person' | 'organization' | 'place' | 'concept' | 'event' | 'thing';
  canonical_name?: string;
  aliases?: string[];
  attributes?: Record<string, unknown>;
  importance_score: number;
  mention_count: number;
  first_mentioned_at: string;
  last_mentioned_at: string;
  container_tag: string;
  created_at: string;
  updated_at: string;
}

export interface EntityRelationship {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  confidence: number;
  source_memory_ids: string[];
  valid_from?: string;
  valid_to?: string;
  created_at: string;
}

export interface GraphStats {
  total_entities: number;
  total_relationships: number;
  entities_by_type: Record<string, number>;
  relationships_by_type: Record<string, number>;
  average_connections: number;
}

// ============================================================================
// Relationship Intelligence
// ============================================================================

export interface RelationshipHealth {
  entity_id: string;
  entity_name: string;
  entity_type: string;
  health_score: number;
  health_status: 'healthy' | 'attention_needed' | 'at_risk' | 'dormant';
  factors: {
    recency: { score: number; last_interaction_date: string; days_since: number };
    frequency: { score: number; interaction_count: number; avg_days_between: number };
    sentiment: { score: number; avg_sentiment: number; trend: 'improving' | 'stable' | 'declining' };
  };
  recommendations: string[];
  calculated_at: string;
}

export interface Nudge {
  id: string;
  entity_id: string;
  entity_name: string;
  nudge_type: 'follow_up' | 'maintenance' | 'commitment_due' | 'at_risk' | 'milestone';
  priority: 'high' | 'medium' | 'low';
  title: string;
  message: string;
  suggested_action: string;
  due_date?: string;
  created_at: string;
}

// ============================================================================
// Cognitive Types (Learnings, Beliefs, Commitments)
// ============================================================================

export interface Learning {
  id: string;
  user_id: string;
  statement: string;
  category: string;
  confidence: number;
  evidence_count: number;
  status: 'active' | 'superseded' | 'invalidated';
  container_tag: string;
  created_at: string;
  updated_at: string;
}

export interface Belief {
  id: string;
  user_id: string;
  content: string;
  domain: string;
  belief_type: 'preference' | 'value' | 'habit' | 'goal' | 'identity';
  confidence: number;
  evidence_count: number;
  status: 'active' | 'uncertain' | 'superseded' | 'invalidated';
  valid_from?: string;
  valid_to?: string;
  container_tag: string;
  created_at: string;
  updated_at: string;
}

export interface Commitment {
  id: string;
  user_id: string;
  title: string;
  description?: string;
  commitment_type: 'promise' | 'deadline' | 'meeting' | 'follow_up' | 'task';
  status: 'pending' | 'completed' | 'overdue' | 'cancelled';
  due_date?: string;
  related_entity_id?: string;
  source_memory_id: string;
  container_tag: string;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Profile Types
// ============================================================================

export interface ProfileData {
  static_facts: ProfileFact[];
  dynamic_facts: ProfileFact[];
  summary: string;
}

export interface ProfileFact {
  id: string;
  fact: string;
  profile_type: 'static' | 'dynamic';
  confidence: number;
  source_memory_ids: string[];
  created_at: string;
}

// ============================================================================
// Temporal Types
// ============================================================================

export interface TimelineEvent {
  date: string;
  type: 'memory_created' | 'memory_updated' | 'memory_superseded' | 'entity_extracted';
  title: string;
  description: string;
  memory_id?: string;
  entity_id?: string;
}

export interface MemoryHistory {
  memory_id: string;
  versions: Array<Memory & { version_note?: string }>;
}

// ============================================================================
// Briefing Types
// ============================================================================

export interface DailyBriefing {
  date: string;
  summary: string;
  priorities: BriefingItem[];
  calendar: BriefingItem[];
  commitments: BriefingItem[];
  nudges: Nudge[];
  weather?: WeatherInfo;
  generated_at: string;
}

export interface BriefingItem {
  type: string;
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  time?: string;
  action?: string;
}

export interface WeatherInfo {
  temperature: number;
  condition: string;
  icon: string;
  location: string;
}

// ============================================================================
// Sync Types
// ============================================================================

export interface SyncConnection {
  id: string;
  provider: 'gmail' | 'google_calendar' | 'slack' | 'notion';
  account_id: string;
  is_active: boolean;
  sync_enabled: boolean;
  sync_frequency: 'realtime' | 'hourly' | 'daily' | 'manual';
  last_sync_at?: string;
  next_sync_at?: string;
  created_at: string;
}

export interface SyncStatus {
  active_connections: number;
  last_sync_times: Record<string, string>;
  next_sync_times: Record<string, string>;
  total_items_synced: number;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface APIResponse<T> {
  data: T;
  success: boolean;
}

export interface APIError {
  error: string;
  message?: string;
  code?: string;
  details?: unknown;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

// ============================================================================
// List/Query Parameters
// ============================================================================

export interface ListParams {
  limit?: number;
  offset?: number;
  sort?: 'created_at' | 'updated_at' | 'importance_score';
  order?: 'asc' | 'desc';
}

export interface EntityListParams extends ListParams {
  type?: Entity['entity_type'];
  min_importance?: number;
  search?: string;
}

export interface MemoryListParams extends ListParams {
  source?: Memory['source'];
  status?: Memory['processing_status'];
  include_forgotten?: boolean;
}
