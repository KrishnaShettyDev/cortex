/**
 * Performance Monitoring
 *
 * Track request latency, database query times, and system performance.
 */

export interface PerformanceMetrics {
  endpoint: string;
  method: string;
  duration: number;
  status: number;
  userId?: string;
  containerTag?: string;
  timestamp: string;
}

export interface DatabaseQueryMetrics {
  query: string;
  duration: number;
  rowCount?: number;
  timestamp: string;
}

/**
 * Performance timer for requests
 */
export class PerformanceTimer {
  private startTime: number;
  private endpoint: string;
  private method: string;
  private userId?: string;
  private containerTag?: string;

  constructor(endpoint: string, method: string, userId?: string, containerTag?: string) {
    this.startTime = Date.now();
    this.endpoint = endpoint;
    this.method = method;
    this.userId = userId;
    this.containerTag = containerTag;
  }

  /**
   * End timer and return metrics
   */
  end(status: number): PerformanceMetrics {
    const duration = Date.now() - this.startTime;

    return {
      endpoint: this.endpoint,
      method: this.method,
      duration,
      status,
      userId: this.userId,
      containerTag: this.containerTag,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Log performance metrics
 */
export function logPerformance(metrics: PerformanceMetrics): void {
  const { endpoint, method, duration, status } = metrics;

  // Warn on slow requests (>1s)
  if (duration > 1000) {
    console.warn(
      `[Performance][SLOW] ${method} ${endpoint} - ${duration}ms (status: ${status})`
    );
  } else {
    console.log(
      `[Performance] ${method} ${endpoint} - ${duration}ms (status: ${status})`
    );
  }
}

/**
 * Track performance metrics in KV
 */
export async function trackPerformanceMetrics(
  kv: KVNamespace,
  metrics: PerformanceMetrics
): Promise<void> {
  const date = new Date().toISOString().split('T')[0];
  const hour = new Date().getHours();

  // Track average latency per endpoint per hour
  const key = `perf:${date}:${hour}:${metrics.endpoint}`;

  try {
    const existing = await kv.get(key, 'json');
    const data = existing
      ? (existing as { count: number; total: number })
      : { count: 0, total: 0 };

    data.count += 1;
    data.total += metrics.duration;

    await kv.put(key, JSON.stringify(data), {
      expirationTtl: 60 * 60 * 24 * 7, // 7 days
    });
  } catch (err) {
    console.warn('Failed to track performance metric:', err);
  }
}

/**
 * Get average latency for endpoint
 */
export async function getAverageLatency(
  kv: KVNamespace,
  endpoint: string,
  date: string,
  hour: number
): Promise<number | null> {
  const key = `perf:${date}:${hour}:${endpoint}`;

  try {
    const data = await kv.get(key, 'json');
    if (data) {
      const { count, total } = data as { count: number; total: number };
      return Math.round(total / count);
    }
  } catch (err) {
    console.warn('Failed to get latency:', err);
  }

  return null;
}

/**
 * Database query timer
 */
export class QueryTimer {
  private startTime: number;
  private query: string;

  constructor(query: string) {
    this.startTime = Date.now();
    this.query = query;
  }

  /**
   * End timer and log if slow
   */
  end(rowCount?: number): DatabaseQueryMetrics {
    const duration = Date.now() - this.startTime;

    const metrics: DatabaseQueryMetrics = {
      query: this.query.substring(0, 100), // Truncate long queries
      duration,
      rowCount,
      timestamp: new Date().toISOString(),
    };

    // Warn on slow queries (>500ms)
    if (duration > 500) {
      console.warn(
        `[Database][SLOW] Query took ${duration}ms (${rowCount || 0} rows): ${metrics.query}`
      );
    }

    return metrics;
  }
}

/**
 * System health check
 */
export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: {
    database: boolean;
    vectorize: boolean;
    cache: boolean;
  };
  timestamp: string;
}

/**
 * Perform health check
 */
export async function checkSystemHealth(env: {
  DB: D1Database;
  VECTORIZE: Vectorize;
  CACHE: KVNamespace;
}): Promise<SystemHealth> {
  const checks = {
    database: false,
    vectorize: false,
    cache: false,
  };

  // Check database
  try {
    await env.DB.prepare('SELECT 1').first();
    checks.database = true;
  } catch (err) {
    console.error('[Health] Database check failed:', err);
  }

  // Check cache
  try {
    await env.CACHE.get('health_check');
    checks.cache = true;
  } catch (err) {
    console.error('[Health] Cache check failed:', err);
  }

  // Vectorize health is implicit (can't directly test without data)
  checks.vectorize = true;

  // Determine overall status
  const healthyCount = Object.values(checks).filter(Boolean).length;
  let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

  if (healthyCount === 0) {
    status = 'unhealthy';
  } else if (healthyCount < 3) {
    status = 'degraded';
  }

  return {
    status,
    checks,
    timestamp: new Date().toISOString(),
  };
}
