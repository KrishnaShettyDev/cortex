import { api } from './api';
import { Memory, MemoryCreateResponse, MemoryListResponse, MemorySearchResponse } from '../types';

interface CreateMemoryRequest {
  content: string;
  memory_type?: 'voice' | 'text' | 'photo';
  memory_date?: string;
  audio_url?: string;
  photo_url?: string;
}

class MemoryService {
  async createMemory(data: CreateMemoryRequest): Promise<MemoryCreateResponse> {
    return api.request<MemoryCreateResponse>('/memories', {
      method: 'POST',
      body: data,
    });
  }

  async getMemories(
    limit: number = 20,
    offset: number = 0,
    memoryType?: string
  ): Promise<MemoryListResponse> {
    let endpoint = `/memories?limit=${limit}&offset=${offset}`;
    if (memoryType) {
      endpoint += `&type=${memoryType}`;
    }
    return api.request<MemoryListResponse>(endpoint);
  }

  async getMemory(id: string): Promise<Memory> {
    return api.request<Memory>(`/memories/${id}`);
  }

  async deleteMemory(id: string): Promise<void> {
    await api.request(`/memories/${id}`, { method: 'DELETE' });
  }

  async searchMemories(query: string, limit: number = 10): Promise<MemorySearchResponse> {
    return api.request<MemorySearchResponse>(
      `/memories/search?q=${encodeURIComponent(query)}&limit=${limit}`
    );
  }
}

export const memoryService = new MemoryService();
