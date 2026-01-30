/**
 * Integration route handlers
 */

import type { Context } from 'hono';
import type { Bindings, IntegrationsResponse } from '../types';
import { handleError } from '../utils/errors';

export async function getIntegrationStatus(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = c.get('jwtPayload').sub;

    const integrations = await c.env.DB.prepare(
      'SELECT provider, connected, email, last_sync FROM integrations WHERE user_id = ?'
    )
      .bind(userId)
      .all();

    const response: IntegrationsResponse = {
      google:
        (integrations.results?.find((i: any) => i.provider === 'google') as any) || {
          connected: false,
          email: null,
          last_sync: null,
        },
      apple:
        (integrations.results?.find((i: any) => i.provider === 'apple') as any) || {
          connected: false,
          email: null,
          last_sync: null,
        },
    };

    return c.json(response);
  });
}

export async function connectGoogle(c: Context<{ Bindings: Bindings }>) {
  return c.json({ error: 'Integration not yet implemented' }, 501);
}
