/**
 * Structured Logger Module
 *
 * Provides configurable logging with severity levels and JSON output option.
 * Designed for production use where structured logging is essential.
 *
 * @packageDocumentation
 */

/**
 * JSON replacer function to handle BigInt serialization
 * BigInt values are converted to strings to avoid serialization errors
 */
function bigIntReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
}

/**
 * Log severity levels
 */
export enum LogLevel {
  /** No logging */
  SILENT = 0,
  /** Error messages only */
  ERROR = 1,
  /** Errors and warnings */
  WARN = 2,
  /** Errors, warnings, and info messages */
  INFO = 3,
  /** All messages including debug */
  DEBUG = 4,
}

/**
 * Log entry structure for JSON output
 */
export interface LogEntry {
  /** ISO timestamp */
  timestamp: string;
  /** Log level name */
  level: keyof typeof LogLevel;
  /** Log message */
  message: string;
  /** Optional context data */
  context?: Record<string, unknown>;
  /** Optional error details */
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  /** Minimum log level to output (default: INFO) */
  level?: LogLevel;
  /** Output as JSON for production (default: false) */
  json?: boolean;
  /** Include timestamps in text output (default: true) */
  timestamps?: boolean;
  /** Logger name prefix (default: 'SDK') */
  prefix?: string;
}

/**
 * Default logger configuration
 */
const DEFAULT_CONFIG: Required<LoggerConfig> = {
  level: LogLevel.INFO,
  json: false,
  timestamps: true,
  prefix: 'SDK',
};

/**
 * Structured Logger
 *
 * Provides logging with configurable levels and output formats.
 *
 * @example
 * ```typescript
 * const logger = new Logger({ level: LogLevel.DEBUG, json: true });
 *
 * logger.info('Processing withdrawal', { userId: 'user-123', amount: 10 });
 * logger.error('Withdrawal failed', { userId: 'user-123' }, new Error('RPC error'));
 * ```
 */
export class Logger {
  private readonly config: Required<LoggerConfig>;

  /**
   * Creates a new Logger
   *
   * @param config - Logger configuration
   */
  constructor(config: LoggerConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Log a debug message
   */
  debug(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  /**
   * Log an info message
   */
  info(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, context);
  }

  /**
   * Log a warning message
   */
  warn(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, context);
  }

  /**
   * Log an error message
   */
  error(message: string, context?: Record<string, unknown>, error?: Error): void {
    this.log(LogLevel.ERROR, message, context, error);
  }

  /**
   * Internal log method
   */
  private log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    error?: Error
  ): void {
    // Check if this level should be logged
    if (level > this.config.level) {
      return;
    }

    const levelName = LogLevel[level] as keyof typeof LogLevel;
    const timestamp = new Date().toISOString();

    if (this.config.json) {
      // JSON output for production
      const entry: LogEntry = {
        timestamp,
        level: levelName,
        message,
      };

      if (context && Object.keys(context).length > 0) {
        entry.context = context;
      }

      if (error) {
        entry.error = {
          name: error.name,
          message: error.message,
          stack: error.stack,
        };
      }

      // Use replacer to handle BigInt serialization
      const output = JSON.stringify(entry, bigIntReplacer);

      if (level === LogLevel.ERROR) {
        console.error(output);
      } else if (level === LogLevel.WARN) {
        console.warn(output);
      } else {
        console.log(output);
      }
    } else {
      // Human-readable text output
      const parts: string[] = [];

      if (this.config.timestamps) {
        parts.push(`[${timestamp}]`);
      }

      parts.push(`[${this.config.prefix}]`);
      parts.push(`[${levelName}]`);
      parts.push(message);

      if (context && Object.keys(context).length > 0) {
        parts.push(JSON.stringify(context, bigIntReplacer));
      }

      const output = parts.join(' ');

      if (level === LogLevel.ERROR) {
        console.error(output);
        if (error) {
          console.error(error);
        }
      } else if (level === LogLevel.WARN) {
        console.warn(output);
      } else {
        console.log(output);
      }
    }
  }

  /**
   * Create a child logger with additional context prefix
   */
  child(prefix: string): Logger {
    return new Logger({
      ...this.config,
      prefix: `${this.config.prefix}:${prefix}`,
    });
  }

  /**
   * Get the current log level
   */
  getLevel(): LogLevel {
    return this.config.level;
  }

  /**
   * Set the log level
   */
  setLevel(level: LogLevel): void {
    this.config.level = level;
  }

  /**
   * Check if a level would be logged
   */
  isLevelEnabled(level: LogLevel): boolean {
    return level <= this.config.level;
  }
}

/**
 * Creates a new Logger instance
 *
 * @param config - Logger configuration
 * @returns A new Logger
 */
export function createLogger(config?: LoggerConfig): Logger {
  return new Logger(config);
}

/**
 * Default logger instance for quick use
 */
export const defaultLogger = new Logger();
