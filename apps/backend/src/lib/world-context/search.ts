/**
 * Web Search Service
 *
 * Provides web search and news using Serper.dev API.
 * Falls back to simple fetch if no API key configured.
 */

import type { SearchResult, WebSearchResponse, NewsArticle, NewsResponse } from './types';

const SERPER_BASE = 'https://google.serper.dev';

export interface SearchServiceConfig {
  serperApiKey?: string;
  cacheTtlSeconds?: number;
}

export class SearchService {
  private serperApiKey?: string;
  private cache: Map<string, { data: any; expires: number }> = new Map();
  private cacheTtl: number;

  constructor(config: SearchServiceConfig) {
    this.serperApiKey = config.serperApiKey;
    this.cacheTtl = (config.cacheTtlSeconds || 3600) * 1000; // Default 1 hour
  }

  /**
   * Web search
   */
  async search(params: {
    query: string;
    numResults?: number;
    location?: string;
  }): Promise<WebSearchResponse> {
    const { query, numResults = 5, location } = params;
    const cacheKey = `search:${query}:${numResults}:${location || ''}`;

    const cached = this.cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return cached.data;
    }

    if (!this.serperApiKey) {
      // Return empty results if no API key
      return {
        query,
        results: [],
        totalResults: 0,
        fetchedAt: new Date().toISOString(),
      };
    }

    try {
      const response = await fetch(`${SERPER_BASE}/search`, {
        method: 'POST',
        headers: {
          'X-API-KEY': this.serperApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          q: query,
          num: numResults,
          gl: location || 'us',
        }),
      });

      if (!response.ok) {
        throw new Error(`Search API error: ${response.status}`);
      }

      const data = await response.json();

      const results: SearchResult[] = (data.organic || []).map((item: any) => ({
        title: item.title,
        url: item.link,
        snippet: item.snippet,
        source: new URL(item.link).hostname.replace('www.', ''),
        publishedAt: item.date,
      }));

      const searchResponse: WebSearchResponse = {
        query,
        results,
        totalResults: data.searchInformation?.totalResults || results.length,
        fetchedAt: new Date().toISOString(),
      };

      this.cache.set(cacheKey, {
        data: searchResponse,
        expires: Date.now() + this.cacheTtl,
      });

      return searchResponse;
    } catch (error: any) {
      console.error('[Search] Failed:', error.message);
      return {
        query,
        results: [],
        totalResults: 0,
        fetchedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * News search
   */
  async searchNews(params: {
    query?: string;
    category?: string;
    location?: string;
    numResults?: number;
  }): Promise<NewsResponse> {
    const { query, category, location, numResults = 5 } = params;
    const searchQuery = query || category || 'top news';
    const cacheKey = `news:${searchQuery}:${location || ''}`;

    const cached = this.cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return cached.data;
    }

    if (!this.serperApiKey) {
      return {
        query: searchQuery,
        articles: [],
        fetchedAt: new Date().toISOString(),
      };
    }

    try {
      const response = await fetch(`${SERPER_BASE}/news`, {
        method: 'POST',
        headers: {
          'X-API-KEY': this.serperApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          q: searchQuery,
          num: numResults,
          gl: location || 'us',
        }),
      });

      if (!response.ok) {
        throw new Error(`News API error: ${response.status}`);
      }

      const data = await response.json();

      const articles: NewsArticle[] = (data.news || []).map((item: any) => ({
        title: item.title,
        description: item.snippet,
        url: item.link,
        source: item.source,
        publishedAt: item.date || new Date().toISOString(),
        imageUrl: item.imageUrl,
        category,
      }));

      const newsResponse: NewsResponse = {
        query: searchQuery,
        category,
        articles,
        fetchedAt: new Date().toISOString(),
      };

      this.cache.set(cacheKey, {
        data: newsResponse,
        expires: Date.now() + this.cacheTtl,
      });

      return newsResponse;
    } catch (error: any) {
      console.error('[News] Failed:', error.message);
      return {
        query: searchQuery,
        articles: [],
        fetchedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Context-aware search for briefing
   * Searches for news relevant to user's interests/entities
   */
  async searchForContext(params: {
    interests: string[];
    location?: string;
  }): Promise<NewsArticle[]> {
    const { interests, location } = params;

    if (!interests.length || !this.serperApiKey) {
      return [];
    }

    // Search for top 2 interests
    const topInterests = interests.slice(0, 2);
    const results = await Promise.all(
      topInterests.map((interest) =>
        this.searchNews({
          query: interest,
          location,
          numResults: 3,
        })
      )
    );

    // Deduplicate by URL
    const seen = new Set<string>();
    const articles: NewsArticle[] = [];

    for (const result of results) {
      for (const article of result.articles) {
        if (!seen.has(article.url)) {
          seen.add(article.url);
          articles.push(article);
        }
      }
    }

    return articles.slice(0, 5);
  }
}

/**
 * Factory function
 */
export function createSearchService(serperApiKey?: string): SearchService {
  return new SearchService({ serperApiKey });
}
