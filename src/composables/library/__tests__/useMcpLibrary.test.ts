import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createPinia, setActivePinia } from 'pinia';
import { setRpcBridge, type RpcBridge } from '@/ipc/invoke';
import type { CommandMap, CommandName } from '@/ipc/types';
import { useMcpLibrary, type DiscoveredEntry } from '@/composables/library/useMcpLibrary';

function makeBridge(
  handlers: Partial<{
    [K in CommandName]: (args: CommandMap[K]['args']) => Promise<CommandMap[K]['result']>;
  }> = {},
): { bridge: RpcBridge; calls: Array<{ name: string; args: unknown }> } {
  const calls: Array<{ name: string; args: unknown }> = [];
  return {
    calls,
    bridge: {
      request: (async <N extends CommandName>(name: N, args: CommandMap[N]['args']) => {
        calls.push({ name, args });
        const handler = handlers[name];
        if (handler) {
          return await (handler as (a: CommandMap[N]['args']) => Promise<CommandMap[N]['result']>)(
            args,
          );
        }
        return undefined as CommandMap[N]['result'];
      }) as RpcBridge['request'],
      onSessionEvent: () => () => {},
      onPendingRequest: () => () => {},
      onLogEvent: () => () => {},
      onAuditEvent: () => () => {},
    },
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  setRpcBridge(null);
});

describe('useMcpLibrary removeConfig (#10 — stays out of Discovered)', () => {
  test('removing a configured server also drops it from the discovered list so it does not bounce to the Discovered section', async () => {
    const { bridge } = makeBridge({
      removeMcpConfig: async () => true,
    });
    setRpcBridge(bridge);

    const lib = useMcpLibrary();
    lib.configured.value = [
      { name: 'github', config: { url: 'https://x' }, transport: 'http' },
    ];
    // The same server is ALSO present in the in-memory discovered list
    // (it round-trips through mcp.discover with source "user", or it is a
    // live session server). Before the fix, removing the config dropped it
    // from `configured` only — so `newlyDiscovered` re-surfaced it under
    // the Discovered section ("jumps to Discovered").
    const disc: DiscoveredEntry = {
      name: 'github',
      source: 'user',
      enabled: true,
    };
    lib.discovered.value = [disc];

    expect(lib.newlyDiscovered.value).toHaveLength(0);

    const ok = await lib.removeConfig('github');

    expect(ok).toBe(true);
    expect(lib.configured.value).toHaveLength(0);
    expect(lib.discovered.value.some((d) => d.name === 'github')).toBe(false);
    expect(lib.newlyDiscovered.value).toHaveLength(0);
  });

  test('removing a server leaves other discovered servers untouched', async () => {
    const { bridge } = makeBridge({
      removeMcpConfig: async () => true,
    });
    setRpcBridge(bridge);

    const lib = useMcpLibrary();
    lib.configured.value = [{ name: 'github', config: {}, transport: 'http' }];
    lib.discovered.value = [
      { name: 'github', source: 'user', enabled: true },
      { name: 'other', source: 'workspace', enabled: true },
    ];

    await lib.removeConfig('github');

    expect(lib.discovered.value.map((d) => d.name)).toEqual(['other']);
    expect(lib.newlyDiscovered.value.map((d) => d.name)).toEqual(['other']);
  });
});
