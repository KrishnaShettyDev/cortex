/**
 * Timezone Utilities
 *
 * Handles timezone-aware time calculations for scheduling notifications.
 * Uses native Intl API - no external dependencies.
 */

/**
 * Get the current hour in a specific timezone
 */
export function getCurrentHourInTimezone(timezone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(new Date());
    const hourPart = parts.find(p => p.type === 'hour');
    return parseInt(hourPart?.value || '0', 10);
  } catch {
    // Invalid timezone, fallback to UTC
    return new Date().getUTCHours();
  }
}

/**
 * Get the current time (HH:MM) in a specific timezone
 */
export function getCurrentTimeInTimezone(timezone: string): string {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const hour = parts.find(p => p.type === 'hour')?.value || '00';
    const minute = parts.find(p => p.type === 'minute')?.value || '00';
    return `${hour}:${minute}`;
  } catch {
    const now = new Date();
    return `${now.getUTCHours().toString().padStart(2, '0')}:${now.getUTCMinutes().toString().padStart(2, '0')}`;
  }
}

/**
 * Get current date in timezone (YYYY-MM-DD)
 */
export function getCurrentDateInTimezone(timezone: string): string {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(now); // Returns YYYY-MM-DD
  } catch {
    return new Date().toISOString().split('T')[0];
  }
}

/**
 * Convert local time to UTC
 * @param localTime - Time in HH:MM format
 * @param timezone - IANA timezone string
 * @param date - Optional date (defaults to today)
 * @returns UTC time in HH:MM format
 */
export function localTimeToUTC(
  localTime: string,
  timezone: string,
  date?: Date
): string {
  try {
    const [hours, minutes] = localTime.split(':').map(Number);
    const baseDate = date || new Date();

    // Create date in local timezone
    const localDateStr = `${baseDate.toISOString().split('T')[0]}T${localTime}:00`;

    // Get timezone offset
    const localDate = new Date(localDateStr);
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    // Calculate offset by comparing UTC and local
    const utcDate = new Date(Date.UTC(
      baseDate.getUTCFullYear(),
      baseDate.getUTCMonth(),
      baseDate.getUTCDate(),
      hours,
      minutes
    ));

    // Get the offset in minutes for this timezone
    const offsetMinutes = getTimezoneOffsetMinutes(timezone, baseDate);

    // Adjust UTC time by offset
    const adjustedTime = new Date(utcDate.getTime() - offsetMinutes * 60 * 1000);

    return `${adjustedTime.getUTCHours().toString().padStart(2, '0')}:${adjustedTime.getUTCMinutes().toString().padStart(2, '0')}`;
  } catch {
    return localTime;
  }
}

/**
 * Get timezone offset in minutes
 */
export function getTimezoneOffsetMinutes(timezone: string, date?: Date): number {
  try {
    const testDate = date || new Date();
    const utcDate = new Date(testDate.toLocaleString('en-US', { timeZone: 'UTC' }));
    const tzDate = new Date(testDate.toLocaleString('en-US', { timeZone: timezone }));
    return (tzDate.getTime() - utcDate.getTime()) / (1000 * 60);
  } catch {
    return 0;
  }
}

/**
 * Check if current time is within a time window in user's timezone
 * @param timezone - User's timezone
 * @param targetTime - Target time in HH:MM format
 * @param windowMinutes - Window size in minutes (default 5)
 */
export function isWithinTimeWindow(
  timezone: string,
  targetTime: string,
  windowMinutes: number = 5
): boolean {
  const currentTime = getCurrentTimeInTimezone(timezone);
  const [currentHour, currentMinute] = currentTime.split(':').map(Number);
  const [targetHour, targetMinute] = targetTime.split(':').map(Number);

  const currentTotalMinutes = currentHour * 60 + currentMinute;
  const targetTotalMinutes = targetHour * 60 + targetMinute;

  const diff = Math.abs(currentTotalMinutes - targetTotalMinutes);

  // Handle midnight crossing
  const diffAcrossMidnight = 1440 - diff;

  return Math.min(diff, diffAcrossMidnight) <= windowMinutes;
}

/**
 * Check if current time is within quiet hours
 * @param timezone - User's timezone
 * @param quietStart - Quiet hours start (HH:MM)
 * @param quietEnd - Quiet hours end (HH:MM)
 */
export function isWithinQuietHours(
  timezone: string,
  quietStart: string,
  quietEnd: string
): boolean {
  const currentTime = getCurrentTimeInTimezone(timezone);
  const [currentHour, currentMinute] = currentTime.split(':').map(Number);
  const [startHour, startMinute] = quietStart.split(':').map(Number);
  const [endHour, endMinute] = quietEnd.split(':').map(Number);

  const currentMinutes = currentHour * 60 + currentMinute;
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;

  // Handle overnight quiet hours (e.g., 22:00 to 07:00)
  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }

  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

/**
 * Get next occurrence of a time in user's timezone as UTC timestamp
 */
export function getNextOccurrenceUTC(
  localTime: string,
  timezone: string
): Date {
  const [targetHour, targetMinute] = localTime.split(':').map(Number);
  const now = new Date();

  // Get current time in user's timezone
  const currentTime = getCurrentTimeInTimezone(timezone);
  const [currentHour, currentMinute] = currentTime.split(':').map(Number);

  // Calculate if we need to schedule for today or tomorrow
  let daysToAdd = 0;
  if (
    currentHour > targetHour ||
    (currentHour === targetHour && currentMinute >= targetMinute)
  ) {
    daysToAdd = 1;
  }

  // Get tomorrow's date in user's timezone if needed
  const targetDate = new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
  const dateStr = getCurrentDateInTimezone(timezone);
  const [year, month, day] = dateStr.split('-').map(Number);

  // Create the target datetime
  const targetDateTime = new Date(Date.UTC(year, month - 1, day + daysToAdd, targetHour, targetMinute, 0, 0));

  // Adjust for timezone offset
  const offsetMinutes = getTimezoneOffsetMinutes(timezone, targetDateTime);
  return new Date(targetDateTime.getTime() - offsetMinutes * 60 * 1000);
}

/**
 * Get greeting based on time of day in user's timezone
 */
export function getGreetingForTimezone(timezone: string, userName?: string): string {
  const hour = getCurrentHourInTimezone(timezone);
  const name = userName || 'there';

  if (hour < 12) return `Good morning, ${name}`;
  if (hour < 17) return `Good afternoon, ${name}`;
  return `Good evening, ${name}`;
}

/**
 * Validate IANA timezone string
 */
export function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get common timezones for a region hint
 */
export function getTimezoneFromRegion(hint: string): string {
  const regionMap: Record<string, string> = {
    // India
    'india': 'Asia/Kolkata',
    'ist': 'Asia/Kolkata',
    'mumbai': 'Asia/Kolkata',
    'delhi': 'Asia/Kolkata',
    'bangalore': 'Asia/Kolkata',

    // USA
    'usa': 'America/New_York',
    'us': 'America/New_York',
    'eastern': 'America/New_York',
    'pacific': 'America/Los_Angeles',
    'central': 'America/Chicago',
    'mountain': 'America/Denver',
    'est': 'America/New_York',
    'pst': 'America/Los_Angeles',
    'cst': 'America/Chicago',
    'mst': 'America/Denver',

    // Europe
    'uk': 'Europe/London',
    'london': 'Europe/London',
    'europe': 'Europe/Paris',
    'paris': 'Europe/Paris',
    'berlin': 'Europe/Berlin',
    'cet': 'Europe/Paris',

    // Asia Pacific
    'singapore': 'Asia/Singapore',
    'tokyo': 'Asia/Tokyo',
    'japan': 'Asia/Tokyo',
    'sydney': 'Australia/Sydney',
    'australia': 'Australia/Sydney',
    'dubai': 'Asia/Dubai',
    'uae': 'Asia/Dubai',

    // Default
    'utc': 'UTC',
  };

  return regionMap[hint.toLowerCase()] || 'UTC';
}
