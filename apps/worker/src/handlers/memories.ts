/**
 * Memory route handlers
 */

import type { Context } from 'hono';
import type { Bindings } from '../types';
import {
  createMemory,
  getMemory,
  getMemories,
  updateMemory,
  deleteMemory,
  searchMemories,
} from '../memory';
import { chat, chatWithHistory } from '../chat';
import { handleError } from '../utils/errors';

function getUserId(c: Context): string {
  return c.get('jwtPayload').sub;
}

export async function listMemories(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = getUserId(c);
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');
    const source = c.req.query('source');

    const result = await getMemories(c.env.DB, userId, {
      limit,
      offset,
      source: source || undefined,
    });

    return c.json(result);
  });
}

export async function getMemoryById(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = getUserId(c);
    const memoryId = c.req.param('id');

    const memory = await getMemory(c.env.DB, memoryId, userId);

    if (!memory) {
      return c.json({ error: 'Memory not found' }, 404);
    }

    return c.json(memory);
  });
}

export async function createNewMemory(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = getUserId(c);
    const body = await c.req.json();

    const memory = await createMemory(
      c.env.DB,
      c.env.VECTORIZE,
      userId,
      {
        content: body.content,
        source: body.source,
        metadata: body.metadata,
      },
      c.env.OPENAI_API_KEY
    );

    return c.json(memory, 201);
  });
}

export async function updateExistingMemory(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = getUserId(c);
    const memoryId = c.req.param('id');
    const body = await c.req.json();

    const memory = await updateMemory(
      c.env.DB,
      c.env.VECTORIZE,
      memoryId,
      userId,
      {
        content: body.content,
        source: body.source,
        metadata: body.metadata,
      },
      c.env.OPENAI_API_KEY
    );

    return c.json(memory);
  });
}

export async function deleteExistingMemory(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = getUserId(c);
    const memoryId = c.req.param('id');

    await deleteMemory(c.env.DB, c.env.VECTORIZE, memoryId, userId);

    return c.json({ message: 'Memory deleted successfully' });
  });
}

export async function search(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = getUserId(c);
    const { query, limit, source } = await c.req.json();

    if (!query || query.trim().length === 0) {
      return c.json({ error: 'Search query is required' }, 400);
    }

    const results = await searchMemories(
      c.env.DB,
      c.env.VECTORIZE,
      userId,
      query,
      c.env.OPENAI_API_KEY,
      {
        limit: limit || 10,
        source: source || undefined,
      }
    );

    return c.json({ results, count: results.length });
  });
}

export async function chatWithMemories(c: Context<{ Bindings: Bindings }>) {
  return handleError(c, async () => {
    const userId = getUserId(c);
    const { message, history, model, contextLimit } = await c.req.json();

    if (!message || message.trim().length === 0) {
      return c.json({ error: 'Message is required' }, 400);
    }

    const result = history
      ? await chatWithHistory(
          c.env.DB,
          c.env.VECTORIZE,
          userId,
          message,
          history,
          c.env.OPENAI_API_KEY,
          {
            model: model || 'gpt-4o-mini',
            contextLimit: contextLimit || 5,
          }
        )
      : await chat(
          c.env.DB,
          c.env.VECTORIZE,
          userId,
          message,
          c.env.OPENAI_API_KEY,
          {
            model: model || 'gpt-4o-mini',
            contextLimit: contextLimit || 5,
          }
        );

    return c.json(result);
  });
}
