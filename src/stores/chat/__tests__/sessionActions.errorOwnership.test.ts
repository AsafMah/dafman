// Regression tests for toast-owns-error pattern (issue #212).
//
// setSessionMode / setSessionModel / setSessionApproveAll /
// resetSessionApprovals used to re-throw after toasting, turning every
// fire-and-forget UI call site into an unhandledrejection. The fix:
// swallow after toast and return `false`; the store wrappers propagate
// that boolean through to callers so control-flow-sensitive callers can
// still react.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { setActivePinia, createPinia } from 'pinia';
import { setRpcBridge, type RpcBridge, type SessionEventListener } from '@/ipc/invoke';
import { useSessionsStore, _resetSessionsStoreForTest } from '@/stores/chat/sessionsStore';
import { useToastStore } from '@/stores/app/toastStore';
import type { CommandMap, CommandName } from '@/ipc/types';

// ---------------------------------------------------------------------------
// Bridge factory
// ---------------------------------------------------------------------------

type CommandHandler<N extends CommandName> = (
  args: CommandMap[N]['args'],
) => Promise<CommandMap[N]['result']>;

type Handlers = Partial<{ [K in CommandName]: CommandHandler<K> }>;

function makeBridge(handlers: Handlers): { bridge: RpcBridge } {
  const sessionListeners = new Set<SessionEventListener>();
  const bridge: RpcBridge = {
    request: (async <N extends CommandName>(name: N, args: CommandMap[N]['args']) => {
      const h = handlers[name];
      if (h) {
        return await (h as CommandHandler<N>)(args);
      }
      return undefined as unknown as CommandMap[N]['result'];
    }) as RpcBridge['request'],
    onSessionEvent: (l) => {
      sessionListeners.add(l);
      return () => sessionListeners.delete(l);
    },
    onPendingRequest: () => () => {},
    onLogEvent: () => () => {},
    onAuditEvent: () => () => {},
  };
  return { bridge };
}

// Minimal resumeSession handler — just seeds a live, non-deleted record.
function resumeHandler(sessionId: string): CommandHandler<'resumeSession'> {
  return async () => ({
    sessionId,
    cwd: null,
    model: null,
    approveAll: false,
    mode: 'interactive',
  });
}

function rejectWith(msg: string): () => Promise<never> {
  return () => Promise.reject(new Error(msg));
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('sessionActions — toast owns error, no re-throw', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    _resetSessionsStoreForTest();
  });

  afterEach(() => {
    setRpcBridge(null);
    _resetSessionsStoreForTest();
  });

  // ---- setSessionMode -----------------------------------------------------

  test('setSessionMode: returns false and queues error toast on RPC failure', async () => {
    const { bridge } = makeBridge({
      resumeSession: resumeHandler('s1'),
      setSessionMode: rejectWith('unknown rpc: setSessionMode'),
    });
    setRpcBridge(bridge);

    const store = useSessionsStore();
    const toasts = useToastStore();
    await store.restoreSession('s1');

    const result = await store.setSessionMode('s1', 'autopilot');

    expect(result).toBe(false);
    const errors = toasts.pending.filter((t) => t.severity === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]?.summary).toBe('Failed to change run mode');
  });

  test('setSessionMode: returns true and updates record on success', async () => {
    const { bridge } = makeBridge({
      resumeSession: resumeHandler('s1'),
      setSessionMode: async () => 'autopilot',
    });
    setRpcBridge(bridge);

    const store = useSessionsStore();
    await store.restoreSession('s1');

    const result = await store.setSessionMode('s1', 'autopilot');

    expect(result).toBe(true);
    expect(store.getSession('s1')?.mode).toBe('autopilot');
  });

  test('setSessionMode: promise resolves (does NOT reject) on RPC failure', async () => {
    const { bridge } = makeBridge({
      resumeSession: resumeHandler('s1'),
      setSessionMode: rejectWith('unknown rpc: setSessionMode'),
    });
    setRpcBridge(bridge);

    const store = useSessionsStore();
    await store.restoreSession('s1');

    // Must not throw — this is the fire-and-forget safety guarantee.
    await expect(store.setSessionMode('s1', 'autopilot')).resolves.toBe(false);
  });

  // ---- setSessionModel ----------------------------------------------------

  test('setSessionModel: returns false and queues error toast on RPC failure', async () => {
    const { bridge } = makeBridge({
      resumeSession: resumeHandler('s1'),
      setSessionModel: rejectWith('unknown rpc: setSessionModel'),
    });
    setRpcBridge(bridge);

    const store = useSessionsStore();
    const toasts = useToastStore();
    await store.restoreSession('s1');

    const result = await store.setSessionModel('s1', 'gpt-4o', null);

    expect(result).toBe(false);
    const errors = toasts.pending.filter((t) => t.severity === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]?.summary).toBe('Failed to switch model');
  });

  test('setSessionModel: promise resolves (does NOT reject) on RPC failure', async () => {
    const { bridge } = makeBridge({
      resumeSession: resumeHandler('s1'),
      setSessionModel: rejectWith('unknown rpc: setSessionModel'),
    });
    setRpcBridge(bridge);

    const store = useSessionsStore();
    await store.restoreSession('s1');

    await expect(store.setSessionModel('s1', 'gpt-4o', null)).resolves.toBe(false);
  });

  // ---- setSessionApproveAll -----------------------------------------------

  test('setSessionApproveAll: returns false and queues error toast on RPC failure', async () => {
    const { bridge } = makeBridge({
      resumeSession: resumeHandler('s1'),
      setSessionApproveAll: rejectWith('unknown rpc: setSessionApproveAll'),
    });
    setRpcBridge(bridge);

    const store = useSessionsStore();
    const toasts = useToastStore();
    await store.restoreSession('s1');

    const result = await store.setSessionApproveAll('s1', true);

    expect(result).toBe(false);
    const errors = toasts.pending.filter((t) => t.severity === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]?.summary).toBe('Failed to update auto-approval');
  });

  test('setSessionApproveAll: promise resolves (does NOT reject) on RPC failure', async () => {
    const { bridge } = makeBridge({
      resumeSession: resumeHandler('s1'),
      setSessionApproveAll: rejectWith('unknown rpc: setSessionApproveAll'),
    });
    setRpcBridge(bridge);

    const store = useSessionsStore();
    await store.restoreSession('s1');

    await expect(store.setSessionApproveAll('s1', true)).resolves.toBe(false);
  });

  // ---- resetSessionApprovals ----------------------------------------------

  test('resetSessionApprovals: returns false and queues error toast on RPC failure', async () => {
    const { bridge } = makeBridge({
      resumeSession: resumeHandler('s1'),
      resetSessionApprovals: rejectWith('unknown rpc: resetSessionApprovals'),
    });
    setRpcBridge(bridge);

    const store = useSessionsStore();
    const toasts = useToastStore();
    await store.restoreSession('s1');

    const result = await store.resetSessionApprovals('s1');

    expect(result).toBe(false);
    const errors = toasts.pending.filter((t) => t.severity === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]?.summary).toBe('Failed to reset approvals');
  });

  test('resetSessionApprovals: promise resolves (does NOT reject) on RPC failure', async () => {
    const { bridge } = makeBridge({
      resumeSession: resumeHandler('s1'),
      resetSessionApprovals: rejectWith('unknown rpc: resetSessionApprovals'),
    });
    setRpcBridge(bridge);

    const store = useSessionsStore();
    await store.restoreSession('s1');

    await expect(store.resetSessionApprovals('s1')).resolves.toBe(false);
  });
});
