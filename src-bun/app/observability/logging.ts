// JSON-lines logger with redaction + live subscribers.
//
// Output is two-pronged:
//   * stderr mirror in dev (always; for warn/error always).
//   * `<logDir>/dafman-YYYY-MM-DD.log` file (newline-delimited JSON).
//   * Live in-process subscribers (the in-app log viewer).
//
// Levels: trace / debug / info / warn / error. `setLevel` mutates at
// runtime so Settings → Diagnostics can switch verbosity without a
// restart. Subscribers receive every emitted record regardless of the
// filter level — gating happens client-side in the viewer so the user
// can flip the filter without missing data.
//
// Domain modules import `log` directly; no Tauri-style instrumentation
// macros to maintain.

import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { redactFields } from '../shared/redact';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};

/// One emitted log record. Stable shape for the wire contract.
export interface LogRecord {
  ts: string; // ISO-8601 UTC
  level: LogLevel;
  message: string;
  [key: string]: unknown; // structured fields (already redacted)
}

interface LoggerConfig {
  level: LogLevel;
  logDir: string | null;
}

const config: LoggerConfig = {
  level: parseLevel(process.env.DAFMAN_LOG) ?? 'info',
  logDir: null,
};

type Subscriber = (record: LogRecord) => void;
const subscribers = new Set<Subscriber>();

/// Ring buffer of recent records, for the in-app log viewer's initial
/// fill. The renderer subscribes via `subscribeLogs()` for live tail,
/// but a fresh subscription needs prior context (e.g. an error that
/// happened at startup before the panel was opened).
const RECENT_CAP = 1000;
const recent: LogRecord[] = [];

function parseLevel(raw: string | undefined): LogLevel | null {
  if (!raw) return null;

  const lc = raw.toLowerCase().trim();

  if (lc in LEVEL_ORDER) return lc as LogLevel;

  return null;
}

function shouldEmit(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[config.level];
}

function currentLogFile(): string | null {
  if (!config.logDir) return null;

  const now = new Date();
  const stamp = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;

  return join(config.logDir, `dafman-${stamp}.log`);
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/// Build a record. Fields run through `redactFields` so secrets / large
/// payloads / prompts never reach disk or subscribers. The exported
/// function is also reusable in tests that want to verify the redaction
/// pipeline directly.
export function buildRecord(
  level: LogLevel,
  message: string,
  fields?: Record<string, unknown>,
): LogRecord {
  const redacted = fields ? redactFields(fields) : undefined;

  return {
    ts: new Date().toISOString(),
    level,
    message,
    ...(redacted ?? {}),
  };
}

async function emit(
  level: LogLevel,
  message: string,
  fields?: Record<string, unknown>,
): Promise<void> {
  const record = buildRecord(level, message, fields);

  // Fan-out happens irrespective of the configured level so subscribers
  // (in-app log viewer) see everything. The viewer applies its own
  // filter.
  pushRecent(record);

  for (const sub of subscribers) {
    try {
      sub(record);
    } catch {
      // Subscriber errors are not logger's problem.
    }
  }

  // Below-level records skip stderr + file IO but DO still feed
  // subscribers + the ring buffer (so a user who flips the filter to
  // debug sees recent debug context).
  if (!shouldEmit(level)) return;

  const line = `${JSON.stringify(record)}\n`;

  if (level === 'error' || level === 'warn' || isDev()) {
    process.stderr.write(line);
  }

  const file = currentLogFile();

  if (!file) return;

  try {
    await appendFile(file, line);
  } catch {
    // Best-effort; never let logging crash the host.
  }
}

function pushRecent(record: LogRecord) {
  recent.push(record);

  if (recent.length > RECENT_CAP) {
    recent.splice(0, recent.length - RECENT_CAP);
  }
}

function isDev(): boolean {
  return process.env.NODE_ENV !== 'production';
}

export const log = {
  trace: (msg: string, fields?: Record<string, unknown>) => void emit('trace', msg, fields),
  debug: (msg: string, fields?: Record<string, unknown>) => void emit('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => void emit('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => void emit('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => void emit('error', msg, fields),
};

export interface InitLoggerOptions {
  logDir: string;
  level?: LogLevel;
}

export async function initLogger(opts: InitLoggerOptions): Promise<void> {
  config.logDir = opts.logDir;

  if (opts.level) config.level = opts.level;

  try {
    await mkdir(opts.logDir, { recursive: true });
  } catch {
    // Same best-effort posture: logger should never block startup.
  }
}

export function getLogDir(): string {
  return config.logDir ?? '';
}

export function getLogLevel(): LogLevel {
  return config.level;
}

/// Mutate the level at runtime. Used by Settings → Diagnostics.
export function setLogLevel(level: LogLevel): LogLevel {
  config.level = level;

  return level;
}

/// Subscribe to live log records. Returns an unsubscribe callback.
/// Subscribers get EVERY emitted record (no level filter) so the
/// in-app viewer can switch its filter without losing history.
export function subscribeLogs(fn: Subscriber): () => void {
  subscribers.add(fn);

  return () => {
    subscribers.delete(fn);
  };
}

/// Snapshot of recent records (most recent last). Used by the in-app
/// viewer to fill on open. Capped at RECENT_CAP (1000) entries.
export function recentLogs(limit?: number): LogRecord[] {
  if (limit === undefined || limit >= recent.length) {
    return recent.slice();
  }

  return recent.slice(recent.length - limit);
}

/// Test-only: reset internal state.
export function _resetLogger(): void {
  config.logDir = null;
  config.level = parseLevel(process.env.DAFMAN_LOG) ?? 'info';
  subscribers.clear();
  recent.length = 0;
}
