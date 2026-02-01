export interface Memory {
  id: string;
  content: string;
  source_type: string;
  created_at: string;
  version: number;
}

export interface SearchResult extends Memory {
  score: number;
}

export interface MemoriesResponse {
  memories: Memory[];
  total: number;
}

export interface SearchResponse {
  results: SearchResult[];
  query: string;
}
