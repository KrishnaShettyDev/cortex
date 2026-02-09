/**
 * Reranking Layer - Boost Search Accuracy
 *
 * After vector search, use LLM to rerank results for better precision.
 *
 * Approach:
 * 1. Get top-K*2 results from vector search (e.g., top 20)
 * 2. Use fast LLM (Claude Haiku or GPT-4o-mini) to score each result
 * 3. Return top-K after reranking (e.g., top 10)
 *
 * Performance target:
 * - Accuracy boost: +15% precision
 * - Latency: <200ms added
 * - Cost: $0.0001 per query (cheaper than Cohere API)
 */

export interface RerankCandidate {
  id: string;
  content: string;
  score: number; // Original vector score
  type: 'memory' | 'chunk';
}

export interface RerankResult {
  id: string;
  content: string;
  vector_score: number; // Original score
  rerank_score: number; // LLM-based score
  final_score: number; // Combined score
  type: 'memory' | 'chunk';
}

export interface RerankOptions {
  query: string;
  candidates: RerankCandidate[];
  topK: number; // How many to return after reranking
  model?: 'gpt-4o-mini' | 'llama'; // Default: gpt-4o-mini
}

/**
 * Rerank search results using LLM
 */
export async function rerankResults(
  env: { AI: any; OPENAI_API_KEY?: string },
  options: RerankOptions
): Promise<RerankResult[]> {
  const { query, candidates, topK, model = 'gpt-4o-mini' } = options;

  if (candidates.length === 0) {
    return [];
  }

  // If we have fewer candidates than topK, no need to rerank
  if (candidates.length <= topK) {
    return candidates.map((c) => ({
      ...c,
      vector_score: c.score,
      rerank_score: c.score,
      final_score: c.score,
    }));
  }

  // Call LLM to score each candidate
  const scores = await callRerankModel(env, query, candidates, model);

  // Combine vector and rerank scores (70% rerank, 30% vector)
  const reranked = candidates.map((candidate, index) => ({
    id: candidate.id,
    content: candidate.content,
    type: candidate.type,
    vector_score: candidate.score,
    rerank_score: scores[index],
    final_score: scores[index] * 0.7 + candidate.score * 0.3,
  }));

  // Sort by final score and return top-K
  reranked.sort((a, b) => b.final_score - a.final_score);

  return reranked.slice(0, topK);
}

/**
 * Call LLM to score relevance of each candidate
 * Uses OpenAI API directly for reliable JSON output
 */
async function callRerankModel(
  env: { AI: any; OPENAI_API_KEY?: string },
  query: string,
  candidates: RerankCandidate[],
  model: 'gpt-4o-mini' | 'llama'
): Promise<number[]> {
  const prompt = buildRerankPrompt(query, candidates);

  // Use OpenAI API for reliable reranking
  if (env.OPENAI_API_KEY && model === 'gpt-4o-mini') {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: RERANK_SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
          temperature: 0.0,
          max_tokens: 500,
          response_format: { type: 'json_object' },
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('[Rerank] OpenAI API error:', error);
        throw new Error(`OpenAI API failed: ${response.status}`);
      }

      const data = await response.json() as any;
      const content = data.choices?.[0]?.message?.content || '{}';
      const parsed = JSON.parse(content);

      if (parsed.scores && Array.isArray(parsed.scores)) {
        return parsed.scores;
      }
    } catch (error) {
      console.error('[Rerank] OpenAI call failed, falling back to Llama:', error);
      // Fall through to Llama fallback
    }
  }

  // Fallback to Cloudflare Workers AI (Llama)
  try {
    const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: RERANK_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0.0,
      max_tokens: 500,
    });

    const text = response.response || '';

    // Try to extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.scores && Array.isArray(parsed.scores)) {
        return parsed.scores;
      }
    }
  } catch (error) {
    console.error('[Rerank] Llama call failed:', error);
  }

  // Fallback to original vector scores
  console.warn('[Rerank] All reranking attempts failed, using original scores');
  return candidates.map((c) => c.score);
}

/**
 * Build prompt for reranking
 */
function buildRerankPrompt(
  query: string,
  candidates: RerankCandidate[]
): string {
  const candidatesText = candidates
    .map(
      (c, i) =>
        `${i}. [Vector Score: ${c.score.toFixed(3)}]\n   "${c.content.slice(0, 200)}${c.content.length > 200 ? '...' : ''}"`
    )
    .join('\n\n');

  return `
QUERY:
"${query}"

CANDIDATES:
${candidatesText}

Score each candidate's relevance to the query from 0.0 (not relevant) to 1.0 (highly relevant).

Consider:
- Semantic similarity
- Topic match
- Completeness of answer
- Recency (if mentioned in content)

Return ONLY valid JSON:
{
  "scores": [0.9, 0.7, 0.5, ...]
}

Array must have exactly ${candidates.length} scores, one per candidate.
`.trim();
}

/**
 * System prompt for reranking model
 */
const RERANK_SYSTEM_PROMPT = `You are a search relevance scoring AI.

Your job is to score how relevant each search result is to the user's query.

Key principles:
1. Higher score = more relevant to query
2. Consider semantic meaning, not just keyword overlap
3. Completeness matters - partial matches get lower scores
4. Recent/updated information is preferred when relevant

Return only valid JSON. No additional text.`;

/**
 * Rerank with batch processing for large result sets
 */
export async function rerankBatched(
  env: { AI: any; OPENAI_API_KEY?: string },
  options: RerankOptions
): Promise<RerankResult[]> {
  const { candidates } = options;
  const BATCH_SIZE = 20; // Process 20 at a time

  if (candidates.length <= BATCH_SIZE) {
    return rerankResults(env, options);
  }

  // Split into batches
  const batches: RerankCandidate[][] = [];
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    batches.push(candidates.slice(i, i + BATCH_SIZE));
  }

  // Process each batch
  const batchResults = await Promise.all(
    batches.map((batch) =>
      rerankResults(env, {
        ...options,
        candidates: batch,
        topK: Math.ceil(options.topK / batches.length),
      })
    )
  );

  // Combine and re-sort
  const combined = batchResults.flat();
  combined.sort((a, b) => b.final_score - a.final_score);

  return combined.slice(0, options.topK);
}
