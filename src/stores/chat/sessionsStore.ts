// Owns the list of active sessions and their event buffers.
//
// In the Electrobun rewrite every backend session event arrives on a
// single global `sessionEvent` channel (set up in `src/main.ts`); this
// store subscribes once via `onSessionEvent` and dispatches by
// `sessionId` to the right record. That replaces Tauri's per-session
// `Channel<SessionEventPayload>` and lets us keep `SessionRecord` plain
// reactive data.

import { defineStore } from 'pinia';
import { reactive, ref, computed, watch } from 'vue';
import { invokeCommand, onPendingRequest, onSessionEvent } from '@/ipc/invoke';
import type {
  AgentInfo,
  AutoModeSwitchRequestData,
  ElicitationRequestData,
  ExitPlanModeRequestData,
  PendingRequestPayload,
  PermissionRequestData,
  ReasoningVisibility,
  RespondToRequestParams,
  SessionEventPayload,
  SessionMode,
  UserInputRequestData,
} from '@/ipc/types';
import { accentForIndex } from '@/lib/color';
import { useLayoutStore } from '@/stores/shell/layoutStore';
import { useNotificationsStore } from '@/stores/app/notificationsStore';
import { useSettingsStore } from '@/stores/app/settingsStore';
import { useToastStore } from '@/stores/app/toastStore';
import { toErrorMessage } from '@/lib/errorMessage';
import { appendEvent, applyToRecord, shouldFireForRecord } from './sessionReducer';

/// User-facing send modes. Maps to SDK message delivery via
/// `sessionsStore.sendMessage`:
///   "steer"     -> session.send({ mode: "immediate" })
///   "queue"     -> session.send({ mode: "enqueue" })
///   "interrupt" -> session.abort() then session.send()
/// Only "steer" and "queue" are valid *default* modes (selectable from
/// the composer's SplitButton dropdown). Interrupt is always explicit.
export type SendMode = 'steer' | 'queue' | 'interrupt';
export type DefaultSendMode = 'steer' | 'queue';

export type SessionRecord = {
  id: string;
  /// CSS color picked from a curated palette so the first N sessions are
  /// visually distinct.
  accent: string;
  events: SessionEventPayload[];
  /// Number of events dropped from the FRONT of `events` to keep the
  /// per-session memory bounded. Consumers (ChatWindow) compute their
  /// absolute progress as `droppedEventCount + events.length` so a
  /// trim doesn't cause them to re-process or miss events. See
  /// MAX_EVENTS_PER_SESSION below.
  droppedEventCount: number;
  /// Currently-selected model id; `null` until the user picks one or a
  /// `session.model_change` event arrives.
  model: string | null;
  /// Currently-selected reasoning effort, when the model supports it.
  reasoningEffort: string | null;
  /// Agent run mode. `null` until we fetch / observe a change.
  mode: SessionMode | null;
  /// Whether the SDK is auto-approving every permission request for this
  /// session. Tracked locally because the SDK doesn't emit an event for it.
  approveAll: boolean;
  /// Tab/pane title, derived from the SDK's `session.title_changed`
  /// event (which fires once the model auto-summarises the chat).
  /// `null` until that event arrives — callers fall back to a short
  /// form of `id` for display.
  title: string | null;
  /// Per-session override for reasoning visibility. `"default"` means
  /// fall back to `settings.appearance.reasoningVisibility`. In-memory
  /// only (we don't yet persist per-session UI preferences).
  reasoningVisibilityOverride: ReasoningVisibility | 'default';
  /// Absolute filesystem path the SDK uses as `cwd` for tool invocations
  /// in this session. Populated either from the user's choice at
  /// creation time, or from the `session.start` event's
  /// `data.context.cwd` (which the CLI persists across resume).
  workingDirectory: string | null;
  /// Per-session default for the composer's primary send action. Used
  /// when the user hits Ctrl+Enter or clicks the SplitButton's main
  /// button. Initial value is "steer" — keeps the agent responsive
  /// (Ctrl+Enter while a turn is running injects rather than queues
  /// behind it). Not persisted across reloads in v1.
  defaultSendMode: DefaultSendMode;
  /// FIFO queue of SDK-blocking pending callbacks. New requests
  /// append; responses or matching `_completed` events remove by
  /// requestId. Mirrors the reducer's `ambient.pendingRequests` at
  /// the record level so cross-pane surfaces (sidebar dot, tab dot,
  /// global modal) react without the chat panel being mounted.
  pendingRequests: PendingRecordRequest[];
  /// Count of completed turns the user hasn't seen because the panel
  /// wasn't the dockview active panel at the time. Drives the
  /// "new activity" dot on the tab + sidebar row. Cleared on focus
  /// (via the `activeSessionId` watch below).
  unseenTurns: number;
  /// True while the agent is mid-turn for this session (between
  /// `assistant.turn_start` and `assistant.turn_end`). Drives the
  /// "Thinking…" indicator on the tab + sidebar row and the
  /// pending-spinner card inside the chat. The `sawTurnBoundary`
  /// flag below tracks whether we've ever observed a turn_start —
  /// SDKs that don't emit those boundaries fall back to the
  /// caller's optimistic flag (see `ChatWindow.vue::isSending`).
  isThinking: boolean;
  /// True once we've observed at least one `assistant.turn_start`.
  /// Tracks the same invariant as `ChatAmbient.sawTurnBoundary` but
  /// at the record level so other surfaces (the sidebar row) can
  /// trust `isThinking` without mounting the chat panel.
  sawTurnBoundary: boolean;
  /// 19a: currently-selected custom agent for the session, or null
  /// when the default agent is in use. Mirrors `ambient.currentAgent`
  /// from the reducer so the header chip + rail can react without
  /// importing the reducer (or running it). Hydrated from the
  /// `getCurrentAgent` RPC on session resume + create.
  currentAgent: AgentInfo | null;
  /// 19b.1: monotonic counter the right rail's Tasks section watches
  /// to trigger a refetch. Bumped whenever a `subagent.started`,
  /// `subagent.completed`, `subagent.failed`, or
  /// `session.background_tasks_changed` event arrives — the rail
  /// reactively calls `listTasks` to pick up the new shape. Counter
  /// (vs boolean flag) because watchers fire on value change; we'd
  /// otherwise miss two events in a row if the rail hadn't read the
  /// previous state yet.
  tasksRefreshCounter: number;
  /// Monotonic counter watched by the details rail's Plan section.
  /// Bumped on SDK `session.plan_changed` so plan.md edits made by the
  /// agent or CLI callbacks refresh the preview without remounting.
  planRefreshCounter: number;
  /// Monotonic artifacts touched by this session. Unlike the chat
  /// footer's derived items, this survives the raw event ring-buffer cap.
  touchedFiles: string[];
  commandsRun: number;
  /// 22a: requestIds of MCP OAuth required-events we've toasted, so a
  /// resume / replay doesn't duplicate the notification, and so we
  /// can pair `_completed` events with their `_required`. Internal —
  /// renderer surfaces never read this directly.
  _toastedOauthRequests: Set<string>;
  /// #69: server names we've toasted a `needs-auth` prompt for, so a
  /// repeated `session.mcp_server_status_changed(needs-auth)` (status
  /// re-emits on every connection attempt / resume) doesn't spam the
  /// user. Cleared when the server reaches `connected` so a later
  /// re-auth re-prompts. Internal — renderer surfaces don't read it.
  _toastedNeedsAuth: Set<string>;
  _artifactToolCallIds: Set<string>;
};

/// Per-record mirror of a single pending request. Matches the
/// `PendingRequest` discriminated union in `chatEvents.ts`; lives
/// here so the SessionRecord shape is self-contained (no cross-
/// module import dance from places like SessionsManager that don't
/// need the rest of the reducer).
export type PendingRecordRequest =
  | {
      kind: 'permission';
      requestId: string;
      message: string;
      request: PermissionRequestData;
    }
  | {
      kind: 'userInput';
      requestId: string;
      message: string;
      request: UserInputRequestData;
    }
  | {
      kind: 'elicitation';
      requestId: string;
      message: string;
      request: ElicitationRequestData;
    }
  | {
      kind: 'exitPlanMode';
      requestId: string;
      message: string;
      request: ExitPlanModeRequestData;
    }
  | {
      kind: 'autoModeSwitch';
      requestId: string;
      message: string;
      request: AutoModeSwitchRequestData;
    };

let unsubscribe: (() => void) | null = null;
let unsubscribePending: (() => void) | null = null;

/// Pending events for sessions whose `SessionRecord` doesn't exist
/// yet. Triggered by the resume race: bun emits the full history via
/// `webview.rpc.send.sessionEvent` *during* the `resumeSession` RPC
/// handler — those messages travel over the same channel as the RPC
/// response and arrive at the renderer before the awaiting promise
/// resolves. Without this buffer, every replayed event (transcript,
/// `session.start`, model, title, …) would hit `handleEvent` with no
/// matching record and be silently dropped, leaving the resumed pane
/// blank.
///
/// Capped per-session so a runaway producer doesn't pin memory.
const pendingEvents = new Map<string, SessionEventPayload[]>();
const pendingRequestBuffer = new Map<string, PendingRequestPayload[]>();
const MAX_PENDING_PER_SESSION = 5000;

// Re-export for consumers that import from this module.
export { MAX_EVENTS_PER_SESSION } from './sessionReducer';

/// Sentinel session id used by `src/dev/Playground.vue` to exercise
/// the PendingRequestModal without a real bun-side handler. The
/// store's `respondToPending` short-circuits the RPC call when the
/// `sessionId` matches this constant so the modal can be tested in
/// isolation. Not exported — the playground constructs the same
/// string literal.
const PLAYGROUND_PENDING_SESSION_ID = 'playground-pending';

/// Test-only seam: clears module-level state (subscription, buffered
/// events) so each unit test starts from a clean slate. Production
/// code never calls this — the module-level state is intentional
/// (one subscription per app lifetime) and survives store re-creation.
export function _resetSessionsStoreForTest(): void {
  if (unsubscribe) {
    try {
      unsubscribe();
    } catch {
      /* best effort */
    }

    unsubscribe = null;
  }

  if (unsubscribePending) {
    try {
      unsubscribePending();
    } catch {
      /* best effort */
    }

    unsubscribePending = null;
  }

  pendingEvents.clear();
  pendingRequestBuffer.clear();
}

export const useSessionsStore = defineStore('sessions', () => {
  const sessions = ref<SessionRecord[]>([]);
  const sessionById = computed(() => new Map(sessions.value.map((s) => [s.id, s])));

  function getSession(id: string | null | undefined): SessionRecord | undefined {
    if (!id) return undefined;

    return sessionById.value.get(id);
  }

  const isCreating = ref(false);
  let creationCount = 0;

  function handleEvent(payload: SessionEventPayload): void {
    const record = getSession(payload.sessionId);

    if (!record) {
      // Buffer for later — the SessionRecord is still in flight (see
      // `pendingEvents` comment). `drainPending` will replay these
      // through `applyToRecord` in order once the record materializes.
      const list = pendingEvents.get(payload.sessionId) ?? [];

      if (list.length < MAX_PENDING_PER_SESSION) {
        list.push(payload);
        pendingEvents.set(payload.sessionId, list);
      }

      if (import.meta.env.DEV) {
        console.debug('[session-event] buffered', payload.eventType, payload.sessionId);
      }

      return;
    }

    applyToRecord(record, payload);
  }

  /// Bun-side `pendingRequest` push handler. Appends to the matching
  /// session's queue + fires the "waiting for input" OS notification
  /// when the session isn't the active panel. Buffers if the
  /// record doesn't exist yet (e.g. mid-resume) the same way
  /// `handleEvent` does, by storing into a synthetic
  /// `sessionEvent` and letting `drainPending` replay through
  /// `applyPendingToRecord`.
  function handlePendingRequest(payload: PendingRequestPayload): void {
    const record = getSession(payload.sessionId);

    if (!record) {
      // Bun's pendingRequest channel can fire before the
      // createSession RPC promise resolves (early-session race —
      // same shape as the sessionEvent buffer). Stash on a parallel
      // queue keyed by sessionId so `drainPending` can replay.
      const list = pendingRequestBuffer.get(payload.sessionId) ?? [];

      list.push(payload);
      pendingRequestBuffer.set(payload.sessionId, list);

      return;
    }

    applyPendingToRecord(record, payload);
  }

  function applyPendingToRecord(record: SessionRecord, payload: PendingRequestPayload): void {
    // Idempotency: drop duplicate pushes of the same requestId.
    if (record.pendingRequests.some((p) => p.requestId === payload.requestId)) {
      return;
    }

    let entry: PendingRecordRequest;

    switch (payload.kind) {
      case 'permission':
        entry = {
          kind: 'permission',
          requestId: payload.requestId,
          message: payload.request.summary,
          request: payload.request,
        };
        break;
      case 'userInput':
        entry = {
          kind: 'userInput',
          requestId: payload.requestId,
          message: payload.request.question,
          request: payload.request,
        };
        break;
      case 'elicitation':
        entry = {
          kind: 'elicitation',
          requestId: payload.requestId,
          message: payload.request.message,
          request: payload.request,
        };
        break;
      case 'exitPlanMode':
        entry = {
          kind: 'exitPlanMode',
          requestId: payload.requestId,
          message: payload.request.summary || 'Plan ready for approval',
          request: payload.request,
        };
        break;
      case 'autoModeSwitch':
        entry = {
          kind: 'autoModeSwitch',
          requestId: payload.requestId,
          message: payload.request.errorCode
            ? `Switch to auto mode after rate limit: ${payload.request.errorCode}`
            : 'Switch to auto mode?',
          request: payload.request,
        };
        break;
    }

    record.pendingRequests.push(entry);
    // Also push a synthetic `dafman.pending_request` event into the
    // record's event buffer so the reducer (which only sees the
    // event stream) builds the same queue inside `ChatAmbient`.
    appendEvent(record, {
      sessionId: record.id,
      eventType: 'dafman.pending_request',
      data: payload,
    });

    if (shouldFireForRecord(record)) {
      const notifications = useNotificationsStore();

      notifications.notify({
        kind: 'waitingForInput',
        title: record.title ?? `Session ${record.id.slice(0, 8)}`,
        body: entry.message,
        sessionId: record.id,
        tag: `${record.id}:pendingRequest:${entry.requestId}`,
      });
    }
  }

  function drainPending(sessionId: string, record: SessionRecord): number {
    const list = pendingEvents.get(sessionId);

    if (list) {
      pendingEvents.delete(sessionId);

      for (const event of list) applyToRecord(record, event);
    }

    const pendingList = pendingRequestBuffer.get(sessionId);

    if (pendingList) {
      pendingRequestBuffer.delete(sessionId);

      for (const p of pendingList) applyPendingToRecord(record, p);
    }

    return (list?.length ?? 0) + (pendingList?.length ?? 0);
  }

  function ensureSubscription(): void {
    if (unsubscribe) return;

    unsubscribe = onSessionEvent(handleEvent);
    unsubscribePending = onPendingRequest(handlePendingRequest);
    // Clear the "unseen activity" dot on the session the user just
    // brought into focus. Watching layoutStore.activeSessionId means
    // we react to dockview's onDidActivePanelChange + onDidActiveGroupChange
    // (those drive activeSessionId in layoutStore.setApi).
    const layoutStore = useLayoutStore();

    watch(
      () => layoutStore.activeSessionId,
      (sid) => {
        if (!sid) return;

        const record = getSession(sid);

        if (record && record.unseenTurns > 0) {
          record.unseenTurns = 0;
        }
      },
      { immediate: true },
    );
  }

  async function createSession(
    opts: {
      workingDirectory?: string;
      model?: string | null;
      reasoningEffort?: string | null;
    } = {},
  ): Promise<SessionRecord | null> {
    if (isCreating.value) return null;

    ensureSubscription();
    const toasts = useToastStore();

    isCreating.value = true;

    try {
      const wd = opts.workingDirectory?.trim();
      const settingsStore = useSettingsStore();
      const defaultModel =
        opts.model ?? settingsStore.settings.appearance.defaultModelId?.trim() ?? '';
      const defaultReasoning =
        opts.reasoningEffort ?? settingsStore.settings.appearance.defaultReasoningEffort ?? null;
      const id = await invokeCommand('createSession', {
        ...(wd ? { workingDirectory: wd } : {}),
        ...(defaultModel ? { model: defaultModel } : {}),
        ...(defaultReasoning ? { reasoningEffort: defaultReasoning } : {}),
      });
      const accent = accentForIndex(creationCount++);
      const record: SessionRecord = reactive({
        id,
        accent,
        events: [],
        droppedEventCount: 0,
        model: defaultModel || null,
        reasoningEffort: defaultReasoning,
        title: null,
        mode: null,
        approveAll: false, // dafman handler now drives permissions; default is interactive
        reasoningVisibilityOverride: 'default',
        workingDirectory: wd && wd.length > 0 ? wd : null,
        defaultSendMode: 'steer',

        pendingRequests: [],
        unseenTurns: 0,
        isThinking: false,
        sawTurnBoundary: false,
        currentAgent: null,
        tasksRefreshCounter: 0,
        planRefreshCounter: 0,
        touchedFiles: [],
        commandsRun: 0,

        _toastedOauthRequests: new Set<string>(),
        _toastedNeedsAuth: new Set<string>(),
        _artifactToolCallIds: new Set<string>(),
      });

      sessions.value.push(record);
      drainPending(id, record);
      toasts.success('Session created', id);
      // 22c: apply the global `defaultApproveAll` setting to brand-new
      // sessions. The flag lives in the renderer's settings store so
      // we don't need a backend RPC change — just call the existing
      // per-session setter. Skipped when false (default) so we don't
      // emit a spurious approve-all flip on every session create.
      const defaultApprove = settingsStore.settings.permissions?.defaultApproveAll;

      if (defaultApprove) {
        void setSessionApproveAll(id, true).catch(() => {
          /* toast already surfaced by the setter */
        });
      }

      // Fire-and-forget: get the current run mode so the UI shows it.
      // Re-look up the record by id when the RPC resolves — if the
      // session was closed in the meantime it's no longer in
      // `sessions.value` and we must not mutate a stale closure capture.
      void invokeCommand('getSessionMode', { sessionId: id })
        .then((mode) => {
          const current = getSession(id);

          if (current) current.mode = mode;
        })
        .catch(() => {
          /* mode RPC may be unavailable on older CLI hosts; ignore */
        });
      // 19a: hydrate current custom agent so the header chip is
      // accurate from the first paint (subagent.selected may not
      // fire post-create if the SDK's selection persists from a
      // previous session). Fire-and-forget like the mode fetch.
      void invokeCommand('getCurrentAgent', { sessionId: id })
        .then((agent) => {
          const current = getSession(id);

          if (current) current.currentAgent = agent;
        })
        .catch(() => {
          /* agent RPC may be unavailable; ignore */
        });

      return record;
    } catch (err) {
      const message = toErrorMessage(err);

      toasts.error('Failed to create session', message);
      throw err;
    } finally {
      isCreating.value = false;
    }
  }

  /// Resumes a previously-created session by id (typically called
  /// during startup from persisted layout). Returns the new
  /// SessionRecord, or `null` if the SDK could not resume (deleted /
  /// corrupted / unknown id). Errors are reported as info toasts since
  /// "the user deleted this session via the CLI" is a common, benign
  /// case — we just drop the pane.
  async function restoreSession(sessionId: string): Promise<SessionRecord | null> {
    ensureSubscription();
    const toasts = useToastStore();

    try {
      // The bun RPC handler may return a different id if the SDK
      // forked on resume (rare, but the contract allows it). `cwd`
      // comes from the session catalog, not the event stream —
      // `getMessages()` history doesn't include `session.resume`, so
      // the workspace chip would otherwise stay hidden after restore.
      const response = await invokeCommand('resumeSession', {
        sessionId,
        model: null,
        reasoningEffort: null,
      });
      const actualId = response.sessionId;
      // Idempotent: if a record for this id is already present (e.g.
      // double-restore), just return it.
      const existing = getSession(actualId);

      if (existing) {
        // Still backfill cwd if the existing record is missing it.
        if (!existing.workingDirectory && response.cwd) existing.workingDirectory = response.cwd;

        if (!existing.model && response.model) existing.model = response.model;

        return existing;
      }

      const accent = accentForIndex(creationCount++);
      const record: SessionRecord = reactive({
        id: actualId,
        accent,
        events: [],
        droppedEventCount: 0,
        model: response.model,
        reasoningEffort: null,
        title: null,
        mode: null,
        approveAll: false,
        reasoningVisibilityOverride: 'default',
        workingDirectory: response.cwd ?? null,
        defaultSendMode: 'steer',

        pendingRequests: [],
        unseenTurns: 0,
        isThinking: false,
        sawTurnBoundary: false,
        currentAgent: null,
        tasksRefreshCounter: 0,
        planRefreshCounter: 0,
        touchedFiles: [],
        commandsRun: 0,

        _toastedOauthRequests: new Set<string>(),
        _toastedNeedsAuth: new Set<string>(),
        _artifactToolCallIds: new Set<string>(),
      });

      sessions.value.push(record);
      // Drain any events that arrived between bun-side `resume()` and
      // the RPC response reaching us — chiefly the history replay
      // (assistant.message_*, tool.*, session.start, …), which would
      // otherwise be lost and the pane would render blank.
      const drained = drainPending(actualId, record);

      if (import.meta.env.DEV) {
        console.debug('[restoreSession] resumed', {
          requestedId: sessionId,
          actualId,
          drainedEvents: drained,
          recordEvents: record.events.length,
        });
      }

      // Pick up the run mode the SDK is currently using for the
      // restored session — same fire-and-forget shape as createSession.
      void invokeCommand('getSessionMode', { sessionId: actualId })
        .then((mode) => {
          const current = getSession(actualId);

          if (current) current.mode = mode;
        })
        .catch(() => {
          /* mode RPC may be unavailable on older CLI hosts; ignore */
        });
      // 19a: same hydration as createSession.
      void invokeCommand('getCurrentAgent', { sessionId: actualId })
        .then((agent) => {
          const current = getSession(actualId);

          if (current) current.currentAgent = agent;
        })
        .catch(() => {
          /* agent RPC may be unavailable; ignore */
        });
      // Hydrate the SDK-stored session name so the tab title shows
      // something meaningful right away. The history replay may or may
      // not contain a `session.title_changed` event — fetching the
      // persisted name closes the gap for sessions whose replay doesn't
      // include it.
      void invokeCommand('getSessionName', { sessionId: actualId })
        .then((name) => {
          const current = getSession(actualId);

          if (current && name && !current.title) current.title = name;
        })
        .catch(() => {
          /* name RPC may be unavailable; ignore */
        });

      return record;
    } catch (err) {
      const message = toErrorMessage(err);

      toasts.info('Session not restored', `${sessionId.slice(0, 8)}…: ${message}`);

      return null;
    }
  }

  async function closeSession(id: string): Promise<void> {
    const toasts = useToastStore();

    try {
      await invokeCommand('disconnectSession', { sessionId: id });
    } catch (err) {
      const message = toErrorMessage(err);

      toasts.error('Failed to close session', message);
    } finally {
      sessions.value = sessions.value.filter((s) => s.id !== id);
    }
  }

  /// Sends a message with the given mode.
  /// - "steer" (default in v1): SDK `mode: "immediate"` — injects into a
  ///   running turn if any, otherwise starts a new one.
  /// - "queue": SDK `mode: "enqueue"` — waits behind the in-flight turn.
  /// - "interrupt": abort current turn, then send a fresh one. The abort
  ///   call resolves on SDK ack (not on idle); for v1 we let the SDK
  ///   handle the rejoin race rather than waiting for `session.idle`
  ///   ourselves. If we observe ordering issues we'll add a wait-for-idle
  ///   gate (rubber-duck flagged this in the original plan).
  async function sendMessage(
    sessionId: string,
    text: string,
    mode: SendMode = 'steer',
    attachments?: import('@/ipc/types').SendMessageAttachment[],
  ): Promise<void> {
    // Vue reactive proxies don't always survive structured-clone /
    // JSON serialization through the Electrobun bridge — fields can
    // be silently dropped on the bun side. Deep-clone via JSON to
    // strip the proxy wrappers and guarantee plain-object payloads.
    const atts =
      attachments && attachments.length > 0
        ? (JSON.parse(JSON.stringify(attachments)) as import('@/ipc/types').SendMessageAttachment[])
        : undefined;

    if (mode === 'interrupt') {
      try {
        await invokeCommand('abortSession', { sessionId });
      } catch (err) {
        const message = toErrorMessage(err);

        useToastStore().warn('Abort failed; sending anyway', message);
      }

      await invokeCommand('sendMessage', {
        sessionId,
        text,
        ...(atts ? { attachments: atts } : {}),
      });

      return;
    }

    const sdkMode = mode === 'steer' ? 'immediate' : 'enqueue';

    await invokeCommand('sendMessage', {
      sessionId,
      text,
      mode: sdkMode,
      ...(atts ? { attachments: atts } : {}),
    });
  }

  async function abortSession(sessionId: string): Promise<void> {
    const toasts = useToastStore();

    try {
      await invokeCommand('abortSession', { sessionId });
    } catch (err) {
      const message = toErrorMessage(err);

      toasts.error('Failed to abort turn', message);
      throw err;
    }
  }

  /// In-memory only — the per-session default for the composer's primary
  /// send action. Mutating this updates `SessionRecord.defaultSendMode`,
  /// which the composer subscribes to.
  function setDefaultSendMode(sessionId: string, next: DefaultSendMode): void {
    const record = getSession(sessionId);

    if (record) record.defaultSendMode = next;
  }

  async function setSessionModel(
    sessionId: string,
    model: string,
    reasoningEffort: string | null,
  ): Promise<void> {
    const toasts = useToastStore();

    try {
      await invokeCommand('setSessionModel', {
        sessionId,
        model,
        reasoningEffort,
      });
      const record = getSession(sessionId);

      if (record) {
        record.model = model;
        record.reasoningEffort = reasoningEffort;
      }
    } catch (err) {
      const message = toErrorMessage(err);

      toasts.error('Failed to switch model', message);
      throw err;
    }
  }

  async function setSessionMode(sessionId: string, mode: SessionMode): Promise<void> {
    const toasts = useToastStore();

    try {
      await invokeCommand('setSessionMode', { sessionId, mode });
      const record = getSession(sessionId);

      if (record) record.mode = mode;
    } catch (err) {
      const message = toErrorMessage(err);

      toasts.error('Failed to change run mode', message);
      throw err;
    }
  }

  async function setSessionApproveAll(sessionId: string, enabled: boolean): Promise<void> {
    // Playground sentinel: skip the RPC (no real bun session) but
    // still mirror the flag onto the in-memory record so the UI
    // reflects the toggle for inline testing.
    if (sessionId === PLAYGROUND_PENDING_SESSION_ID) {
      const record = getSession(sessionId);

      if (record) record.approveAll = enabled;

      return;
    }

    const toasts = useToastStore();

    try {
      await invokeCommand('setSessionApproveAll', { sessionId, enabled });
      const record = getSession(sessionId);

      if (record) record.approveAll = enabled;
    } catch (err) {
      const message = toErrorMessage(err);

      toasts.error('Failed to update auto-approval', message);
      throw err;
    }
  }

  async function resetSessionApprovals(sessionId: string): Promise<void> {
    const toasts = useToastStore();

    try {
      await invokeCommand('resetSessionApprovals', { sessionId });
      toasts.success('Session approvals cleared', sessionId);
    } catch (err) {
      const message = toErrorMessage(err);

      toasts.error('Failed to reset approvals', message);
      throw err;
    }
  }

  async function setSessionWorkingDirectory(
    sessionId: string,
    workingDirectory: string,
  ): Promise<string> {
    const toasts = useToastStore();
    // Capture the baseWorkingDirectory read-only BEFORE the await
    // (so the RPC has it for relative-path resolution), but DO NOT
    // capture the record reference itself — it may be unmounted by
    // the time the RPC resolves. Re-lookup after.
    const baseWd = getSession(sessionId)?.workingDirectory;

    try {
      const next = await invokeCommand('setSessionWorkingDirectory', {
        sessionId,
        workingDirectory,
        ...(baseWd ? { baseWorkingDirectory: baseWd } : {}),
      });
      // Re-lookup the record post-await — it may have been closed
      // mid-RPC, in which case there's nothing to update locally
      // (the SDK side already committed the change).
      const record = getSession(sessionId);

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

  async function compactSessionHistory(sessionId: string): Promise<void> {
    const toasts = useToastStore();

    try {
      const result = await invokeCommand('compactSessionHistory', {
        sessionId,
      });

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

  /// Truncate the session's history to (and including) `eventId`,
  /// then send the new text. Used by the Edit action on a user
  /// message: the user supplies replacement text in the composer,
  /// the SDK is told to forget from that point onward, and the new
  /// message is dispatched fresh.
  async function editUserMessage(
    sessionId: string,
    eventId: string,
    newText: string,
  ): Promise<void> {
    const toasts = useToastStore();

    try {
      await invokeCommand('truncateSessionHistory', { sessionId, eventId });
      // Drop local items at the truncation point too — otherwise we
      // double-render the edited message until the SDK echoes it.
      const record = getSession(sessionId);

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

  /// Truncate to `eventId` (typically the preceding user message)
  /// and re-send its text — "retry from here" semantics. Caller
  /// passes the resolved user text so the store doesn't need to
  /// search the items array.
  async function retryFromEvent(
    sessionId: string,
    eventId: string,
    userText: string,
  ): Promise<void> {
    return editUserMessage(sessionId, eventId, userText);
  }

  /// Fork the session at an optional event boundary. When the new
  /// session id resolves, restoreSession opens it as a panel. Returns
  /// the new session id so the caller can route to it / focus it.
  async function forkSession(sessionId: string, toEventId?: string): Promise<string> {
    const toasts = useToastStore();

    try {
      const result = await invokeCommand('forkSession', {
        sessionId,
        ...(toEventId ? { toEventId } : {}),
      });

      await restoreSession(result.sessionId);

      return result.sessionId;
    } catch (err) {
      const message = toErrorMessage(err);

      toasts.error('Failed to fork session', message);
      throw err;
    }
  }

  /// Fork-and-send: fork the session at the given event boundary,
  /// then send `newText` as the first user message in the new
  /// session. Returns the new session id so the caller can open it
  /// as a panel.
  async function forkAndSend(
    sessionId: string,
    toEventId: string,
    newText: string,
  ): Promise<string> {
    const newId = await forkSession(sessionId, toEventId);

    await sendMessage(newId, newText);

    return newId;
  }

  /// Best-effort lookup for the loaded session that matches a
  /// free-form name. Used by the fork-notice chip to resolve a
  /// CLI-supplied "name" to a sessionId we can activate. Matches
  /// exact title, then title-startsWith, then short-id prefix
  /// (CLI's default fork name format is `Session <8 hex>...`).
  function findSessionByName(name: string): SessionRecord | undefined {
    if (!name) return undefined;

    const trimmed = name.trim();
    const lower = trimmed.toLowerCase();
    const records = sessions.value;
    const exact = records.find((s) => (s.title ?? '').toLowerCase() === lower);

    if (exact) return exact;

    const titleStarts = records.find((s) => (s.title ?? '').toLowerCase().startsWith(lower));

    if (titleStarts) return titleStarts;

    const m = trimmed.match(/([0-9a-f]{4,})/i);

    if (m && m[1]) {
      const prefix = m[1].toLowerCase();
      const byId = records.find((s) => s.id.toLowerCase().startsWith(prefix));

      if (byId) return byId;
    }

    return undefined;
  }

  async function setSessionName(sessionId: string, name: string): Promise<void> {
    const toasts = useToastStore();

    try {
      await invokeCommand('setSessionName', { sessionId, name });
    } catch (err) {
      const message = toErrorMessage(err);

      toasts.error('Failed to rename session', message);
      throw err;
    }
  }

  /// Per-session UI override for reasoning visibility. `"default"`
  /// means inherit from `settings.appearance.reasoningVisibility`.
  /// In-memory only — not persisted across reloads. No backend RPC.
  function setSessionReasoningOverride(
    sessionId: string,
    value: ReasoningVisibility | 'default',
  ): void {
    const record = getSession(sessionId);

    if (record) record.reasoningVisibilityOverride = value;
  }

  /// Sends the user's answer to a pending SDK callback. The bun
  /// side resolves the awaiting Promise; the matching queue entry
  /// is removed locally immediately (don't wait for the SDK
  /// `_completed` echo, which can lag), and we also push a
  /// synthetic `dafman.pending_response` into the record's event
  /// buffer so the reducer's `ambient.pendingRequests` queue +
  /// in-stream card both clear in the same tick.
  ///
  /// The `PLAYGROUND_PENDING_SESSION_ID` sentinel short-circuits
  /// the RPC call so the dev playground can exercise the card
  /// without a real bun-side handler (which would reject with
  /// `Session ${id} not found`).
  async function respondToPending(params: RespondToRequestParams): Promise<void> {
    const record = getSession(params.sessionId);
    // Snapshot + remove the pending entry optimistically so the UI's
    // pending card disappears immediately on click. The
    // `dafman.pending_response` event is NOT appended until the RPC
    // succeeds — otherwise a failed response would leave a phantom
    // response event in the transcript that the chat reducer would
    // dutifully render.
    let restoredEntry: PendingRecordRequest | null = null;
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

      const toasts = useToastStore();

      toasts.error('Failed to send response', toErrorMessage(err));
    }
  }

  return {
    sessions,
    getSession,
    isCreating,
    createSession,
    restoreSession,
    closeSession,
    sendMessage,
    abortSession,
    setDefaultSendMode,
    setSessionModel,
    setSessionMode,
    setSessionApproveAll,
    resetSessionApprovals,
    setSessionWorkingDirectory,
    compactSessionHistory,
    editUserMessage,
    retryFromEvent,
    forkSession,
    forkAndSend,
    findSessionByName,
    setSessionName,
    setSessionReasoningOverride,
    respondToPending,
    /// Exported so callers outside the store (e.g. slash-command
    /// handlers in `lib/sessionCommands.ts`) can push synthetic
    /// events while still bounding the per-session log.
    appendEvent,
    /// 22a: exported for tests that need to exercise the
    /// side-effectful event handling pipeline (MCP OAuth toasts,
    /// model-change handling, …) without spinning up the real
    /// `onSessionEvent` RPC subscription. Same function the runtime
    /// subscription delegates to.
    applySessionEvent: handleEvent,
  };
});
