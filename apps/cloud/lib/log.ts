import { AsyncLocalStorage } from "node:async_hooks";

// ---------------------------------------------------------------------------
// Log context (requestId scoped via AsyncLocalStorage)
// ---------------------------------------------------------------------------

export const logContext = new AsyncLocalStorage<{ requestId: string }>();

/** Extract the current requestId from ALS, if any. */
function currentRequestId(): string | undefined {
  const store = logContext.getStore();
  return store ? store.requestId : undefined;
}

// ---------------------------------------------------------------------------
// Log levels
// ---------------------------------------------------------------------------

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const EFFECTIVE_LEVEL: number = LOG_LEVELS[process.env.LOG_LEVEL as LogLevel] ?? LOG_LEVELS.info;

// ---------------------------------------------------------------------------
// Structured log entry
// ---------------------------------------------------------------------------

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  requestId: string | undefined;
  [key: string]: unknown;
}

function writeEntry(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (LOG_LEVELS[level] < EFFECTIVE_LEVEL) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    requestId: currentRequestId(),
    ...meta,
  };

  const line = JSON.stringify(entry) + "\n";

  if (level === "error" || level === "warn") {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => writeEntry("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) => writeEntry("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => writeEntry("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => writeEntry("error", message, meta),
};
