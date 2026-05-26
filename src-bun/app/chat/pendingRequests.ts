// Pending SDK callback coordinator.
//
// Multiplexes one slot per in-flight `onPermissionRequest` /
// `onUserInputRequest` / `onElicitationRequest` from the SDK. Holds
// the Promise resolver so the renderer can settle the callback via
// `respondToRequest`, and the teardown paths (disconnect, delete,
// shutdown) can cancel cleanly.
//
// Extracted from `SessionRegistry` so the registry can focus on
// session lifecycle and so this surface can be unit-tested in
// isolation. The registry owns approve-all state and short-circuits
// before calling `enqueue`; this class never knows about approve-all.

import { randomUUID } from 'node:crypto';
import { recordPermission, type PermissionAuditEntry } from '../observability/audit';
import { log } from '../observability/logging';
import type { RespondToRequestParams } from '../../rpc';
import { toErrorMessage } from '../shared/errorMessage';

export type PendingKind =
  | 'permission'
  | 'userInput'
  | 'elicitation'
  | 'exitPlanMode'
  | 'autoModeSwitch';

interface PendingEntry {
  sessionId: string;
  kind: PendingKind;
  resolve: (response: unknown) => void;
  reject: (err: Error) => void;
  /// Set to `true` by `respond` / teardown paths so a second response
  /// is a benign no-op instead of double-resolving.
  settled: boolean;
  /// For permission entries: the SDK's `kind` (shell / write / read /
  /// mcp / url / custom-tool / memory / hook). Lifted off the
  /// PendingRequest payload at construction time so the audit log
  /// can record it without re-parsing the SDK shape later.
  permissionKind?: string;
  /// For permission entries: the one-line UI summary the modal
  /// shows. Also recorded in the audit log so an operator can
  /// later see "user denied shell `git push origin master`"
  /// instead of just "permission rejected".
  summary?: string;
}

/// Constructor-injected audit callback so unit tests can capture
/// without touching disk. Production passes the real `recordPermission`.
export type AuditPermission = (entry: Omit<PermissionAuditEntry, 'ts' | 'kind'>) => void;

export class PendingRequestQueue {
  private readonly entries = new Map<string, PendingEntry>();

  constructor(private readonly auditPermission: AuditPermission = recordPermission) {}

  /// Test seam: snapshot count of in-flight entries.
  get size(): number {
    return this.entries.size;
  }

  /// Allocates a PendingEntry + Promise, registers it, runs the
  /// caller's emit closure with the requestId so the renderer hears
  /// about it. Returns the Promise the SDK awaits.
  enqueue(
    sessionId: string,
    kind: PendingKind,
    emit: (requestId: string) => void,
    extras?: { permissionKind?: string; summary?: string },
  ): Promise<unknown> {
    const requestId = randomUUID();
    const promise = new Promise<unknown>((resolve, reject) => {
      this.entries.set(requestId, {
        sessionId,
        kind,
        resolve,
        reject,
        settled: false,
        ...(extras?.permissionKind ? { permissionKind: extras.permissionKind } : {}),
        ...(extras?.summary ? { summary: extras.summary } : {}),
      });
    });

    try {
      emit(requestId);
    } catch (err) {
      // Emit failure shouldn't deadlock the SDK. Resolve with a
      // safe "unavailable" so the SDK can move on.
      log.warn('pendingRequest emit threw; cancelling', {
        sessionId,
        requestId,
        kind,
        error: toErrorMessage(err),
      });
      this.cancel(requestId, 'emit-failure');
    }

    return promise;
  }

  /// Resolves one entry with a typed cancellation. Used by teardown
  /// paths (disconnect, delete, shutdown) and the emit-failure
  /// fallback above.
  cancel(requestId: string, _reason: string): void {
    const entry = this.entries.get(requestId);

    if (!entry || entry.settled) return;

    entry.settled = true;
    this.entries.delete(requestId);
    const cancellation: unknown =
      entry.kind === 'permission'
        ? { kind: 'user-not-available' }
        : entry.kind === 'userInput'
          ? { answer: 'User is unavailable in autopilot mode.', wasFreeform: true }
          : entry.kind === 'elicitation'
            ? { action: 'cancel' }
            : entry.kind === 'exitPlanMode'
              ? { approved: false }
              : 'no';

    try {
      entry.resolve(cancellation);
    } catch (err) {
      log.warn('cancelPending resolve threw', {
        requestId,
        error: toErrorMessage(err),
      });
    }
  }

  /// Drains every entry for a given session, used on disconnect /
  /// delete / setWorkingDirectory so the SDK never hangs on a
  /// handler whose UI counterpart is gone.
  ///
  /// REGISTRY CONTRACT: callers MUST invoke this BEFORE deleting
  /// their entry for the session. The queue has no way to know about
  /// the registry-side entry map, so a registry that deletes-first
  /// would leak pending callbacks until shutdown drains them.
  settleForSession(sessionId: string, reason: string): void {
    const requestIds: string[] = [];

    for (const [id, entry] of this.entries) {
      if (entry.sessionId === sessionId) requestIds.push(id);
    }

    for (const id of requestIds) this.cancel(id, reason);
  }

  /// Drains every entry. Used by `SessionRegistry.shutdown()` on app
  /// quit. Snapshots the key set first so concurrent mutation during
  /// cancellation can't trip iteration.
  settleAll(reason: string): void {
    for (const id of [...this.entries.keys()]) this.cancel(id, reason);
  }

  /// Renderer → bun: respond to a pending callback. Idempotent: a
  /// double-submit on an already-resolved request returns `false`
  /// instead of throwing. Type-narrows the renderer's compact
  /// response shape into the SDK's wider one.
  async respond(params: RespondToRequestParams): Promise<boolean> {
    const entry = this.validateRespond(params);

    if (!entry) return false;

    entry.settled = true;
    this.entries.delete(params.requestId);

    const sdkResult = this.buildSdkResult(entry, params);

    try {
      entry.resolve(sdkResult);
    } catch (err) {
      log.warn('respondToRequest resolve threw', {
        requestId: params.requestId,
        error: toErrorMessage(err),
      });

      return false;
    }

    return true;
  }

  /// Verify the response targets a still-pending request and the
  /// sessionId / kind line up. Returns the entry on success, `null`
  /// on a mismatch (with a log line).
  private validateRespond(params: RespondToRequestParams): PendingEntry | null {
    const entry = this.entries.get(params.requestId);

    if (!entry || entry.settled) {
      log.debug('respondToRequest on already-resolved request', {
        requestId: params.requestId,
      });

      return null;
    }

    if (entry.sessionId !== params.sessionId) {
      log.warn('respondToRequest sessionId mismatch', {
        requestId: params.requestId,
        expected: entry.sessionId,
        got: params.sessionId,
      });

      return null;
    }

    if (entry.kind !== params.response.kind) {
      log.warn('respondToRequest kind mismatch', {
        requestId: params.requestId,
        expected: entry.kind,
        got: params.response.kind,
      });

      return null;
    }

    return entry;
  }

  /// Translate the renderer's compact response shape into the SDK's
  /// wider one. Permission responses also fire an audit-log entry as
  /// a side effect — the only kind that does.
  private buildSdkResult(entry: PendingEntry, params: RespondToRequestParams): unknown {
    switch (params.response.kind) {
      case 'permission':
        return this.buildPermissionResult(entry, params, params.response);
      case 'userInput':
        return {
          answer: params.response.answer,
          wasFreeform: params.response.wasFreeform,
        };
      case 'elicitation':
        return {
          action: params.response.action,
          ...(params.response.content ? { content: params.response.content } : {}),
        };
      case 'exitPlanMode':
        return {
          approved: params.response.approved,
          ...(params.response.selectedAction
            ? { selectedAction: params.response.selectedAction }
            : {}),
          ...(params.response.feedback ? { feedback: params.response.feedback } : {}),
        };
      case 'autoModeSwitch':
        return params.response.response;
    }
  }

  /// Permission response builder + audit log. The `approval` field
  /// is per-kind:
  ///   - commands : { commandIdentifiers: string[] }
  ///   - read / write / memory : kind only
  ///   - mcp : { serverName, toolName | null }
  ///   - mcp-sampling : { serverName }
  ///   - custom-tool : { toolName }
  /// `domain` is exclusive to `url` permission requests and goes
  /// at the top level (not inside `approval`).
  private buildPermissionResult(
    entry: PendingEntry,
    params: RespondToRequestParams,
    response: Extract<RespondToRequestParams['response'], { kind: 'permission' }>,
  ): unknown {
    let sdkResult: unknown;
    let approvalKind: string | undefined;
    let approvalDomain: string | undefined;

    if (response.decision === 'approveOnce') {
      sdkResult = { kind: 'approve-once' };
    } else if (response.decision === 'reject') {
      sdkResult = { kind: 'reject' };
    } else {
      const out: Record<string, unknown> = { kind: 'approve-for-session' };

      if (response.approval) {
        out.approval = response.approval;
        approvalKind = response.approval.kind;
      }

      if (response.domain) {
        out.domain = response.domain;
        approvalDomain = response.domain;
      }

      sdkResult = out;
    }

    // Audit log: every permission decision recorded as one line in
    // <userData>/audit/permissions.jsonl. Captures what + when +
    // who + scope without leaking command bodies or paths beyond
    // the bun-derived summary.
    this.auditPermission({
      sessionId: params.sessionId,
      requestId: params.requestId,
      permissionKind: entry.permissionKind ?? 'unknown',
      decision: response.decision,
      ...(entry.summary ? { summary: entry.summary } : {}),
      ...(approvalKind ? { approvalKind } : {}),
      ...(approvalDomain ? { approvalDomain } : {}),
    });

    return sdkResult;
  }
}
