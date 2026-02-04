/**
 * External API Rate Tracking & Per-User Budget
 *
 * Tracks usage of external APIs (OpenAI, Composio, Yelp, etc.) and enforces
 * per-user daily/monthly budgets using Cloudflare KV.
 *
 * IMPORTANT: This is for tracking OUR usage of external APIs, not for rate
 * limiting incoming requests to our API.
 */

export type ExternalAPI = 'openai' | 'composio' | 'yelp' | 'openweather' | 'tavily';

interface APIUsageRecord {
  /** Total requests made */
  requestCount: number;
  /** Estimated cost in USD (for APIs that charge per request/token) */
  estimatedCostUsd: number;
  /** Timestamp of first request in window */
  windowStart: number;
  /** Last updated timestamp */
  lastUpdated: number;
}

interface UserBudget {
  /** Daily budget in USD */
  dailyBudgetUsd: number;
  /** Monthly budget in USD */
  monthlyBudgetUsd: number;
  /** Whether user has exceeded daily budget */
  dailyExceeded: boolean;
  /** Whether user has exceeded monthly budget */
  monthlyExceeded: boolean;
}

interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  dailyUsed: number;
  monthlyUsed: number;
  dailyRemaining: number;
  monthlyRemaining: number;
}

/** Default cost estimates per API call (in USD) */
const DEFAULT_COSTS: Record<ExternalAPI, number> = {
  openai: 0.0002, // ~$0.0002 per embedding (text-embedding-3-small)
  composio: 0.001, // Estimated per action
  yelp: 0, // Free tier
  openweather: 0, // Free tier
  tavily: 0.001, // ~$0.001 per search
};

/** Default user budgets */
const DEFAULT_BUDGET: UserBudget = {
  dailyBudgetUsd: 0.50, // $0.50/day default
  monthlyBudgetUsd: 10.0, // $10/month default
  dailyExceeded: false,
  monthlyExceeded: false,
};

/**
 * External API Rate Tracker
 *
 * Tracks API usage per user and enforces budgets.
 */
export class APIRateTracker {
  constructor(
    private kv: KVNamespace,
    private defaultBudgets: Partial<UserBudget> = {}
  ) {}

  /**
   * Record an API call for a user
   */
  async recordAPICall(
    userId: string,
    api: ExternalAPI,
    options?: {
      /** Override default cost estimate */
      costUsd?: number;
      /** Number of calls to record (default 1) */
      count?: number;
    }
  ): Promise<void> {
    const cost = options?.costUsd ?? DEFAULT_COSTS[api];
    const count = options?.count ?? 1;
    const now = Date.now();

    // Update daily usage
    const dailyKey = this.getDailyKey(userId, api);
    await this.incrementUsage(dailyKey, count, cost, now, 86400); // 24h TTL

    // Update monthly usage
    const monthlyKey = this.getMonthlyKey(userId, api);
    await this.incrementUsage(monthlyKey, count, cost, now, 2678400); // 31d TTL
  }

  /**
   * Check if user is within budget before making API call
   */
  async checkBudget(
    userId: string,
    api?: ExternalAPI
  ): Promise<BudgetCheckResult> {
    const budget = { ...DEFAULT_BUDGET, ...this.defaultBudgets };
    const now = Date.now();

    // Get total daily usage across all APIs or specific API
    const dailyUsed = api
      ? await this.getUsageCost(this.getDailyKey(userId, api))
      : await this.getTotalDailyUsage(userId);

    // Get total monthly usage
    const monthlyUsed = api
      ? await this.getUsageCost(this.getMonthlyKey(userId, api))
      : await this.getTotalMonthlyUsage(userId);

    const dailyRemaining = Math.max(0, budget.dailyBudgetUsd - dailyUsed);
    const monthlyRemaining = Math.max(0, budget.monthlyBudgetUsd - monthlyUsed);

    if (dailyUsed >= budget.dailyBudgetUsd) {
      return {
        allowed: false,
        reason: `Daily budget exceeded ($${dailyUsed.toFixed(4)} / $${budget.dailyBudgetUsd.toFixed(2)})`,
        dailyUsed,
        monthlyUsed,
        dailyRemaining: 0,
        monthlyRemaining,
      };
    }

    if (monthlyUsed >= budget.monthlyBudgetUsd) {
      return {
        allowed: false,
        reason: `Monthly budget exceeded ($${monthlyUsed.toFixed(4)} / $${budget.monthlyBudgetUsd.toFixed(2)})`,
        dailyUsed,
        monthlyUsed,
        dailyRemaining,
        monthlyRemaining: 0,
      };
    }

    return {
      allowed: true,
      dailyUsed,
      monthlyUsed,
      dailyRemaining,
      monthlyRemaining,
    };
  }

  /**
   * Get usage stats for a user
   */
  async getUsageStats(
    userId: string
  ): Promise<{
    daily: Record<ExternalAPI, { requests: number; costUsd: number }>;
    monthly: Record<ExternalAPI, { requests: number; costUsd: number }>;
    totals: { dailyCost: number; monthlyCost: number };
  }> {
    const apis: ExternalAPI[] = ['openai', 'composio', 'yelp', 'openweather', 'tavily'];
    const daily: Record<string, { requests: number; costUsd: number }> = {};
    const monthly: Record<string, { requests: number; costUsd: number }> = {};
    let dailyCost = 0;
    let monthlyCost = 0;

    for (const api of apis) {
      const dailyUsage = await this.getUsage(this.getDailyKey(userId, api));
      const monthlyUsage = await this.getUsage(this.getMonthlyKey(userId, api));

      daily[api] = {
        requests: dailyUsage?.requestCount ?? 0,
        costUsd: dailyUsage?.estimatedCostUsd ?? 0,
      };
      monthly[api] = {
        requests: monthlyUsage?.requestCount ?? 0,
        costUsd: monthlyUsage?.estimatedCostUsd ?? 0,
      };

      dailyCost += daily[api].costUsd;
      monthlyCost += monthly[api].costUsd;
    }

    return {
      daily: daily as Record<ExternalAPI, { requests: number; costUsd: number }>,
      monthly: monthly as Record<ExternalAPI, { requests: number; costUsd: number }>,
      totals: { dailyCost, monthlyCost },
    };
  }

  /**
   * Set custom budget for a user
   */
  async setUserBudget(
    userId: string,
    budget: Partial<UserBudget>
  ): Promise<void> {
    const key = `budget:${userId}`;
    const existing = await this.kv.get(key);
    const current = existing ? JSON.parse(existing) : { ...DEFAULT_BUDGET };
    const updated = { ...current, ...budget };
    await this.kv.put(key, JSON.stringify(updated), { expirationTtl: 2678400 }); // 31d
  }

  /**
   * Get user's custom budget (or defaults)
   */
  async getUserBudget(userId: string): Promise<UserBudget> {
    const key = `budget:${userId}`;
    const data = await this.kv.get(key);
    if (data) {
      return { ...DEFAULT_BUDGET, ...JSON.parse(data) };
    }
    return { ...DEFAULT_BUDGET, ...this.defaultBudgets };
  }

  // Private helpers

  private getDailyKey(userId: string, api: ExternalAPI): string {
    const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return `api-usage:daily:${userId}:${api}:${day}`;
  }

  private getMonthlyKey(userId: string, api: ExternalAPI): string {
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM
    return `api-usage:monthly:${userId}:${api}:${month}`;
  }

  private async incrementUsage(
    key: string,
    count: number,
    cost: number,
    now: number,
    ttl: number
  ): Promise<void> {
    const existing = await this.kv.get(key);
    const usage: APIUsageRecord = existing
      ? JSON.parse(existing)
      : { requestCount: 0, estimatedCostUsd: 0, windowStart: now, lastUpdated: now };

    usage.requestCount += count;
    usage.estimatedCostUsd += cost * count;
    usage.lastUpdated = now;

    await this.kv.put(key, JSON.stringify(usage), { expirationTtl: ttl });
  }

  private async getUsage(key: string): Promise<APIUsageRecord | null> {
    const data = await this.kv.get(key);
    return data ? JSON.parse(data) : null;
  }

  private async getUsageCost(key: string): Promise<number> {
    const usage = await this.getUsage(key);
    return usage?.estimatedCostUsd ?? 0;
  }

  private async getTotalDailyUsage(userId: string): Promise<number> {
    const apis: ExternalAPI[] = ['openai', 'composio', 'yelp', 'openweather', 'tavily'];
    let total = 0;
    for (const api of apis) {
      total += await this.getUsageCost(this.getDailyKey(userId, api));
    }
    return total;
  }

  private async getTotalMonthlyUsage(userId: string): Promise<number> {
    const apis: ExternalAPI[] = ['openai', 'composio', 'yelp', 'openweather', 'tavily'];
    let total = 0;
    for (const api of apis) {
      total += await this.getUsageCost(this.getMonthlyKey(userId, api));
    }
    return total;
  }
}

/**
 * Factory function
 */
export function createAPIRateTracker(
  kv: KVNamespace,
  defaultBudgets?: Partial<UserBudget>
): APIRateTracker {
  return new APIRateTracker(kv, defaultBudgets);
}
