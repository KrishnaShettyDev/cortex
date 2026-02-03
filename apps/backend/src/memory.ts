/**
 * Memory management utilities
 * Handles CRUD operations, embeddings, and vector storage
 */

interface MemoryCreateInput {
  content: string;
  source?: string; // 'chat', 'email', 'calendar', 'manual'
  metadata?: {
    entities?: string[];
    location_lat?: number;
    location_lon?: number;
    location_name?: string;
    people?: string[];
    tags?: string[];
    timestamp?: string;
  };
}

interface Memory {
  id: string;
  user_id: string;
  content: string;
  source: string | null;
  created_at: string;
  updated_at: string;
  metadata?: {
    entities?: string[];
    location_lat?: number;
    location_lon?: number;
    location_name?: string;
    people?: string[];
    tags?: string[];
    timestamp?: string;
  };
}

/**
 * Generate embeddings using OpenAI
 */
export async function generateEmbedding(
  text: string,
  apiKey: string
): Promise<number[]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${error}`);
  }

  const data = (await response.json()) as {
    data: Array<{ embedding: number[] }>;
  };
  return data.data[0].embedding;
}

/**
 * Create a new memory
 */
export async function createMemory(
  db: D1Database,
  vectorize: Vectorize,
  userId: string,
  input: MemoryCreateInput,
  openaiKey: string
): Promise<Memory> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  // Validate content
  if (!input.content || input.content.trim().length === 0) {
    throw new Error('Memory content cannot be empty');
  }

  if (input.content.length > 50000) {
    throw new Error('Memory content too long (max 50,000 characters)');
  }

  // Generate embedding
  const embedding = await generateEmbedding(input.content, openaiKey);

  // Insert into D1
  await db
    .prepare(
      'INSERT INTO memories (id, user_id, content, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .bind(
      id,
      userId,
      input.content,
      input.source || 'manual',
      now,
      now
    )
    .run();

  // Insert metadata if provided
  if (input.metadata) {
    await db
      .prepare(
        `INSERT INTO memory_metadata (
          memory_id, entities, location_lat, location_lon,
          location_name, people, tags, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        input.metadata.entities ? JSON.stringify(input.metadata.entities) : null,
        input.metadata.location_lat || null,
        input.metadata.location_lon || null,
        input.metadata.location_name || null,
        input.metadata.people ? JSON.stringify(input.metadata.people) : null,
        input.metadata.tags ? JSON.stringify(input.metadata.tags) : null,
        input.metadata.timestamp || null
      )
      .run();
  }

  // Store embedding in Vectorize
  await vectorize.insert([
    {
      id: id,
      values: embedding,
      metadata: {
        user_id: userId,
        content: input.content.substring(0, 1000), // Store preview
        source: input.source || 'manual',
        created_at: now,
      },
    },
  ]);

  return {
    id,
    user_id: userId,
    content: input.content,
    source: input.source || 'manual',
    created_at: now,
    updated_at: now,
    metadata: input.metadata,
  };
}

/**
 * Get a single memory by ID
 */
export async function getMemory(
  db: D1Database,
  memoryId: string,
  userId: string
): Promise<Memory | null> {
  // Get memory
  const memory = await db
    .prepare(
      'SELECT * FROM memories WHERE id = ? AND user_id = ?'
    )
    .bind(memoryId, userId)
    .first();

  if (!memory) {
    return null;
  }

  // Get metadata
  const metadata = await db
    .prepare('SELECT * FROM memory_metadata WHERE memory_id = ?')
    .bind(memoryId)
    .first();

  return {
    id: memory.id as string,
    user_id: memory.user_id as string,
    content: memory.content as string,
    source: memory.source as string | null,
    created_at: memory.created_at as string,
    updated_at: memory.updated_at as string,
    metadata: metadata
      ? {
          entities: metadata.entities
            ? JSON.parse(metadata.entities as string)
            : undefined,
          location_lat: metadata.location_lat as number | undefined,
          location_lon: metadata.location_lon as number | undefined,
          location_name: metadata.location_name as string | undefined,
          people: metadata.people
            ? JSON.parse(metadata.people as string)
            : undefined,
          tags: metadata.tags ? JSON.parse(metadata.tags as string) : undefined,
          timestamp: metadata.timestamp as string | undefined,
        }
      : undefined,
  };
}

/**
 * Get memories with pagination
 */
export async function getMemories(
  db: D1Database,
  userId: string,
  options: {
    limit?: number;
    offset?: number;
    source?: string;
  } = {}
): Promise<{ memories: Memory[]; total: number }> {
  const limit = Math.min(options.limit || 50, 100); // Max 100
  const offset = options.offset || 0;

  // Build query
  let query = 'SELECT * FROM memories WHERE user_id = ?';
  const bindings: any[] = [userId];

  if (options.source) {
    query += ' AND source = ?';
    bindings.push(options.source);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  bindings.push(limit, offset);

  // Get memories
  const { results } = await db.prepare(query).bind(...bindings).all();

  // Get total count
  let countQuery = 'SELECT COUNT(*) as count FROM memories WHERE user_id = ?';
  const countBindings: any[] = [userId];

  if (options.source) {
    countQuery += ' AND source = ?';
    countBindings.push(options.source);
  }

  const countResult = await db
    .prepare(countQuery)
    .bind(...countBindings)
    .first();

  // Get metadata for all memories
  const memories = await Promise.all(
    results.map(async (memory) => {
      const metadata = await db
        .prepare('SELECT * FROM memory_metadata WHERE memory_id = ?')
        .bind(memory.id as string)
        .first();

      return {
        id: memory.id as string,
        user_id: memory.user_id as string,
        content: memory.content as string,
        source: memory.source as string | null,
        created_at: memory.created_at as string,
        updated_at: memory.updated_at as string,
        metadata: metadata
          ? {
              entities: metadata.entities
                ? JSON.parse(metadata.entities as string)
                : undefined,
              location_lat: metadata.location_lat as number | undefined,
              location_lon: metadata.location_lon as number | undefined,
              location_name: metadata.location_name as string | undefined,
              people: metadata.people
                ? JSON.parse(metadata.people as string)
                : undefined,
              tags: metadata.tags
                ? JSON.parse(metadata.tags as string)
                : undefined,
              timestamp: metadata.timestamp as string | undefined,
            }
          : undefined,
      };
    })
  );

  return {
    memories,
    total: (countResult?.count as number) || 0,
  };
}

/**
 * Update a memory
 */
export async function updateMemory(
  db: D1Database,
  vectorize: Vectorize,
  memoryId: string,
  userId: string,
  updates: Partial<MemoryCreateInput>,
  openaiKey: string
): Promise<Memory> {
  // Check if memory exists
  const existing = await getMemory(db, memoryId, userId);
  if (!existing) {
    throw new Error('Memory not found');
  }

  const now = new Date().toISOString();

  // Update content if provided
  if (updates.content !== undefined) {
    if (updates.content.trim().length === 0) {
      throw new Error('Memory content cannot be empty');
    }

    if (updates.content.length > 50000) {
      throw new Error('Memory content too long (max 50,000 characters)');
    }

    // Generate new embedding
    const embedding = await generateEmbedding(updates.content, openaiKey);

    // Update in D1
    await db
      .prepare('UPDATE memories SET content = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .bind(updates.content, now, memoryId, userId)
      .run();

    // Update in Vectorize
    await vectorize.upsert([
      {
        id: memoryId,
        values: embedding,
        metadata: {
          user_id: userId,
          content: updates.content.substring(0, 1000),
          source: updates.source || existing.source || 'manual',
          created_at: existing.created_at,
        },
      },
    ]);
  }

  // Update source if provided
  if (updates.source !== undefined) {
    await db
      .prepare('UPDATE memories SET source = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .bind(updates.source, now, memoryId, userId)
      .run();
  }

  // Update metadata if provided
  if (updates.metadata !== undefined) {
    // Delete existing metadata
    await db
      .prepare('DELETE FROM memory_metadata WHERE memory_id = ?')
      .bind(memoryId)
      .run();

    // Insert new metadata
    await db
      .prepare(
        `INSERT INTO memory_metadata (
          memory_id, entities, location_lat, location_lon,
          location_name, people, tags, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        memoryId,
        updates.metadata.entities ? JSON.stringify(updates.metadata.entities) : null,
        updates.metadata.location_lat || null,
        updates.metadata.location_lon || null,
        updates.metadata.location_name || null,
        updates.metadata.people ? JSON.stringify(updates.metadata.people) : null,
        updates.metadata.tags ? JSON.stringify(updates.metadata.tags) : null,
        updates.metadata.timestamp || null
      )
      .run();
  }

  // Return updated memory
  return (await getMemory(db, memoryId, userId))!;
}

/**
 * Delete a memory
 */
export async function deleteMemory(
  db: D1Database,
  vectorize: Vectorize,
  memoryId: string,
  userId: string
): Promise<void> {
  // Check if memory exists
  const existing = await getMemory(db, memoryId, userId);
  if (!existing) {
    throw new Error('Memory not found');
  }

  // Delete from D1 (cascade will delete metadata)
  await db
    .prepare('DELETE FROM memories WHERE id = ? AND user_id = ?')
    .bind(memoryId, userId)
    .run();

  // Delete from Vectorize
  await vectorize.deleteByIds([memoryId]);
}

/**
 * Search memories using vector similarity
 */
export async function searchMemories(
  db: D1Database,
  vectorize: Vectorize,
  userId: string,
  query: string,
  openaiKey: string,
  options: {
    limit?: number;
    source?: string;
  } = {}
): Promise<Memory[]> {
  const limit = Math.min(options.limit || 10, 50); // Max 50

  // Generate query embedding
  const queryEmbedding = await generateEmbedding(query, openaiKey);

  // Search in Vectorize with user filter
  // SECURITY: Always filter by user_id at the vectorize level to prevent data leakage
  const filter: Record<string, any> = { user_id: userId };
  if (options.source) {
    filter.source = options.source;
  }

  const results = await vectorize.query(queryEmbedding, {
    topK: limit * 2, // Get more than needed for filtering
    filter,
    returnMetadata: 'all',
  });

  // Additional filtering (safety net)
  const filtered = results.matches.filter((match) => {
    // Double-check user_id in case filter wasn't applied
    if (match.metadata?.user_id !== userId) return false;
    return true;
  });

  // Get full memory details from D1
  const memories = await Promise.all(
    filtered.slice(0, limit).map(async (match) => {
      return await getMemory(db, match.id, userId);
    })
  );

  // Filter out nulls
  return memories.filter((m) => m !== null) as Memory[];
}
