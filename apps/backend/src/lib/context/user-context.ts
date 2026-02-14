/**
 * User Context Builder
 *
 * Builds comprehensive context about the user from memories, entities, and settings.
 * This context is injected into chat prompts so Cortex KNOWS things instead of asking.
 */

import type { D1Database } from '@cloudflare/workers-types';

export interface UserLocation {
  city: string;
  country: string;
  timezone: string;
  latitude?: number;
  longitude?: number;
  source: 'device' | 'settings' | 'inferred';
}

export interface UserPreferences {
  cuisines: string[];
  workStyle: 'early_bird' | 'night_owl' | 'standard' | 'unknown';
  communicationStyle: 'brief' | 'detailed' | 'casual' | 'formal';
  interests: string[];
}

export interface ImportantPerson {
  id: string;
  name: string;
  relationship: string | null;
  email: string | null;
  lastContact: string | null;
  daysSinceContact: number | null;
  mentionCount: number;
}

export interface ActiveProject {
  name: string;
  lastMentioned: string;
  mentionCount: number;
}

export interface UserContext {
  location: UserLocation | null;
  preferences: UserPreferences;
  projects: ActiveProject[];
  importantPeople: ImportantPerson[];
  recentTopics: string[];
  upcomingCommitments: Array<{
    content: string;
    dueDate: string | null;
    entityName: string | null;
  }>;
  stats: {
    totalMemories: number;
    totalEntities: number;
  };
}

/**
 * Build comprehensive user context from all available sources
 */
export async function getUserContext(
  db: D1Database,
  userId: string
): Promise<UserContext> {
  // Run all queries in parallel for speed
  const [
    location,
    preferences,
    projects,
    importantPeople,
    recentTopics,
    upcomingCommitments,
    stats,
  ] = await Promise.all([
    getUserLocation(db, userId),
    getUserPreferences(db, userId),
    getActiveProjects(db, userId),
    getImportantPeople(db, userId),
    getRecentTopics(db, userId),
    getUpcomingCommitments(db, userId),
    getUserStats(db, userId),
  ]);

  return {
    location,
    preferences,
    projects,
    importantPeople,
    recentTopics,
    upcomingCommitments,
    stats,
  };
}

/**
 * Get user's location from device, settings, or infer from memories
 */
async function getUserLocation(
  db: D1Database,
  userId: string
): Promise<UserLocation | null> {
  // 1. Check for device-reported location (most recent, within last hour)
  const deviceLocation = await db.prepare(`
    SELECT latitude, longitude, updated_at
    FROM users
    WHERE id = ? AND latitude IS NOT NULL AND longitude IS NOT NULL
    AND datetime(updated_at) > datetime('now', '-1 hour')
  `).bind(userId).first<{ latitude: number; longitude: number; updated_at: string }>();

  if (deviceLocation) {
    // Reverse geocode to city (simplified - in production use a geocoding API)
    const city = await reverseGeocodeToCity(deviceLocation.latitude, deviceLocation.longitude);
    if (city) {
      return {
        city: city.name,
        country: city.country,
        timezone: city.timezone,
        latitude: deviceLocation.latitude,
        longitude: deviceLocation.longitude,
        source: 'device',
      };
    }
  }

  // 2. Check notification preferences for timezone (user-set)
  const prefs = await db.prepare(`
    SELECT timezone FROM notification_preferences WHERE user_id = ?
  `).bind(userId).first<{ timezone: string }>();

  // 3. Infer from memories mentioning locations
  const locationMemories = await db.prepare(`
    SELECT content FROM memories
    WHERE user_id = ?
    AND (
      content LIKE '%I live in%' OR
      content LIKE '%I am in%' OR
      content LIKE '%I''m in%' OR
      content LIKE '%based in%' OR
      content LIKE '%located in%' OR
      content LIKE '%my city%' OR
      content LIKE '%my home%'
    )
    ORDER BY created_at DESC
    LIMIT 10
  `).bind(userId).all();

  // Check for Indian cities (most common for this app)
  const indianCities: Record<string, { country: string; timezone: string }> = {
    'Bangalore': { country: 'India', timezone: 'Asia/Kolkata' },
    'Bengaluru': { country: 'India', timezone: 'Asia/Kolkata' },
    'Hyderabad': { country: 'India', timezone: 'Asia/Kolkata' },
    'Delhi': { country: 'India', timezone: 'Asia/Kolkata' },
    'New Delhi': { country: 'India', timezone: 'Asia/Kolkata' },
    'Mumbai': { country: 'India', timezone: 'Asia/Kolkata' },
    'Chennai': { country: 'India', timezone: 'Asia/Kolkata' },
    'Pune': { country: 'India', timezone: 'Asia/Kolkata' },
    'Kolkata': { country: 'India', timezone: 'Asia/Kolkata' },
    'Ahmedabad': { country: 'India', timezone: 'Asia/Kolkata' },
    'Jaipur': { country: 'India', timezone: 'Asia/Kolkata' },
    'Gurgaon': { country: 'India', timezone: 'Asia/Kolkata' },
    'Gurugram': { country: 'India', timezone: 'Asia/Kolkata' },
    'Noida': { country: 'India', timezone: 'Asia/Kolkata' },
  };

  for (const memory of locationMemories.results as any[]) {
    for (const [city, info] of Object.entries(indianCities)) {
      if (memory.content.includes(city)) {
        return {
          city,
          country: info.country,
          timezone: prefs?.timezone || info.timezone,
          source: 'inferred',
        };
      }
    }
  }

  // 4. Fall back to timezone-based inference
  if (prefs?.timezone) {
    const tzToCityMap: Record<string, { city: string; country: string }> = {
      'Asia/Kolkata': { city: 'India', country: 'India' },
      'America/New_York': { city: 'New York', country: 'USA' },
      'America/Los_Angeles': { city: 'Los Angeles', country: 'USA' },
      'Europe/London': { city: 'London', country: 'UK' },
    };

    const tzCity = tzToCityMap[prefs.timezone];
    if (tzCity) {
      return {
        city: tzCity.city,
        country: tzCity.country,
        timezone: prefs.timezone,
        source: 'settings',
      };
    }
  }

  return null;
}

/**
 * Get user preferences from memories and beliefs
 */
async function getUserPreferences(
  db: D1Database,
  userId: string
): Promise<UserPreferences> {
  const preferences: UserPreferences = {
    cuisines: [],
    workStyle: 'unknown',
    communicationStyle: 'casual',
    interests: [],
  };

  // Get cuisine preferences from beliefs or memories
  const cuisineMemories = await db.prepare(`
    SELECT content FROM memories
    WHERE user_id = ?
    AND (
      content LIKE '%I like%food%' OR
      content LIKE '%I love%food%' OR
      content LIKE '%favorite cuisine%' OR
      content LIKE '%prefer%restaurant%' OR
      content LIKE '%I enjoy%eating%'
    )
    ORDER BY created_at DESC
    LIMIT 5
  `).bind(userId).all();

  const cuisineTypes = ['Indian', 'Italian', 'Chinese', 'Japanese', 'Mexican', 'Thai', 'Korean', 'Mediterranean', 'American', 'French'];
  for (const memory of cuisineMemories.results as any[]) {
    for (const cuisine of cuisineTypes) {
      if (memory.content.toLowerCase().includes(cuisine.toLowerCase())) {
        if (!preferences.cuisines.includes(cuisine)) {
          preferences.cuisines.push(cuisine);
        }
      }
    }
  }

  // Get interests from entities (topics, organizations)
  const interests = await db.prepare(`
    SELECT name FROM entities
    WHERE user_id = ? AND type IN ('topic', 'interest', 'hobby')
    ORDER BY mention_count DESC
    LIMIT 10
  `).bind(userId).all();

  preferences.interests = (interests.results as any[]).map(i => i.name);

  // Infer work style from memory timestamps
  const morningMemories = await db.prepare(`
    SELECT COUNT(*) as count FROM memories
    WHERE user_id = ?
    AND CAST(strftime('%H', created_at) AS INTEGER) BETWEEN 5 AND 9
  `).bind(userId).first<{ count: number }>();

  const nightMemories = await db.prepare(`
    SELECT COUNT(*) as count FROM memories
    WHERE user_id = ?
    AND CAST(strftime('%H', created_at) AS INTEGER) BETWEEN 22 AND 3
  `).bind(userId).first<{ count: number }>();

  if ((morningMemories?.count || 0) > (nightMemories?.count || 0) * 2) {
    preferences.workStyle = 'early_bird';
  } else if ((nightMemories?.count || 0) > (morningMemories?.count || 0) * 2) {
    preferences.workStyle = 'night_owl';
  } else {
    preferences.workStyle = 'standard';
  }

  return preferences;
}

/**
 * Get active projects/work topics from recent memories
 */
async function getActiveProjects(
  db: D1Database,
  userId: string
): Promise<ActiveProject[]> {
  // Get entities of type 'project' or 'work' mentioned in last 30 days
  const projects = await db.prepare(`
    SELECT
      e.name,
      MAX(m.created_at) as last_mentioned,
      COUNT(*) as mention_count
    FROM entities e
    JOIN entity_mentions em ON em.entity_id = e.id
    JOIN memories m ON m.id = em.memory_id
    WHERE e.user_id = ?
    AND e.type IN ('project', 'work', 'company', 'client')
    AND m.created_at > datetime('now', '-30 days')
    GROUP BY e.id
    ORDER BY mention_count DESC
    LIMIT 5
  `).bind(userId).all();

  return (projects.results as any[]).map(p => ({
    name: p.name,
    lastMentioned: p.last_mentioned,
    mentionCount: p.mention_count,
  }));
}

/**
 * Get important people from entities with relationship info
 */
async function getImportantPeople(
  db: D1Database,
  userId: string
): Promise<ImportantPerson[]> {
  const people = await db.prepare(`
    SELECT
      e.id,
      e.name,
      json_extract(e.metadata, '$.relationship') as relationship,
      json_extract(e.metadata, '$.email') as email,
      e.mention_count,
      (
        SELECT MAX(m.created_at)
        FROM memories m
        JOIN entity_mentions em ON em.memory_id = m.id
        WHERE em.entity_id = e.id
      ) as last_contact
    FROM entities e
    WHERE e.user_id = ? AND e.type = 'person'
    ORDER BY e.mention_count DESC
    LIMIT 20
  `).bind(userId).all();

  const now = new Date();

  return (people.results as any[]).map(p => {
    let daysSinceContact: number | null = null;
    if (p.last_contact) {
      const lastDate = new Date(p.last_contact);
      daysSinceContact = Math.floor((now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
    }

    return {
      id: p.id,
      name: p.name,
      relationship: p.relationship,
      email: p.email,
      lastContact: p.last_contact,
      daysSinceContact,
      mentionCount: p.mention_count,
    };
  });
}

/**
 * Get recent topics from memories (last 7 days)
 */
async function getRecentTopics(
  db: D1Database,
  userId: string
): Promise<string[]> {
  // Get most discussed entities from recent memories
  const topics = await db.prepare(`
    SELECT e.name, COUNT(*) as cnt
    FROM entities e
    JOIN entity_mentions em ON em.entity_id = e.id
    JOIN memories m ON m.id = em.memory_id
    WHERE e.user_id = ?
    AND m.created_at > datetime('now', '-7 days')
    AND e.type NOT IN ('person') -- Exclude people, focus on topics
    GROUP BY e.id
    ORDER BY cnt DESC
    LIMIT 10
  `).bind(userId).all();

  return (topics.results as any[]).map(t => t.name);
}

/**
 * Get upcoming commitments
 */
async function getUpcomingCommitments(
  db: D1Database,
  userId: string
): Promise<Array<{ content: string; dueDate: string | null; entityName: string | null }>> {
  const commitments = await db.prepare(`
    SELECT
      c.content,
      c.due_date,
      e.name as entity_name
    FROM commitments c
    LEFT JOIN entities e ON c.entity_id = e.id
    WHERE c.user_id = ?
    AND c.status = 'active'
    AND (c.due_date IS NULL OR c.due_date >= date('now'))
    ORDER BY
      CASE WHEN c.due_date IS NULL THEN 1 ELSE 0 END,
      c.due_date
    LIMIT 10
  `).bind(userId).all();

  return (commitments.results as any[]).map(c => ({
    content: c.content,
    dueDate: c.due_date,
    entityName: c.entity_name,
  }));
}

/**
 * Get user stats
 */
async function getUserStats(
  db: D1Database,
  userId: string
): Promise<{ totalMemories: number; totalEntities: number }> {
  const [memories, entities] = await Promise.all([
    db.prepare('SELECT COUNT(*) as count FROM memories WHERE user_id = ?').bind(userId).first<{ count: number }>(),
    db.prepare('SELECT COUNT(*) as count FROM entities WHERE user_id = ?').bind(userId).first<{ count: number }>(),
  ]);

  return {
    totalMemories: memories?.count || 0,
    totalEntities: entities?.count || 0,
  };
}

/**
 * Reverse geocode coordinates to city (simplified)
 * In production, use a real geocoding API
 */
async function reverseGeocodeToCity(
  latitude: number,
  longitude: number
): Promise<{ name: string; country: string; timezone: string } | null> {
  // Simplified: Check if coordinates are in known Indian cities
  const cities = [
    { name: 'Bangalore', lat: 12.9716, lon: 77.5946, country: 'India', timezone: 'Asia/Kolkata' },
    { name: 'Hyderabad', lat: 17.3850, lon: 78.4867, country: 'India', timezone: 'Asia/Kolkata' },
    { name: 'Mumbai', lat: 19.0760, lon: 72.8777, country: 'India', timezone: 'Asia/Kolkata' },
    { name: 'Delhi', lat: 28.7041, lon: 77.1025, country: 'India', timezone: 'Asia/Kolkata' },
    { name: 'Chennai', lat: 13.0827, lon: 80.2707, country: 'India', timezone: 'Asia/Kolkata' },
    { name: 'Pune', lat: 18.5204, lon: 73.8567, country: 'India', timezone: 'Asia/Kolkata' },
    { name: 'Kolkata', lat: 22.5726, lon: 88.3639, country: 'India', timezone: 'Asia/Kolkata' },
  ];

  // Find closest city within 50km
  for (const city of cities) {
    const distance = haversineDistance(latitude, longitude, city.lat, city.lon);
    if (distance < 50) {
      return { name: city.name, country: city.country, timezone: city.timezone };
    }
  }

  return null;
}

/**
 * Calculate distance between two coordinates in km
 */
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Format user context for injection into system prompt
 */
export function formatContextForPrompt(context: UserContext, userName?: string): string {
  const parts: string[] = [];

  // Location
  if (context.location) {
    parts.push(`LOCATION: User is in ${context.location.city}, ${context.location.country} (${context.location.timezone})`);
  }

  // Important people
  if (context.importantPeople.length > 0) {
    const peopleList = context.importantPeople
      .slice(0, 10)
      .map(p => {
        let desc = p.name;
        if (p.relationship) desc += ` (${p.relationship})`;
        if (p.daysSinceContact !== null && p.daysSinceContact > 14) {
          desc += ` - haven't talked in ${p.daysSinceContact} days`;
        }
        return desc;
      })
      .join(', ');
    parts.push(`IMPORTANT PEOPLE: ${peopleList}`);
  }

  // Active projects
  if (context.projects.length > 0) {
    const projectList = context.projects.map(p => p.name).join(', ');
    parts.push(`ACTIVE PROJECTS: ${projectList}`);
  }

  // Recent topics
  if (context.recentTopics.length > 0) {
    parts.push(`RECENT TOPICS: ${context.recentTopics.slice(0, 5).join(', ')}`);
  }

  // Upcoming commitments
  if (context.upcomingCommitments.length > 0) {
    const commitmentList = context.upcomingCommitments
      .slice(0, 5)
      .map(c => {
        let desc = c.content;
        if (c.dueDate) desc += ` (due ${c.dueDate})`;
        if (c.entityName) desc += ` - for ${c.entityName}`;
        return desc;
      })
      .join('; ');
    parts.push(`UPCOMING COMMITMENTS: ${commitmentList}`);
  }

  // Preferences
  if (context.preferences.cuisines.length > 0) {
    parts.push(`FOOD PREFERENCES: ${context.preferences.cuisines.join(', ')}`);
  }

  if (context.preferences.interests.length > 0) {
    parts.push(`INTERESTS: ${context.preferences.interests.join(', ')}`);
  }

  if (parts.length === 0) {
    return '';
  }

  return `
=== USER CONTEXT (USE THIS - DON'T ASK FOR IT) ===
${parts.join('\n')}

RULES:
- When asked about restaurants/places, search near ${context.location?.city || 'their location'} without asking
- When user mentions a name, check if it's someone important to them
- Reference their active projects and commitments when relevant
- Don't ask for information you already have above
===`;
}
