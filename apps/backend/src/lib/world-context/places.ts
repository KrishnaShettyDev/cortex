/**
 * Places Service
 *
 * Fetches nearby places and restaurants using Yelp Fusion API.
 */

import type { Place, PlacesSearchResponse } from './types';

const YELP_BASE = 'https://api.yelp.com/v3';

export interface PlacesServiceConfig {
  yelpApiKey?: string;
  cacheTtlSeconds?: number;
}

export class PlacesService {
  private yelpApiKey?: string;
  private cache: Map<string, { data: any; expires: number }> = new Map();
  private cacheTtl: number;

  constructor(config: PlacesServiceConfig) {
    this.yelpApiKey = config.yelpApiKey;
    this.cacheTtl = (config.cacheTtlSeconds || 3600) * 1000; // Default 1 hour
  }

  /**
   * Search for nearby businesses/places
   */
  async searchPlaces(params: {
    query?: string;
    latitude: number;
    longitude: number;
    categories?: string[];
    radius?: number; // meters
    limit?: number;
    sortBy?: 'best_match' | 'rating' | 'distance';
  }): Promise<PlacesSearchResponse> {
    const {
      query,
      latitude,
      longitude,
      categories,
      radius = 5000,
      limit = 10,
      sortBy = 'best_match',
    } = params;

    const cacheKey = `places:${latitude.toFixed(2)},${longitude.toFixed(2)}:${query || ''}:${categories?.join(',') || ''}`;

    const cached = this.cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return cached.data;
    }

    if (!this.yelpApiKey) {
      return {
        query: query || '',
        location: `${latitude}, ${longitude}`,
        results: [],
        totalResults: 0,
        fetchedAt: new Date().toISOString(),
      };
    }

    try {
      const searchParams = new URLSearchParams({
        latitude: latitude.toString(),
        longitude: longitude.toString(),
        radius: Math.min(radius, 40000).toString(), // Yelp max is 40km
        limit: limit.toString(),
        sort_by: sortBy,
      });

      if (query) {
        searchParams.append('term', query);
      }

      if (categories?.length) {
        searchParams.append('categories', categories.join(','));
      }

      const response = await fetch(`${YELP_BASE}/businesses/search?${searchParams}`, {
        headers: {
          Authorization: `Bearer ${this.yelpApiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Yelp API error: ${response.status}`);
      }

      const data = await response.json();

      const results: Place[] = (data.businesses || []).map((biz: any) => ({
        id: biz.id,
        name: biz.name,
        category: biz.categories?.[0]?.title || 'Unknown',
        rating: biz.rating || 0,
        reviewCount: biz.review_count || 0,
        priceLevel: biz.price,
        address: this.formatAddress(biz.location),
        phone: biz.display_phone,
        url: biz.url,
        imageUrl: biz.image_url,
        distance: biz.distance ? Math.round(biz.distance) : undefined,
        isOpen: biz.is_closed === false,
      }));

      const placesResponse: PlacesSearchResponse = {
        query: query || '',
        location: data.region?.center
          ? `${data.region.center.latitude}, ${data.region.center.longitude}`
          : `${latitude}, ${longitude}`,
        results,
        totalResults: data.total || results.length,
        fetchedAt: new Date().toISOString(),
      };

      this.cache.set(cacheKey, {
        data: placesResponse,
        expires: Date.now() + this.cacheTtl,
      });

      return placesResponse;
    } catch (error: any) {
      console.error('[Places] Failed:', error.message);
      return {
        query: query || '',
        location: `${latitude}, ${longitude}`,
        results: [],
        totalResults: 0,
        fetchedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Search for restaurants specifically
   */
  async searchRestaurants(params: {
    latitude: number;
    longitude: number;
    cuisine?: string;
    priceLevel?: '1' | '2' | '3' | '4';
    openNow?: boolean;
    limit?: number;
  }): Promise<PlacesSearchResponse> {
    const { latitude, longitude, cuisine, priceLevel, openNow, limit = 10 } = params;

    if (!this.yelpApiKey) {
      return {
        query: cuisine || 'restaurants',
        location: `${latitude}, ${longitude}`,
        results: [],
        totalResults: 0,
        fetchedAt: new Date().toISOString(),
      };
    }

    try {
      const searchParams = new URLSearchParams({
        latitude: latitude.toString(),
        longitude: longitude.toString(),
        categories: 'restaurants',
        limit: limit.toString(),
        sort_by: 'rating',
      });

      if (cuisine) {
        searchParams.append('term', cuisine);
      }

      if (priceLevel) {
        searchParams.append('price', priceLevel);
      }

      if (openNow) {
        searchParams.append('open_now', 'true');
      }

      const response = await fetch(`${YELP_BASE}/businesses/search?${searchParams}`, {
        headers: {
          Authorization: `Bearer ${this.yelpApiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Yelp API error: ${response.status}`);
      }

      const data = await response.json();

      const results: Place[] = (data.businesses || []).map((biz: any) => ({
        id: biz.id,
        name: biz.name,
        category: biz.categories?.[0]?.title || 'Restaurant',
        rating: biz.rating || 0,
        reviewCount: biz.review_count || 0,
        priceLevel: biz.price,
        address: this.formatAddress(biz.location),
        phone: biz.display_phone,
        url: biz.url,
        imageUrl: biz.image_url,
        distance: biz.distance ? Math.round(biz.distance) : undefined,
        isOpen: biz.is_closed === false,
      }));

      return {
        query: cuisine || 'restaurants',
        location: `${latitude}, ${longitude}`,
        results,
        totalResults: data.total || results.length,
        fetchedAt: new Date().toISOString(),
      };
    } catch (error: any) {
      console.error('[Places] Restaurant search failed:', error.message);
      return {
        query: cuisine || 'restaurants',
        location: `${latitude}, ${longitude}`,
        results: [],
        totalResults: 0,
        fetchedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Get business details
   */
  async getPlaceDetails(businessId: string): Promise<Place | null> {
    if (!this.yelpApiKey) {
      return null;
    }

    try {
      const response = await fetch(`${YELP_BASE}/businesses/${businessId}`, {
        headers: {
          Authorization: `Bearer ${this.yelpApiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Yelp API error: ${response.status}`);
      }

      const biz = await response.json();

      return {
        id: biz.id,
        name: biz.name,
        category: biz.categories?.[0]?.title || 'Unknown',
        rating: biz.rating || 0,
        reviewCount: biz.review_count || 0,
        priceLevel: biz.price,
        address: this.formatAddress(biz.location),
        phone: biz.display_phone,
        url: biz.url,
        imageUrl: biz.image_url,
        isOpen: biz.is_closed === false,
        hours: biz.hours?.[0]?.open?.map((h: any) =>
          `${this.dayName(h.day)}: ${this.formatTime(h.start)}-${this.formatTime(h.end)}`
        ),
      };
    } catch (error: any) {
      console.error('[Places] Details fetch failed:', error.message);
      return null;
    }
  }

  /**
   * Format Yelp address object to string
   */
  private formatAddress(location: any): string {
    if (!location) return '';

    const parts = [
      location.address1,
      location.city,
      location.state,
    ].filter(Boolean);

    return parts.join(', ');
  }

  /**
   * Convert day number to name
   */
  private dayName(day: number): string {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return days[day] || '';
  }

  /**
   * Format Yelp time string
   */
  private formatTime(time: string): string {
    if (!time || time.length !== 4) return time;
    const hours = parseInt(time.slice(0, 2), 10);
    const minutes = time.slice(2);
    const period = hours >= 12 ? 'PM' : 'AM';
    const hour12 = hours % 12 || 12;
    return `${hour12}:${minutes}${period}`;
  }
}

/**
 * Factory function
 */
export function createPlacesService(yelpApiKey?: string): PlacesService {
  return new PlacesService({ yelpApiKey });
}
