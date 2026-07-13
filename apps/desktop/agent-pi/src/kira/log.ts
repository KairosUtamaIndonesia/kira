/**
 * Minimal structured logger for the agent runtime.
 *
 * `no-console` is suppressed here intentionally — this is a backend
 * process where console output is the primary operational log sink.
 */

/* eslint-disable no-console */

export const logger = {
  error: (message?: unknown, ...optional: unknown[]) => {
    console.error(message, ...optional);
  },
  warn: (message?: unknown, ...optional: unknown[]) => {
    console.warn(message, ...optional);
  },
  info: (message?: unknown, ...optional: unknown[]) => {
    console.info(message, ...optional);
  },
  log: (message?: unknown, ...optional: unknown[]) => {
    console.log(message, ...optional);
  },
};
