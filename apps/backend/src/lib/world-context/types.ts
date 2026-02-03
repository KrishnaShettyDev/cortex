/**
 * World Context Types
 *
 * Types for external world data: weather, search, places, etc.
 */

export interface WeatherData {
  location: string;
  temperature: number;
  temperatureUnit: 'celsius' | 'fahrenheit';
  feelsLike: number;
  humidity: number;
  description: string;
  icon: string;
  windSpeed: number;
  visibility: number;
  uvIndex?: number;
  forecast?: DailyForecast[];
  alerts?: WeatherAlert[];
  fetchedAt: string;
}

export interface DailyForecast {
  date: string;
  high: number;
  low: number;
  description: string;
  icon: string;
  precipitationChance: number;
}

export interface WeatherAlert {
  event: string;
  severity: 'minor' | 'moderate' | 'severe' | 'extreme';
  headline: string;
  description: string;
  start: string;
  end: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  publishedAt?: string;
}

export interface WebSearchResponse {
  query: string;
  results: SearchResult[];
  totalResults: number;
  fetchedAt: string;
}

export interface Place {
  id: string;
  name: string;
  category: string;
  rating: number;
  reviewCount: number;
  priceLevel?: string;
  address: string;
  phone?: string;
  url?: string;
  imageUrl?: string;
  distance?: number;
  isOpen?: boolean;
  hours?: string[];
}

export interface PlacesSearchResponse {
  query: string;
  location: string;
  results: Place[];
  totalResults: number;
  fetchedAt: string;
}

export interface NewsArticle {
  title: string;
  description: string;
  url: string;
  source: string;
  publishedAt: string;
  imageUrl?: string;
  category?: string;
}

export interface NewsResponse {
  category?: string;
  query?: string;
  articles: NewsArticle[];
  fetchedAt: string;
}

export interface Location {
  latitude: number;
  longitude: number;
  city?: string;
  region?: string;
  country?: string;
  timezone?: string;
}

export interface WorldContext {
  weather?: WeatherData;
  news?: NewsArticle[];
  nearbyPlaces?: Place[];
  relevantSearch?: SearchResult[];
  location?: Location;
  generatedAt: string;
}
