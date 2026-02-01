/**
 * User Profile Database Operations
 *
 * Auto-extracted facts about users:
 * - Static facts (stable preferences, role, expertise)
 * - Dynamic facts (current projects, recent activities)
 * - Confidence scores
 * - Source tracking
 */

import { nanoid } from 'nanoid';

export interface UserProfile {
  id: string;
  user_id: string;
  profile_type: 'static' | 'dynamic';
  fact: string;
  confidence: number; // 0.0 to 1.0
  container_tag: string;
  source_memory_ids: string | null; // JSON array of memory IDs
  created_at: string;
  updated_at: string;
}

export interface CreateProfileFactOptions {
  userId: string;
  profileType: 'static' | 'dynamic';
  fact: string;
  confidence?: number;
  containerTag?: string;
  sourceMemoryIds?: string[];
}

/**
 * Create a profile fact
 */
export async function createProfileFact(
  db: D1Database,
  options: CreateProfileFactOptions
): Promise<UserProfile> {
  const id = nanoid();
  const now = new Date().toISOString();

  const profile: UserProfile = {
    id,
    user_id: options.userId,
    profile_type: options.profileType,
    fact: options.fact,
    confidence: options.confidence || 0.5,
    container_tag: options.containerTag || 'default',
    source_memory_ids: options.sourceMemoryIds
      ? JSON.stringify(options.sourceMemoryIds)
      : null,
    created_at: now,
    updated_at: now,
  };

  await db
    .prepare(
      `INSERT INTO user_profiles (id, user_id, profile_type, fact, confidence, container_tag, source_memory_ids, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      profile.id,
      profile.user_id,
      profile.profile_type,
      profile.fact,
      profile.confidence,
      profile.container_tag,
      profile.source_memory_ids,
      profile.created_at,
      profile.updated_at
    )
    .run();

  return profile;
}

/**
 * Get user profile (static + dynamic facts)
 */
export async function getUserProfile(
  db: D1Database,
  userId: string,
  options?: {
    containerTag?: string;
    profileType?: 'static' | 'dynamic';
    minConfidence?: number;
  }
): Promise<UserProfile[]> {
  let query = 'SELECT * FROM user_profiles WHERE user_id = ?';
  const params: any[] = [userId];

  if (options?.containerTag) {
    query += ' AND container_tag = ?';
    params.push(options.containerTag);
  }

  if (options?.profileType) {
    query += ' AND profile_type = ?';
    params.push(options.profileType);
  }

  if (options?.minConfidence !== undefined) {
    query += ' AND confidence >= ?';
    params.push(options.minConfidence);
  }

  query += ' ORDER BY confidence DESC, created_at DESC';

  const result = await db.prepare(query).bind(...params).all<UserProfile>();
  return result.results || [];
}

/**
 * Update profile fact confidence
 */
export async function updateProfileConfidence(
  db: D1Database,
  profileId: string,
  newConfidence: number
): Promise<void> {
  const now = new Date().toISOString();

  await db
    .prepare('UPDATE user_profiles SET confidence = ?, updated_at = ? WHERE id = ?')
    .bind(newConfidence, now, profileId)
    .run();
}

/**
 * Delete profile fact
 */
export async function deleteProfileFact(
  db: D1Database,
  profileId: string
): Promise<void> {
  await db.prepare('DELETE FROM user_profiles WHERE id = ?').bind(profileId).run();
}

/**
 * Check if similar fact already exists
 */
export async function findSimilarProfileFact(
  db: D1Database,
  userId: string,
  fact: string,
  profileType: 'static' | 'dynamic',
  containerTag?: string
): Promise<UserProfile | null> {
  let query = `
    SELECT * FROM user_profiles
    WHERE user_id = ?
      AND profile_type = ?
      AND fact LIKE ?
  `;
  const params: any[] = [userId, profileType, `%${fact}%`];

  if (containerTag) {
    query += ' AND container_tag = ?';
    params.push(containerTag);
  }

  query += ' LIMIT 1';

  const result = await db.prepare(query).bind(...params).first<UserProfile>();
  return result;
}

/**
 * Upsert profile fact (update if exists, create if not)
 */
export async function upsertProfileFact(
  db: D1Database,
  options: CreateProfileFactOptions
): Promise<UserProfile> {
  // Check if similar fact exists
  const existing = await findSimilarProfileFact(
    db,
    options.userId,
    options.fact,
    options.profileType,
    options.containerTag
  );

  if (existing) {
    // Update confidence and source memory IDs
    const now = new Date().toISOString();
    const newConfidence = Math.max(existing.confidence, options.confidence || 0.5);

    // Merge source memory IDs
    const existingSourceIds = existing.source_memory_ids
      ? JSON.parse(existing.source_memory_ids)
      : [];
    const newSourceIds = options.sourceMemoryIds || [];
    const mergedSourceIds = Array.from(
      new Set([...existingSourceIds, ...newSourceIds])
    );

    await db
      .prepare(
        `UPDATE user_profiles
         SET confidence = ?, source_memory_ids = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(
        newConfidence,
        JSON.stringify(mergedSourceIds),
        now,
        existing.id
      )
      .run();

    return {
      ...existing,
      confidence: newConfidence,
      source_memory_ids: JSON.stringify(mergedSourceIds),
      updated_at: now,
    };
  } else {
    // Create new profile fact
    return createProfileFact(db, options);
  }
}

import { getCachedProfile, cacheProfile } from '../cache';

/**
 * Get formatted profile for context injection (with caching)
 */
export async function getFormattedProfile(
  db: D1Database,
  userId: string,
  containerTag?: string,
  cache?: KVNamespace
): Promise<{ static: string[]; dynamic: string[] }> {
  const tag = containerTag || 'default';

  // Check cache if available
  if (cache) {
    const cached = await getCachedProfile(cache, userId, tag);
    if (cached) {
      console.log('[Cache] Profile cache hit');
      return cached;
    }
    console.log('[Cache] Profile cache miss, querying DB...');
  }

  // Cache miss or no cache - query database
  const profiles = await getUserProfile(db, userId, {
    containerTag,
    minConfidence: 0.6, // Only high-confidence facts
  });

  const staticFacts = profiles
    .filter((p) => p.profile_type === 'static')
    .map((p) => p.fact);

  const dynamicFacts = profiles
    .filter((p) => p.profile_type === 'dynamic')
    .map((p) => p.fact);

  const result = { static: staticFacts, dynamic: dynamicFacts };

  // Cache the result
  if (cache) {
    await cacheProfile(cache, userId, tag, result);
  }

  return result;
}
