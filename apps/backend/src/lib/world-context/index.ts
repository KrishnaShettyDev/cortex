/**
 * World Context Module
 *
 * Aggregates external world data for proactive intelligence:
 * - Weather conditions and forecasts
 * - Web search results
 * - News articles
 * - Nearby places and restaurants
 *
 * Used by briefing endpoint and chat for contextual awareness.
 */

import { WeatherService, createWeatherService } from './weather';
import { SearchService, createSearchService } from './search';
import { PlacesService, createPlacesService } from './places';
import type {
  WorldContext,
  WeatherData,
  NewsArticle,
  Place,
  SearchResult,
  Location,
} from './types';

export * from './types';
export * from './weather';
export * from './search';
export * from './places';

export interface WorldContextConfig {
  openWeatherApiKey?: string;
  serperApiKey?: string;
  yelpApiKey?: string;
}

export interface WorldContextParams {
  latitude?: number;
  longitude?: number;
  city?: string;
  timezone?: string;
  interests?: string[];
  includeWeather?: boolean;
  includeNews?: boolean;
  includePlaces?: boolean;
}

/**
 * World Context Aggregator
 *
 * Combines multiple services to provide comprehensive world context.
 */
export class WorldContextAggregator {
  private weatherService: WeatherService | null;
  private searchService: SearchService;
  private placesService: PlacesService;

  constructor(config: WorldContextConfig) {
    this.weatherService = config.openWeatherApiKey
      ? createWeatherService(config.openWeatherApiKey)
      : null;
    this.searchService = createSearchService(config.serperApiKey);
    this.placesService = createPlacesService(config.yelpApiKey);
  }

  /**
   * Get comprehensive world context for a user
   */
  async getContext(params: WorldContextParams): Promise<WorldContext> {
    const {
      latitude,
      longitude,
      city,
      interests = [],
      includeWeather = true,
      includeNews = true,
      includePlaces = false,
    } = params;

    const context: WorldContext = {
      generatedAt: new Date().toISOString(),
    };

    const hasLocation = (latitude && longitude) || city;

    // Collect promises for parallel execution
    const promises: Promise<void>[] = [];

    // Weather
    if (includeWeather && this.weatherService && hasLocation) {
      promises.push(
        (async () => {
          try {
            let weather: WeatherData;
            if (latitude && longitude) {
              weather = await this.weatherService!.getWeather({ latitude, longitude });
            } else if (city) {
              weather = await this.weatherService!.getWeatherByCity({ city });
            } else {
              return;
            }
            context.weather = weather;
          } catch (error) {
            console.warn('[WorldContext] Weather fetch failed:', error);
          }
        })()
      );
    }

    // News based on interests
    if (includeNews && interests.length > 0) {
      promises.push(
        (async () => {
          try {
            const articles = await this.searchService.searchForContext({ interests });
            context.news = articles;
          } catch (error) {
            console.warn('[WorldContext] News fetch failed:', error);
          }
        })()
      );
    }

    // Nearby places
    if (includePlaces && latitude && longitude) {
      promises.push(
        (async () => {
          try {
            const placesResult = await this.placesService.searchPlaces({
              latitude,
              longitude,
              limit: 5,
            });
            context.nearbyPlaces = placesResult.results;
          } catch (error) {
            console.warn('[WorldContext] Places fetch failed:', error);
          }
        })()
      );
    }

    // Location info
    if (hasLocation) {
      context.location = {
        latitude: latitude || 0,
        longitude: longitude || 0,
        city,
        timezone: params.timezone,
      };
    }

    // Execute all in parallel
    await Promise.all(promises);

    return context;
  }

  /**
   * Get weather only
   */
  async getWeather(params: {
    latitude?: number;
    longitude?: number;
    city?: string;
  }): Promise<WeatherData | null> {
    if (!this.weatherService) return null;

    try {
      if (params.latitude && params.longitude) {
        return await this.weatherService.getWeather({
          latitude: params.latitude,
          longitude: params.longitude,
        });
      } else if (params.city) {
        return await this.weatherService.getWeatherByCity({ city: params.city });
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Search web
   */
  async search(query: string, numResults = 5): Promise<SearchResult[]> {
    const result = await this.searchService.search({ query, numResults });
    return result.results;
  }

  /**
   * Get news
   */
  async getNews(params: {
    query?: string;
    category?: string;
  }): Promise<NewsArticle[]> {
    const result = await this.searchService.searchNews(params);
    return result.articles;
  }

  /**
   * Search places
   */
  async searchPlaces(params: {
    query?: string;
    latitude: number;
    longitude: number;
  }): Promise<Place[]> {
    const result = await this.placesService.searchPlaces(params);
    return result.results;
  }

  /**
   * Search restaurants
   */
  async searchRestaurants(params: {
    latitude: number;
    longitude: number;
    cuisine?: string;
  }): Promise<Place[]> {
    const result = await this.placesService.searchRestaurants(params);
    return result.results;
  }

  /**
   * Generate natural language summary for briefing
   */
  generateSummary(context: WorldContext): string {
    const parts: string[] = [];

    // Weather summary
    if (context.weather) {
      const w = context.weather;
      const unit = w.temperatureUnit === 'celsius' ? 'C' : 'F';
      parts.push(
        `Weather in ${w.location}: ${w.temperature}${unit}, ${w.description}.`
      );

      if (w.forecast?.length) {
        const tomorrow = w.forecast[0];
        parts.push(
          `Tomorrow: ${tomorrow.high}/${tomorrow.low}${unit}${
            tomorrow.precipitationChance > 30
              ? ` with ${tomorrow.precipitationChance}% chance of rain`
              : ''
          }.`
        );
      }
    }

    // News summary
    if (context.news?.length) {
      parts.push(`News: ${context.news.slice(0, 2).map((n) => n.title).join('; ')}.`);
    }

    return parts.join(' ') || 'No world context available.';
  }
}

/**
 * Factory function to create world context aggregator
 */
export function createWorldContext(config: WorldContextConfig): WorldContextAggregator {
  return new WorldContextAggregator(config);
}
