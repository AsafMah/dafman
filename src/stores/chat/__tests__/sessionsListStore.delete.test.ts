import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { setActivePinia, createPinia } from 'pinia';
import { setRpcBridge, type RpcBridge } from '@/ipc/invoke';
import type { CommandMap, CommandName, SessionMetadataSummary } from '@/ipc/types';
import { _resetSessionsStoreForTest, useSessionsStore } from '@/stores/chat/sessionsStore';
import { useSessionsListStore } from '@/stores/chat/sessionsListStore';

function makeFakeBridge(): {
  bridge: RpcBridge;
  calls: Array<{ name: string; args: unknown }>;
  handlers: Partial<{
    [K in CommandName]: (args: CommandMap[K]['args']) => Promise<CommandMap[K]['result']>;
  }>;
} {
  const calls: Array<{ name: string; args: unknown }> = [];
  const handlers: Partial<{
    [K in CommandName]: (args: CommandMap[K]['args']) => Promise<CommandMap[K]['result']>;
  }> = {};

  const bridge: RpcBridge = {
    request: (async <N extends CommandName>(name: N, args: CommandMap[N]['args']) => {
      calls.push({ name, args });
      const handler = handlers[name];

      if (handler) {
        return await (handler as (a: CommandMap[N]['args']) => Promise<CommandMap[N]['result']>)(
          args,
        );
      }

      return undefined as unknown as CommandMap[N]['result'];
    }) as RpcBridge['request'],
    onSessionEvent: () => () => {},
    onPendingRequest: () => () => {},
    onLogEvent: () => () => {},
    onAuditEvent: () => () => {},
  };

  return { bridge, calls, handlers };
}

describe('sessionsListStore.deleteSession', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    _resetSessionsStoreForTest();
  });

  afterEach(() => {
    setRpcBridge(null);
    _resetSessionsStoreForTest();
  });

  test('marks an open session record as deleted after permanent catalog delete', async () => {
    const { bridge, handlers } = makeFakeBridge();
    handlers.createSession = async () => 'sess-delete-open';
    handlers.deleteSession = async () => 'sess-delete-open';
    setRpcBridge(bridge);

    const sessionsStore = useSessionsStore();
    const sessionsListStore = useSessionsListStore();
    const record = await sessionsStore.createSession();

    sessionsListStore.sessions = [
      {
        sessionId: 'sess-delete-open',
        modifiedTime: '2026-06-01T00:00:00.000Z',
      } as SessionMetadataSummary,
    ];

    await sessionsListStore.deleteSession('sess-delete-open');

    expect(record).not.toBeNull();
    expect(sessionsStore.getSession('sess-delete-open')).toBe(record ?? undefined);
    expect((record as { isDeleted?: boolean }).isDeleted).toBe(true);
    expect(sessionsListStore.sessions).toHaveLength(0);
  });

  test('deleted session records reject future sends before hitting IPC', async () => {
    const { bridge, calls, handlers } = makeFakeBridge();
    handlers.createSession = async () => 'sess-readonly';
    handlers.deleteSession = async () => 'sess-readonly';
    handlers.sendMessage = async () => 'msg-1';
    setRpcBridge(bridge);

    const sessionsStore = useSessionsStore();
    const sessionsListStore = useSessionsListStore();
    await sessionsStore.createSession();

    await sessionsListStore.deleteSession('sess-readonly');

    await expect(sessionsStore.sendMessage('sess-readonly', 'should not send')).rejects.toThrow(
      'read-only',
    );
    expect(calls.filter((c) => c.name === 'sendMessage')).toHaveLength(0);
  });
});
