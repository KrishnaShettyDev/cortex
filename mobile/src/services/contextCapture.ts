/**
 * Context Capture Service - Phase 2.2 Context Reinstatement + Phase 2.3 Mood Congruence
 *
 * Captures current context from the device to send with chat requests.
 * Enables encoding specificity principle: memories are more accessible
 * when retrieval context matches encoding context.
 *
 * Note: Mood detection (Phase 2.3) happens on the backend from the user's message.
 * No need to send mood from frontend - the backend's MoodService analyzes the
 * message text to detect emotional state and applies mood-congruent retrieval.
 */

import { locationService } from './location';
import { logger } from '../utils/logger';

/**
 * Current context for context reinstatement.
 * Matches the backend CurrentContext schema.
 */
export interface CurrentContext {
  // Location context
  latitude?: number;
  longitude?: number;
  location_name?: string;
  location_type?: string; // "home", "work", "cafe", "gym", etc.

  // Time context (derived on frontend)
  time_of_day?: string; // "morning", "afternoon", "evening", "night"
  day_of_week?: string; // "monday", "tuesday", etc.
  is_weekend?: boolean;

  // Environment context
  weather?: string; // "sunny", "rainy", "cloudy"
  temperature?: number;

  // Activity context
  activity?: string;
  activity_category?: string; // "work", "leisure", "travel"

  // Social context
  social_setting?: string; // "alone", "with_friends", "at_meeting"

  // Device context
  device_type?: string; // "mobile"
}

/**
 * Known locations for automatic location_type detection.
 * Users can customize this in settings.
 */
interface KnownLocation {
  name: string;
  type: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

class ContextCaptureService {
  private knownLocations: KnownLocation[] = [];
  private cachedContext: CurrentContext | null = null;
  private lastCaptureTime: number = 0;
  private CACHE_DURATION_MS = 60000; // 1 minute cache

  /**
   * Set known locations for automatic detection.
   * Call this after user sets up their home/work locations.
   */
  setKnownLocations(locations: KnownLocation[]): void {
    this.knownLocations = locations;
    logger.log(`ContextCapture: Set ${locations.length} known locations`);
  }

  /**
   * Add a known location.
   */
  addKnownLocation(location: KnownLocation): void {
    this.knownLocations.push(location);
  }

  /**
   * Capture current context for chat requests.
   * Uses caching to avoid excessive location calls.
   */
  async captureContext(): Promise<CurrentContext> {
    // Return cached context if fresh
    const now = Date.now();
    if (this.cachedContext && now - this.lastCaptureTime < this.CACHE_DURATION_MS) {
      return this.cachedContext;
    }

    const context: CurrentContext = {
      device_type: 'mobile',
    };

    try {
      // Capture time context (always available)
      this.captureTimeContext(context);

      // Capture location context
      await this.captureLocationContext(context);

      // Cache the result
      this.cachedContext = context;
      this.lastCaptureTime = now;

      logger.log('ContextCapture: Captured context', context);
      return context;
    } catch (error) {
      logger.error('ContextCapture: Error capturing context', error);
      // Return partial context (at least time)
      this.captureTimeContext(context);
      return context;
    }
  }

  /**
   * Capture time-based context.
   */
  private captureTimeContext(context: CurrentContext): void {
    const now = new Date();
    const hour = now.getHours();

    // Determine time of day
    if (hour >= 5 && hour < 12) {
      context.time_of_day = 'morning';
    } else if (hour >= 12 && hour < 17) {
      context.time_of_day = 'afternoon';
    } else if (hour >= 17 && hour < 21) {
      context.time_of_day = 'evening';
    } else {
      context.time_of_day = 'night';
    }

    // Day of week
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    context.day_of_week = days[now.getDay()];

    // Is weekend
    context.is_weekend = now.getDay() === 0 || now.getDay() === 6;
  }

  /**
   * Capture location-based context.
   */
  private async captureLocationContext(context: CurrentContext): Promise<void> {
    const location = await locationService.getCurrentLocation();

    if (!location) {
      logger.log('ContextCapture: No location available');
      return;
    }

    context.latitude = location.latitude;
    context.longitude = location.longitude;

    // Try to match against known locations
    const matched = this.matchKnownLocation(location.latitude, location.longitude);
    if (matched) {
      context.location_name = matched.name;
      context.location_type = matched.type;
      logger.log(`ContextCapture: Matched known location: ${matched.name} (${matched.type})`);
    }
  }

  /**
   * Match current coordinates against known locations.
   */
  private matchKnownLocation(lat: number, lon: number): KnownLocation | null {
    for (const known of this.knownLocations) {
      const distance = this.haversineDistance(lat, lon, known.latitude, known.longitude);
      if (distance * 1000 <= known.radiusMeters) { // Convert km to meters
        return known;
      }
    }
    return null;
  }

  /**
   * Calculate distance between two GPS points in kilometers.
   */
  private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  /**
   * Set activity context manually (called by user or inferred from app state).
   */
  setActivityContext(activity: string, category: string): void {
    if (this.cachedContext) {
      this.cachedContext.activity = activity;
      this.cachedContext.activity_category = category;
    }
  }

  /**
   * Set social context manually.
   */
  setSocialContext(setting: string): void {
    if (this.cachedContext) {
      this.cachedContext.social_setting = setting;
    }
  }

  /**
   * Set weather context (from Composio or weather API).
   */
  setWeatherContext(weather: string, temperature?: number): void {
    if (this.cachedContext) {
      this.cachedContext.weather = weather;
      if (temperature !== undefined) {
        this.cachedContext.temperature = temperature;
      }
    }
  }

  /**
   * Clear cached context (call when user logs out or context changes significantly).
   */
  clearCache(): void {
    this.cachedContext = null;
    this.lastCaptureTime = 0;
  }

  /**
   * Get context without capturing (returns cached or empty).
   */
  getCachedContext(): CurrentContext | null {
    return this.cachedContext;
  }
}

export const contextCaptureService = new ContextCaptureService();
