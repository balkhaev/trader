import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  meta?: Record<string, unknown>;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const COLORS: Record<LogLevel, string> = {
  debug: "\x1b[36m", // cyan
  info: "\x1b[32m", // green
  warn: "\x1b[33m", // yellow
  error: "\x1b[31m", // red
};

const RESET = "\x1b[0m";

class Logger {
  private minLevel: LogLevel;
  private logDir: string;
  private serviceName: string;

  constructor(serviceName = "server") {
    this.minLevel = (process.env.LOG_LEVEL as LogLevel) ?? "info";
    this.logDir = join(process.cwd(), "..", "..", "logs");
    this.serviceName = serviceName;

    // Ensure log directory exists
    if (!existsSync(this.logDir)) {
      try {
        mkdirSync(this.logDir, { recursive: true });
      } catch {
        // Fallback to current directory
        this.logDir = process.cwd();
      }
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.minLevel];
  }

  private formatMeta(meta?: Record<string, unknown>): string {
    if (!meta || Object.keys(meta).length === 0) return "";

    return Object.entries(meta)
      .map(([key, value]) => {
        if (typeof value === "object") {
          return `${key}=${JSON.stringify(value)}`;
        }
        return `${key}=${value}`;
      })
      .join(" ");
  }

  private formatConsole(entry: LogEntry): string {
    const color = COLORS[entry.level];
    const levelStr = entry.level.toUpperCase().padEnd(5);
    const meta = this.formatMeta(entry.meta);
    const metaStr = meta ? ` | ${meta}` : "";

    return `${color}[${entry.timestamp}] ${levelStr}${RESET} ${entry.message}${metaStr}`;
  }

  private formatFile(entry: LogEntry): string {
    const meta = entry.meta ? ` ${JSON.stringify(entry.meta)}` : "";
    return `[${entry.timestamp}] ${entry.level.toUpperCase()} ${entry.message}${meta}\n`;
  }

  private log(
    level: LogLevel,
    message: string,
    meta?: Record<string, unknown>
  ): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      meta,
    };

    // Console output
    console.log(this.formatConsole(entry));

    // File output (for errors and warnings)
    if (level === "error" || level === "warn") {
      try {
        const logFile = join(this.logDir, `${this.serviceName}.log`);
        appendFileSync(logFile, this.formatFile(entry));
      } catch {
        // Silently fail if can't write to file
      }
    }
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.log("debug", message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.log("info", message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.log("warn", message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.log("error", message, meta);
  }

  /**
   * Create a child logger with a specific context
   */
  child(context: string): Logger {
    const child = new Logger(`${this.serviceName}:${context}`);
    return child;
  }
}

// Export singleton instance
export const logger = new Logger();

// Export class for creating child loggers
export { Logger };
