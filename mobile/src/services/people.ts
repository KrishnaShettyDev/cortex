/**
 * People Service
 *
 * @deprecated This service is deprecated. Use entities.ts instead.
 *
 * This file now wraps the entities service for backwards compatibility.
 * The backend has replaced /people endpoints with /v3/entities.
 */

import { entitiesService, Entity, EntityMemoriesResponse } from './entities';
import { logger } from '../utils/logger';

// Legacy types for backwards compatibility
export interface ContactSuggestion {
  id: string;
  name: string;
  email: string | null;
  mention_count: number;
}

export interface ContactSearchResponse {
  contacts: ContactSuggestion[];
}

export interface PersonSummary {
  id: string;
  name: string;
  entity_type: string;
  email: string | null;
  mention_count: number;
  first_seen: string | null;
  last_seen: string | null;
}

export interface PersonProfile {
  id: string;
  name: string;
  entity_type: string;
  email: string | null;
  mention_count: number;
  first_seen: string | null;
  last_seen: string | null;
  summary: string | null;
  relationship_type: string | null;
  topics: string[];
  sentiment_trend: string | null;
  last_interaction_date: string | null;
  next_meeting_date: string | null;
  recent_memories: Array<{
    id: string;
    content: string;
    memory_type: string;
    memory_date: string | null;
  }>;
}

export interface PeopleListResponse {
  people: PersonSummary[];
  total: number;
}

export interface PersonMemoriesResponse {
  memories: Array<{
    id: string;
    content: string;
    created_at: string;
  }>;
  total: number;
}

// Transform Entity to PersonSummary
function entityToPersonSummary(entity: Entity): PersonSummary {
  return {
    id: entity.id,
    name: entity.name,
    entity_type: entity.entity_type,
    email: entity.email || null,
    mention_count: entity.mention_count,
    first_seen: entity.first_seen,
    last_seen: entity.last_seen,
  };
}

// Transform Entity to PersonProfile
function entityToPersonProfile(entity: Entity, memories: Array<{ id: string; content: string; created_at: string }> = []): PersonProfile {
  const attrs = entity.attributes as Record<string, any> || {};
  return {
    id: entity.id,
    name: entity.name,
    entity_type: entity.entity_type,
    email: entity.email || null,
    mention_count: entity.mention_count,
    first_seen: entity.first_seen,
    last_seen: entity.last_seen,
    summary: attrs.summary || `${entity.name} is mentioned in ${entity.mention_count} memories.`,
    relationship_type: attrs.relationship_type || attrs.relationship || null,
    topics: attrs.topics || attrs.recent_topics || [],
    sentiment_trend: attrs.sentiment_trend || null,
    last_interaction_date: entity.last_seen,
    next_meeting_date: attrs.next_meeting_date || null,
    recent_memories: memories.map(m => ({
      id: m.id,
      content: m.content,
      memory_type: 'text',
      memory_date: m.created_at,
    })),
  };
}

class PeopleService {
  /**
   * @deprecated Use entitiesService.getEntities({ type: 'person' }) instead
   */
  async listPeople(
    _sortBy: 'recent' | 'frequent' | 'alphabetical' = 'recent',
    limit: number = 50
  ): Promise<PeopleListResponse> {
    logger.warn('PeopleService: listPeople is deprecated, use entitiesService.getEntities()');

    const response = await entitiesService.getEntities({
      type: 'person',
      limit,
    });

    return {
      people: response.entities.map(entityToPersonSummary),
      total: response.total,
    };
  }

  /**
   * @deprecated Use entitiesService.getEntity() instead
   */
  async getPersonProfile(
    name: string,
    _regenerate: boolean = false
  ): Promise<PersonProfile> {
    logger.warn('PeopleService: getPersonProfile is deprecated, use entitiesService');

    // Search for the person by name
    const entity = await entitiesService.getPersonByName(name);
    if (!entity) {
      throw new Error(`Person "${name}" not found`);
    }

    // Also fetch recent memories for this person
    let memories: Array<{ id: string; content: string; created_at: string }> = [];
    try {
      const memoriesResponse = await entitiesService.getEntityMemories(entity.id, { limit: 5 });
      memories = memoriesResponse.memories.map(m => ({
        id: m.id,
        content: m.content,
        created_at: m.created_at,
      }));
    } catch (err) {
      logger.warn('Failed to fetch memories for person:', err);
    }

    return entityToPersonProfile(entity, memories);
  }

  /**
   * @deprecated Use entitiesService.getEntityMemories() instead
   */
  async getPersonMemories(
    name: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<PersonMemoriesResponse> {
    logger.warn('PeopleService: getPersonMemories is deprecated, use entitiesService');

    // Search for the person by name
    const entity = await entitiesService.getPersonByName(name);
    if (!entity) {
      return { memories: [], total: 0 };
    }

    const response = await entitiesService.getEntityMemories(entity.id, { limit, offset });
    return {
      memories: response.memories.map(m => ({
        id: m.id,
        content: m.content,
        created_at: m.created_at,
      })),
      total: response.total,
    };
  }

  /**
   * @deprecated Meeting context not available in v3 API
   */
  async getMeetingContext(name: string): Promise<{
    context: string | null;
    topics: string[];
    last_meeting: string | null;
  }> {
    logger.warn('PeopleService: getMeetingContext is deprecated');

    // Try to get entity info and recent memories
    const entity = await entitiesService.getPersonByName(name);
    if (!entity) {
      return {
        context: `No context available for ${name}`,
        topics: [],
        last_meeting: null,
      };
    }

    // Fetch recent memories to build context
    let contextParts: string[] = [];
    try {
      const memoriesResponse = await entitiesService.getEntityMemories(entity.id, { limit: 5 });
      contextParts = memoriesResponse.memories.slice(0, 3).map(m => m.content.slice(0, 200));
    } catch (err) {
      logger.warn('Failed to fetch memories for meeting context:', err);
    }

    const attrs = entity.attributes as Record<string, any> || {};
    const topics = attrs.topics || [];

    return {
      context: contextParts.length > 0
        ? `Recent interactions with ${entity.name}:\n${contextParts.join('\n\n')}`
        : `${entity.name} - mentioned ${entity.mention_count} times`,
      topics,
      last_meeting: entity.last_seen,
    };
  }

  /**
   * @deprecated Connections not available in v3 API
   */
  async listConnections(
    _limit: number = 20,
    _unnotifiedOnly: boolean = false
  ): Promise<{ connections: any[]; total: number }> {
    logger.warn('PeopleService: listConnections is deprecated and not available');
    return { connections: [], total: 0 };
  }

  /**
   * @deprecated Connections not available in v3 API
   */
  async getConnection(_connectionId: string): Promise<null> {
    logger.warn('PeopleService: getConnection is deprecated and not available');
    return null;
  }

  /**
   * @deprecated Connections not available in v3 API
   */
  async dismissConnection(_connectionId: string): Promise<{ success: boolean }> {
    logger.warn('PeopleService: dismissConnection is deprecated and not available');
    return { success: false };
  }

  /**
   * @deprecated Use entitiesService.searchEntities() instead
   */
  async searchContacts(
    query: string = '',
    limit: number = 10
  ): Promise<ContactSearchResponse> {
    logger.warn('PeopleService: searchContacts is deprecated, use entitiesService.searchEntities()');

    const response = await entitiesService.searchContacts(query, limit);
    return {
      contacts: response.contacts.map(entity => ({
        id: entity.id,
        name: entity.name,
        email: (entity.attributes as any)?.email || null,
        mention_count: entity.mention_count,
      })),
    };
  }
}

export const peopleService = new PeopleService();
