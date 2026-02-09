/**
 * Agent Configuration Loader
 *
 * Loads agent configs from D1 with user-specific overrides
 * and template variable replacement.
 */

import type { Bindings } from '../types';

export type AgentType = 'interaction' | 'execution' | 'proactive';

export interface AgentConfig {
  id: string;
  userId: string | null;
  agentType: AgentType;
  systemPrompt: string;
  model: string;
  temperature: number;
  maxTokens: number;
  toolsEnabled: string[];
  metadata: {
    rateLimits?: {
      maxPerHour: number;
      maxPerDay: number;
    };
    timeoutMs?: number;
    fallbackModel?: string;
    [key: string]: any;
  };
  active: boolean;
}

export interface TemplateContext {
  userName: string;
  userEmail: string;
  currentDate: string;
  currentTime: string;
  timezone?: string;
}

// Request-scoped cache for configs
const configCache = new Map<string, AgentConfig>();

/**
 * Parse a D1 row into AgentConfig
 */
function parseConfigRow(row: any): AgentConfig {
  return {
    id: row.id,
    userId: row.user_id,
    agentType: row.agent_type as AgentType,
    systemPrompt: row.system_prompt,
    model: row.model,
    temperature: row.temperature ?? 0.7,
    maxTokens: row.max_tokens ?? 1500,
    toolsEnabled: JSON.parse(row.tools_enabled || '[]'),
    metadata: JSON.parse(row.metadata || '{}'),
    active: row.active === 1,
  };
}

/**
 * Replace template variables in system prompt
 */
export function applyTemplateVariables(
  systemPrompt: string,
  context: TemplateContext
): string {
  const now = new Date();

  // Format date and time with timezone if provided
  const dateOptions: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: context.timezone || 'UTC',
  };

  const timeOptions: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: context.timezone || 'UTC',
  };

  const currentDate = context.currentDate || now.toLocaleDateString('en-US', dateOptions);
  const currentTime = context.currentTime || now.toLocaleTimeString('en-US', timeOptions);

  return systemPrompt
    .replace(/\{\{user_name\}\}/g, context.userName || 'there')
    .replace(/\{\{user_email\}\}/g, context.userEmail || '')
    .replace(/\{\{current_date\}\}/g, currentDate)
    .replace(/\{\{current_time\}\}/g, currentTime);
}

/**
 * Get agent config for a specific user and agent type.
 * Checks for user-specific override first, falls back to global default.
 */
export async function getAgentConfig(
  db: D1Database,
  agentType: AgentType,
  userId: string | null,
  templateContext?: TemplateContext
): Promise<AgentConfig | null> {
  // Check request-scoped cache
  const cacheKey = `${userId || 'global'}-${agentType}`;
  if (configCache.has(cacheKey)) {
    const cached = configCache.get(cacheKey)!;
    if (templateContext) {
      return {
        ...cached,
        systemPrompt: applyTemplateVariables(cached.systemPrompt, templateContext),
      };
    }
    return cached;
  }

  let config: AgentConfig | null = null;

  // Try user-specific config first
  if (userId) {
    const userConfig = await db
      .prepare(
        `SELECT * FROM agent_configs
         WHERE user_id = ? AND agent_type = ? AND active = 1`
      )
      .bind(userId, agentType)
      .first();

    if (userConfig) {
      config = parseConfigRow(userConfig);
    }
  }

  // Fall back to global default
  if (!config) {
    const globalConfig = await db
      .prepare(
        `SELECT * FROM agent_configs
         WHERE user_id IS NULL AND agent_type = ? AND active = 1`
      )
      .bind(agentType)
      .first();

    if (globalConfig) {
      config = parseConfigRow(globalConfig);
    }
  }

  if (!config) {
    console.warn(`[AgentConfig] No config found for agent type: ${agentType}`);
    return null;
  }

  // Cache the raw config (without template replacements)
  configCache.set(cacheKey, config);

  // Apply template variables if context provided
  if (templateContext) {
    return {
      ...config,
      systemPrompt: applyTemplateVariables(config.systemPrompt, templateContext),
    };
  }

  return config;
}

/**
 * Get all configs for a user (with global fallbacks)
 */
export async function getAllAgentConfigs(
  db: D1Database,
  userId: string | null,
  templateContext?: TemplateContext
): Promise<Map<AgentType, AgentConfig>> {
  const agentTypes: AgentType[] = ['interaction', 'execution', 'proactive'];
  const configs = new Map<AgentType, AgentConfig>();

  for (const agentType of agentTypes) {
    const config = await getAgentConfig(db, agentType, userId, templateContext);
    if (config) {
      configs.set(agentType, config);
    }
  }

  return configs;
}

/**
 * Clear the request-scoped config cache.
 * Call this at the start of each request if needed.
 */
export function clearConfigCache(): void {
  configCache.clear();
}

/**
 * Create or update a user-specific agent config override
 */
export async function upsertAgentConfig(
  db: D1Database,
  userId: string,
  agentType: AgentType,
  updates: Partial<{
    systemPrompt: string;
    model: string;
    temperature: number;
    maxTokens: number;
    toolsEnabled: string[];
    metadata: Record<string, any>;
    active: boolean;
  }>
): Promise<AgentConfig> {
  const now = new Date().toISOString();

  // Check if user config exists
  const existing = await db
    .prepare('SELECT id FROM agent_configs WHERE user_id = ? AND agent_type = ?')
    .bind(userId, agentType)
    .first();

  if (existing) {
    // Update existing
    const setClauses: string[] = ['updated_at = ?'];
    const values: any[] = [now];

    if (updates.systemPrompt !== undefined) {
      setClauses.push('system_prompt = ?');
      values.push(updates.systemPrompt);
    }
    if (updates.model !== undefined) {
      setClauses.push('model = ?');
      values.push(updates.model);
    }
    if (updates.temperature !== undefined) {
      setClauses.push('temperature = ?');
      values.push(updates.temperature);
    }
    if (updates.maxTokens !== undefined) {
      setClauses.push('max_tokens = ?');
      values.push(updates.maxTokens);
    }
    if (updates.toolsEnabled !== undefined) {
      setClauses.push('tools_enabled = ?');
      values.push(JSON.stringify(updates.toolsEnabled));
    }
    if (updates.metadata !== undefined) {
      setClauses.push('metadata = ?');
      values.push(JSON.stringify(updates.metadata));
    }
    if (updates.active !== undefined) {
      setClauses.push('active = ?');
      values.push(updates.active ? 1 : 0);
    }

    values.push(userId, agentType);

    await db
      .prepare(
        `UPDATE agent_configs SET ${setClauses.join(', ')}
         WHERE user_id = ? AND agent_type = ?`
      )
      .bind(...values)
      .run();
  } else {
    // Get global default as base
    const globalConfig = await getAgentConfig(db, agentType, null);
    if (!globalConfig) {
      throw new Error(`No global config found for agent type: ${agentType}`);
    }

    const id = crypto.randomUUID().replace(/-/g, '').toLowerCase();

    await db
      .prepare(
        `INSERT INTO agent_configs
         (id, user_id, agent_type, system_prompt, model, temperature, max_tokens, tools_enabled, metadata, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        userId,
        agentType,
        updates.systemPrompt ?? globalConfig.systemPrompt,
        updates.model ?? globalConfig.model,
        updates.temperature ?? globalConfig.temperature,
        updates.maxTokens ?? globalConfig.maxTokens,
        JSON.stringify(updates.toolsEnabled ?? globalConfig.toolsEnabled),
        JSON.stringify(updates.metadata ?? globalConfig.metadata),
        updates.active !== undefined ? (updates.active ? 1 : 0) : 1,
        now,
        now
      )
      .run();
  }

  // Clear cache and return updated config
  configCache.delete(`${userId}-${agentType}`);

  const updatedConfig = await getAgentConfig(db, agentType, userId);
  if (!updatedConfig) {
    throw new Error('Failed to retrieve updated config');
  }

  return updatedConfig;
}

/**
 * Delete a user-specific config override (reverts to global default)
 */
export async function deleteUserConfig(
  db: D1Database,
  userId: string,
  agentType: AgentType
): Promise<void> {
  await db
    .prepare('DELETE FROM agent_configs WHERE user_id = ? AND agent_type = ?')
    .bind(userId, agentType)
    .run();

  configCache.delete(`${userId}-${agentType}`);
}

/**
 * Get model pricing for cost estimation
 */
export function getModelPricing(model: string): { inputPer1k: number; outputPer1k: number } {
  const pricing: Record<string, { inputPer1k: number; outputPer1k: number }> = {
    'gpt-4o': { inputPer1k: 0.005, outputPer1k: 0.015 },
    'gpt-4o-mini': { inputPer1k: 0.00015, outputPer1k: 0.0006 },
    'gpt-4-turbo': { inputPer1k: 0.01, outputPer1k: 0.03 },
    'gpt-3.5-turbo': { inputPer1k: 0.0005, outputPer1k: 0.0015 },
  };

  return pricing[model] || pricing['gpt-4o-mini'];
}

/**
 * Calculate cost estimate for an agent execution
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = getModelPricing(model);
  return (inputTokens / 1000) * pricing.inputPer1k + (outputTokens / 1000) * pricing.outputPer1k;
}
