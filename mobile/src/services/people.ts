import { api } from './api';
import {
  PersonSummary,
  PersonProfile,
  PeopleListResponse,
  PersonMemoriesResponse,
  MeetingContextResponse,
  MemoryConnection,
  ConnectionListResponse,
  DismissResponse,
} from '../types';

type SortOption = 'recent' | 'frequent' | 'alphabetical';

// Contact autocomplete types
export interface ContactSuggestion {
  id: string;
  name: string;
  email: string | null;
  mention_count: number;
}

export interface ContactSearchResponse {
  contacts: ContactSuggestion[];
}

class PeopleService {
  /**
   * List all people the user knows about
   */
  async listPeople(
    sortBy: SortOption = 'recent',
    limit: number = 50
  ): Promise<PeopleListResponse> {
    return api.request<PeopleListResponse>(
      `/people?sort_by=${sortBy}&limit=${limit}`
    );
  }

  /**
   * Get comprehensive profile for a person
   */
  async getPersonProfile(
    name: string,
    regenerate: boolean = false
  ): Promise<PersonProfile> {
    const encodedName = encodeURIComponent(name);
    const queryParam = regenerate ? '?regenerate=true' : '';
    return api.request<PersonProfile>(`/people/${encodedName}${queryParam}`);
  }

  /**
   * Get all memories mentioning a person
   */
  async getPersonMemories(
    name: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<PersonMemoriesResponse> {
    const encodedName = encodeURIComponent(name);
    return api.request<PersonMemoriesResponse>(
      `/people/${encodedName}/memories?limit=${limit}&offset=${offset}`
    );
  }

  /**
   * Get meeting preparation context for a person
   */
  async getMeetingContext(name: string): Promise<MeetingContextResponse> {
    const encodedName = encodeURIComponent(name);
    return api.request<MeetingContextResponse>(`/people/${encodedName}/context`);
  }

  /**
   * List discovered memory connections
   */
  async listConnections(
    limit: number = 20,
    unnotifiedOnly: boolean = false
  ): Promise<ConnectionListResponse> {
    return api.request<ConnectionListResponse>(
      `/connections?limit=${limit}&unnotified_only=${unnotifiedOnly}`
    );
  }

  /**
   * Get details of a specific connection
   */
  async getConnection(connectionId: string): Promise<MemoryConnection> {
    return api.request<MemoryConnection>(`/connections/${connectionId}`);
  }

  /**
   * Dismiss/acknowledge a connection
   */
  async dismissConnection(connectionId: string): Promise<DismissResponse> {
    return api.request<DismissResponse>(`/connections/${connectionId}/dismiss`, {
      method: 'POST',
    });
  }

  /**
   * Search contacts by name or email for autocomplete
   * Returns contacts with email addresses sorted by relevance
   */
  async searchContacts(
    query: string = '',
    limit: number = 10
  ): Promise<ContactSearchResponse> {
    const params = new URLSearchParams();
    if (query) params.append('q', query);
    params.append('limit', limit.toString());
    return api.request<ContactSearchResponse>(`/people/search?${params.toString()}`);
  }
}

export const peopleService = new PeopleService();
