const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://askcortex.plutas.in';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('cortex_token');
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (res.status === 401) {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('cortex_token');
      localStorage.removeItem('cortex_user');
      window.location.href = '/login';
    }
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(body.message || body.error || `API error ${res.status}`);
  }

  return res.json();
}

// API endpoint types based on apps/backend/src/handlers/auth.ts
// Confirmed endpoints:
// - POST /auth/google - Google OAuth login
// - GET /auth/api-keys - List API keys
// - POST /auth/api-keys - Create API key
// - DELETE /auth/api-keys/:id - Delete API key
// - POST /auth/api-keys/:id/revoke - Revoke API key
// - GET /v3/memories - List memories

export const api = {
  auth: {
    // POST /auth/google - expects { idToken }, returns AuthResponse
    google: (idToken: string) =>
      apiFetch<{
        access_token: string;
        refresh_token: string;
        expires_in: number;
        user: { id: string; email: string; name?: string };
      }>('/auth/google', { method: 'POST', body: JSON.stringify({ idToken }) }),
  },
  keys: {
    // GET /auth/api-keys - returns { api_keys: [...], total }
    list: () =>
      apiFetch<{
        api_keys: Array<{
          id: string;
          name: string;
          prefix: string;
          last_used_at: string | null;
          expires_at: string | null;
          is_active: boolean;
          created_at: string;
        }>;
        total: number;
      }>('/auth/api-keys'),
    // POST /auth/api-keys - expects { name }, returns { key, id, prefix, ... }
    create: (name: string) =>
      apiFetch<{
        key: string;
        id: string;
        prefix: string;
        name: string;
        expires_at: string | null;
        created_at: string;
        warning: string;
      }>('/auth/api-keys', { method: 'POST', body: JSON.stringify({ name }) }),
    // DELETE /auth/api-keys/:id - returns { deleted: true }
    delete: (keyId: string) =>
      apiFetch<{ deleted: boolean }>(`/auth/api-keys/${keyId}`, { method: 'DELETE' }),
    // POST /auth/api-keys/:id/revoke - returns { revoked: true }
    revoke: (keyId: string) =>
      apiFetch<{ revoked: boolean }>(`/auth/api-keys/${keyId}/revoke`, { method: 'POST' }),
  },
  memories: {
    // GET /v3/memories - returns { memories: [...], total }
    count: () =>
      apiFetch<{ memories: unknown[]; total?: number }>('/v3/memories?limit=1'),
  },
  // TODO: Backend needs GET /v3/stats endpoint for usage metrics (API calls, etc.)
};
