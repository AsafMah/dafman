/// Regression tests for ChatWindow.vue (Phase D.2 — pre-split safety net).
///
/// ChatWindow had 0 unit tests before this file (smoke covers the
/// happy path end-to-end but is too coarse for the rAF flush logic,
/// the optimistic-send path, or the inline retry/fork anchor walk).
/// Per AGENTS.md rule #4a + the 2026-05-26 handoff, these pins land
/// BEFORE any composable extraction so each split commit can be
/// validated against the same 5 invariants.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { setActivePinia, createPinia } from 'pinia';
import { cleanup, render, fireEvent } from '@testing-library/vue';
import { defineComponent, nextTick, type Component } from 'vue';
import PrimeVue from 'primevue/config';

/// Mock the Lexical-heavy chat children BEFORE importing ChatWindow.
/// Static `import` statements are hoisted in ESM, so `mock.module`
/// at module top still runs too late for the original chain. Dynamic
/// import below picks up the mocks after they're registered.
///
/// Only stub MessageComposer + MessageEditor — between them they
/// transitively pull `@lexical/react`, `@lexical/utils`, and
/// `@lexical/list`, all of which crash on a top-level-await circular
/// init under bun/happy-dom. UserMessageBody / MessageContent only
/// reach for `lexical` (which loads fine — see AttachmentNode tests),
/// so we leave them as real modules and stub them at render time
/// via `global.stubs`. Keeping the mock surface minimal also reduces
/// the cross-file leak risk: bun's `mock.module` registry persists
/// for the lifetime of the process, so anything we mock here is
/// stubbed for every sibling test file too. MessageComposer +
/// MessageEditor don't have their own unit tests today, so the leak
/// is harmless; UserMessageBody / MessageContent / MessageActions
/// DO have tests, so we leave them alone.
const composerStub = {
  name: 'MessageComposer',
  emits: ['submit', 'request-command-terminal', 'open-full-terminal', 'update:default-mode'],
  template: '<div class="stub-composer" />',
};
const editorStub = {
  name: 'MessageEditor',
  template: '<div class="stub-editor" />',
};

mock.module('@/components/chat/MessageComposer.vue', () => ({
  default: composerStub,
}));
mock.module('@/components/chat/MessageEditor.vue', () => ({
  default: editorStub,
}));

let ChatWindow: Component;
import {
  setRpcBridge,
  type RpcBridge,
  type SessionEventListener,
  type PendingRequestListener,
} from '@/ipc/invoke';
import { _resetSessionsStoreForTest } from '@/stores/chat/sessionsStore';
import { useCommandResultsStore } from '@/stores/chat/commandResultsStore';
import type {
  CommandMap,
  CommandName,
  PermissionRequestData,
  SessionEventPayload,
  SendMessageAttachment,
} from '@/ipc/types';

/// Minimal RPC bridge — returns empty arrays for the listing calls the
/// stores make during mount, records `sendMessage` / `retryFromEvent`
/// / `editUserMessage` / `forkSession` / `forkAndSend` calls for the
/// tests to assert against. Each test seeds its own expectations onto
/// the returned `calls` log.
interface BridgeHandle {
  bridge: RpcBridge;
  calls: Array<{ name: string; args: unknown }>;
  fireSession: (payload: SessionEventPayload) => void;
}

function makeBridge(): BridgeHandle {
  const calls: BridgeHandle['calls'] = [];
  const sessionListeners = new Set<SessionEventListener>();
  const pendingListeners = new Set<PendingRequestListener>();

  const request: RpcBridge['request'] = (async <N extends CommandName>(
    name: N,
    args: CommandMap[N]['args'],
  ) => {
    calls.push({ name, args });
    // Default empty/no-op responses for the side-loaded RPC calls
    // (terminal listing, command-results listing, settings).
    if (name === 'listTerminals') return [] as unknown as CommandMap[N]['result'];
    if (name === 'listCommandResults') return [] as unknown as CommandMap[N]['result'];
    if (name === 'getSettings') return undefined as unknown as CommandMap[N]['result'];
    return undefined as unknown as CommandMap[N]['result'];
  }) as RpcBridge['request'];

  const bridge: RpcBridge = {
    request,
    onSessionEvent: (l) => {
      sessionListeners.add(l);
      return () => sessionListeners.delete(l);
    },
    onPendingRequest: (l) => {
      pendingListeners.add(l);
      return () => pendingListeners.delete(l);
    },
    onLogEvent: () => () => {},
    onAuditEvent: () => () => {},
    onTerminalEvent: () => () => {},
    onCommandResultEvent: () => () => {},
  };

  return {
    bridge,
    calls,
    fireSession: (payload) => {
      for (const l of sessionListeners) l(payload);
    },
  };
}

/// Child-component stubs. We don't care about the rendered shape of
/// the message bubbles, the composer, or the artifact pills — only
/// about the event flow into / out of ChatWindow.
const stubs = {
  MessageComposer: defineComponent({
    name: 'MessageComposer',
    emits: ['submit', 'request-command-terminal', 'open-full-terminal', 'update:default-mode'],
    template: '<div class="stub-composer" />',
  }),
  MessageContent: defineComponent({
    name: 'MessageContent',
    props: ['text'],
    template: '<div class="stub-assistant">{{ text }}</div>',
  }),
  UserMessageBody: defineComponent({
    name: 'UserMessageBody',
    props: ['text', 'attachments'],
    template:
      '<div class="stub-user" :data-attachments="(attachments || []).length">{{ text }}</div>',
  }),
  MessageActions: defineComponent({
    name: 'MessageActions',
    props: ['kind', 'text', 'eventId', 'toolArgsText', 'toolResultText'],
    emits: ['edit', 'quote', 'retry', 'fork'],
    template:
      '<div class="stub-actions" :data-kind="kind" :data-event-id="eventId">' +
      '<button class="stub-retry" @click="$emit(\'retry\')" />' +
      '<button class="stub-fork" @click="$emit(\'fork\')" />' +
      '</div>',
  }),
  MessageEditor: defineComponent({
    name: 'MessageEditor',
    template: '<div class="stub-editor" />',
  }),
  SessionHeaderControls: defineComponent({
    name: 'SessionHeaderControls',
    template: '<div class="stub-header-controls" />',
  }),
  ToolCallBlock: defineComponent({
    name: 'ToolCallBlock',
    template: '<div class="stub-tool" />',
  }),
  SubagentBlock: defineComponent({
    name: 'SubagentBlock',
    template: '<div class="stub-subagent" />',
  }),
  PendingRequestCard: defineComponent({
    name: 'PendingRequestCard',
    props: ['sessionId', 'requestId', 'pendingKind', 'message', 'request'],
    template: '<div class="stub-pending-card" :data-request-id="requestId">{{ message }}</div>',
  }),
  CommandResultCard: defineComponent({
    name: 'CommandResultCard',
    props: ['record'],
    template: '<div class="stub-command-result" :data-id="record.id">{{ record.command }}</div>',
  }),
  ReasoningBlock: defineComponent({
    name: 'ReasoningBlock',
    template: '<div class="stub-reasoning" />',
  }),
};

function userEvent(text: string, eventId?: string): SessionEventPayload {
  return {
    sessionId: 's1',
    eventType: 'user.message',
    data: { content: text },
    ...(eventId ? { eventId } : {}),
  };
}

function assistantEvent(text: string, eventId?: string): SessionEventPayload {
  // The assistant.message handler requires `messageId` to dedupe stream
  // chunks. Without it the handler early-returns and no item is created.
  const messageId = eventId ?? `msg-${text.slice(0, 8)}`;
  return {
    sessionId: 's1',
    eventType: 'assistant.message',
    data: { messageId, text },
    ...(eventId ? { eventId } : {}),
  };
}

function pendingPermissionEvent(requestId: string, summary: string): SessionEventPayload {
  const request: PermissionRequestData = {
    kind: 'shell',
    summary,
    raw: { kind: 'shell' },
  };
  return {
    sessionId: 's1',
    eventType: 'dafman.pending_request',
    data: { requestId, kind: 'permission', request },
  };
}

/// happy-dom doesn't ship ResizeObserver; ChatWindow uses
/// VueUse's `useResizeObserver` for tile-height tracking. Provide a
/// noop so the composable's setup doesn't throw.
function ensureResizeObserver(): void {
  if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver !== 'undefined') return;
  class StubResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as unknown as { ResizeObserver: typeof StubResizeObserver }).ResizeObserver =
    StubResizeObserver;
}

interface MountOptions {
  events?: SessionEventPayload[];
  droppedEventCount?: number;
  defaultSendMode?: 'steer' | 'queue';
}

async function mountChat(opts: MountOptions = {}) {
  ensureResizeObserver();
  const utils = render(ChatWindow, {
    props: {
      sessionId: 's1',
      accent: '#abc',
      events: opts.events ?? [],
      droppedEventCount: opts.droppedEventCount ?? 0,
      reasoningVisibilityOverride: 'default',
      defaultSendMode: opts.defaultSendMode ?? 'steer',
    },
    global: {
      plugins: [PrimeVue],
      stubs,
    },
  });
  // Two ticks: one for the watcher to run scheduleFlush, one for the
  // synchronous (happy-dom has no rAF on first call to scheduleFlush
  // during setup — but VueUse + Vue do schedule on rAF anyway). We
  // explicitly drive a frame below.
  await nextTick();
  await flushFrames();
  return utils;
}

/// Drive enough animation frames to settle ChatWindow's rAF-coalesced
/// flush + scroll. Two frames is the conservative number per
/// `scrollToBottom`'s double-rAF pattern.
async function flushFrames(n = 3): Promise<void> {
  for (let i = 0; i < n; i++) {
    await new Promise<void>((resolve) =>
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(() => resolve())
        : setTimeout(resolve, 0),
    );
    await nextTick();
  }
}

describe('ChatWindow', () => {
  let handle: BridgeHandle;

  beforeAll(async () => {
    ChatWindow = (await import('@/components/chat/ChatWindow.vue')).default;
  });

  beforeEach(() => {
    setActivePinia(createPinia());
    _resetSessionsStoreForTest();
    handle = makeBridge();
    setRpcBridge(handle.bridge);
  });

  afterEach(() => {
    cleanup();
    setRpcBridge(null);
    document.body.innerHTML = '';
  });

  /// Bun's `mock.module()` registers replacements in the process-wide
  /// module cache. Without restoring, the four chat-component mocks
  /// above leak into sibling test files (UserMessageBody, etc.) and
  /// silently swap the real components for our `<div class="stub-…">`
  /// surrogates. `mock.restore()` clears every mock registered in
  /// this file so the next file gets the real modules.
  afterAll(() => {
    mock.restore();
  });

  test('flush respects droppedEventCount across a ring-buffer trim', async () => {
    // Prime the component with 3 user messages.
    const initial = [
      userEvent('one', 'evt-1'),
      userEvent('two', 'evt-2'),
      userEvent('three', 'evt-3'),
    ];
    const utils = await mountChat({ events: initial, droppedEventCount: 0 });

    // After the initial flush the transcript should show all three
    // user bubbles (via UserMessageBody stub).
    const initialBubbles = utils.container.querySelectorAll('.stub-user');
    expect(initialBubbles.length).toBe(3);

    // Simulate a ring-buffer trim: drop the first event, append a new
    // one. `events.length` is unchanged (3) but `droppedEventCount`
    // bumps from 0 → 1, so absolute progress (`dropped + length`)
    // goes 3 → 4 and the watcher fires.
    await utils.rerender({
      sessionId: 's1',
      accent: '#abc',
      events: [userEvent('two', 'evt-2'), userEvent('three', 'evt-3'), userEvent('four', 'evt-4')],
      droppedEventCount: 1,
      reasoningVisibilityOverride: 'default',
      defaultSendMode: 'steer',
    });
    await flushFrames();

    // Only the new event was processed (evt-2/evt-3 not reprocessed),
    // so the transcript grew from 3 → 4 bubbles, not to 6.
    const afterTrim = utils.container.querySelectorAll('.stub-user');
    expect(afterTrim.length).toBe(4);
    const texts = Array.from(afterTrim).map((el) => el.textContent?.trim());
    expect(texts).toEqual(['one', 'two', 'three', 'four']);
  });

  test('timelineItems renders commandResults inline alongside chat items', async () => {
    const utils = await mountChat({
      events: [userEvent('hello there', 'evt-1')],
    });

    // Seed a command-result through the store the composable watches.
    const cr = useCommandResultsStore();
    cr.recordsBySession['s1'] = [
      {
        id: 'cr-1',
        sessionId: 's1',
        command: 'echo hi',
        cwd: '/tmp',
        shell: 'session terminal',
        status: 'completed',
        stdout: 'hi',
        stderr: '',
        truncated: false,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        exitCode: 0,
      },
    ];
    await flushFrames();

    const cards = utils.container.querySelectorAll('.stub-command-result');
    expect(cards.length).toBe(1);
    expect(cards[0]?.getAttribute('data-id')).toBe('cr-1');
  });

  test('send forwards text + attachments through sessionsStore', async () => {
    const attachments: SendMessageAttachment[] = [
      { type: 'file', path: 'C:/tmp/foo.md', displayName: 'foo.md' },
    ];
    const utils = await mountChat();

    // Reach the stubbed composer and emit its `submit` event with the
    // payload ChatWindow expects. We synthesize the same shape
    // MessageComposer would emit (mode + text + attachments).
    const composerHost = utils.container.querySelector('.stub-composer');
    expect(composerHost).not.toBeNull();
    // testing-library/vue's `fireEvent` doesn't fire custom Vue
    // emits, so reach for the component instance via Vue's
    // internal `__vueParentComponent` pointer on the rendered root.
    const composerEl = composerHost as HTMLElement & {
      __vueParentComponent?: { emit: (e: string, p: unknown) => void };
    };
    const instance = composerEl.__vueParentComponent;
    expect(instance).toBeDefined();
    instance!.emit('submit', {
      text: 'attach this',
      mode: 'default',
      attachments,
    });
    await flushFrames();

    // The optimistic user bubble landed in the transcript with the
    // attachment count exposed by the stub.
    const bubbles = utils.container.querySelectorAll('.stub-user');
    expect(bubbles.length).toBe(1);
    expect(bubbles[0]?.getAttribute('data-attachments')).toBe('1');

    // sessionsStore.sendMessage routes through `invokeCommand('sendMessage')`.
    const sendCalls = handle.calls.filter((c) => c.name === 'sendMessage');
    expect(sendCalls.length).toBe(1);
    const sentArgs = sendCalls[0]!.args as {
      sessionId: string;
      text: string;
      attachments?: SendMessageAttachment[];
    };
    expect(sentArgs.sessionId).toBe('s1');
    expect(sentArgs.text).toBe('attach this');
    expect(sentArgs.attachments).toEqual(attachments);
  });

  test('retry walks back to the nearest user-with-eventId anchor', async () => {
    const events: SessionEventPayload[] = [
      userEvent('first user msg', 'user-evt-1'),
      assistantEvent('first reply', 'asst-evt-1'),
      userEvent('second user msg', 'user-evt-2'),
      assistantEvent('second reply', 'asst-evt-2'),
    ];
    const utils = await mountChat({ events });

    // Locate the assistant message-actions stub and trigger retry.
    const actionBlocks = Array.from(utils.container.querySelectorAll<HTMLElement>('.stub-actions'));
    // Order in the DOM: user→assistant→user→assistant, so the second
    // assistant's actions panel is the last one. Its retry should
    // anchor to user-evt-2.
    const assistantActions = actionBlocks.filter(
      (el) => el.getAttribute('data-kind') === 'assistant',
    );
    expect(assistantActions.length).toBe(2);
    const retryBtn = assistantActions[1]!.querySelector('.stub-retry');
    expect(retryBtn).not.toBeNull();
    await fireEvent.click(retryBtn as Element);
    await flushFrames();

    // `retryFromEvent` is a store action, not an IPC command. It
    // invokes `truncateSessionHistory` + `sendMessage` on the bridge.
    const truncateCalls = handle.calls.filter((c) => c.name === 'truncateSessionHistory');
    expect(truncateCalls.length).toBe(1);
    const truncateArgs = truncateCalls[0]!.args as {
      sessionId: string;
      eventId: string;
    };
    expect(truncateArgs.sessionId).toBe('s1');
    expect(truncateArgs.eventId).toBe('user-evt-2');
    const resendCalls = handle.calls.filter((c) => c.name === 'sendMessage');
    expect(resendCalls.length).toBe(1);
    expect((resendCalls[0]!.args as { text: string }).text).toBe('second user msg');
  });

  test('pending-request banner reflects the queue head', async () => {
    const events: SessionEventPayload[] = [
      pendingPermissionEvent('req-A', 'shell: ls'),
      pendingPermissionEvent('req-B', 'shell: rm -rf /'),
    ];
    const utils = await mountChat({ events });

    const banner = utils.container.querySelector('.pending-banner');
    expect(banner).not.toBeNull();
    const message = banner!.querySelector('.pending-banner-message');
    expect(message?.textContent).toContain('ls');

    // Second pending request bumps the count chip on the banner.
    const kindChip = banner!.querySelector('.pending-banner-kind');
    expect(kindChip?.textContent).toContain('2 pending');
  });

  /// Rubber-duck pre-split critique flagged three additional paths
  /// the original five tests didn't pin: fork anchor resolution
  /// (separate from retry), editor-save replay, and the dev
  /// `sendHandler` bypass. Adding them keeps the safety net
  /// behavior-complete before any composable extraction begins.

  test('fork from assistant resolves to preceding user event id', async () => {
    const events: SessionEventPayload[] = [
      userEvent('a', 'user-A'),
      assistantEvent('a-reply', 'asst-A'),
      userEvent('b', 'user-B'),
      assistantEvent('b-reply', 'asst-B'),
    ];
    const utils = await mountChat({ events });

    const actionBlocks = Array.from(utils.container.querySelectorAll<HTMLElement>('.stub-actions'));
    const assistantActions = actionBlocks.filter(
      (el) => el.getAttribute('data-kind') === 'assistant',
    );
    expect(assistantActions.length).toBe(2);
    // Forking from the LAST assistant should anchor at user-B (the
    // user message that triggered that assistant turn — not asst-A
    // or asst-B which would be mid-turn).
    const forkBtn = assistantActions[1]!.querySelector('.stub-fork');
    expect(forkBtn).not.toBeNull();
    await fireEvent.click(forkBtn as Element);
    await flushFrames();

    const forkCalls = handle.calls.filter((c) => c.name === 'forkSession');
    expect(forkCalls.length).toBe(1);
    const forkArgs = forkCalls[0]!.args as {
      sessionId: string;
      toEventId?: string;
    };
    expect(forkArgs.sessionId).toBe('s1');
    expect(forkArgs.toEventId).toBe('user-B');
  });

  test('sendHandler prop bypasses sessionsStore.sendMessage', async () => {
    const sendHandlerCalls: string[] = [];
    ensureResizeObserver();
    const utils = render(ChatWindow, {
      props: {
        sessionId: 's1',
        accent: '#abc',
        events: [],
        droppedEventCount: 0,
        reasoningVisibilityOverride: 'default',
        defaultSendMode: 'steer',
        sendHandler: (text: string) => {
          sendHandlerCalls.push(text);
          return Promise.resolve();
        },
      },
      global: { plugins: [PrimeVue], stubs },
    });
    await nextTick();
    await flushFrames();

    const composerEl = utils.container.querySelector('.stub-composer') as HTMLElement & {
      __vueParentComponent?: { emit: (e: string, p: unknown) => void };
    };
    composerEl.__vueParentComponent!.emit('submit', {
      text: 'dev playground msg',
      mode: 'default',
    });
    await flushFrames();

    // The optimistic user bubble still landed (sendHandler is just a
    // transport swap, not a transcript swap).
    const bubbles = utils.container.querySelectorAll('.stub-user');
    expect(bubbles.length).toBe(1);
    expect(bubbles[0]?.textContent?.trim()).toBe('dev playground msg');

    // sendHandler received the text; sessionsStore.sendMessage was NOT
    // invoked (no `sendMessage` IPC call landed on the bridge).
    expect(sendHandlerCalls).toEqual(['dev playground msg']);
    expect(handle.calls.filter((c) => c.name === 'sendMessage').length).toBe(0);
  });

  test('editor save resets transcript and replays via truncate + send', async () => {
    const events: SessionEventPayload[] = [
      userEvent('original prompt', 'user-orig'),
      assistantEvent('answer', 'asst-1'),
    ];
    const utils = await mountChat({ events });

    expect(utils.container.querySelectorAll('.stub-user').length).toBe(1);
    expect(utils.container.querySelectorAll('.stub-assistant').length).toBe(1);

    // Reach the MessageActions stub on the user bubble and request
    // edit mode. The component opens an inline MessageEditor stub;
    // we then emit the editor's `save` event with the new text.
    const userActions = Array.from(
      utils.container.querySelectorAll<HTMLElement>('.stub-actions'),
    ).filter((el) => el.getAttribute('data-kind') === 'user');
    expect(userActions.length).toBe(1);
    const userActionsHost = userActions[0] as HTMLElement & {
      __vueParentComponent?: { emit: (e: string, p?: unknown) => void };
    };
    userActionsHost.__vueParentComponent!.emit('edit');
    await flushFrames();

    const editorHost = utils.container.querySelector('.stub-editor') as HTMLElement & {
      __vueParentComponent?: { emit: (e: string, p?: unknown) => void };
    };
    expect(editorHost).not.toBeNull();
    editorHost.__vueParentComponent!.emit('save', 'edited prompt');
    await flushFrames();

    const truncateCalls = handle.calls.filter((c) => c.name === 'truncateSessionHistory');
    expect(truncateCalls.length).toBe(1);
    expect((truncateCalls[0]!.args as { eventId: string }).eventId).toBe('user-orig');
    const sendCalls = handle.calls.filter((c) => c.name === 'sendMessage');
    expect(sendCalls.length).toBe(1);
    expect((sendCalls[0]!.args as { text: string }).text).toBe('edited prompt');

    // After save, the transcript is cleared until the SDK echoes new
    // events back. (The component drops `items` to []; the next
    // event flush will repopulate from the live stream.)
    await flushFrames();
    expect(utils.container.querySelectorAll('.stub-assistant').length).toBe(0);
  });
});
