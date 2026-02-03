/**
 * Fetch with Timeout
 *
 * Wrapper around fetch that adds timeout support and better error handling.
 * Essential for external API calls to prevent hanging requests.
 */

export interface FetchWithTimeoutOptions extends RequestInit {
  timeout?: number; // Timeout in milliseconds
}

export class FetchTimeoutError extends Error {
  constructor(
    public url: string,
    public timeout: number
  ) {
    super(`Request to ${url} timed out after ${timeout}ms`);
    this.name = 'FetchTimeoutError';
  }
}

export class FetchNetworkError extends Error {
  constructor(
    public url: string,
    public originalError: Error
  ) {
    super(`Network error while fetching ${url}: ${originalError.message}`);
    this.name = 'FetchNetworkError';
  }
}

/**
 * Default timeouts for different types of requests
 */
export const DEFAULT_TIMEOUTS = {
  /** Fast operations (health checks, simple GETs) */
  FAST: 5000,
  /** Normal API calls */
  NORMAL: 15000,
  /** Slow operations (LLM calls, large data transfers) */
  SLOW: 30000,
  /** Very slow operations (file uploads, batch processing) */
  VERY_SLOW: 60000,
} as const;

/**
 * Fetch with timeout support
 *
 * @param url - The URL to fetch
 * @param options - Fetch options including timeout
 * @returns Promise that resolves to Response or rejects on timeout/error
 *
 * @example
 * ```ts
 * // With 10 second timeout
 * const response = await fetchWithTimeout('https://api.example.com/data', {
 *   timeout: 10000,
 *   method: 'GET',
 * });
 *
 * // With default timeout (15 seconds)
 * const response = await fetchWithTimeout('https://api.example.com/data');
 * ```
 */
export async function fetchWithTimeout(
  url: string,
  options: FetchWithTimeoutOptions = {}
): Promise<Response> {
  const { timeout = DEFAULT_TIMEOUTS.NORMAL, ...fetchOptions } = options;

  // Create an AbortController for the timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);

    // Check if this was a timeout (abort)
    if (error.name === 'AbortError') {
      throw new FetchTimeoutError(url, timeout);
    }

    // Network error
    throw new FetchNetworkError(url, error);
  }
}

/**
 * Fetch JSON with timeout support
 *
 * Convenience wrapper that fetches and parses JSON in one call.
 * Throws on non-2xx responses.
 */
export async function fetchJsonWithTimeout<T>(
  url: string,
  options: FetchWithTimeoutOptions = {}
): Promise<T> {
  const response = await fetchWithTimeout(url, options);

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  return response.json();
}

/**
 * Create a fetch wrapper with preset options
 *
 * Useful for API clients that need consistent headers and timeout.
 *
 * @example
 * ```ts
 * const apiClient = createFetchClient({
 *   baseUrl: 'https://api.example.com',
 *   timeout: 10000,
 *   headers: { 'Authorization': 'Bearer token' },
 * });
 *
 * const data = await apiClient.get('/users');
 * const result = await apiClient.post('/users', { name: 'John' });
 * ```
 */
export function createFetchClient(config: {
  baseUrl: string;
  timeout?: number;
  headers?: Record<string, string>;
}) {
  const { baseUrl, timeout = DEFAULT_TIMEOUTS.NORMAL, headers = {} } = config;

  async function request<T>(
    endpoint: string,
    options: FetchWithTimeoutOptions = {}
  ): Promise<T> {
    const url = `${baseUrl}${endpoint}`;
    const response = await fetchWithTimeout(url, {
      timeout,
      ...options,
      headers: {
        ...headers,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    return response.json();
  }

  return {
    get: <T>(endpoint: string, options?: FetchWithTimeoutOptions) =>
      request<T>(endpoint, { ...options, method: 'GET' }),

    post: <T>(endpoint: string, body?: any, options?: FetchWithTimeoutOptions) =>
      request<T>(endpoint, {
        ...options,
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      }),

    put: <T>(endpoint: string, body?: any, options?: FetchWithTimeoutOptions) =>
      request<T>(endpoint, {
        ...options,
        method: 'PUT',
        body: body ? JSON.stringify(body) : undefined,
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      }),

    delete: <T>(endpoint: string, options?: FetchWithTimeoutOptions) =>
      request<T>(endpoint, { ...options, method: 'DELETE' }),
  };
}
