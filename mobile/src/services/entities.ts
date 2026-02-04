/**
 * Entities Service
 *
 * Replaces the old people.ts service with the v3 entity graph API.
 * Entities are the core knowledge graph - people, places, organizations, concepts.
 */

import { api } from './api';

// ============== Entity Types ==============

export interface Entity {
  id: string;
  name: string;
  entity_type: string; // person, organization, place, concept, event
  mention_count: number;
  first_seen: string;
  last_seen: string;
  importance_score: number;
  attributes: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface EntityRelationship {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  strength: number;
  confidence: number;
  source_memory_ids: string[];
  valid_from: string;
  valid_to: string | null;
  created_at: string;
}

export interface RelationshipHealth {
  entity_id: string;
  entity_name: string;
  entity_type: string;
  health_score: number;
  health_status: 'healthy' | 'attention_needed' | 'at_risk' | 'dormant';
  last_interaction: string;
  interaction_count: number;
  trend: 'improving' | 'stable' | 'declining';
  factors?: {
    recency: { score: number; days_since: number };
    frequency: { score: number; interaction_count: number };
    sentiment?: { score: number; trend: string };
  };
  recommendations?: string[];
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

export interface GraphStats {
  total_entities: number;
  total_relationships: number;
  entities_by_type: Record<string, number>;
  relationships_by_type: Record<string, number>;
}

// ============== Response Types ==============

export interface EntitiesListResponse {
  entities: Entity[];
  total: number;
}

export interface EntityRelationshipsResponse {
  relationships: EntityRelationship[];
  total: number;
}

export interface EntityMemoriesResponse {
  memories: Array<{
    id: string;
    content: string;
    created_at: string;
    importance_score: number;
  }>;
  total: number;
}

export interface RelationshipHealthResponse {
  health_scores: RelationshipHealth[];
  total: number;
}

export interface NudgesResponse {
  nudges: Nudge[];
  total: number;
}

// ============== Service ==============

class EntitiesService {
  /**
   * List all entities for the current user
   */
  async getEntities(params?: {
    type?: string;
    limit?: number;
    offset?: number;
    search?: string;
  }): Promise<EntitiesListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.type) searchParams.append('type', params.type);
    if (params?.limit) searchParams.append('limit', params.limit.toString());
    if (params?.offset) searchParams.append('offset', params.offset.toString());
    if (params?.search) searchParams.append('search', params.search);

    const query = searchParams.toString();
    return api.request<EntitiesListResponse>(`/v3/entities${query ? `?${query}` : ''}`);
  }

  /**
   * Get a single entity by ID
   */
  async getEntity(id: string): Promise<Entity> {
    return api.request<Entity>(`/v3/entities/${id}`);
  }

  /**
   * Get relationships for an entity
   */
  async getEntityRelationships(id: string): Promise<EntityRelationshipsResponse> {
    return api.request<EntityRelationshipsResponse>(`/v3/entities/${id}/relationships`);
  }

  /**
   * Get memories mentioning an entity
   */
  async getEntityMemories(
    id: string,
    params?: { limit?: number; offset?: number }
  ): Promise<EntityMemoriesResponse> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.append('limit', params.limit.toString());
    if (params?.offset) searchParams.append('offset', params.offset.toString());

    const query = searchParams.toString();
    return api.request<EntityMemoriesResponse>(`/v3/entities/${id}/memories${query ? `?${query}` : ''}`);
  }

  /**
   * Search entities by query
   */
  async searchEntities(query: string): Promise<Entity[]> {
    const response = await api.request<{ entities: Entity[] }>(
      `/v3/graph/search?q=${encodeURIComponent(query)}`
    );
    return response.entities;
  }

  /**
   * Get graph statistics
   */
  async getGraphStats(): Promise<GraphStats> {
    return api.request<GraphStats>('/v3/graph/stats');
  }

  // ============== Relationship Intelligence ==============

  /**
   * Get relationship health scores for all entities
   */
  async getRelationshipHealth(params?: {
    status?: 'healthy' | 'attention_needed' | 'at_risk' | 'dormant';
    limit?: number;
  }): Promise<RelationshipHealthResponse> {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.append('status', params.status);
    if (params?.limit) searchParams.append('limit', params.limit.toString());

    const query = searchParams.toString();
    return api.request<RelationshipHealthResponse>(`/v3/relationships/health${query ? `?${query}` : ''}`);
  }

  /**
   * Get relationship health for a specific entity
   */
  async getEntityHealth(entityId: string): Promise<RelationshipHealth> {
    return api.request<RelationshipHealth>(`/v3/relationships/${entityId}/health`);
  }

  /**
   * Get proactive nudges (relationship suggestions)
   */
  async getNudges(params?: {
    priority?: 'high' | 'medium' | 'low';
    limit?: number;
  }): Promise<NudgesResponse> {
    const searchParams = new URLSearchParams();
    if (params?.priority) searchParams.append('priority', params.priority);
    if (params?.limit) searchParams.append('limit', params.limit.toString());

    const query = searchParams.toString();
    return api.request<NudgesResponse>(`/v3/nudges${query ? `?${query}` : ''}`);
  }

  /**
   * Generate new nudges
   */
  async generateNudges(): Promise<NudgesResponse> {
    return api.request<NudgesResponse>('/v3/nudges/generate', {
      method: 'POST',
    });
  }

  // ============== Legacy Compatibility ==============
  // These methods map the old people.ts interface to the new entities API

  /**
   * @deprecated Use getEntities({ type: 'person' }) instead
   */
  async listPeople(
    sortBy: 'recent' | 'frequent' | 'alphabetical' = 'recent',
    limit: number = 50
  ): Promise<{ people: Entity[]; total: number }> {
    const response = await this.getEntities({
      type: 'person',
      limit,
    });
    return {
      people: response.entities,
      total: response.total,
    };
  }

  /**
   * @deprecated Use getEntity(id) instead
   * Note: Old API used name, new API uses id
   */
  async getPersonByName(name: string): Promise<Entity | null> {
    const results = await this.searchEntities(name);
    const person = results.find(
      e => e.entity_type === 'person' && e.name.toLowerCase() === name.toLowerCase()
    );
    return person || null;
  }

  /**
   * @deprecated Use searchEntities instead
   */
  async searchContacts(
    query: string = '',
    limit: number = 10
  ): Promise<{ contacts: Entity[] }> {
    if (!query) {
      const response = await this.getEntities({ type: 'person', limit });
      return { contacts: response.entities };
    }
    const results = await this.searchEntities(query);
    return {
      contacts: results.filter(e => e.entity_type === 'person').slice(0, limit),
    };
  }
}

export const entitiesService = new EntitiesService();

// Note: For backwards compatibility, use peopleService from './people' instead
