// Composable for ChatWindow's per-message action handlers.
//
// Extracted from ChatWindow.vue (Phase D.2 step 4). Owns the
// edit/quote/retry/fork/fork-notice flows + the editor save/cancel
// flows + their anchor-walk helpers. Calls into the timeline state
// controller via the injected `resetForReplay` rather than mutating
// transcript state directly — per the 2026-05-26 rubber-duck on the
// extraction shape.
//
// Stores are passed as dependencies (testable) rather than reached
// for via `use*()` so the composable can be exercised against fakes
// without a real Pinia install.

import { ref, type ComputedRef, type Ref } from 'vue';
import type { ChatItem } from '@/lib/chatEvents';

export interface MessageActionsToasts {
  warn(summary: string, detail?: string): void;
}

/// Subset of `useSessionsStore` we depend on.
export interface MessageActionsSessionsStore {
  editUserMessage(sessionId: string, eventId: string, newText: string): Promise<void>;
  forkAndSend(sessionId: string, eventId: string, newText: string): Promise<string>;
  retryFromEvent(sessionId: string, eventId: string, text: string): Promise<void>;
  forkSession(sessionId: string, toEventId?: string): Promise<string>;
  findSessionByName(name: string): { id: string } | undefined;
  /// Loose return type so the real `sessionsStore.restoreSession`
  /// (which returns `SessionRecord | null`) and tighter fakes both
  /// satisfy this contract. We only read `.id` off the result.
  restoreSession(sessionId: string): Promise<{ id: string } | null | undefined>;
}

export interface MessageActionsSessionsListStore {
  hasLoaded: boolean;
  refresh(): Promise<void>;
  findByName(name: string): { sessionId: string } | undefined;
}

export interface MessageActionsLayoutStore {
  addPanel(sessionId: string): void;
  activatePanel(sessionId: string): void;
  isPanelOpen(panelId: string): boolean;
}

export interface UseMessageActionsOptions {
  /// Reactive session id (read fresh on every action).
  sessionId: Ref<string>;
  /// Live items array from `useChatTimelineState`. Read-only for this
  /// composable — all mutations go through `resetForReplay` when the
  /// transcript needs to be cleared (editor-save path).
  items: ComputedRef<ChatItem[]> | Ref<ChatItem[]>;
  /// Composer ref for `quote` (appendText) and focus.
  composerRef: Ref<{
    appendText?: (text: string) => void;
  } | null>;
  /// Inline-edit transition handle — exposed because the parent
  /// template binds `:v-if="editingItemId === item.id"`. Owned here
  /// so the save / cancel paths can clear it.
  editingItemId: Ref<number | null>;
  /// Reset the transcript after the SDK acks the truncate+resend
  /// (editor-save path). Forwarded from `useChatTimelineState`.
  resetForReplay(opts?: { markSending?: boolean }): void;
  scrollToBottom(): Promise<void> | void;
  toasts: MessageActionsToasts;
  sessionsStore: MessageActionsSessionsStore;
  sessionsListStore: MessageActionsSessionsListStore;
  layoutStore: MessageActionsLayoutStore;
}

export interface UseMessageActionsReturn {
  editingItemId: Ref<number | null>;
  onMessageEdit: (itemId: number) => void;
  onMessageQuote: (quotedText: string) => void;
  onEditorSave: (eventId: string, newText: string) => Promise<void>;
  onEditorSaveFork: (eventId: string, newText: string) => Promise<void>;
  onEditorCancel: () => void;
  onMessageRetry: (assistantItemIndex: number) => Promise<void>;
  onMessageFork: (itemIndex: number) => Promise<void>;
  onForkNoticeClick: (referenceName: string) => Promise<void>;
  itemIndexById: (itemId: number) => number;
}

export function useMessageActions(opts: UseMessageActionsOptions): UseMessageActionsReturn {
  const editingItemId = opts.editingItemId ?? ref<number | null>(null);

  function onMessageEdit(itemId: number): void {
    editingItemId.value = itemId;
  }

  function onMessageQuote(quotedText: string): void {
    opts.composerRef.value?.appendText?.(quotedText);
  }

  async function onEditorSave(eventId: string, newText: string): Promise<void> {
    editingItemId.value = null;

    if (!eventId) {
      opts.toasts.warn("Can't save edit", 'Missing server anchor for this message.');

      return;
    }

    try {
      await opts.sessionsStore.editUserMessage(opts.sessionId.value, eventId, newText);
      opts.resetForReplay({ markSending: true });
      await opts.scrollToBottom();
    } catch {
      // Toast surfaced by the store action.
    }
  }

  /// Save & fork: open a brand-new session forked at the user
  /// message's eventId, send the edited text there. Original session
  /// is left intact. The new session opens as a new dockview panel.
  async function onEditorSaveFork(eventId: string, newText: string): Promise<void> {
    editingItemId.value = null;

    if (!eventId) {
      opts.toasts.warn("Can't fork", 'Missing server anchor for this message.');

      return;
    }

    try {
      const newId = await opts.sessionsStore.forkAndSend(opts.sessionId.value, eventId, newText);

      opts.layoutStore.addPanel(newId);
      opts.layoutStore.activatePanel(newId);
    } catch {
      // Toast surfaced by the store action.
    }
  }

  function onEditorCancel(): void {
    editingItemId.value = null;
  }

  async function onMessageRetry(assistantItemIndex: number): Promise<void> {
    // Walk backwards to find the most recent user item BEFORE this
    // assistant block. That's the anchor we truncate to + the text
    // we resend.
    const arr = opts.items.value;

    for (let i = assistantItemIndex - 1; i >= 0; i--) {
      const it = arr[i];

      if (it && it.kind === 'user' && it.eventId) {
        try {
          await opts.sessionsStore.retryFromEvent(opts.sessionId.value, it.eventId, it.text);
        } catch {
          // Toast already shown by the store action.
        }

        return;
      }
    }

    opts.toasts.warn(
      "Can't retry from here",
      'No preceding user message with a server-acknowledged anchor.',
    );
  }

  /// Resolve the right fork anchor for the item at `itemIndex`.
  ///
  /// "Fork from this assistant message" → branch at the user message
  /// that triggered this assistant turn. The SDK's `toEventId` is
  /// exclusive, so we'd otherwise land mid-turn (turn_start without
  /// turn_end → permanent loading spinner). Anchoring at the user
  /// message gives a clean state from the same conversation lead-up
  /// and lets the user re-prompt.
  ///
  /// For user messages we just use their own eventId.
  function resolveForkAnchor(itemIndex: number): string | undefined {
    const arr = opts.items.value;
    const item = arr[itemIndex];

    if (!item) return undefined;

    if (item.kind === 'user' && item.eventId) return item.eventId;

    for (let i = itemIndex; i >= 0; i--) {
      const it = arr[i];

      if (it && it.kind === 'user' && it.eventId) return it.eventId;
    }

    return undefined;
  }

  async function onMessageFork(itemIndex: number): Promise<void> {
    const anchor = resolveForkAnchor(itemIndex);

    if (!anchor) {
      opts.toasts.warn(
        "Can't fork from here",
        'Need a preceding user message with a server-acknowledged anchor.',
      );

      return;
    }

    try {
      const newId = await opts.sessionsStore.forkSession(opts.sessionId.value, anchor);

      opts.layoutStore.addPanel(newId);
      opts.layoutStore.activatePanel(newId);
    } catch {
      // Toast already shown by the store action.
    }
  }

  /// Fork-notice chip clicked → resolve the referenced session by
  /// name (best-effort) and surface it. Three-tier lookup:
  /// 1. Already-loaded sessions (sessionsStore) → activate the panel.
  /// 2. Catalog (sessionsListStore) → restore + add panel + activate.
  ///    Refreshes the catalog first if it hasn't loaded yet, since
  ///    forks done before this app started won't be in the cache.
  /// 3. Nothing matched → toast hint to open via the sidebar.
  async function onForkNoticeClick(referenceName: string): Promise<void> {
    const loaded = opts.sessionsStore.findSessionByName(referenceName);

    if (loaded) {
      if (!opts.layoutStore.isPanelOpen(loaded.id)) {
        opts.layoutStore.addPanel(loaded.id);
      }

      opts.layoutStore.activatePanel(loaded.id);

      return;
    }

    if (!opts.sessionsListStore.hasLoaded) {
      await opts.sessionsListStore.refresh();
    }

    const catalogHit = opts.sessionsListStore.findByName(referenceName);

    if (catalogHit) {
      try {
        const restored = await opts.sessionsStore.restoreSession(catalogHit.sessionId);
        const id = (restored as { id?: string } | undefined)?.id ?? catalogHit.sessionId;

        if (!opts.layoutStore.isPanelOpen(id)) {
          opts.layoutStore.addPanel(id);
        }

        opts.layoutStore.activatePanel(id);
      } catch {
        // restoreSession surfaces its own toast on failure.
      }

      return;
    }

    opts.toasts.warn(
      "Couldn't find that session",
      `No session matches "${referenceName}". Open it from the sessions sidebar.`,
    );
  }

  function itemIndexById(itemId: number): number {
    return opts.items.value.findIndex((item) => item.id === itemId);
  }

  return {
    editingItemId,
    onMessageEdit,
    onMessageQuote,
    onEditorSave,
    onEditorSaveFork,
    onEditorCancel,
    onMessageRetry,
    onMessageFork,
    onForkNoticeClick,
    itemIndexById,
  };
}
