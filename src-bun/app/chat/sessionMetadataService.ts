// SessionMetadataService — thin SDK passthrough for per-session
// metadata + the two non-session-scoped methods that touch the
// top-level client (account quota, built-in tool catalog).
//
// Extracted from `SessionRegistry` (Phase D.3.8, 2026-05-26). Owns
// all the methods that fit the shape:
//
//   const entry = ctx.getEntry(sessionId);
//   return ctx.wrapSdk(async () => entry.session.rpc.X.Y(...));
//
// plus a handful that also mutate the registry's per-session bookkeeping
// (`setMode` writes `modeBySession`, `setApproveAll` writes
// `approveAllBySession`, `setMode` also settles the pending queue on
// the autopilot switch). Those mutations come in through the same
// dependency bundle used by `sessionConfigBuilder`, so the metadata
// service still doesn't touch the entries Map directly.

import { tryGetClient } from '../client/client';
import { AppError } from '../shared/errors';
import { toErrorMessage } from '../shared/errorMessage';
import type { ReasoningEffort } from '../client/copilotSdk';
import type { SessionHistoryCompactionResult, SessionMode } from '../../rpc';
import type { PendingRequestQueue } from './pendingRequests';
import type { SessionServiceContext } from './sessionServiceContext';

export interface AccountQuotaEntry {
  isUnlimitedEntitlement: boolean;
  entitlementRequests: number;
  usedRequests: number;
  remainingPercentage: number;
  overage: number;
  resetDate?: string;
}

export interface BuiltinToolSummary {
  name: string;
  namespacedName?: string;
  description: string;
}

export interface SessionMetadataServiceDeps {
  ctx: SessionServiceContext;
  /// Per-session "approve every permission" mirror — written by
  /// `setApproveAll`.
  approveAllBySession: Map<string, boolean>;
  /// Per-session mode mirror — written by `setMode` / `getMode`.
  modeBySession: Map<string, SessionMode>;
  /// Settled by `setMode` when the SDK switches to autopilot
  /// (mirrors the `session.mode_changed` event-forwarder branch).
  pending: PendingRequestQueue;
}

export class SessionMetadataService {
  constructor(private readonly deps: SessionMetadataServiceDeps) {}

  private get ctx(): SessionServiceContext {
    return this.deps.ctx;
  }

  async getCurrentModel(sessionId: string): Promise<string | null> {
    const entry = this.ctx.getEntry(sessionId);

    return this.ctx.wrapSdk(async () => {
      const current = (await entry.session.rpc.model.getCurrent()) as {
        modelId?: unknown;
      };

      return typeof current.modelId === 'string' && current.modelId.trim() ? current.modelId : null;
    });
  }

  async abort(sessionId: string): Promise<string> {
    const entry = this.ctx.getEntry(sessionId);

    await this.ctx.wrapSdk(() => entry.session.abort());

    return 'Aborted';
  }

  async setModel(
    sessionId: string,
    model: string,
    reasoningEffort: string | null,
  ): Promise<string> {
    const entry = this.ctx.getEntry(sessionId);
    const opts = reasoningEffort
      ? { reasoningEffort: reasoningEffort as ReasoningEffort }
      : undefined;

    await this.ctx.wrapSdk(() => entry.session.setModel(model, opts));

    return model;
  }

  async getMode(sessionId: string): Promise<SessionMode> {
    const entry = this.ctx.getEntry(sessionId);

    return this.ctx.wrapSdk(async () => {
      const result = await entry.session.rpc.mode.get();

      if (result !== 'interactive' && result !== 'plan' && result !== 'autopilot') {
        throw AppError.sdk(`unexpected session mode from SDK: ${JSON.stringify(result)}`);
      }

      this.deps.modeBySession.set(sessionId, result);

      return result;
    });
  }

  async setMode(sessionId: string, mode: SessionMode): Promise<SessionMode> {
    const entry = this.ctx.getEntry(sessionId);

    await this.ctx.wrapSdk(async () => {
      await entry.session.rpc.mode.set({ mode });
      this.deps.modeBySession.set(sessionId, mode);

      if (mode === 'autopilot') {
        this.deps.pending.settleForSession(sessionId, 'autopilot-mode');
      }
    });

    return mode;
  }

  async getName(sessionId: string): Promise<string | null> {
    const entry = this.ctx.getEntry(sessionId);

    return this.ctx.wrapSdk(async () => {
      const result = await entry.session.rpc.name.get();
      const name = (result as { name?: unknown }).name;

      if (typeof name === 'string') return name;

      if (name === null || name === undefined) return null;

      throw AppError.sdk(`unexpected session name from SDK: ${JSON.stringify(name)}`);
    });
  }

  async setName(sessionId: string, name: string): Promise<string> {
    const entry = this.ctx.getEntry(sessionId);

    await this.ctx.wrapSdk(() => entry.session.rpc.name.set({ name }));

    return name;
  }

  async compactHistory(sessionId: string): Promise<SessionHistoryCompactionResult> {
    const entry = this.ctx.getEntry(sessionId);

    return this.ctx.wrapSdk(async () => {
      const result = (await entry.session.rpc.history.compact()) as {
        success?: boolean;
        tokensFreed?: number;
        messagesRemoved?: number;
      };

      return {
        success: result.success ?? true,
        tokensFreed: typeof result.tokensFreed === 'number' ? result.tokensFreed : null,
        messagesRemoved: typeof result.messagesRemoved === 'number' ? result.messagesRemoved : null,
      };
    });
  }

  /// Wraps `session.history.truncate`. The given event AND all later
  /// events are removed; callers typically follow this with a fresh
  /// `sendMessage` (Edit / Retry flows).
  async truncateHistory(sessionId: string, eventId: string): Promise<{ eventsRemoved: number }> {
    const entry = this.ctx.getEntry(sessionId);

    return this.ctx.wrapSdk(async () => {
      const result = (await entry.session.rpc.history.truncate({
        eventId,
      })) as { eventsRemoved?: number };

      return { eventsRemoved: result.eventsRemoved ?? 0 };
    });
  }

  /// Wraps `sessions.fork`. Returns the new session id; the registry
  /// does NOT auto-register it — the renderer opens it via the
  /// regular resume flow once it has the id (keeps lifecycle uniform).
  async fork(sessionId: string, toEventId?: string): Promise<{ sessionId: string }> {
    // Validate the source session is registered before reaching for
    // the top-level client (matches the previous behavior — a fork
    // on an unknown id should fail with SessionNotFound, not
    // ClientNotStarted).
    this.ctx.getEntry(sessionId);
    const client = tryGetClient();

    if (!client) throw AppError.clientNotStarted();

    return this.ctx.wrapSdk(async () => {
      const result = (await client.rpc.sessions.fork({
        sessionId,
        ...(toEventId ? { toEventId } : {}),
      })) as { sessionId?: string };

      if (!result.sessionId) {
        throw AppError.sdk('fork: SDK returned no sessionId');
      }

      return { sessionId: result.sessionId };
    });
  }

  async setApproveAll(sessionId: string, enabled: boolean): Promise<boolean> {
    const entry = this.ctx.getEntry(sessionId);

    // Source of truth for OUR onPermissionRequest handler. Mirror to
    // the SDK so any SDK-internal short-circuits that respect this
    // flag stay consistent.
    this.deps.approveAllBySession.set(sessionId, enabled);

    return this.ctx.wrapSdk(async () => {
      const result = (await entry.session.rpc.permissions.setApproveAll({
        enabled,
      })) as { success?: boolean };

      return result.success ?? true;
    });
  }

  async resetApprovals(sessionId: string): Promise<boolean> {
    const entry = this.ctx.getEntry(sessionId);

    return this.ctx.wrapSdk(async () => {
      const result = (await entry.session.rpc.permissions.resetSessionApprovals()) as {
        success?: boolean;
      };

      return result.success ?? true;
    });
  }

  async getUsageMetrics(sessionId: string): Promise<Record<string, unknown>> {
    const entry = this.ctx.getEntry(sessionId);

    return this.ctx.wrapSdk(
      async () =>
        (await entry.session.rpc.usage.getMetrics()) as unknown as Record<string, unknown>,
    );
  }

  // ---------- Non-session-scoped (top-level client) ----------

  /// Built-in tool catalog. Returns a trimmed view — the renderer
  /// doesn't need the full JSON schema.
  async listBuiltinTools(): Promise<BuiltinToolSummary[]> {
    const client = tryGetClient();

    if (!client) throw AppError.clientNotStarted();

    try {
      const result = (await client.rpc.tools.list({})) as {
        tools?: Array<{
          name?: unknown;
          namespacedName?: unknown;
          description?: unknown;
        }>;
      };
      const tools = result.tools ?? [];

      return tools
        .filter((t) => typeof t.name === 'string')
        .map((t) => ({
          name: String(t.name),
          ...(typeof t.namespacedName === 'string' ? { namespacedName: t.namespacedName } : {}),
          description: typeof t.description === 'string' ? t.description : '',
        }));
    } catch (err) {
      throw AppError.sdk(toErrorMessage(err));
    }
  }

  async getAccountQuota(): Promise<Record<string, AccountQuotaEntry>> {
    const client = tryGetClient();

    if (!client) throw AppError.clientNotStarted();

    try {
      const result = (await client.rpc.account.getQuota({})) as unknown as {
        quotaSnapshots?: Record<string, Record<string, unknown>>;
      };
      const snaps = result.quotaSnapshots ?? {};
      const out: Record<string, AccountQuotaEntry> = {};

      for (const [key, snap] of Object.entries(snaps)) {
        out[key] = {
          isUnlimitedEntitlement: snap.isUnlimitedEntitlement === true,
          entitlementRequests:
            typeof snap.entitlementRequests === 'number' ? snap.entitlementRequests : 0,
          usedRequests: typeof snap.usedRequests === 'number' ? snap.usedRequests : 0,
          remainingPercentage:
            typeof snap.remainingPercentage === 'number' ? snap.remainingPercentage : 0,
          overage: typeof snap.overage === 'number' ? snap.overage : 0,
          ...(typeof snap.resetDate === 'string' ? { resetDate: snap.resetDate } : {}),
        };
      }

      return out;
    } catch (err) {
      throw AppError.sdk(toErrorMessage(err));
    }
  }
}
