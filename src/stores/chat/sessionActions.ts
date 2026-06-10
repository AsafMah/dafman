// Async per-session configuration mutations extracted from sessionsStore.ts.
//
// Each function accepts the minimum set of deps it needs via a context object
// rather than importing useSessionsStore() directly — avoids circular imports
// between the store and this module.

import { invokeCommand } from '@/ipc/invoke';
import type { RespondToRequestParams, SessionMode } from '@/ipc/types';
import { toErrorMessage } from '@/lib/errorMessage';
import type { SessionPendingRequest } from '@/lib/sessionStatus';
import { useToastStore } from '@/stores/app/toastStore';
import { appendEvent } from './sessionReducer';
import type { SessionRecord } from './sessionsStore';

/// Sentinel session id used by `src/dev/Playground.vue` to exercise
/// the PendingRequestModal without a real bun-side handler. Exported
/// so `sessionsStore.ts` can skip `assertSessionWritable` for this id
/// without duplicating the literal.
export const PLAYGROUND_PENDING_SESSION_ID = 'playground-pending';

/// Minimal context every action needs to look up live session records
/// post-await without capturing a stale closure reference.
export interface SessionActionCtx {
  getSession(id: string): SessionRecord | undefined;
}

/// Extended context for actions that need to open a new session panel.
export interface ForkSessionCtx extends SessionActionCtx {
  restoreSession(id: string): Promise<SessionRecord | null>;
}

export async function setSessionModelAction(
  ctx: SessionActionCtx,
  sessionId: string,
  model: string,
  reasoningEffort: string | null,
): Promise<boolean> {
  const toasts = useToastStore();

  try {
    await invokeCommand('setSessionModel', { sessionId, model, reasoningEffort });
    const record = ctx.getSession(sessionId);

    if (record) {
      record.model = model;
      record.reasoningEffort = reasoningEffort;
    }

    return true;
  } catch (err) {
    const message = toErrorMessage(err);

    toasts.error('Failed to switch model', message);

    return false;
  }
}

export async function setSessionModeAction(
  ctx: SessionActionCtx,
  sessionId: string,
  mode: SessionMode,
): Promise<boolean> {
  const toasts = useToastStore();

  try {
    await invokeCommand('setSessionMode', { sessionId, mode });
    const record = ctx.getSession(sessionId);

    if (record) record.mode = mode;

    return true;
  } catch (err) {
    const message = toErrorMessage(err);

    toasts.error('Failed to change run mode', message);

    return false;
  }
}

export async function setSessionApproveAllAction(
  ctx: SessionActionCtx,
  sessionId: string,
  enabled: boolean,
): Promise<boolean> {
  // Playground sentinel: skip the RPC (no real bun session) but still
  // mirror the flag onto the in-memory record so the UI reflects the
  // toggle for inline testing. assertSessionWritable was already skipped
  // by the store delegate for this id.
  if (sessionId === PLAYGROUND_PENDING_SESSION_ID) {
    const record = ctx.getSession(sessionId);

    if (record) record.approveAll = enabled;

    return true;
  }

  const toasts = useToastStore();

  try {
    await invokeCommand('setSessionApproveAll', { sessionId, enabled });
    const record = ctx.getSession(sessionId);

    if (record) record.approveAll = enabled;

    return true;
  } catch (err) {
    const message = toErrorMessage(err);

    toasts.error('Failed to update auto-approval', message);

    return false;
  }
}

export async function resetSessionApprovalsAction(sessionId: string): Promise<boolean> {
  const toasts = useToastStore();

  try {
    await invokeCommand('resetSessionApprovals', { sessionId });
    toasts.success('Session approvals cleared', sessionId);

    return true;
  } catch (err) {
    const message = toErrorMessage(err);

    toasts.error('Failed to reset approvals', message);

    return false;
  }
}

/// The caller must snapshot `baseWd` before the await boundary and pass
/// it here, preserving the original pre-await capture semantics.
export async function setSessionWorkingDirectoryAction(
  ctx: SessionActionCtx,
  sessionId: string,
  workingDirectory: string,
  baseWd: string | null | undefined,
): Promise<string> {
  const toasts = useToastStore();

  try {
    const next = await invokeCommand('setSessionWorkingDirectory', {
      sessionId,
      workingDirectory,
      ...(baseWd ? { baseWorkingDirectory: baseWd } : {}),
    });
    // Re-lookup post-await — the record may have been closed while the
    // RPC was in flight (the SDK side already committed the change).
    const record = ctx.getSession(sessionId);

    if (record) {
      record.workingDirectory = next;
      appendEvent(record, {
        sessionId,
        eventType: 'system.notification',
        data: { content: `Working directory changed to ${next}` },
      });
    }

    toasts.success('Working directory changed', next);

    return next;
  } catch (err) {
    const message = toErrorMessage(err);

    toasts.error('Failed to change working directory', message);
    throw err;
  }
}

export async function compactSessionHistoryAction(sessionId: string): Promise<void> {
  const toasts = useToastStore();

  try {
    const result = await invokeCommand('compactSessionHistory', { sessionId });

    if (result.success) {
      const parts: string[] = [];

      if (result.tokensFreed !== null) {
        parts.push(`${result.tokensFreed.toLocaleString()} tokens freed`);
      }

      if (result.messagesRemoved !== null) {
        parts.push(`${result.messagesRemoved} messages removed`);
      }

      toasts.success('History compacted', parts.length > 0 ? parts.join(', ') : undefined);
    } else {
      toasts.warn('Compaction did not complete', sessionId);
    }
  } catch (err) {
    const message = toErrorMessage(err);

    toasts.error('Failed to compact history', message);
    throw err;
  }
}

export async function editUserMessageAction(
  ctx: SessionActionCtx,
  sessionId: string,
  eventId: string,
  newText: string,
): Promise<void> {
  const toasts = useToastStore();

  try {
    await invokeCommand('truncateSessionHistory', { sessionId, eventId });
    // Drop local items at the truncation point too — otherwise we
    // double-render the edited message until the SDK echoes it.
    const record = ctx.getSession(sessionId);

    if (record) {
      const idx = record.events.findIndex((e) => e.eventId === eventId);

      if (idx >= 0) record.events.splice(idx);
    }

    await invokeCommand('sendMessage', { sessionId, text: newText });
  } catch (err) {
    const message = toErrorMessage(err);

    toasts.error('Failed to edit message', message);
    throw err;
  }
}

export async function forkSessionAction(
  ctx: ForkSessionCtx,
  sessionId: string,
  toEventId?: string,
): Promise<string> {
  const toasts = useToastStore();

  try {
    const result = await invokeCommand('forkSession', {
      sessionId,
      ...(toEventId ? { toEventId } : {}),
    });

    await ctx.restoreSession(result.sessionId);

    return result.sessionId;
  } catch (err) {
    const message = toErrorMessage(err);

    toasts.error('Failed to fork session', message);
    throw err;
  }
}

export async function setSessionNameAction(
  ctx: SessionActionCtx,
  sessionId: string,
  name: string,
): Promise<void> {
  const trimmed = name.trim();

  if (!trimmed) return;

  const toasts = useToastStore();

  try {
    await invokeCommand('setSessionName', { sessionId, name: trimmed });
    const record = ctx.getSession(sessionId);

    if (record) record.title = trimmed;
  } catch (err) {
    const message = toErrorMessage(err);

    toasts.error('Failed to rename session', message);
    throw err;
  }
}

export async function respondToPendingAction(
  ctx: SessionActionCtx,
  params: RespondToRequestParams,
): Promise<void> {
  const record = ctx.getSession(params.sessionId);

  // Snapshot + remove the pending entry optimistically so the UI's
  // pending card disappears immediately on click. The
  // `dafman.pending_response` event is NOT appended until the RPC
  // succeeds — otherwise a failed response would leave a phantom
  // response event in the transcript that the chat reducer would
  // dutifully render.
  let restoredEntry: SessionPendingRequest | null = null;
  let restoredIdx = -1;

  if (record) {
    restoredIdx = record.pendingRequests.findIndex((p) => p.requestId === params.requestId);

    if (restoredIdx >= 0) {
      restoredEntry = record.pendingRequests[restoredIdx] ?? null;
      record.pendingRequests.splice(restoredIdx, 1);
    }
  }

  if (params.sessionId === PLAYGROUND_PENDING_SESSION_ID) {
    // Playground: synthesise the response event locally so the demo
    // UI can show the closed-out card without a real RPC.
    if (record) {
      appendEvent(record, {
        sessionId: record.id,
        eventType: 'dafman.pending_response',
        data: { requestId: params.requestId, kind: params.response.kind },
      });
    }

    return;
  }

  try {
    await invokeCommand('respondToRequest', params);

    // Only emit the response event after the RPC succeeds — the
    // chat reducer uses it to clear the pending card from the
    // transcript view.
    if (record) {
      appendEvent(record, {
        sessionId: record.id,
        eventType: 'dafman.pending_response',
        data: { requestId: params.requestId, kind: params.response.kind },
      });
    }
  } catch (err) {
    // Roll back the optimistic pending-list mutation so the user
    // can retry. No response event was appended yet, so nothing
    // else to undo.
    if (record && restoredEntry) {
      record.pendingRequests.splice(restoredIdx, 0, restoredEntry);
    }

    useToastStore().error('Failed to send response', toErrorMessage(err));
  }
}
