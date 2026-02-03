/**
 * Validation Schema Tests
 *
 * Tests for all Zod validation schemas.
 */

import { describe, it, expect } from 'vitest';
import {
  createMemorySchema,
  updateMemorySchema,
  searchSchema,
  recallSchema,
  appleAuthSchema,
  googleAuthSchema,
  refreshTokenSchema,
  entityListSchema,
  commitmentListSchema,
  learningListSchema,
  validateLearningSchema,
} from './schemas';

describe('Validation Schemas', () => {
  // ============================================
  // MEMORY SCHEMAS
  // ============================================

  describe('createMemorySchema', () => {
    it('should accept valid input', () => {
      const input = {
        content: 'This is a test memory about my dog Max',
        source: 'manual',
      };

      const result = createMemorySchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject empty content', () => {
      const input = { content: '' };

      const result = createMemorySchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject content over 50000 chars', () => {
      const input = { content: 'x'.repeat(50001) };

      const result = createMemorySchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should provide default for useAUDN', () => {
      const input = { content: 'Test memory' };

      const result = createMemorySchema.parse(input);
      expect(result.useAUDN).toBe(true);
    });

    it('should allow optional metadata', () => {
      const input = {
        content: 'Test',
        metadata: { custom: 'value', count: 123 },
      };

      const result = createMemorySchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('updateMemorySchema', () => {
    it('should accept valid update', () => {
      const input = {
        content: 'Updated content',
        relationType: 'updates' as const,
      };

      const result = updateMemorySchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should default relationType to updates', () => {
      const input = { content: 'New content' };

      const result = updateMemorySchema.parse(input);
      expect(result.relationType).toBe('updates');
    });

    it('should only allow valid relation types', () => {
      const input = {
        content: 'Content',
        relationType: 'invalid',
      };

      const result = updateMemorySchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  // ============================================
  // SEARCH SCHEMAS
  // ============================================

  describe('searchSchema', () => {
    it('should accept valid search query', () => {
      const input = {
        q: 'what is my dog name',
        limit: 20,
      };

      const result = searchSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject empty query', () => {
      const input = { q: '' };

      const result = searchSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject limit over 100', () => {
      const input = {
        q: 'test',
        limit: 101,
      };

      const result = searchSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should provide sensible defaults', () => {
      const input = { q: 'test query' };

      const result = searchSchema.parse(input);
      expect(result.limit).toBe(10);
      expect(result.searchMode).toBe('hybrid');
      expect(result.includeProfile).toBe(true);
      expect(result.rerank).toBe(false);
    });

    it('should accept all search modes', () => {
      for (const mode of ['vector', 'keyword', 'hybrid'] as const) {
        const input = { q: 'test', searchMode: mode };
        const result = searchSchema.safeParse(input);
        expect(result.success).toBe(true);
      }
    });
  });

  describe('recallSchema', () => {
    it('should accept valid recall query', () => {
      const input = {
        q: 'Remember when we discussed the project?',
        limit: 15,
        format: 'markdown' as const,
      };

      const result = recallSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should default to json format', () => {
      const input = { q: 'test' };

      const result = recallSchema.parse(input);
      expect(result.format).toBe('json');
    });
  });

  // ============================================
  // AUTH SCHEMAS
  // ============================================

  describe('appleAuthSchema', () => {
    it('should require identity token of minimum length', () => {
      const input = { identityToken: 'short' };

      const result = appleAuthSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should accept valid token', () => {
      const input = {
        identityToken: 'a'.repeat(100),
      };

      const result = appleAuthSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept optional user name', () => {
      const input = {
        identityToken: 'a'.repeat(100),
        user: {
          name: {
            givenName: 'John',
            familyName: 'Doe',
          },
        },
      };

      const result = appleAuthSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('googleAuthSchema', () => {
    it('should require id token of minimum length', () => {
      const input = { idToken: 'short' };

      const result = googleAuthSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should accept valid token', () => {
      const input = {
        idToken: 'a'.repeat(100),
      };

      const result = googleAuthSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('refreshTokenSchema', () => {
    it('should require refresh token', () => {
      const input = {};

      const result = refreshTokenSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject short tokens', () => {
      const input = { refresh_token: 'short' };

      const result = refreshTokenSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should accept valid refresh token', () => {
      const input = { refresh_token: 'a'.repeat(50) };

      const result = refreshTokenSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  // ============================================
  // ENTITY & COMMITMENT SCHEMAS
  // ============================================

  describe('entityListSchema', () => {
    it('should accept empty query (list all)', () => {
      const input = {};

      const result = entityListSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept type filter', () => {
      const input = { type: 'person' as const };

      const result = entityListSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject invalid entity type', () => {
      const input = { type: 'invalid' };

      const result = entityListSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('commitmentListSchema', () => {
    it('should accept status filter', () => {
      const input = { status: 'pending' as const };

      const result = commitmentListSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should provide pagination defaults', () => {
      const input = {};

      const result = commitmentListSchema.parse(input);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
    });
  });

  // ============================================
  // LEARNING SCHEMAS (Cognitive Layer)
  // ============================================

  describe('learningListSchema', () => {
    it('should accept empty query (list all active)', () => {
      const input = {};

      const result = learningListSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should default status to active', () => {
      const input = {};

      const result = learningListSchema.parse(input);
      expect(result.status).toBe('active');
    });

    it('should accept valid category filter', () => {
      const categories = [
        'preference', 'habit', 'relationship', 'work_pattern',
        'health', 'interest', 'routine', 'communication',
        'decision_style', 'value', 'goal', 'skill', 'other',
      ] as const;

      for (const category of categories) {
        const input = { category };
        const result = learningListSchema.safeParse(input);
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid category', () => {
      const input = { category: 'invalid_category' };

      const result = learningListSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should accept valid status filter', () => {
      const statuses = ['active', 'invalidated', 'superseded', 'archived'] as const;

      for (const status of statuses) {
        const input = { status };
        const result = learningListSchema.safeParse(input);
        expect(result.success).toBe(true);
      }
    });

    it('should accept valid strength filter', () => {
      const strengths = ['weak', 'moderate', 'strong', 'definitive'] as const;

      for (const strength of strengths) {
        const input = { strength };
        const result = learningListSchema.safeParse(input);
        expect(result.success).toBe(true);
      }
    });

    it('should provide sensible pagination defaults', () => {
      const input = {};

      const result = learningListSchema.parse(input);
      expect(result.limit).toBe(50);
      expect(result.offset).toBe(0);
    });

    it('should reject limit over 100', () => {
      const input = { limit: 101 };

      const result = learningListSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('validateLearningSchema', () => {
    it('should accept valid validation (is_valid: true)', () => {
      const input = { is_valid: true };

      const result = validateLearningSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept valid invalidation (is_valid: false)', () => {
      const input = { is_valid: false };

      const result = validateLearningSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept optional correction', () => {
      const input = {
        is_valid: false,
        correction: 'Actually, I prefer evening meetings',
      };

      const result = validateLearningSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should accept optional notes', () => {
      const input = {
        is_valid: true,
        notes: 'This is correct for work meetings',
      };

      const result = validateLearningSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject correction over 2000 chars', () => {
      const input = {
        is_valid: false,
        correction: 'x'.repeat(2001),
      };

      const result = validateLearningSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should require is_valid field', () => {
      const input = { notes: 'some notes' };

      const result = validateLearningSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });
});
