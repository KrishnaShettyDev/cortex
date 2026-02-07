/**
 * Natural Language Trigger Parser
 *
 * Converts natural language scheduling expressions to cron format.
 * Examples:
 * - "every weekday at 9am" → "0 9 * * 1-5"
 * - "daily at 8:30am" → "30 8 * * *"
 * - "every Monday at 2pm" → "0 14 * * 1"
 * - "first Monday of the month at 10am" → "0 10 1-7 * 1"
 *
 * Uses LLM for complex cases, with fallback to rule-based parsing.
 */

// =============================================================================
// TYPES
// =============================================================================

export interface ParsedTrigger {
  cronExpression: string;
  humanReadable: string;
  actionType: 'reminder' | 'briefing' | 'check' | 'query' | 'custom';
  actionPayload: Record<string, any>;
  confidence: number;
  timezone: string;
  nextTriggerAt: string;
}

export interface TriggerParseResult {
  success: boolean;
  trigger?: ParsedTrigger;
  error?: string;
  needsMoreInfo?: string[];
}

// =============================================================================
// MAIN PARSER
// =============================================================================

/**
 * Parse natural language trigger input
 */
export async function parseTriggerInput(
  input: string,
  timezone: string,
  openaiKey?: string
): Promise<TriggerParseResult> {
  // First try rule-based parsing (fast, no API call)
  const ruleBasedResult = parseWithRules(input, timezone);

  if (ruleBasedResult.success && ruleBasedResult.trigger && ruleBasedResult.trigger.confidence >= 0.9) {
    return ruleBasedResult;
  }

  // For complex cases, use LLM
  if (openaiKey) {
    const llmResult = await parseWithLLM(input, timezone, openaiKey);
    if (llmResult.success) {
      return llmResult;
    }
  }

  // Return rule-based result even if confidence is lower
  return ruleBasedResult;
}

// =============================================================================
// RULE-BASED PARSER
// =============================================================================

/**
 * Parse trigger using regex rules (fast, deterministic)
 */
function parseWithRules(input: string, timezone: string): TriggerParseResult {
  const normalized = input.toLowerCase().trim();

  // Extract action type and message
  const actionInfo = extractActionInfo(normalized);

  // Try to match common patterns
  const timePattern = extractTimePattern(normalized);
  const schedulePattern = extractSchedulePattern(normalized);

  if (!timePattern) {
    return {
      success: false,
      error: 'Could not determine the time for this trigger',
      needsMoreInfo: ['What time should this trigger?'],
    };
  }

  // Build cron expression
  let cronExpression: string;
  let humanReadable: string;
  let confidence = 0.9;

  if (schedulePattern.type === 'daily') {
    cronExpression = `${timePattern.minute} ${timePattern.hour} * * *`;
    humanReadable = `Daily at ${formatTime(timePattern.hour, timePattern.minute)}`;
  } else if (schedulePattern.type === 'weekdays') {
    cronExpression = `${timePattern.minute} ${timePattern.hour} * * 1-5`;
    humanReadable = `Every weekday at ${formatTime(timePattern.hour, timePattern.minute)}`;
  } else if (schedulePattern.type === 'weekends') {
    cronExpression = `${timePattern.minute} ${timePattern.hour} * * 0,6`;
    humanReadable = `Every weekend at ${formatTime(timePattern.hour, timePattern.minute)}`;
  } else if (schedulePattern.type === 'weekly' && schedulePattern.dayOfWeek !== undefined) {
    cronExpression = `${timePattern.minute} ${timePattern.hour} * * ${schedulePattern.dayOfWeek}`;
    humanReadable = `Every ${getDayName(schedulePattern.dayOfWeek)} at ${formatTime(timePattern.hour, timePattern.minute)}`;
  } else if (schedulePattern.type === 'monthly' && schedulePattern.dayOfMonth) {
    cronExpression = `${timePattern.minute} ${timePattern.hour} ${schedulePattern.dayOfMonth} * *`;
    humanReadable = `Monthly on day ${schedulePattern.dayOfMonth} at ${formatTime(timePattern.hour, timePattern.minute)}`;
  } else if (schedulePattern.type === 'first_weekday_of_month' && schedulePattern.dayOfWeek !== undefined) {
    // First X of month: days 1-7, on specified weekday
    cronExpression = `${timePattern.minute} ${timePattern.hour} 1-7 * ${schedulePattern.dayOfWeek}`;
    humanReadable = `First ${getDayName(schedulePattern.dayOfWeek)} of each month at ${formatTime(timePattern.hour, timePattern.minute)}`;
  } else if (schedulePattern.type === 'hourly') {
    cronExpression = `${timePattern.minute} * * * *`;
    humanReadable = `Every hour at ${timePattern.minute} minutes past`;
  } else if (schedulePattern.type === 'once') {
    // For one-time triggers, we'll set a specific datetime
    cronExpression = `${timePattern.minute} ${timePattern.hour} ${schedulePattern.dayOfMonth || '*'} ${schedulePattern.month || '*'} *`;
    humanReadable = `Once at ${formatTime(timePattern.hour, timePattern.minute)}`;
    confidence = 0.7; // Lower confidence for once-off
  } else {
    // Default to daily
    cronExpression = `${timePattern.minute} ${timePattern.hour} * * *`;
    humanReadable = `Daily at ${formatTime(timePattern.hour, timePattern.minute)}`;
    confidence = 0.6;
  }

  const nextTriggerAt = calculateNextTrigger(cronExpression, timezone);

  return {
    success: true,
    trigger: {
      cronExpression,
      humanReadable,
      actionType: actionInfo.type,
      actionPayload: actionInfo.payload,
      confidence,
      timezone,
      nextTriggerAt,
    },
  };
}

// =============================================================================
// TIME EXTRACTION
// =============================================================================

interface TimePattern {
  hour: number;
  minute: number;
}

function extractTimePattern(input: string): TimePattern | null {
  // Match patterns like:
  // "9am", "9:30am", "14:00", "2pm", "at 9", "at 9:30"

  // Pattern: 9:30am, 9:30 am, 9:30pm
  const timeWithMinutesAndMeridiem = input.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (timeWithMinutesAndMeridiem) {
    let hour = parseInt(timeWithMinutesAndMeridiem[1]);
    const minute = parseInt(timeWithMinutesAndMeridiem[2]);
    const meridiem = timeWithMinutesAndMeridiem[3].toLowerCase();

    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;

    return { hour, minute };
  }

  // Pattern: 9am, 9 am, 9pm
  const timeWithMeridiem = input.match(/(\d{1,2})\s*(am|pm)/i);
  if (timeWithMeridiem) {
    let hour = parseInt(timeWithMeridiem[1]);
    const meridiem = timeWithMeridiem[2].toLowerCase();

    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;

    return { hour, minute: 0 };
  }

  // Pattern: 14:00, 9:30 (24-hour format)
  const time24h = input.match(/(\d{1,2}):(\d{2})(?!\s*(am|pm))/i);
  if (time24h) {
    const hour = parseInt(time24h[1]);
    const minute = parseInt(time24h[2]);

    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
  }

  // Pattern: "at 9" (assume AM for single digit, PM for common times like "at 3")
  const atHour = input.match(/at\s+(\d{1,2})(?!\d|:)/);
  if (atHour) {
    let hour = parseInt(atHour[1]);
    // Assume work hours: 7-11 are AM, 12+ stay as-is, 1-6 are PM
    if (hour >= 1 && hour <= 6) hour += 12;
    return { hour, minute: 0 };
  }

  // Common time words
  if (input.includes('morning') || input.includes('breakfast')) {
    return { hour: 8, minute: 0 };
  }
  if (input.includes('noon') || input.includes('lunch')) {
    return { hour: 12, minute: 0 };
  }
  if (input.includes('afternoon')) {
    return { hour: 14, minute: 0 };
  }
  if (input.includes('evening') || input.includes('dinner')) {
    return { hour: 18, minute: 0 };
  }
  if (input.includes('night') || input.includes('bedtime')) {
    return { hour: 21, minute: 0 };
  }

  return null;
}

// =============================================================================
// SCHEDULE EXTRACTION
// =============================================================================

interface SchedulePattern {
  type: 'daily' | 'weekdays' | 'weekends' | 'weekly' | 'monthly' | 'first_weekday_of_month' | 'hourly' | 'once';
  dayOfWeek?: number; // 0=Sunday, 1=Monday, etc.
  dayOfMonth?: number;
  month?: number;
}

function extractSchedulePattern(input: string): SchedulePattern {
  // Check for "first X of month"
  const firstOfMonth = input.match(/first\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(of\s+)?(the\s+)?(every\s+)?month/i);
  if (firstOfMonth) {
    return {
      type: 'first_weekday_of_month',
      dayOfWeek: getDayNumber(firstOfMonth[1]),
    };
  }

  // Check for specific day of week
  const dayMatch = input.match(/(every\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?/i);
  if (dayMatch) {
    return {
      type: 'weekly',
      dayOfWeek: getDayNumber(dayMatch[2]),
    };
  }

  // Check for weekdays
  if (input.includes('weekday') || input.includes('work day') || input.includes('business day')) {
    return { type: 'weekdays' };
  }

  // Check for weekends
  if (input.includes('weekend')) {
    return { type: 'weekends' };
  }

  // Check for monthly
  if (input.includes('monthly') || input.match(/(\d{1,2})(st|nd|rd|th)\s+of\s+(every\s+)?month/)) {
    const dayMatch = input.match(/(\d{1,2})(st|nd|rd|th)/);
    return {
      type: 'monthly',
      dayOfMonth: dayMatch ? parseInt(dayMatch[1]) : 1,
    };
  }

  // Check for hourly
  if (input.includes('every hour') || input.includes('hourly')) {
    return { type: 'hourly' };
  }

  // Check for "tomorrow", "today" (one-time)
  if (input.includes('tomorrow') || input.includes('today') || input.includes('once')) {
    return { type: 'once' };
  }

  // Default to daily
  if (input.includes('every day') || input.includes('daily') || input.includes('each day')) {
    return { type: 'daily' };
  }

  return { type: 'daily' };
}

// =============================================================================
// ACTION EXTRACTION
// =============================================================================

interface ActionInfo {
  type: 'reminder' | 'briefing' | 'check' | 'query' | 'custom';
  payload: Record<string, any>;
}

function extractActionInfo(input: string): ActionInfo {
  // Check for briefing
  if (input.includes('briefing') || input.includes('brief me') || input.includes('summary')) {
    return {
      type: 'briefing',
      payload: { includeCalendar: true, includeEmail: true, includeWeather: true },
    };
  }

  // Check for status check
  if (input.includes('check') || input.includes('status') || input.includes('update me')) {
    return {
      type: 'check',
      payload: {},
    };
  }

  // Check for reminder
  const reminderMatch = input.match(/remind\s+(me\s+)?(to\s+)?(.+?)(\s+at|\s+every|\s+daily|$)/i);
  if (reminderMatch) {
    return {
      type: 'reminder',
      payload: { message: reminderMatch[3].trim() },
    };
  }

  // Default to reminder with the full input as message
  const cleanedMessage = input
    .replace(/every\s+(day|weekday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|evening|night)/gi, '')
    .replace(/at\s+\d{1,2}(:\d{2})?\s*(am|pm)?/gi, '')
    .replace(/daily|weekly|monthly|hourly/gi, '')
    .trim();

  return {
    type: 'reminder',
    payload: { message: cleanedMessage || 'Scheduled reminder' },
  };
}

// =============================================================================
// LLM PARSER (for complex cases)
// =============================================================================

const TRIGGER_PARSING_PROMPT = `You are a scheduling parser. Convert natural language scheduling requests into cron expressions.

Output JSON format:
{
  "cronExpression": "0 9 * * 1-5",
  "humanReadable": "Every weekday at 9:00 AM",
  "actionType": "reminder|briefing|check|query|custom",
  "actionPayload": { "message": "..." },
  "confidence": 0.95
}

Cron format: minute hour dayOfMonth month dayOfWeek
- minute: 0-59
- hour: 0-23
- dayOfMonth: 1-31 or *
- month: 1-12 or *
- dayOfWeek: 0-6 (0=Sunday) or 1-5 for Mon-Fri

Examples:
- "every weekday at 9am" → "0 9 * * 1-5"
- "daily at 8:30am" → "30 8 * * *"
- "every Monday at 2pm" → "0 14 * * 1"
- "first Monday of the month at 10am" → "0 10 1-7 * 1"
- "every 2 hours" → "0 */2 * * *"

Today's date: {date}
User timezone: {timezone}`;

async function parseWithLLM(
  input: string,
  timezone: string,
  openaiKey: string
): Promise<TriggerParseResult> {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: TRIGGER_PARSING_PROMPT
              .replace('{date}', new Date().toISOString().split('T')[0])
              .replace('{timezone}', timezone),
          },
          { role: 'user', content: input },
        ],
        temperature: 0.2,
        max_tokens: 500,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      console.error('[TriggerParser] LLM error:', await response.text());
      return { success: false, error: 'Failed to parse trigger' };
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };

    const parsed = JSON.parse(data.choices[0].message.content);

    if (!parsed.cronExpression) {
      return { success: false, error: 'Could not determine schedule' };
    }

    // Validate cron expression
    if (!isValidCron(parsed.cronExpression)) {
      return { success: false, error: 'Invalid cron expression generated' };
    }

    const nextTriggerAt = calculateNextTrigger(parsed.cronExpression, timezone);

    return {
      success: true,
      trigger: {
        cronExpression: parsed.cronExpression,
        humanReadable: parsed.humanReadable || formatCronToHuman(parsed.cronExpression),
        actionType: parsed.actionType || 'reminder',
        actionPayload: parsed.actionPayload || { message: input },
        confidence: parsed.confidence || 0.8,
        timezone,
        nextTriggerAt,
      },
    };
  } catch (error) {
    console.error('[TriggerParser] LLM parse error:', error);
    return { success: false, error: String(error) };
  }
}

// =============================================================================
// UTILITIES
// =============================================================================

function getDayNumber(dayName: string): number {
  const days: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  return days[dayName.toLowerCase()] ?? 1;
}

function getDayName(dayNumber: number): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[dayNumber] || 'Monday';
}

function formatTime(hour: number, minute: number): string {
  const h = hour % 12 || 12;
  const m = minute.toString().padStart(2, '0');
  const ampm = hour < 12 ? 'AM' : 'PM';
  return minute === 0 ? `${h}:00 ${ampm}` : `${h}:${m} ${ampm}`;
}

function isValidCron(expression: string): boolean {
  const parts = expression.split(' ');
  if (parts.length !== 5) return false;

  // Basic validation for each field
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Check minute (0-59)
  if (!isValidCronField(minute, 0, 59)) return false;
  // Check hour (0-23)
  if (!isValidCronField(hour, 0, 23)) return false;
  // Check day of month (1-31)
  if (!isValidCronField(dayOfMonth, 1, 31)) return false;
  // Check month (1-12)
  if (!isValidCronField(month, 1, 12)) return false;
  // Check day of week (0-6)
  if (!isValidCronField(dayOfWeek, 0, 6)) return false;

  return true;
}

function isValidCronField(field: string, min: number, max: number): boolean {
  if (field === '*') return true;

  // Handle ranges like 1-5
  if (field.includes('-')) {
    const [start, end] = field.split('-').map(Number);
    return !isNaN(start) && !isNaN(end) && start >= min && end <= max;
  }

  // Handle lists like 0,6
  if (field.includes(',')) {
    return field.split(',').every(f => {
      const num = parseInt(f);
      return !isNaN(num) && num >= min && num <= max;
    });
  }

  // Handle step values like */2
  if (field.includes('/')) {
    const [base, step] = field.split('/');
    if (base !== '*' && !isNaN(parseInt(base))) {
      const baseNum = parseInt(base);
      if (baseNum < min || baseNum > max) return false;
    }
    return !isNaN(parseInt(step));
  }

  // Simple number
  const num = parseInt(field);
  return !isNaN(num) && num >= min && num <= max;
}

function formatCronToHuman(cron: string): string {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = cron.split(' ');

  const time = formatTime(parseInt(hour) || 0, parseInt(minute) || 0);

  if (dayOfWeek === '1-5' && dayOfMonth === '*' && month === '*') {
    return `Every weekday at ${time}`;
  }
  if (dayOfWeek === '0,6' && dayOfMonth === '*' && month === '*') {
    return `Every weekend at ${time}`;
  }
  if (dayOfWeek === '*' && dayOfMonth === '*' && month === '*') {
    return `Daily at ${time}`;
  }
  if (dayOfMonth !== '*' && month === '*') {
    return `Monthly on day ${dayOfMonth} at ${time}`;
  }

  return `Scheduled: ${cron}`;
}

/**
 * Calculate the next trigger time from a cron expression
 */
export function calculateNextTrigger(cronExpression: string, timezone: string): string {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = cronExpression.split(' ');

  // Start from now
  const now = new Date();
  let next = new Date(now);

  // Set time if specified
  if (hour !== '*') {
    const h = parseInt(hour);
    next.setHours(h);
  }
  if (minute !== '*') {
    const m = parseInt(minute);
    next.setMinutes(m);
  }
  next.setSeconds(0);
  next.setMilliseconds(0);

  // If time has passed today, move to tomorrow
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  // Handle day of week constraints
  if (dayOfWeek !== '*') {
    const allowedDays = parseCronField(dayOfWeek, 0, 6);
    let attempts = 0;
    while (!allowedDays.includes(next.getDay()) && attempts < 8) {
      next.setDate(next.getDate() + 1);
      attempts++;
    }
  }

  // Handle day of month constraints
  if (dayOfMonth !== '*' && !dayOfMonth.includes('-')) {
    const targetDay = parseInt(dayOfMonth);
    if (!isNaN(targetDay)) {
      while (next.getDate() !== targetDay) {
        next.setDate(next.getDate() + 1);
        if (next.getDate() === 1 && targetDay > 28) {
          // Handle months with fewer days
          break;
        }
      }
    }
  }

  return next.toISOString();
}

function parseCronField(field: string, min: number, max: number): number[] {
  if (field === '*') {
    return Array.from({ length: max - min + 1 }, (_, i) => i + min);
  }

  const values: number[] = [];

  // Handle comma-separated values
  const parts = field.split(',');
  for (const part of parts) {
    if (part.includes('-')) {
      // Range
      const [start, end] = part.split('-').map(Number);
      for (let i = start; i <= end; i++) {
        values.push(i);
      }
    } else {
      values.push(parseInt(part));
    }
  }

  return values.filter(v => !isNaN(v) && v >= min && v <= max);
}
