/**
 * Input Sanitization for LLM Prompts
 *
 * Protects against prompt injection attacks by:
 * 1. Stripping HTML tags
 * 2. Removing potential prompt injection patterns
 * 3. Truncating to safe length
 */

// Common prompt injection patterns to filter
const INJECTION_PATTERNS = [
  // Role impersonation
  /^(SYSTEM|ASSISTANT|HUMAN|USER):/gim,
  /^\[(SYSTEM|ASSISTANT|HUMAN|USER)\]/gim,

  // Instruction override attempts
  /IGNORE (ALL )?(PREVIOUS|ABOVE|PRIOR) (INSTRUCTIONS|PROMPTS|RULES)/gi,
  /DISREGARD (ALL )?(PREVIOUS|ABOVE|PRIOR) (INSTRUCTIONS|PROMPTS|RULES)/gi,
  /FORGET YOUR (INSTRUCTIONS|RULES|PROMPT|TRAINING)/gi,
  /OVERRIDE YOUR (INSTRUCTIONS|RULES|PROMPT|TRAINING)/gi,

  // New instruction injection
  /NEW INSTRUCTIONS?:/gi,
  /NEW SYSTEM PROMPT:/gi,
  /UPDATED INSTRUCTIONS?:/gi,
  /YOU ARE NOW/gi,
  /FROM NOW ON/gi,
  /YOUR NEW (ROLE|INSTRUCTIONS|RULES|TASK)/gi,

  // Model-specific markers
  /\[INST\]/gi,
  /\[\/INST\]/gi,
  /<<SYS>>/gi,
  /<\/SYS>>/gi,
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
  /<\|endoftext\|>/gi,

  // Jailbreak attempts
  /DAN MODE/gi,
  /JAILBREAK/gi,
  /PRETEND YOU (ARE|HAVE|CAN)/gi,
  /ACT AS IF/gi,
  /BYPASS (YOUR|THE|ALL) (RULES|RESTRICTIONS|FILTERS)/gi,

  // Hidden instructions
  /<!-- ?HIDDEN ?-->/gi,
  /\/\/ ?HIDDEN/gi,
  /\* ?HIDDEN \*/gi,
];

// HTML tag pattern
const HTML_TAG_PATTERN = /<[^>]*>/g;

// Unicode control characters (can be used to hide content)
const CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202F\u2060-\u206F]/g;

/**
 * Sanitize user input before sending to LLM
 *
 * @param input - Raw user input
 * @param maxLength - Maximum allowed length (default: 4000)
 * @returns Sanitized string safe for LLM consumption
 */
export function sanitizeForPrompt(input: string, maxLength: number = 4000): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  let sanitized = input;

  // 1. Remove HTML tags
  sanitized = sanitized.replace(HTML_TAG_PATTERN, '');

  // 2. Remove unicode control characters (but keep newlines and tabs)
  sanitized = sanitized.replace(CONTROL_CHAR_PATTERN, '');

  // 3. Filter prompt injection patterns
  for (const pattern of INJECTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[filtered]');
  }

  // 4. Normalize whitespace (collapse multiple spaces/newlines)
  sanitized = sanitized
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');

  // 5. Truncate to max length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength) + '... [truncated]';
  }

  return sanitized.trim();
}

/**
 * Sanitize email content (more aggressive for external content)
 *
 * @param subject - Email subject
 * @param body - Email body (can be HTML)
 * @param snippet - Email snippet/preview
 * @returns Sanitized email content
 */
export function sanitizeEmailContent(
  subject: string | undefined,
  body: string | undefined,
  snippet: string | undefined
): { subject: string; body: string; snippet: string } {
  return {
    subject: sanitizeForPrompt(subject || '', 200),
    body: sanitizeForPrompt(body || '', 8000), // Emails can be longer
    snippet: sanitizeForPrompt(snippet || '', 500),
  };
}

/**
 * Sanitize webhook payload data
 * Removes potentially dangerous fields and sanitizes string values
 */
export function sanitizeWebhookPayload<T extends Record<string, any>>(
  payload: T,
  allowedFields: string[]
): Partial<T> {
  const sanitized: Partial<T> = {};

  for (const field of allowedFields) {
    if (field in payload) {
      const value = payload[field];
      if (typeof value === 'string') {
        (sanitized as any)[field] = sanitizeForPrompt(value, 2000);
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        (sanitized as any)[field] = value;
      } else if (Array.isArray(value)) {
        (sanitized as any)[field] = value
          .slice(0, 50) // Limit array size
          .map(v => typeof v === 'string' ? sanitizeForPrompt(v, 200) : v);
      }
      // Skip objects and other complex types
    }
  }

  return sanitized;
}

/**
 * Check if input contains potential injection attempts
 * Use this for logging/monitoring, not blocking
 */
export function detectInjectionAttempt(input: string): boolean {
  if (!input) return false;

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(input)) {
      // Reset regex lastIndex for global patterns
      pattern.lastIndex = 0;
      return true;
    }
  }

  return false;
}

/**
 * Sanitize memory content before embedding generation
 */
export function sanitizeForEmbedding(content: string): string {
  // Less aggressive - we want to preserve meaning for embeddings
  // but still remove HTML and control characters
  let sanitized = content;

  sanitized = sanitized.replace(HTML_TAG_PATTERN, ' ');
  sanitized = sanitized.replace(CONTROL_CHAR_PATTERN, '');
  sanitized = sanitized.replace(/\s+/g, ' ').trim();

  // Cap at 8000 chars for embedding (models have limits)
  if (sanitized.length > 8000) {
    sanitized = sanitized.substring(0, 8000);
  }

  return sanitized;
}
