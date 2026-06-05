// Single-instance guard for the dafman main process.
//
// Two dafman instances on the SAME build channel share one WebView2
// user-data folder + the same dafman-owned JSON state (settings, session
// metadata, audit, command results). That contention crashes the webview
// (observed: three concurrent dev-channel instances → silent webview death).
// Electrobun ships no single-instance API, so we roll our own PID lockfile.
//
// Scope: the lock lives in `Utils.paths.userData`, which is keyed on the
// build channel (dev/canary/stable). So it blocks accidental duplicates
// WITHIN a channel while letting different channels run side-by-side — that
// cross-channel coexistence is the supported "second instance for
// development" workflow (see `bun run install:canary`).
//
// Framework-agnostic on purpose (no electrobun import) so `bun test` can
// exercise it directly, per the src-bun/app/ rule.

import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface SingleInstanceLock {
  /** True if this process now owns the lock and should keep running. */
  acquired: boolean;
  /** PID of the live instance already holding the lock, when `acquired` is false. */
  existingPid?: number;
  /** Idempotent; removes the lockfile only if this process still owns it. */
  release: () => void;
}

export interface AcquireOptions {
  /** Defaults to `process.pid`. Injectable for tests. */
  pid?: number;
  /** Defaults to a random UUID. Injectable for tests. */
  token?: string;
  /** Defaults to a `process.kill(pid, 0)` liveness probe. Injectable for tests. */
  isProcessAlive?: (pid: number) => boolean;
}

interface LockContent {
  pid: number;
  token: string;
  startedAt: string;
}

const noop = (): void => {};
const MAX_ATTEMPTS = 5;

function defaultIsProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;

  try {
    // Signal 0 performs error checking without actually sending a signal:
    // succeeds if the process exists, throws ESRCH if it doesn't, and
    // throws EPERM if it exists but we lack permission to signal it.
    process.kill(pid, 0);

    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readLock(lockPath: string): LockContent | null {
  try {
    const raw = readFileSync(lockPath, 'utf8').trim();

    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<LockContent>;

    if (typeof parsed.pid !== 'number' || typeof parsed.token !== 'string') {
      return null;
    }

    return {
      pid: parsed.pid,
      token: parsed.token,
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : '',
    };
  } catch {
    // Missing, unreadable, or corrupt — treat as "no valid lock".
    return null;
  }
}

/**
 * Try to become the sole instance for the given lock path.
 *
 * Acquisition is atomic via `O_CREAT | O_EXCL` (the `wx` flag). When the
 * lockfile already exists we inspect the recorded PID: a live foreign PID
 * means another instance is running (we back off); a dead/corrupt/own PID is
 * a stale lock left by a crash, which we remove and retry. After creating the
 * lock we read it back and confirm our token is still present, closing the
 * narrow window where a racing starter takes over the same stale lock.
 *
 * On unexpected filesystem errors we FAIL OPEN (acquire with a no-op release)
 * rather than brick startup over a lockfile glitch; the caller logs loudly.
 */
export function acquireSingleInstanceLock(
  lockPath: string,
  options: AcquireOptions = {},
): SingleInstanceLock {
  const pid = options.pid ?? process.pid;
  const token = options.token ?? randomUUID();
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const content = JSON.stringify({
    pid,
    token,
    startedAt: new Date().toISOString(),
  } satisfies LockContent);

  try {
    mkdirSync(dirname(lockPath), { recursive: true });
  } catch {
    // Non-fatal; the open below surfaces a genuine problem.
  }

  const makeRelease = (): (() => void) => {
    let released = false;

    return () => {
      if (released) return;

      released = true;

      const current = readLock(lockPath);

      if (current && current.token === token) {
        try {
          rmSync(lockPath, { force: true });
        } catch {
          // Best-effort; a stale file is reclaimed on next startup anyway.
        }
      }
    };
  };

  // One claim attempt. Returns a resolved lock, or `null` to retry the
  // loop (our fresh lock was stolen, or we just reclaimed a stale file).
  const claimFreshLock = (): SingleInstanceLock | null => {
    const fd = openSync(lockPath, 'wx');

    try {
      writeSync(fd, content);
    } finally {
      closeSync(fd);
    }

    // Read-back verify: if a lagging starter removed our fresh lock and
    // wrote its own, our token is gone and we must defer to the new owner.
    const confirmed = readLock(lockPath);

    if (!confirmed || confirmed.token !== token) {
      if (confirmed && confirmed.pid !== pid && isProcessAlive(confirmed.pid)) {
        return { acquired: false, existingPid: confirmed.pid, release: noop };
      }

      return null;
    }

    return { acquired: true, release: makeRelease() };
  };

  // EEXIST path: a lock already exists. Defer to a live foreign owner,
  // otherwise reclaim a stale/corrupt/own-leftover file and retry.
  const reclaimOrDefer = (): SingleInstanceLock | null => {
    const existing = readLock(lockPath);

    if (existing && existing.pid !== pid && isProcessAlive(existing.pid)) {
      return { acquired: false, existingPid: existing.pid, release: noop };
    }

    try {
      rmSync(lockPath, { force: true });
    } catch {
      // Ignore; the loop retries.
    }

    return null;
  };

  const attemptClaim = (): SingleInstanceLock | null => {
    try {
      return claimFreshLock();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        // Unwritable lock dir / unexpected error — fail open.
        return { acquired: true, release: noop };
      }

      return reclaimOrDefer();
    }
  };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const lock = attemptClaim();

    if (lock) return lock;
  }

  // Persistent race (should be unreachable in practice) — fail open.
  return { acquired: true, release: noop };
}
