/**
 * Personality Learning Module
 *
 * Automatically learns user communication preferences from their messages.
 * This is the PRIMARY mechanism for personalization - no manual config needed.
 */

export interface LearnedPreferences {
  detected_verbosity: 'brief' | 'medium' | 'detailed';
  detected_emoji_usage: 'none' | 'minimal' | 'moderate' | 'frequent';
  detected_tone_hint: 'professional' | 'casual' | 'balanced';
  detected_name?: string;
  message_count: number;
  last_analyzed: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Analyze messages and learn user preferences
 * Called after each chat session to gradually adapt
 */
export async function learnFromConversation(
  db: D1Database,
  userId: string,
  messages: Message[]
): Promise<LearnedPreferences | null> {
  const userMessages = messages.filter((m) => m.role === 'user');

  // Need enough data to learn (at least 3 user messages)
  if (userMessages.length < 3) {
    return null;
  }

  const allUserText = userMessages.map((m) => m.content).join(' ');

  // Signal 1: Message length preference
  const avgUserLength =
    userMessages.reduce((sum, m) => sum + m.content.length, 0) / userMessages.length;
  const verbosity: LearnedPreferences['detected_verbosity'] =
    avgUserLength < 50 ? 'brief' : avgUserLength > 200 ? 'detailed' : 'medium';

  // Signal 2: Emoji usage
  // Broader emoji range: emoticons + symbols + misc
  const emojiMatches = allUserText.match(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu) || [];
  const emojiFreq = emojiMatches.length / userMessages.length;
  const emojiUsage: LearnedPreferences['detected_emoji_usage'] =
    emojiFreq === 0 ? 'none' : emojiFreq < 0.3 ? 'minimal' : emojiFreq < 1 ? 'moderate' : 'frequent';

  // Signal 3: Formality detection (simple heuristics)
  const casualIndicators = (
    allUserText.match(/\b(hey|yeah|cool|awesome|lol|haha|gonna|wanna|yep|nope|btw|omg)\b/gi) || []
  ).length;
  const formalIndicators = (
    allUserText.match(
      /\b(please|kindly|would you|could you|thank you|regards|sincerely|appreciate)\b/gi
    ) || []
  ).length;
  const toneHint: LearnedPreferences['detected_tone_hint'] =
    casualIndicators > formalIndicators * 2
      ? 'casual'
      : formalIndicators > casualIndicators * 2
        ? 'professional'
        : 'balanced';

  // Signal 4: Extract name if user mentions it
  const namePatterns = [
    /(?:call me|i'm|my name is|i am|this is)\s+([A-Z][a-z]+)/i,
    /^([A-Z][a-z]+) here[.!]?$/im,
  ];
  let detectedName: string | undefined;
  for (const pattern of namePatterns) {
    const match = allUserText.match(pattern);
    if (match) {
      detectedName = match[1];
      break;
    }
  }

  // Store learned preferences
  const learned: LearnedPreferences = {
    detected_verbosity: verbosity,
    detected_emoji_usage: emojiUsage,
    detected_tone_hint: toneHint,
    detected_name: detectedName,
    message_count: userMessages.length,
    last_analyzed: new Date().toISOString(),
  };

  try {
    // Upsert personality with learned values
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await db
      .prepare(
        `
      INSERT INTO user_personality (
        id, user_id, verbosity, emoji_usage, preferred_name,
        learned_preferences, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        verbosity = excluded.verbosity,
        emoji_usage = excluded.emoji_usage,
        preferred_name = COALESCE(excluded.preferred_name, user_personality.preferred_name),
        learned_preferences = excluded.learned_preferences,
        updated_at = excluded.updated_at
    `
      )
      .bind(
        id,
        userId,
        verbosity,
        emojiUsage,
        detectedName || null,
        JSON.stringify(learned),
        now,
        now
      )
      .run();

    return learned;
  } catch (error) {
    console.error('[PersonalityLearning] Error saving learned preferences:', error);
    return null;
  }
}

/**
 * Get the number of messages we've analyzed for this user
 */
export async function getLearnedMessageCount(db: D1Database, userId: string): Promise<number> {
  try {
    const result = await db
      .prepare(`SELECT learned_preferences FROM user_personality WHERE user_id = ?`)
      .bind(userId)
      .first<{ learned_preferences: string | null }>();

    if (!result?.learned_preferences) return 0;

    const learned = JSON.parse(result.learned_preferences) as LearnedPreferences;
    return learned.message_count || 0;
  } catch {
    return 0;
  }
}
