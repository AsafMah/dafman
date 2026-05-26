// SessionEventForwarder — transforms raw SDK SessionEvents into the
// wire-shape SessionEventPayload the renderer consumes.
//
// Extracted from `SessionRegistry.forward` (Phase D.3.6, 2026-05-26).
// Owns:
// - the diagnostic-vs-trace log split
// - the SDK envelope unwrap + plain-object validation
// - the `session.mode_changed` → `modeBySession` writeback
// - the `session.idle` → `pollTitleFromMetadata` trigger
// - the final emit (with envelope fields lifted to top-level)
//
// Does NOT own:
// - subscription setup (`session.on(...)`) — the registry wires that
//   up at create/resume time and passes events here
// - the pending-request queue (this forwarder only calls into it
//   when the SDK switches to autopilot mode; the queue lives on
//   the registry)

import type { SessionEvent } from '../client/copilotSdk';
import { log } from '../observability/logging';
import { tryGetClient } from '../client/client';
import { toErrorMessage } from '../shared/errorMessage';
import type { PendingRequestQueue } from './pendingRequests';
import type { SessionEventPayload, SessionMode } from '../../rpc';

type Emit = (payload: SessionEventPayload) => void;

export interface SessionEventForwarderDeps {
  /// Forward the transformed payload to the renderer.
  emit: Emit;
  /// Writable map — the forwarder updates the registry's view when
  /// the SDK emits a `session.mode_changed`. The registry passes its
  /// own Map by reference; tests can pass a fresh `new Map()`.
  modeBySession: Map<string, SessionMode>;
  /// Pending queue — settled when the SDK switches to autopilot mode
  /// (no more user-driven permission prompts make sense after that).
  pending: PendingRequestQueue;
}

/// Diagnostic event types log at `debug` (with the full payload);
/// everything else logs at `trace` (without the payload, to keep
/// the JSONL log lean).
const DIAGNOSTIC_EVENT_TYPES = new Set<string>([
  'assistant.reasoning',
  'assistant.reasoning_delta',
  'session.error',
  'session.warning',
  'model.call_failure',
]);

function logSessionEvent(sessionId: string, eventType: string, event: SessionEvent): void {
  if (DIAGNOSTIC_EVENT_TYPES.has(eventType)) {
    log.debug('session event', { sessionId, eventType, event });
  } else {
    log.trace('session event', { sessionId, eventType });
  }
}

/// SDK envelope unwrap + plain-object validation. Returns the lifted
/// envelope fields (`agentId` / `id` / `timestamp`) and the safe
/// `data` record (which always exists; malformed `null` / array /
/// primitive payloads coerce to `{}` plus a warn-log so the issue
/// surfaces in diagnostics).
function unwrapEvent(
  sessionId: string,
  event: SessionEvent,
): {
  envelope: { agentId?: string; id?: string; timestamp?: string };
  data: Record<string, unknown>;
} {
  // The SDK wraps each event as { type, data, id, parentId, ts, ... }.
  // The Rust port forwarded only `event.data`, and our `chatEvents.ts`
  // reads fields like `payload.data.messageId` directly off the
  // payload. Unwrap the SDK's nested `data` so the frontend sees the
  // same shape it always did, but also lift envelope-level fields
  // (`agentId`, `id`, `timestamp`) so the frontend can correlate
  // sub-agent activity without us mirroring every variant.
  const envelope = event as unknown as {
    data?: unknown;
    agentId?: string;
    id?: string;
    timestamp?: string;
  };
  const rawData = envelope.data;
  const isPlainObject = rawData !== null && typeof rawData === 'object' && !Array.isArray(rawData);

  if (!isPlainObject && rawData !== undefined) {
    log.warn('dropping malformed event.data on forward', {
      sessionId,
      eventType: event.type,
      dataType: rawData === null ? 'null' : Array.isArray(rawData) ? 'array' : typeof rawData,
    });
  }

  return {
    envelope,
    data: (isPlainObject ? rawData : {}) as Record<string, unknown>,
  };
}

export class SessionEventForwarder {
  constructor(private readonly deps: SessionEventForwarderDeps) {}

  /// Forward one event. The SDK wraps each event as
  /// `{ type, data, id, parentId, ts, agentId, ... }`; this method
  /// flattens that to the renderer's `SessionEventPayload` shape.
  forward(sessionId: string, event: SessionEvent): void {
    const eventType = event.type;

    logSessionEvent(sessionId, eventType, event);

    const { envelope, data } = unwrapEvent(sessionId, event);

    this.handleSideEffects(sessionId, eventType, data);

    try {
      this.deps.emit({
        sessionId,
        eventType,
        data,
        ...(envelope.agentId ? { agentId: envelope.agentId } : {}),
        ...(envelope.id ? { eventId: envelope.id } : {}),
        ...(envelope.timestamp ? { timestamp: envelope.timestamp } : {}),
      });
    } catch (err) {
      log.warn('failed to forward session event', {
        sessionId,
        eventType,
        error: toErrorMessage(err),
      });
    }
  }

  /// Per-eventType side effects: mode mirror + autopilot pending
  /// settle on `session.mode_changed`, title poll on `session.idle`,
  /// info-log on `session.title_changed`. Kept inside the class
  /// because all three reach for `this.deps` / `this.pollTitleFromMetadata`.
  private handleSideEffects(
    sessionId: string,
    eventType: string,
    data: Record<string, unknown>,
  ): void {
    if (eventType === 'session.mode_changed') {
      const newMode = data.newMode;

      if (newMode === 'interactive' || newMode === 'plan' || newMode === 'autopilot') {
        this.deps.modeBySession.set(sessionId, newMode);

        if (newMode === 'autopilot') {
          this.deps.pending.settleForSession(sessionId, 'autopilot-mode');
        }
      }

      return;
    }

    // When the CLI signals idle (turn finished), proactively fetch
    // the session title from metadata. The CLI auto-summarises the
    // conversation but may only emit `session.title_changed` inside
    // workspace-enabled sessions. Polling `getMetadata` on idle
    // catches the title regardless.
    if (eventType === 'session.idle') {
      this.pollTitleFromMetadata(sessionId);

      return;
    }

    if (eventType === 'session.title_changed') {
      log.info('session.title_changed received', { sessionId, title: data.title });
    }
  }

  /// Fire-and-forget title poll. Called on `session.idle` because the
  /// CLI auto-summarises and may only emit `session.title_changed`
  /// inside workspace-enabled sessions. Failures are silent — the
  /// session may have been deleted between idle and the poll.
  pollTitleFromMetadata(sessionId: string): void {
    try {
      const client = tryGetClient();

      client
        .getSessionMetadata(sessionId)
        .then((meta) => {
          if (meta?.summary) {
            log.info('polled title from metadata', {
              sessionId,
              title: meta.summary,
            });
            this.deps.emit({
              sessionId,
              eventType: 'session.title_changed',
              data: { title: meta.summary },
            });
          }
        })
        .catch(() => {
          // Session may have been deleted between idle and poll.
        });
    } catch {
      // Client not started or getSessionMetadata unavailable.
    }
  }
}
