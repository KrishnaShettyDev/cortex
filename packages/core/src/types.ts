/**
 * Core types for Cortex memory engine
 */

export interface Memory {
  id: string;
  userId: string;
  content: string;
  embedding?: number[];
  metadata: MemoryMetadata;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryMetadata {
  source?: 'chat' | 'email' | 'calendar' | 'manual';
  entities?: string[];
  timestamp?: Date;
  location?: {
    lat: number;
    lon: number;
    name?: string;
  };
  people?: string[];
  tags?: string[];
}

export interface SearchQuery {
  query: string;
  userId: string;
  limit?: number;
  filters?: {
    source?: string[];
    dateRange?: {
      start: Date;
      end: Date;
    };
    entities?: string[];
  };
}

export interface SearchResult {
  memory: Memory;
  score: number;
  relevance: 'high' | 'medium' | 'low';
}

export interface User {
  id: string;
  email: string;
  name?: string;
  createdAt: Date;
}

export interface Integration {
  userId: string;
  provider: 'google' | 'apple';
  connected: boolean;
  email?: string;
  lastSync?: Date;
}
