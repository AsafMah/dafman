// Composable that owns ChatWindow's optimistic-send orchestrator.
//
// Extracted from ChatWindow.vue (Phase D.2 step 3). The submit handler
// touches every other composable — timeline (`appendOptimisticUser`,
// `appendSystemError`), scroll (`scrollToBottom`), and the transport
// (either `sendHandler` for the dev playground or
// `sessionsStore.sendMessage` for real sessions). Keeping it as a
// separate composable rather than inlining it in ChatWindow makes the
// `sendHandler` swap testable in isolation and gives the dev
// playground a clean seam.
//
// Mode semantics:
// - `default` → resolved against the session's `defaultSendMode`
//   (`steer` or `queue`)
// - `queue` / `interrupt` → passed through unchanged
//
// The busy guard (`isSending.value`) is intentionally NOT here:
// queuing/steering while a turn is in flight is the whole point of
// these modes. The optimistic user bubble appears immediately; the
// SDK reconciles it with the eventual `user.message` echo.

import type { ComposerSubmitPayload } from '@/lexical/plugins';
import type { SendMessageAttachment } from '@/ipc/types';
import type { SendMode } from '@/stores/chat/sessionsStore';
import { toErrorMessage } from '@/lib/errorMessage';

export interface ChatSubmitToasts {
  error(summary: string, detail?: string): void;
}

export interface ChatSubmitTransport {
  /// Real-session send. Routes through `sessionsStore.sendMessage`
  /// in production; tests can swap a fake bridge.
  sendMessage(
    sessionId: string,
    text: string,
    mode: SendMode,
    attachments?: SendMessageAttachment[],
  ): Promise<void>;
}

export interface UseChatSubmitOptions {
  /// Reactive session id getter. Read on every submit so the handler
  /// always targets the currently-mounted session.
  getSessionId(): string;
  /// Per-session default mode resolution. Getter for the same reason.
  getDefaultSendMode(): SendMode;
  /// Optional dev-playground bypass. When provided, called instead of
  /// the transport's `sendMessage`. Receives the raw text only —
  /// playground doesn't render attachments.
  getSendHandler(): ((text: string) => Promise<void> | void) | undefined;
  /// Timeline-state mutations (from `useChatTimelineState`).
  appendOptimisticUser(text: string, attachments?: SendMessageAttachment[]): void;
  appendSystemError(text: string): void;
  /// DOM scroll (from `useChatScroll`).
  scrollToBottom(): Promise<void> | void;
  /// Toast emission for the catch path.
  toasts: ChatSubmitToasts;
  /// Real transport — typically the `sessionsStore`.
  transport: ChatSubmitTransport;
}

export type ComposerSubmitPayloadWithAttachments = ComposerSubmitPayload & {
  attachments?: SendMessageAttachment[];
};

export interface UseChatSubmitReturn {
  sendMessage: (payload: ComposerSubmitPayloadWithAttachments) => Promise<void>;
}

export function useChatSubmit(opts: UseChatSubmitOptions): UseChatSubmitReturn {
  async function sendMessage(payload: ComposerSubmitPayloadWithAttachments): Promise<void> {
    if (!payload.text) return;

    const defaultMode = opts.getDefaultSendMode();
    const concreteMode: SendMode = payload.mode === 'default' ? defaultMode : payload.mode;

    opts.appendOptimisticUser(payload.text, payload.attachments);
    await opts.scrollToBottom();

    try {
      const handler = opts.getSendHandler();

      if (handler) {
        await handler(payload.text);
      } else {
        await opts.transport.sendMessage(
          opts.getSessionId(),
          payload.text,
          concreteMode,
          payload.attachments,
        );
      }
    } catch (error) {
      const message = toErrorMessage(error);

      opts.appendSystemError(`Error: ${message}`);
      opts.toasts.error('Failed to send message', message);
      await opts.scrollToBottom();
    }
  }

  return { sendMessage };
}
