// Composable that owns ChatWindow's transcript state machine.
//
// Extracted from ChatWindow.vue (Phase D.2 step 2). Per the 2026-05-26
// pre-split rubber-duck, this is intentionally a SINGLE controller
// rather than a thin `useChatEventFlush` + escape-hatch mutations —
// items, ambient, the id counter, the absolute cursor, the
// first-batch hydration flag, and the fallback "thinking" flag are
// one coupled state machine. Splitting them would just hide the god
// object behind shared refs.
//
// All state mutation goes through semantic APIs:
//
//   appendOptimisticUser(text, attachments?)
//   appendSystemError(text)
//   resetForReplay({ markSending? })
//
// The session-events watcher and rAF-coalesced flush are owned here.
// Toast emission (from reducer output) and scroll-to-bottom (after
// each flush) are injected so the composable stays Pinia-free and
// unit-testable in isolation.
//
// `idCounter` is intentionally returned so consumers (notably
// `useCommandTerminal`) can share the same monotonic id space —
// `timelineItems` merges chat items and command-result cards by their
// `id`, so they must come from one counter.

import { computed, onBeforeUnmount, ref, watch, type ComputedRef, type Ref } from 'vue';

import {
  appendSystemMessage,
  appendUserMessage,
  defaultAmbient,
  processEvents,
  type ChatAmbient,
  type ChatItem,
  type IdCounter,
} from '@/lib/chatEvents';
import type { SendMessageAttachment, SessionEventPayload } from '@/ipc/types';

/// Minimal toast-emission surface the reducer needs. Matches the
/// methods used by `processEvents`'s toast output (`success` / `warn`
/// / `error` / `info`). Accepts the real `useToastStore()` instance
/// directly, or a fake in tests.
export interface TimelineToasts {
  success(summary: string, detail?: string): void;
  warn(summary: string, detail?: string): void;
  error(summary: string, detail?: string): void;
  info(summary: string, detail?: string): void;
}

export interface UseChatTimelineStateOptions {
  events: Ref<SessionEventPayload[]>;
  droppedEventCount: Ref<number | undefined>;
  sessionId: Ref<string>;
  toasts: TimelineToasts;
  /// Called after every successful flush so the transcript ends
  /// scroll-pinned to the latest item.
  scrollToBottom: () => Promise<void> | void;
}

export interface UseChatTimelineStateReturn {
  items: Ref<ChatItem[]>;
  ambient: Ref<ChatAmbient>;
  idCounter: IdCounter;
  /// "Agent might be working" indicator local to this composable.
  /// `recordIsThinking` (which prefers the session record's
  /// `isThinking` flag after the first turn boundary) lives in
  /// ChatWindow because it reaches into the sessions store.
  isSending: ComputedRef<boolean>;
  appendOptimisticUser: (text: string, attachments?: SendMessageAttachment[]) => void;
  appendSystemError: (text: string) => void;
  resetForReplay: (opts?: { markSending?: boolean }) => void;
}

export function useChatTimelineState(
  opts: UseChatTimelineStateOptions,
): UseChatTimelineStateReturn {
  const items = ref<ChatItem[]>([]);
  const ambient = ref<ChatAmbient>(defaultAmbient());
  const idCounter: IdCounter = { next: 1 };

  /// Fallback "thinking" flag used until we observe a turn boundary;
  /// after the first `assistant.turn_start` we trust
  /// `ambient.turnActive` exclusively.
  const isSendingFallback = ref(false);

  /// Absolute position in the session's event stream that we've
  /// already reduced into `items`. Computed as `droppedEventCount +
  /// events.length` AFTER the reducer pass, so the next flush picks
  /// up only events that arrived since. Survives the store's
  /// ring-buffer trim (which bumps droppedEventCount and shifts
  /// `events`) without re-processing or skipping anything.
  let processedAbsolute = 0;
  let isFirstBatch = true;

  const isSending = computed(() =>
    ambient.value.sawTurnBoundary ? ambient.value.turnActive : isSendingFallback.value,
  );

  /// rAF-coalesced flush. Each event arrives as its own IPC frame —
  /// during session hydration that's 30-80+ frames in quick
  /// succession. Without coalescing we'd run processEvents O(N²)
  /// times (N=length on each push) and remount the whole CM6/Lexical
  /// tree per chunk. By gating the work behind requestAnimationFrame
  /// we collapse all events that landed in the same frame into a
  /// single reducer pass.
  let pendingFlush: number | null = null;

  function scheduleFlush(): void {
    if (pendingFlush !== null) return;

    if (typeof requestAnimationFrame === 'undefined') {
      // Test environments (jsdom etc.) — flush synchronously so the
      // existing chatEvents tests don't have to wait for a frame.
      flush();

      return;
    }

    pendingFlush = requestAnimationFrame(() => {
      pendingFlush = null;
      flush();
    });
  }

  function flush(): void {
    const dropped = opts.droppedEventCount.value ?? 0;
    const target = dropped + opts.events.value.length;

    if (processedAbsolute >= target) return;

    // Slice index inside the (possibly trimmed) events array. clamped
    // to 0 in case the ring buffer trimmed events we hadn't processed
    // yet — those are lost, but the cap is high enough that this
    // only happens for surfaces that mount very late in a long
    // session.
    const startIdx = Math.max(0, processedAbsolute - dropped);
    const fresh = opts.events.value.slice(startIdx);

    processedAbsolute = target;
    const live = !isFirstBatch;

    isFirstBatch = false;
    const result = processEvents(items.value, ambient.value, fresh, idCounter, {
      live,
    });

    items.value = result.items;
    ambient.value = result.ambient;

    if (result.idle || result.error) isSendingFallback.value = false;

    for (const t of result.toasts) {
      switch (t.severity) {
        case 'success':
          opts.toasts.success(t.summary, t.detail);
          break;
        case 'warn':
          opts.toasts.warn(t.summary, t.detail);
          break;
        case 'error':
          opts.toasts.error(t.summary, t.detail);
          break;
        default:
          opts.toasts.info(t.summary, t.detail);
      }
    }

    if (result.error && live) {
      const lastSystem = [...result.items]
        .reverse()
        .find((i) => i.kind === 'system' && i.severity === 'error');

      if (lastSystem && lastSystem.kind === 'system') {
        opts.toasts.error('Session error', lastSystem.text);
      }
    }

    void opts.scrollToBottom();
  }

  watch(
    // Watch the absolute target (dropped + length). Trimming the ring
    // buffer leaves `events.length` unchanged but bumps
    // droppedEventCount — without including it here we'd miss the
    // flush for events that arrive once the buffer is at its cap.
    () => (opts.droppedEventCount.value ?? 0) + opts.events.value.length,
    () => scheduleFlush(),
    { immediate: true },
  );

  // Session switch: clear all transcript state and jump the cursor
  // forward to the current target so we don't re-process the new
  // session's already-buffered events.
  watch(
    () => opts.sessionId.value,
    () => {
      items.value = [];
      ambient.value = defaultAmbient();
      isSendingFallback.value = false;
      processedAbsolute =
        (opts.droppedEventCount.value ?? 0) + opts.events.value.length;
    },
  );

  onBeforeUnmount(() => {
    if (pendingFlush !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(pendingFlush);
      pendingFlush = null;
    }
  });

  function appendOptimisticUser(
    text: string,
    attachments?: SendMessageAttachment[],
  ): void {
    items.value = appendUserMessage(items.value, text, idCounter, attachments);
    isSendingFallback.value = true;
  }

  function appendSystemError(text: string): void {
    items.value = appendSystemMessage(items.value, text, idCounter);
    isSendingFallback.value = false;
  }

  /// Drop the local transcript and rewind the cursor to zero so the
  /// next event from the SDK (the edited/forked turn's first event)
  /// replays as a fresh hydration pass. The optional `markSending`
  /// keeps the spinner up while the SDK works through the edited
  /// turn. Used by the editor-save path; not appropriate for plain
  /// session switches (use the `sessionId` watcher for that, which
  /// jumps the cursor FORWARD instead of rewinding).
  function resetForReplay(opts2?: { markSending?: boolean }): void {
    items.value = [];
    ambient.value = defaultAmbient();
    processedAbsolute = 0;
    isFirstBatch = true;
    isSendingFallback.value = Boolean(opts2?.markSending);
  }

  return {
    items,
    ambient,
    idCounter,
    isSending,
    appendOptimisticUser,
    appendSystemError,
    resetForReplay,
  };
}
