// Tiny JSON-lines logger.
//
// Replaces the Rust `tracing` + daily-rotating file appender. Levels
// match the old crate (`error`/`warn`/`info`/`debug`/`trace`). Output
// goes to:
//   - stderr in dev (level >= debug by default)
//   - `<logDir>/dafman-YYYY-MM-DD.log` (newline-delimited JSON)
//
// The log directory is resolved at app start (typically
// `Utils.paths.userLogs`) and threaded into `init`. Until `init` is
// called the logger writes to stderr only — handy for unit tests under
// `bun test` where filesystem side-effects are unwanted.
//
// Domain modules import `log` directly; no Tauri-style instrumentation
// macros to maintain.

import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
	trace: 10,
	debug: 20,
	info: 30,
	warn: 40,
	error: 50,
};

interface LoggerConfig {
	level: LogLevel;
	logDir: string | null;
}

const config: LoggerConfig = {
	level: parseLevel(process.env.DAFMAN_LOG) ?? "info",
	logDir: null,
};

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

async function emit(
	level: LogLevel,
	message: string,
	fields?: Record<string, unknown>,
): Promise<void> {
	if (!shouldEmit(level)) return;
	const record = {
		ts: new Date().toISOString(),
		level,
		message,
		...(fields ?? {}),
	};
	const line = `${JSON.stringify(record)}\n`;
	// Stderr mirror for dev visibility. Errors and warnings always echo.
	if (level === "error" || level === "warn" || isDev()) {
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

function isDev(): boolean {
	return process.env.NODE_ENV !== "production";
}

export const log = {
	trace: (msg: string, fields?: Record<string, unknown>) =>
		void emit("trace", msg, fields),
	debug: (msg: string, fields?: Record<string, unknown>) =>
		void emit("debug", msg, fields),
	info: (msg: string, fields?: Record<string, unknown>) =>
		void emit("info", msg, fields),
	warn: (msg: string, fields?: Record<string, unknown>) =>
		void emit("warn", msg, fields),
	error: (msg: string, fields?: Record<string, unknown>) =>
		void emit("error", msg, fields),
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
	return config.logDir ?? "";
}

/// Test-only: reset internal state.
export function _resetLogger(): void {
	config.logDir = null;
	config.level = parseLevel(process.env.DAFMAN_LOG) ?? "info";
}
