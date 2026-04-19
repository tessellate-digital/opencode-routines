/**
 * Simple logger with configurable log levels.
 *
 * Set LOG_LEVEL env var to: error, warn, info, or debug (default: info)
 */

const LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
} as const;

type LogLevel = keyof typeof LEVELS;

function getLogLevel(): LogLevel {
  const env = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  if (env in LEVELS) {
    return env as LogLevel;
  }
  return 'info';
}

const currentLevel = LEVELS[getLogLevel()];

export const logger = {
  error(...args: unknown[]): void {
    if (currentLevel >= LEVELS.error) {
      console.error(`[ERROR]`, ...args);
    }
  },

  warn(...args: unknown[]): void {
    if (currentLevel >= LEVELS.warn) {
      console.warn(`[WARN]`, ...args);
    }
  },

  info(...args: unknown[]): void {
    if (currentLevel >= LEVELS.info) {
      console.log(`[INFO]`, ...args);
    }
  },

  debug(...args: unknown[]): void {
    if (currentLevel >= LEVELS.debug) {
      console.log(`[DEBUG]`, ...args);
    }
  },
};
