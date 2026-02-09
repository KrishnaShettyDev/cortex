/**
 * Contextual Memory Extractor
 *
 * Extracts standalone facts from conversations with resolved pronouns.
 * Based on Supermemory's approach: convert raw conversations into searchable facts.
 */

interface Message {
  role: 'user' | 'assistant';
  content: string;
  speaker?: string;
}

interface ContextualMemory {
  fact: string;
  confidence: number;
  entities: string[];
}

/**
 * Retry wrapper for OpenAI API calls with exponential backoff
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3
): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      // If rate limited, wait and retry
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('retry-after') || '5');
        const waitTime = Math.min(retryAfter * 1000, 2 ** attempt * 1000);
        console.log(`[ContextualMemory] Rate limited, waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        continue;
      }

      return response;
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      const waitTime = 2 ** attempt * 1000;
      console.log(`[ContextualMemory] Request failed, waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }

  throw new Error('Max retries exceeded');
}

/**
 * Extract contextual memories from a conversation session
 *
 * Input: Raw conversation with pronouns
 * Output: Standalone facts with resolved entities
 *
 * Example:
 *   Input: "She went to the LGBTQ center on May 7th"
 *   Output: "Caroline went to the LGBTQ support center on May 7, 2023"
 */
export async function extractContextualMemories(
  env: { AI: any; OPENAI_API_KEY?: string },
  messages: Message[],
  sessionDate?: string
): Promise<ContextualMemory[]> {
  // Build conversation context
  const conversationText = messages
    .map((m) => `${m.speaker || m.role}: ${m.content}`)
    .join('\n');

  // Prompt for extraction
  const prompt = `Extract individual facts from this conversation. Resolve all pronouns to actual names.

Conversation:
${conversationText}

${sessionDate ? `Date context: This conversation took place on ${sessionDate}` : ''}

Extract facts as standalone statements that would make sense without the conversation context.

Rules:
1. Replace pronouns (she/he/they) with actual names
2. Include dates and time references when mentioned
3. Each fact should be one clear statement
4. Only extract verifiable facts, not opinions
5. Include entity names (people, places) in each fact

Output JSON format:
{
  "memories": [
    {
      "fact": "standalone fact with resolved entities",
      "confidence": 0.0-1.0,
      "entities": ["Entity1", "Entity2"]
    }
  ]
}

Output only valid JSON, no explanation.`;

  try {
    let text: string;

    // Use OpenAI GPT-4o-mini if available (better extraction quality)
    if (env.OPENAI_API_KEY) {
      const response = await fetchWithRetry('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content:
                'You are a fact extraction expert. Extract standalone facts with resolved pronouns. Output only valid JSON.',
            },
            { role: 'user', content: prompt },
          ],
          max_tokens: 1500,
          temperature: 0.1,
          response_format: { type: 'json_object' },
        }),
      });

      if (!response.ok) {
        console.error('[ContextualMemory] OpenAI API error:', await response.text());
        throw new Error('OpenAI API failed');
      }

      const data = await response.json();
      text = data.choices[0]?.message?.content || '';

      // Parse structured JSON output
      try {
        const parsed = JSON.parse(text);
        const memories: ContextualMemory[] = parsed.memories || [];
        return memories.filter((m) => m.confidence >= 0.6);
      } catch (error) {
        console.error('[ContextualMemory] Failed to parse OpenAI response:', error);
        return [];
      }
    } else {
      // Fallback to Cloudflare AI (Llama)
      const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          {
            role: 'system',
            content:
              'You are a fact extraction expert. Extract standalone facts with resolved pronouns. Output only valid JSON.',
          },
          { role: 'user', content: prompt },
        ],
        max_tokens: 1000,
      });
      text = response.response || '';

      // Try to extract JSON from response (handle multiple formats)
      // Format 1: {"memories": [...]} - expected format from prompt
      let jsonMatch = text.match(/\{\s*"memories"\s*:\s*\[[\s\S]*?\]\s*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          const memories: ContextualMemory[] = parsed.memories || [];
          return memories.filter((m) => m.confidence >= 0.6);
        } catch (error) {
          console.error('[ContextualMemory] Failed to parse object format:', error);
        }
      }

      // Format 2: [...] - bare array (LLM sometimes returns this)
      jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          const memories: ContextualMemory[] = JSON.parse(jsonMatch[0]);
          return memories.filter((m) => m.confidence >= 0.6);
        } catch (error) {
          console.error('[ContextualMemory] Failed to parse array format:', error);
        }
      }

      console.error('[ContextualMemory] No valid JSON found in Llama response:', text.substring(0, 500));
      return [];
    }
  } catch (error) {
    console.error('[ContextualMemory] Extraction failed:', error);
    return [];
  }
}

/**
 * Check if content is raw conversation JSON (needs extraction)
 */
export function isRawConversation(content: string): boolean {
  return (
    content.includes('stringified JSON') ||
    content.includes('[{"role"') ||
    content.includes('Here is the session')
  );
}
