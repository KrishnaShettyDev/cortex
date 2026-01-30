import { api } from './api';
import { Memory, MemoryCreateResponse, MemoryListResponse, MemorySearchResponse } from '../types';

interface CreateMemoryRequest {
  content: string;
  source?: string;
  metadata?: {
    entities?: string[];
    location_lat?: number;
    location_lon?: number;
    location_name?: string;
    people?: string[];
    tags?: string[];
    timestamp?: string;
  };
}

class MemoryService {
  async createMemory(data: CreateMemoryRequest): Promise<Memory> {
    return api.request<Memory>('/api/memories', {
      method: 'POST',
      body: data,
    });
  }

  async getMemories(
    limit: number = 20,
    offset: number = 0,
    source?: string
  ): Promise<MemoryListResponse> {
    let endpoint = `/api/memories?limit=${limit}&offset=${offset}`;
    if (source) {
      endpoint += `&source=${source}`;
    }
    return api.request<MemoryListResponse>(endpoint);
  }

  async getMemory(id: string): Promise<Memory> {
    return api.request<Memory>(`/api/memories/${id}`);
  }

  async updateMemory(id: string, data: Partial<CreateMemoryRequest>): Promise<Memory> {
    return api.request<Memory>(`/api/memories/${id}`, {
      method: 'PATCH',
      body: data,
    });
  }

  async deleteMemory(id: string): Promise<void> {
    await api.request(`/api/memories/${id}`, { method: 'DELETE' });
  }

  async searchMemories(query: string, limit: number = 10, source?: string): Promise<MemorySearchResponse> {
    return api.request<MemorySearchResponse>('/api/search', {
      method: 'POST',
      body: {
        query,
        limit,
        source,
      },
    });
  }
}

export const memoryService = new MemoryService();
