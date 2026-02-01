/**
 * Profile & Fact Extraction Service
 *
 * Core intelligence for memory layer:
 * - Extract user facts from memories
 * - Classify static vs dynamic facts
 * - Detect memory relationships (updates, extends, derives)
 * - Assign confidence scores
 */

import type { Memory } from './db/memories';
import { upsertProfileFact, type UserProfile } from './db/profiles';
import { createMemoryRelation } from './db/memories';
import { vectorSearch, generateEmbedding } from './vectorize';

export interface ExtractedFact {
  fact: string;
  type: 'static' | 'dynamic';
  confidence: number;
}

/**
 * Extract user facts from memory content using LLM
 */
export async function extractFactsFromMemory(
  env: { AI: any },
  memoryContent: string,
  userId: string
): Promise<ExtractedFact[]> {
  const prompt = `Analyze the following user memory and extract facts about the user.

Memory: "${memoryContent}"

Extract:
1. Static facts (stable preferences, role, expertise, personality traits)
2. Dynamic facts (current projects, recent activities, temporary states)

Format as JSON array:
[
  {"fact": "User is a software engineer", "type": "static", "confidence": 0.9},
  {"fact": "User is working on Q4 budget", "type": "dynamic", "confidence": 0.8}
]

Rules:
- Only extract facts directly supported by the memory
- Confidence: 0.9-1.0 = explicit, 0.7-0.8 = implicit, 0.5-0.6 = inferred
- Skip generic facts like "User exists"
- Be concise, specific, and accurate

Output JSON only, no explanation:`;

  try {
    const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
    });

    const text = response.response || '';

    // Extract JSON from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return [];
    }

    const facts = JSON.parse(jsonMatch[0]) as ExtractedFact[];

    // Validate and filter
    return facts.filter(
      (f) =>
        f.fact &&
        f.fact.length > 5 &&
        f.fact.length < 200 &&
        (f.type === 'static' || f.type === 'dynamic') &&
        f.confidence >= 0.5 &&
        f.confidence <= 1.0
    );
  } catch (error) {
    console.error('Fact extraction failed:', error);
    return [];
  }
}

/**
 * Detect relationships between new memory and existing memories
 */
export async function detectMemoryRelationships(
  env: { DB: D1Database; VECTORIZE: Vectorize; AI: any },
  newMemory: Memory,
  userId: string
): Promise<
  Array<{
    relatedMemoryId: string;
    relationType: 'updates' | 'extends' | 'derives';
    confidence: number;
  }>
> {
  // 1. Find similar memories via vector search
  const embedding = await generateEmbedding(env, newMemory.content);
  const similarMemories = await vectorSearch(env.VECTORIZE, embedding, userId, {
    containerTag: newMemory.container_tag,
    topK: 5,
    minScore: 0.75,
    type: 'memory',
  });

  if (similarMemories.length === 0) {
    return [];
  }

  // 2. Use LLM to classify relationships
  const relationships: Array<{
    relatedMemoryId: string;
    relationType: 'updates' | 'extends' | 'derives';
    confidence: number;
  }> = [];

  for (const similar of similarMemories) {
    const relationType = await classifyRelationship(
      env,
      newMemory.content,
      similar.metadata.content
    );

    if (relationType) {
      relationships.push({
        relatedMemoryId: similar.id,
        relationType,
        confidence: similar.score,
      });
    }
  }

  return relationships;
}

/**
 * Classify relationship between two memories
 */
async function classifyRelationship(
  env: { AI: any },
  newMemoryContent: string,
  existingMemoryContent: string
): Promise<'updates' | 'extends' | 'derives' | null> {
  const prompt = `Analyze the relationship between these two memories:

New Memory: "${newMemoryContent}"
Existing Memory: "${existingMemoryContent}"

Classify the relationship:
- "updates": New memory contradicts or replaces the existing one (e.g., preference changed)
- "extends": New memory adds details to the existing one (e.g., more context)
- "derives": New memory is inferred from the existing one (e.g., pattern detected)
- "none": No meaningful relationship

Output ONLY one word: updates, extends, derives, or none`;

  try {
    const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 10,
    });

    const text = (response.response || '').toLowerCase().trim();

    if (text.includes('updates')) return 'updates';
    if (text.includes('extends')) return 'extends';
    if (text.includes('derives')) return 'derives';
    return null;
  } catch (error) {
    console.error('Relationship classification failed:', error);
    return null;
  }
}

/**
 * Process new memory: extract facts + detect relationships
 */
export async function processNewMemory(
  env: { DB: D1Database; VECTORIZE: Vectorize; AI: any },
  memory: Memory
): Promise<{
  factsExtracted: number;
  relationshipsCreated: number;
}> {
  const startTime = Date.now();

  // 1. Extract facts
  const facts = await extractFactsFromMemory(env, memory.content, memory.user_id);

  // 2. Store facts as profile entries
  for (const fact of facts) {
    await upsertProfileFact(env.DB, {
      userId: memory.user_id,
      profileType: fact.type,
      fact: fact.fact,
      confidence: fact.confidence,
      containerTag: memory.container_tag,
      sourceMemoryIds: [memory.id],
    });
  }

  // 3. Detect relationships with existing memories
  const relationships = await detectMemoryRelationships(
    env,
    memory,
    memory.user_id
  );

  // 4. Create relationship records
  for (const rel of relationships) {
    await createMemoryRelation(
      env.DB,
      memory.id,
      rel.relatedMemoryId,
      rel.relationType
    );
  }

  const duration = Date.now() - startTime;
  console.log(
    `Processed memory ${memory.id} in ${duration}ms: ${facts.length} facts, ${relationships.length} relationships`
  );

  return {
    factsExtracted: facts.length,
    relationshipsCreated: relationships.length,
  };
}

/**
 * Batch process multiple memories (for backfilling profiles)
 */
export async function batchProcessMemories(
  env: { DB: D1Database; VECTORIZE: Vectorize; AI: any },
  memories: Memory[]
): Promise<void> {
  console.log(`Batch processing ${memories.length} memories...`);

  for (const memory of memories) {
    try {
      await processNewMemory(env, memory);
    } catch (error) {
      console.error(`Failed to process memory ${memory.id}:`, error);
    }
  }

  console.log('Batch processing complete');
}
