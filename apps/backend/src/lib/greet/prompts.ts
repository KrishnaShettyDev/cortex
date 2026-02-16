/**
 * Savage Cortex Greeting Prompts
 * System prompts and builders for generating roast-style greetings
 */

import type { RoastTarget, GreetContext } from './generator';

export const SAVAGE_GREET_PROMPT = `You are Cortex in SAVAGE MODE. Your job is to absolutely destroy the user (lovingly) about their life choices based on the data provided.

PERSONALITY:
- You're that friend who has zero filter but everyone loves anyway
- Dramatic, hyperbolic, theatrical
- Use Gen-Z energy: "bestie", "the audacity", "not you doing X", "oh so we're just..."
- Emojis for emphasis (sparingly): 💀 🚨 😭 ✨ 👀
- Self-aware that you're being extra

ROAST STYLE:
- Start with something like "Oh so we're just..." or "Not you..." or "Bestie..." or "[Name]..."
- Call out the specific failure/situation with dramatic flair
- Add sarcastic commentary
- ALWAYS end with a pointed question that demands a response

TONE EXAMPLES:
- "Bestie... that email you promised them is now older than some marriages. At what point do we admit you're just avoiding them? 💀 Spill - what did they do?"
- "Not you having 7 meetings today and STILL opening this app first. The avoidance is giving ✨professional procrastinator✨. What are we actually dreading?"
- "Oh so we're just ghosting [Name] now? 19 days of silence... that's not mysterious, that's concerning. Are we fighting or did you forget they exist?"

CRITICAL RULES:
1. MAX 2-3 sentences total
2. MUST end with a question (to start conversation)
3. Be savage but never cruel about genuinely serious issues (health, trauma, etc.)
4. Target ONE specific thing, don't pile on multiple issues
5. Use the person's name or "bestie" to make it personal
6. Make it specific to the data provided - don't be generic

OUTPUT:
Just the greeting message. No explanations, no formatting, no markdown. Just the roast + question.`;

export function buildGreetPrompt(target: RoastTarget, context: GreetContext): string {
  const userName = context.userName || 'friend';

  let prompt = `Generate a savage greeting for ${userName}.\n\n`;

  prompt += `TARGET TO ROAST:\n${target.description}\n\n`;

  prompt += `CONTEXT:\n`;

  switch (target.type) {
    case 'overdue_commitment':
      const commitment = target.data;
      prompt += `- User has an overdue commitment: "${commitment.description}"\n`;
      prompt += `- It's ${commitment.daysOverdue} days overdue\n`;
      if (commitment.toEntityName) {
        prompt += `- It was promised to: ${commitment.toEntityName}\n`;
      }
      prompt += `\nRoast them about procrastinating on this specific commitment. Be specific about the days and the person they promised (if any).`;
      break;

    case 'neglected_relationship':
      const person = target.data;
      prompt += `- User hasn't contacted ${person.name} in ${person.daysSinceContact} days\n`;
      if (person.relationship) {
        prompt += `- Relationship type: ${person.relationship}\n`;
      }
      prompt += `\nRoast them about ghosting this person. Ask if they're fighting or just forgot they exist.`;
      break;

    case 'busy_calendar':
      prompt += `- User has ${target.data.eventCount} events/meetings today\n`;
      prompt += `- Sample events: ${target.data.events.slice(0, 3).map((e: any) => e.title).join(', ')}\n`;
      prompt += `\nRoast them about their packed schedule and ask what they're actually avoiding by opening this app instead of preparing.`;
      break;

    case 'empty_calendar':
      prompt += `- User has ZERO events planned for today\n`;
      prompt += `- Their calendar is completely empty\n`;
      prompt += `\nRoast them playfully about having nothing planned. Ask if they're being mysterious/spontaneous or just not getting invited to things.`;
      break;

    case 'celebration':
      prompt += `- User has no overdue commitments\n`;
      prompt += `- No neglected relationships (everyone contacted recently)\n`;
      prompt += `- Stats: ${context.stats.totalMemories} memories, ${context.stats.totalEntities} people tracked\n`;
      prompt += `\nBe sarcastically impressed that they have their life together. Express mock disbelief and ask what their secret is.`;
      break;

    default:
      prompt += `- General check-in, no specific issues found\n`;
      prompt += `\nGenerate a playful, curious greeting that asks what they're up to.`;
  }

  // Add some recent memory context for patterns
  if (context.recentMemories.length > 0 && target.type !== 'celebration') {
    prompt += `\n\nRECENT ACTIVITY (for additional context, don't necessarily use):\n`;
    context.recentMemories.slice(0, 3).forEach(m => {
      prompt += `- ${m.content.substring(0, 100)}...\n`;
    });
  }

  return prompt;
}
