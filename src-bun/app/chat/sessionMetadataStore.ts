// Per-session metadata store — dafman-owned persistence for the small
// slice of session state the SDK does NOT remember across resume:
//   - `approveAll` (the per-session "Allow all" / auto-approve flag):
//     not part of the SDK's persisted `SessionMetadataSnapshot`, so it
//     resets to the global default on every resume unless we keep it.
//   - `mode` (interactive / plan / autopilot): the high-level
//     `client.getSessionMetadata()` (types.d.ts `SessionMetadata`) does
//     NOT expose the persisted run mode — only the low-level
//     `SessionMetadataSnapshot.currentMode` does, which the client API
//     we use never surfaces. A freshly-resumed session reports the SDK
//     default, so we re-apply our last-known value on open.
//
// Framework-agnostic (no `electrobun/bun` import, per AGENTS.md): the
// caller in `src-bun/index.ts` resolves the path via
// `Utils.paths.userData` and hands it to `loadOrDefault`. Mirrors the
// `SettingsService` / `CommandResultRegistry` persistence shape: load
// synchronously at construction, persist async via `writeFile`, fall
// back to an empty store on any parse failure.

import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SessionMode } from '../../rpc';
import { log } from '../observability/logging';
import { toErrorMessage } from '../shared/errorMessage';
import { atomicWrite } from '../shared/atomicWrite';

export const SESSION_METADATA_VERSION = 1;

const VALID_MODES: readonly SessionMode[] = ['interactive', 'plan', 'autopilot'];

export interface PersistedSessionMeta {
  approveAll?: boolean;
  mode?: SessionMode;
}

interface SessionMetadataFile {
  version: number;
  sessions: Record<string, PersistedSessionMeta>;
}

/// Persistence port consumed by `SessionRegistry`. Kept as an interface
/// so unit tests can inject an in-memory fake and the registry stays
/// framework-agnostic. The no-op default below preserves the previous
/// (non-persistent) behavior for registries constructed without a store
/// (most unit tests, the in-memory test-server).
export interface SessionMetadataPersistence {
  get(sessionId: string): PersistedSessionMeta | undefined;
  setApproveAll(sessionId: string, enabled: boolean): void;
  setMode(sessionId: string, mode: SessionMode): void;
  delete(sessionId: string): void;
}

export const noopSessionMetadataPersistence: SessionMetadataPersistence = {
  get: () => undefined,
  setApproveAll: () => {},
  setMode: () => {},
  delete: () => {},
};

export class SessionMetadataStore implements SessionMetadataPersistence {
  /// Serializes writes so concurrent `setApproveAll` / `setMode` calls
  /// can't interleave a half-written file.
  private writeChain: Promise<void> = Promise.resolve();

  private constructor(
    private readonly path: string,
    private readonly data: SessionMetadataFile,
  ) {}

  static loadOrDefault(path: string): SessionMetadataStore {
    const empty: SessionMetadataFile = { version: SESSION_METADATA_VERSION, sessions: {} };

    if (!existsSync(path)) return new SessionMetadataStore(path, empty);

    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;

      return new SessionMetadataStore(path, SessionMetadataStore.coerce(parsed));
    } catch (err) {
      log.warn('session metadata load failed; starting empty', {
        path,
        error: toErrorMessage(err),
      });

      return new SessionMetadataStore(path, empty);
    }
  }

  private static coerce(input: unknown): SessionMetadataFile {
    const out: SessionMetadataFile = { version: SESSION_METADATA_VERSION, sessions: {} };

    if (!input || typeof input !== 'object') return out;

    const sessions = (input as { sessions?: unknown }).sessions;

    if (!sessions || typeof sessions !== 'object') return out;

    for (const [id, raw] of Object.entries(sessions as Record<string, unknown>)) {
      if (!raw || typeof raw !== 'object') continue;

      const entry = raw as { approveAll?: unknown; mode?: unknown };
      const meta: PersistedSessionMeta = {};

      if (typeof entry.approveAll === 'boolean') meta.approveAll = entry.approveAll;

      if (VALID_MODES.includes(entry.mode as SessionMode)) meta.mode = entry.mode as SessionMode;

      if (meta.approveAll !== undefined || meta.mode !== undefined) out.sessions[id] = meta;
    }

    return out;
  }

  get(sessionId: string): PersistedSessionMeta | undefined {
    const meta = this.data.sessions[sessionId];

    return meta ? { ...meta } : undefined;
  }

  setApproveAll(sessionId: string, enabled: boolean): void {
    this.data.sessions[sessionId] = { ...this.data.sessions[sessionId], approveAll: enabled };
    this.persist();
  }

  setMode(sessionId: string, mode: SessionMode): void {
    this.data.sessions[sessionId] = { ...this.data.sessions[sessionId], mode };
    this.persist();
  }

  delete(sessionId: string): void {
    if (!this.data.sessions[sessionId]) return;

    delete this.data.sessions[sessionId];
    this.persist();
  }

  private persist(): void {
    const snapshot = JSON.stringify(this.data, null, 2);

    this.writeChain = this.writeChain
      .then(async () => {
        await mkdir(dirname(this.path), { recursive: true });
        await atomicWrite(this.path, snapshot);
      })
      .catch((err) => {
        log.warn('session metadata persist failed', {
          path: this.path,
          error: toErrorMessage(err),
        });
      });
  }
}
