/**
 * Structured Logger
 *
 * Replaces console.log with structured JSON logging.
 * In production, these logs can be parsed by log aggregators.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  userId?: string;
  requestId?: string;
  memoryId?: string;
  jobId?: string;
  stage?: string;
  duration?: number;
  [key: string]: unknown;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

class Logger {
  private context: LogContext = {};
  private isProduction: boolean;

  constructor() {
    // In Cloudflare Workers, check ENVIRONMENT binding
    this.isProduction = true; // Default to production behavior
  }

  /**
   * Set context that will be included in all subsequent logs
   */
  setContext(ctx: LogContext): void {
    this.context = { ...this.context, ...ctx };
  }

  /**
   * Clear all context
   */
  clearContext(): void {
    this.context = {};
  }

  /**
   * Create a child logger with additional context
   */
  child(ctx: LogContext): Logger {
    const childLogger = new Logger();
    childLogger.context = { ...this.context, ...ctx };
    return childLogger;
  }

  private formatEntry(level: LogLevel, message: string, data?: LogContext | Error): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: { ...this.context },
    };

    if (data instanceof Error) {
      entry.error = {
        name: data.name,
        message: data.message,
        stack: data.stack,
      };
    } else if (data) {
      entry.context = { ...entry.context, ...data };
    }

    return entry;
  }

  private output(entry: LogEntry): void {
    const json = JSON.stringify(entry);

    switch (entry.level) {
      case 'error':
        console.error(json);
        break;
      case 'warn':
        console.warn(json);
        break;
      default:
        console.log(json);
    }
  }

  /**
   * Debug level - only logged in development
   */
  debug(message: string, data?: LogContext): void {
    if (!this.isProduction) {
      this.output(this.formatEntry('debug', message, data));
    }
  }

  /**
   * Info level - normal operational messages
   */
  info(message: string, data?: LogContext): void {
    this.output(this.formatEntry('info', message, data));
  }

  /**
   * Warn level - non-critical issues
   */
  warn(message: string, data?: LogContext): void {
    this.output(this.formatEntry('warn', message, data));
  }

  /**
   * Error level - errors and exceptions
   */
  error(message: string, error?: Error | LogContext): void {
    this.output(this.formatEntry('error', message, error));
  }

  /**
   * Log with timing - for performance tracking
   */
  timed(message: string, startTime: number, data?: LogContext): void {
    const duration = Date.now() - startTime;
    this.info(message, { ...data, duration });
  }
}

// Singleton logger instance
export const logger = new Logger();

// Factory for request-scoped loggers
export function createRequestLogger(requestId: string, userId?: string): Logger {
  return logger.child({ requestId, userId });
}

// Re-export types
export type { LogContext, LogLevel, LogEntry };
