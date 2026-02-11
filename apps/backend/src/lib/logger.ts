/**
 * Structured Logger for Cloudflare Workers
 *
 * Outputs JSON-formatted logs that work well with:
 * - Cloudflare Workers logs
 * - Log aggregation services (Datadog, Logflare, etc.)
 * - Local development (colorized output)
 *
 * Usage:
 * ```ts
 * const log = createLogger('MyService');
 * log.info('User logged in', { userId: '123', method: 'oauth' });
 * log.error('Payment failed', { orderId: '456', error: err.message });
 * ```
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  /** ISO timestamp */
  timestamp: string;
  /** Log level */
  level: LogLevel;
  /** Service/module name */
  service: string;
  /** Log message */
  message: string;
  /** Structured data */
  data?: Record<string, any>;
  /** Error details (if applicable) */
  error?: {
    message: string;
    stack?: string;
    name?: string;
  };
  /** Request context (if available) */
  request?: {
    method?: string;
    path?: string;
    userId?: string;
    requestId?: string;
  };
}

export interface LoggerOptions {
  /** Minimum level to log (default: 'info') */
  minLevel?: LogLevel;
  /** Additional context to include in every log */
  context?: Record<string, any>;
  /** Whether to output as JSON (default: true in production) */
  json?: boolean;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m', // Cyan
  info: '\x1b[32m',  // Green
  warn: '\x1b[33m',  // Yellow
  error: '\x1b[31m', // Red
};

const RESET = '\x1b[0m';

export class Logger {
  private service: string;
  private minLevel: LogLevel;
  private context: Record<string, any>;
  private useJson: boolean;

  constructor(service: string, options: LoggerOptions = {}) {
    this.service = service;
    this.minLevel = options.minLevel || 'info';
    this.context = options.context || {};
    // Default to JSON in Workers environment
    this.useJson = options.json ?? (typeof (globalThis as any).navigator === 'undefined');
  }

  /**
   * Create a child logger with additional context
   */
  child(additionalContext: Record<string, any>): Logger {
    return new Logger(this.service, {
      minLevel: this.minLevel,
      context: { ...this.context, ...additionalContext },
      json: this.useJson,
    });
  }

  /**
   * Log at debug level
   */
  debug(message: string, data?: Record<string, any>): void {
    this.log('debug', message, data);
  }

  /**
   * Log at info level
   */
  info(message: string, data?: Record<string, any>): void {
    this.log('info', message, data);
  }

  /**
   * Log at warn level
   */
  warn(message: string, data?: Record<string, any>): void {
    this.log('warn', message, data);
  }

  /**
   * Log at error level
   */
  error(message: string, error?: Error | any, data?: Record<string, any>): void {
    const errorDetails = error instanceof Error
      ? { message: error.message, stack: error.stack, name: error.name }
      : error
        ? { message: String(error) }
        : undefined;

    this.log('error', message, data, errorDetails);
  }

  /**
   * Internal log method
   */
  private log(
    level: LogLevel,
    message: string,
    data?: Record<string, any>,
    error?: LogEntry['error']
  ): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minLevel]) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      message,
    };

    // Add context and data
    if (Object.keys(this.context).length > 0 || data) {
      entry.data = { ...this.context, ...data };
    }

    // Add error if present
    if (error) {
      entry.error = error;
    }

    // Output
    if (this.useJson) {
      this.outputJson(level, entry);
    } else {
      this.outputPretty(level, entry);
    }
  }

  /**
   * Output as JSON (for production/Workers)
   */
  private outputJson(level: LogLevel, entry: LogEntry): void {
    const output = JSON.stringify(entry);

    switch (level) {
      case 'debug':
        console.debug(output);
        break;
      case 'info':
        console.info(output);
        break;
      case 'warn':
        console.warn(output);
        break;
      case 'error':
        console.error(output);
        break;
    }
  }

  /**
   * Output as pretty-printed (for local development)
   */
  private outputPretty(level: LogLevel, entry: LogEntry): void {
    const color = LEVEL_COLORS[level];
    const levelStr = level.toUpperCase().padEnd(5);
    const timestamp = entry.timestamp.substring(11, 23); // HH:mm:ss.SSS

    let output = `${color}[${levelStr}]${RESET} ${timestamp} [${this.service}] ${entry.message}`;

    if (entry.data && Object.keys(entry.data).length > 0) {
      output += ` ${JSON.stringify(entry.data)}`;
    }

    if (entry.error) {
      output += `\n  Error: ${entry.error.message}`;
      if (entry.error.stack) {
        output += `\n  ${entry.error.stack.split('\n').slice(1).join('\n  ')}`;
      }
    }

    switch (level) {
      case 'debug':
        console.debug(output);
        break;
      case 'info':
        console.info(output);
        break;
      case 'warn':
        console.warn(output);
        break;
      case 'error':
        console.error(output);
        break;
    }
  }

  /**
   * Log with request context (for middleware)
   */
  withRequest(request: {
    method?: string;
    path?: string;
    userId?: string;
    requestId?: string;
  }): Logger {
    return this.child({ request });
  }
}

/**
 * Create a new logger instance
 */
export function createLogger(service: string, options?: LoggerOptions): Logger {
  return new Logger(service, options);
}

/**
 * Default loggers for common services
 */
export const log = {
  api: createLogger('API'),
  queue: createLogger('Queue'),
  processing: createLogger('Processing'),
  composio: createLogger('Composio'),
  auth: createLogger('Auth'),
  db: createLogger('DB'),
  cache: createLogger('Cache'),
  cron: createLogger('Cron'),
  webhook: createLogger('Webhook'),
  sync: createLogger('Sync'),
  notification: createLogger('Notification'),
  crypto: createLogger('Crypto'),
  dlq: createLogger('DLQ'),
  mcp: createLogger('MCP'),
  agent: createLogger('Agent'),
};

/**
 * Cron-specific logging with metrics
 */
export interface CronTaskResult {
  name: string;
  status: 'success' | 'error' | 'timeout' | 'skipped';
  durationMs: number;
  llmCalls?: number;
  error?: string;
}

export interface CronResult {
  interval: string;
  tasks: CronTaskResult[];
  totalDurationMs: number;
  totalLLMCalls: number;
  wallTimeExceeded: boolean;
}

export function logCronResult(result: CronResult): void {
  const hasErrors = result.tasks.some(t => t.status === 'error');
  const logger = log.cron;

  if (hasErrors) {
    logger.warn('cron_completed_with_errors', {
      interval: result.interval,
      taskCount: result.tasks.length,
      successCount: result.tasks.filter(t => t.status === 'success').length,
      errorCount: result.tasks.filter(t => t.status === 'error').length,
      skippedCount: result.tasks.filter(t => t.status === 'skipped').length,
      totalLLMCalls: result.totalLLMCalls,
      totalDurationMs: result.totalDurationMs,
      wallTimeExceeded: result.wallTimeExceeded,
      tasks: result.tasks,
    });
  } else {
    logger.info('cron_completed', {
      interval: result.interval,
      taskCount: result.tasks.length,
      totalLLMCalls: result.totalLLMCalls,
      totalDurationMs: result.totalDurationMs,
      wallTimeExceeded: result.wallTimeExceeded,
      tasks: result.tasks.map(t => ({
        name: t.name,
        status: t.status,
        durationMs: t.durationMs,
      })),
    });
  }
}

/**
 * Timed operation helper - logs duration on completion
 */
export async function timed<T>(
  logger: Logger,
  operation: string,
  fn: () => Promise<T>,
  metadata?: Record<string, any>
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    logger.info(operation, {
      ...metadata,
      durationMs: Date.now() - start,
      success: true,
    });
    return result;
  } catch (error) {
    logger.error(operation, error, {
      ...metadata,
      durationMs: Date.now() - start,
    });
    throw error;
  }
}
