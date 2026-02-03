/**
 * Weather Service
 *
 * Fetches weather data using OpenWeatherMap API.
 * Supports current conditions, forecasts, and alerts.
 */

import type { WeatherData, DailyForecast, WeatherAlert } from './types';

const OPENWEATHERMAP_BASE = 'https://api.openweathermap.org/data/2.5';

export interface WeatherServiceConfig {
  apiKey: string;
  cacheTtlSeconds?: number;
}

export class WeatherService {
  private apiKey: string;
  private cache: Map<string, { data: WeatherData; expires: number }> = new Map();
  private cacheTtl: number;

  constructor(config: WeatherServiceConfig) {
    this.apiKey = config.apiKey;
    this.cacheTtl = (config.cacheTtlSeconds || 1800) * 1000; // Default 30 min
  }

  /**
   * Get current weather and forecast for a location
   */
  async getWeather(params: {
    latitude: number;
    longitude: number;
    units?: 'metric' | 'imperial';
  }): Promise<WeatherData> {
    const { latitude, longitude, units = 'metric' } = params;
    const cacheKey = `${latitude.toFixed(2)},${longitude.toFixed(2)},${units}`;

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return cached.data;
    }

    try {
      // Fetch current weather and forecast in parallel
      const [currentRes, forecastRes] = await Promise.all([
        fetch(
          `${OPENWEATHERMAP_BASE}/weather?lat=${latitude}&lon=${longitude}&units=${units}&appid=${this.apiKey}`
        ),
        fetch(
          `${OPENWEATHERMAP_BASE}/forecast?lat=${latitude}&lon=${longitude}&units=${units}&appid=${this.apiKey}`
        ),
      ]);

      if (!currentRes.ok) {
        throw new Error(`Weather API error: ${currentRes.status}`);
      }

      const current = await currentRes.json();
      const forecast = forecastRes.ok ? await forecastRes.json() : null;

      const weather: WeatherData = {
        location: current.name || `${latitude}, ${longitude}`,
        temperature: Math.round(current.main.temp),
        temperatureUnit: units === 'metric' ? 'celsius' : 'fahrenheit',
        feelsLike: Math.round(current.main.feels_like),
        humidity: current.main.humidity,
        description: current.weather[0]?.description || 'Unknown',
        icon: this.mapIcon(current.weather[0]?.icon),
        windSpeed: Math.round(current.wind?.speed || 0),
        visibility: Math.round((current.visibility || 10000) / 1000),
        fetchedAt: new Date().toISOString(),
      };

      // Parse 5-day forecast
      if (forecast?.list) {
        weather.forecast = this.parseForecast(forecast.list, units);
      }

      // Cache result
      this.cache.set(cacheKey, {
        data: weather,
        expires: Date.now() + this.cacheTtl,
      });

      return weather;
    } catch (error: any) {
      console.error('[Weather] Failed to fetch:', error.message);
      throw error;
    }
  }

  /**
   * Get weather by city name (for users without GPS)
   */
  async getWeatherByCity(params: {
    city: string;
    units?: 'metric' | 'imperial';
  }): Promise<WeatherData> {
    const { city, units = 'metric' } = params;
    const cacheKey = `city:${city.toLowerCase()},${units}`;

    const cached = this.cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return cached.data;
    }

    try {
      const response = await fetch(
        `${OPENWEATHERMAP_BASE}/weather?q=${encodeURIComponent(city)}&units=${units}&appid=${this.apiKey}`
      );

      if (!response.ok) {
        throw new Error(`Weather API error: ${response.status}`);
      }

      const current = await response.json();

      // Get forecast using coordinates
      const forecastRes = await fetch(
        `${OPENWEATHERMAP_BASE}/forecast?lat=${current.coord.lat}&lon=${current.coord.lon}&units=${units}&appid=${this.apiKey}`
      );
      const forecast = forecastRes.ok ? await forecastRes.json() : null;

      const weather: WeatherData = {
        location: current.name,
        temperature: Math.round(current.main.temp),
        temperatureUnit: units === 'metric' ? 'celsius' : 'fahrenheit',
        feelsLike: Math.round(current.main.feels_like),
        humidity: current.main.humidity,
        description: current.weather[0]?.description || 'Unknown',
        icon: this.mapIcon(current.weather[0]?.icon),
        windSpeed: Math.round(current.wind?.speed || 0),
        visibility: Math.round((current.visibility || 10000) / 1000),
        fetchedAt: new Date().toISOString(),
      };

      if (forecast?.list) {
        weather.forecast = this.parseForecast(forecast.list, units);
      }

      this.cache.set(cacheKey, {
        data: weather,
        expires: Date.now() + this.cacheTtl,
      });

      return weather;
    } catch (error: any) {
      console.error('[Weather] Failed to fetch by city:', error.message);
      throw error;
    }
  }

  /**
   * Parse forecast data into daily summaries
   */
  private parseForecast(
    list: any[],
    units: 'metric' | 'imperial'
  ): DailyForecast[] {
    // Group by date
    const dailyMap = new Map<
      string,
      { temps: number[]; descriptions: string[]; icons: string[]; pop: number[] }
    >();

    for (const item of list) {
      const date = item.dt_txt.split(' ')[0];
      if (!dailyMap.has(date)) {
        dailyMap.set(date, { temps: [], descriptions: [], icons: [], pop: [] });
      }
      const day = dailyMap.get(date)!;
      day.temps.push(item.main.temp);
      day.descriptions.push(item.weather[0]?.description || '');
      day.icons.push(item.weather[0]?.icon || '01d');
      day.pop.push(item.pop || 0);
    }

    // Convert to daily forecasts
    const forecasts: DailyForecast[] = [];
    for (const [date, data] of dailyMap) {
      if (forecasts.length >= 5) break;

      forecasts.push({
        date,
        high: Math.round(Math.max(...data.temps)),
        low: Math.round(Math.min(...data.temps)),
        description: data.descriptions[Math.floor(data.descriptions.length / 2)] || '',
        icon: this.mapIcon(data.icons[Math.floor(data.icons.length / 2)]),
        precipitationChance: Math.round(Math.max(...data.pop) * 100),
      });
    }

    return forecasts;
  }

  /**
   * Map OpenWeatherMap icon codes to emoji
   */
  private mapIcon(code: string): string {
    const iconMap: Record<string, string> = {
      '01d': 'sunny',
      '01n': 'clear_night',
      '02d': 'partly_cloudy',
      '02n': 'partly_cloudy_night',
      '03d': 'cloudy',
      '03n': 'cloudy',
      '04d': 'overcast',
      '04n': 'overcast',
      '09d': 'rain',
      '09n': 'rain',
      '10d': 'rain_sun',
      '10n': 'rain_night',
      '11d': 'thunderstorm',
      '11n': 'thunderstorm',
      '13d': 'snow',
      '13n': 'snow',
      '50d': 'fog',
      '50n': 'fog',
    };
    return iconMap[code] || 'unknown';
  }

  /**
   * Get weather summary for briefing
   */
  getSummary(weather: WeatherData): string {
    const temp = weather.temperature;
    const unit = weather.temperatureUnit === 'celsius' ? 'C' : 'F';
    const desc = weather.description;

    let summary = `${temp}${unit}, ${desc} in ${weather.location}`;

    if (weather.forecast?.length) {
      const tomorrow = weather.forecast[0];
      summary += `. Tomorrow: ${tomorrow.high}/${tomorrow.low}${unit}`;
      if (tomorrow.precipitationChance > 30) {
        summary += ` (${tomorrow.precipitationChance}% chance of rain)`;
      }
    }

    if (weather.alerts?.length) {
      const alert = weather.alerts[0];
      summary += `. Alert: ${alert.headline}`;
    }

    return summary;
  }
}

/**
 * Factory function
 */
export function createWeatherService(apiKey: string): WeatherService {
  return new WeatherService({ apiKey });
}
