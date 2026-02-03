/**
 * Zod Validation Schemas
 *
 * All request body/query/param validation schemas in one place.
 * Prevents injection attacks and ensures data integrity.
 */

import { z } from 'zod';

// ============================================
// MEMORY SCHEMAS
// ============================================

export const createMemorySchema = z.object({
  content: z.string().min(1, 'Content is required').max(50000, 'Content too long'),
  source: z.string().max(50).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  useAUDN: z.boolean().optional().default(true),
  containerTag: z.string().max(100).optional(),
});

export const updateMemorySchema = z.object({
  content: z.string().min(1).max(50000),
  relationType: z.enum(['updates', 'extends']).optional().default('updates'),
});

export const searchSchema = z.object({
  q: z.string().min(1, 'Query is required').max(1000),
  containerTag: z.string().max(100).optional(),
  limit: z.number().int().min(1).max(100).optional().default(10),
  searchMode: z.enum(['vector', 'keyword', 'hybrid']).optional().default('hybrid'),
  includeProfile: z.boolean().optional().default(true),
  rerank: z.boolean().optional().default(false),
});

export const recallSchema = z.object({
  q: z.string().min(1, 'Query is required').max(2000),
  containerTag: z.string().max(100).optional(),
  limit: z.number().int().min(1).max(50).optional().default(10),
  format: z.enum(['json', 'markdown']).optional().default('json'),
});

export const batchContextualSchema = z.object({
  content: z.string().min(1).max(100000),
  source: z.string().max(50).optional(),
  metadata: z.record(z.unknown()).optional(),
  sessionDate: z.string().optional(),
});

// ============================================
// AUTH SCHEMAS
// ============================================

export const appleAuthSchema = z.object({
  identityToken: z.string().min(50, 'Invalid identity token'),
  user: z.object({
    name: z.object({
      givenName: z.string().optional(),
      familyName: z.string().optional(),
    }).optional(),
  }).optional(),
});

export const googleAuthSchema = z.object({
  idToken: z.string().min(50, 'Invalid ID token'),
});

export const refreshTokenSchema = z.object({
  refresh_token: z.string().min(20, 'Invalid refresh token'),
});

// ============================================
// ENTITY SCHEMAS
// ============================================

export const entityListSchema = z.object({
  type: z.enum(['person', 'organization', 'location', 'event', 'concept', 'other']).optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
});

export const entitySearchSchema = z.object({
  query: z.string().min(1).max(200),
  type: z.enum(['person', 'organization', 'location', 'event', 'concept', 'other']).optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
});

// ============================================
// COMMITMENT SCHEMAS
// ============================================

export const commitmentListSchema = z.object({
  status: z.enum(['pending', 'completed', 'cancelled', 'overdue']).optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
});

export const updateCommitmentSchema = z.object({
  status: z.enum(['pending', 'completed', 'cancelled']),
  notes: z.string().max(2000).optional(),
});

// ============================================
// PROCESSING SCHEMAS
// ============================================

export const createProcessingJobSchema = z.object({
  memoryId: z.string().uuid('Invalid memory ID'),
});

export const processingJobListSchema = z.object({
  status: z.enum(['pending', 'processing', 'done', 'failed']).optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
});

// ============================================
// TEMPORAL SCHEMAS
// ============================================

export const timeTravelSchema = z.object({
  query: z.string().min(1).max(1000),
  asOfDate: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
});

export const memoryHistorySchema = z.object({
  memoryId: z.string().uuid('Invalid memory ID'),
});

// ============================================
// LEARNING SCHEMAS (Cognitive Layer)
// ============================================

const learningCategories = z.enum([
  'preference', 'habit', 'relationship', 'work_pattern',
  'health', 'interest', 'routine', 'communication',
  'decision_style', 'value', 'goal', 'skill', 'other',
]);

const learningStatuses = z.enum(['active', 'invalidated', 'superseded', 'archived']);

const learningStrengths = z.enum(['weak', 'moderate', 'strong', 'definitive']);

export const learningListSchema = z.object({
  category: learningCategories.optional(),
  status: learningStatuses.optional().default('active'),
  strength: learningStrengths.optional(),
  limit: z.number().int().min(1).max(100).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});

export const validateLearningSchema = z.object({
  is_valid: z.boolean(),
  correction: z.string().max(2000).optional(),
  notes: z.string().max(2000).optional(),
});

// ============================================
// PAGINATION SCHEMA (reusable)
// ============================================

export const paginationSchema = z.object({
  limit: z.number().int().min(1).max(100).optional().default(20),
  offset: z.number().int().min(0).optional().default(0),
});

// ============================================
// ID PARAMETER SCHEMA
// ============================================

export const idParamSchema = z.object({
  id: z.string().uuid('Invalid ID format'),
});

// ============================================
// TYPE EXPORTS
// ============================================

export type CreateMemoryInput = z.infer<typeof createMemorySchema>;
export type UpdateMemoryInput = z.infer<typeof updateMemorySchema>;
export type SearchInput = z.infer<typeof searchSchema>;
export type RecallInput = z.infer<typeof recallSchema>;
export type AppleAuthInput = z.infer<typeof appleAuthSchema>;
export type GoogleAuthInput = z.infer<typeof googleAuthSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type EntityListInput = z.infer<typeof entityListSchema>;
export type CommitmentListInput = z.infer<typeof commitmentListSchema>;
export type UpdateCommitmentInput = z.infer<typeof updateCommitmentSchema>;
export type TimeTravelInput = z.infer<typeof timeTravelSchema>;
export type PaginationInput = z.infer<typeof paginationSchema>;
export type LearningListInput = z.infer<typeof learningListSchema>;
export type ValidateLearningInput = z.infer<typeof validateLearningSchema>;
