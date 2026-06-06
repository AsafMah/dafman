import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createPinia, setActivePinia } from 'pinia';
import { setRpcBridge, type RpcBridge } from '@/ipc/invoke';
import type { CommandMap, CommandName } from '@/ipc/types';
import { useMcpLibrary, type DiscoveredEntry } from '@/composables/library/useMcpLibrary';
import { useSessionsStore, type SessionRecord } from '@/stores/chat/sessionsStore';
import { useLayoutStore } from '@/stores/shell/layoutStore';

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
    lib.configured.value = [{ name: 'github', config: { url: 'https://x' }, transport: 'http' }];
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

describe('useMcpLibrary workspace discovery cwd (#96)', () => {
  function seedSession(id: string, workingDirectory: string): void {
    const store = useSessionsStore();
    store.sessions.push({ id, workingDirectory } as unknown as SessionRecord);
  }

  test('discovers from the last focused chat session when activeSessionId is stale on the Library panel', async () => {
    const { bridge, calls } = makeBridge({
      listMcpConfigs: async () => ({}),
      discoverMcpServers: async () => [],
      listSessionMcpServers: async () => [],
    });
    setRpcBridge(bridge);
    seedSession('stale-session', 'C:\\repo\\stale');
    seedSession('focused-session', 'C:\\repo\\focused');

    const layoutStore = useLayoutStore();
    layoutStore.setActiveSessionId('focused-session');
    layoutStore.activeSessionId = 'stale-session';

    const lib = useMcpLibrary();
    await lib.loadAll();

    const discover = calls.find((c) => c.name === 'discoverMcpServers');
    expect(discover?.args).toEqual({ workingDirectory: 'C:\\repo\\focused' });
    const liveList = calls.find((c) => c.name === 'listSessionMcpServers');
    expect(liveList?.args).toEqual({ sessionId: 'focused-session' });
  });
});

describe('useMcpLibrary signIn (#7 — branded OAuth + active session)', () => {
  function seedSession(id: string): void {
    const store = useSessionsStore();
    store.sessions.push({ id } as unknown as SessionRecord);
  }

  test('passes the product name as clientName so the consent screen is branded', async () => {
    const { bridge, calls } = makeBridge({
      loginToMcpServer: async () => ({ authorizationUrl: null }),
    });
    setRpcBridge(bridge);
    seedSession('sess-1');

    const lib = useMcpLibrary();
    const result = await lib.signIn('github');

    expect(result.state).toBe('already-signed-in');
    const login = calls.find((c) => c.name === 'loginToMcpServer');
    expect(login?.args).toMatchObject({ serverName: 'github', clientName: 'Dafman' });
  });

  test('runs the flow through the active session, not just the first one', async () => {
    const { bridge, calls } = makeBridge({
      loginToMcpServer: async () => ({ authorizationUrl: null }),
    });
    setRpcBridge(bridge);
    seedSession('sess-1');
    seedSession('sess-2');
    useLayoutStore().activeSessionId = 'sess-2';

    const lib = useMcpLibrary();
    await lib.signIn('github');

    const login = calls.find((c) => c.name === 'loginToMcpServer');
    expect(login?.args).toMatchObject({ sessionId: 'sess-2' });
  });

  test('returns no-session when there are no sessions to authenticate through', async () => {
    const { bridge } = makeBridge();
    setRpcBridge(bridge);

    const lib = useMcpLibrary();
    const result = await lib.signIn('github');

    expect(result.state).toBe('no-session');
  });
});

describe('useMcpLibrary needsSignIn (#7 follow-up — gate Sign-in on needs-auth)', () => {
  test('hides Sign-in for a connected server, shows it for a needs-auth server', async () => {
    const { bridge } = makeBridge({
      listMcpConfigs: async () => ({}),
      discoverMcpServers: async () => [],
      listSessionMcpServers: async () => [
        { name: 'connected-srv', status: 'connected' },
        { name: 'auth-srv', status: 'needs-auth' },
      ],
    });
    setRpcBridge(bridge);
    // loadAll only queries the live list when there's an active session.
    useSessionsStore().sessions.push({ id: 'sess-1' } as unknown as SessionRecord);
    useLayoutStore().activeSessionId = 'sess-1';

    const lib = useMcpLibrary();
    await lib.loadAll();

    expect(lib.needsSignIn('connected-srv')).toBe(false);
    expect(lib.needsSignIn('auth-srv')).toBe(true);
  });

  test('shows Sign-in for a disabled server (e.g. never authenticated, session reopened)', async () => {
    // Symptom B: after reopening a session, an HTTP server that was never
    // authenticated resolves to `disabled` (SDK couldn't start it), not
    // `needs-auth`. We must still show the button so the user can sign in.
    const { bridge } = makeBridge({
      listMcpConfigs: async () => ({}),
      discoverMcpServers: async () => [],
      listSessionMcpServers: async () => [{ name: 'github-mcp', status: 'disabled' }],
    });
    setRpcBridge(bridge);
    useSessionsStore().sessions.push({ id: 'sess-1' } as unknown as SessionRecord);
    useLayoutStore().activeSessionId = 'sess-1';

    const lib = useMcpLibrary();
    await lib.loadAll();

    expect(lib.needsSignIn('github-mcp')).toBe(true);
  });

  test('shows Sign-in for a failed server', async () => {
    const { bridge } = makeBridge({
      listMcpConfigs: async () => ({}),
      discoverMcpServers: async () => [],
      listSessionMcpServers: async () => [{ name: 'github-mcp', status: 'failed' }],
    });
    setRpcBridge(bridge);
    useSessionsStore().sessions.push({ id: 'sess-1' } as unknown as SessionRecord);
    useLayoutStore().activeSessionId = 'sess-1';

    const lib = useMcpLibrary();
    await lib.loadAll();

    expect(lib.needsSignIn('github-mcp')).toBe(true);
  });

  test('treats unknown status (no live data for the server) as "might need auth"', async () => {
    const { bridge } = makeBridge({
      listMcpConfigs: async () => ({}),
      discoverMcpServers: async () => [],
      listSessionMcpServers: async () => [],
    });
    setRpcBridge(bridge);

    const lib = useMcpLibrary();
    await lib.loadAll();

    // No active session / no live status → don't hide the affordance.
    expect(lib.needsSignIn('anything')).toBe(true);
  });
});

describe('useMcpLibrary upsertConfig — triggers session MCP reload (Symptom A fix)', () => {
  function seedSession(id: string): void {
    useSessionsStore().sessions.push({ id } as unknown as SessionRecord);
  }

  test('calls reloadSessionMcpServers for every active session after addMcpConfig', async () => {
    const { bridge, calls } = makeBridge({
      addMcpConfig: async () => true,
      listMcpConfigs: async () => ({}),
      discoverMcpServers: async () => [],
      listSessionMcpServers: async () => [],
      reloadSessionMcpServers: async () => true,
    });
    setRpcBridge(bridge);
    seedSession('sess-1');
    seedSession('sess-2');

    const lib = useMcpLibrary();
    const ok = await lib.upsertConfig('add', {
      name: 'github-remote',
      config: { type: 'http', url: 'https://api.githubcopilot.com/mcp/' },
    });

    expect(ok).toBe(true);
    const reloads = calls.filter((c) => c.name === 'reloadSessionMcpServers');
    // One reload call per active session.
    expect(reloads).toHaveLength(2);
    expect(reloads.map((c) => (c.args as { sessionId: string }).sessionId)).toEqual([
      'sess-1',
      'sess-2',
    ]);
  });

  test('calls reloadSessionMcpServers after updateMcpConfig too', async () => {
    const { bridge, calls } = makeBridge({
      updateMcpConfig: async () => true,
      listMcpConfigs: async () => ({}),
      discoverMcpServers: async () => [],
      listSessionMcpServers: async () => [],
      reloadSessionMcpServers: async () => true,
    });
    setRpcBridge(bridge);
    seedSession('sess-1');

    const lib = useMcpLibrary();
    await lib.upsertConfig('edit', {
      name: 'github-remote',
      config: { type: 'http', url: 'https://api.githubcopilot.com/mcp/' },
    });

    expect(calls.some((c) => c.name === 'reloadSessionMcpServers')).toBe(true);
  });

  test('skips reload when no sessions are open (no error thrown)', async () => {
    const { bridge, calls } = makeBridge({
      addMcpConfig: async () => true,
      listMcpConfigs: async () => ({}),
      discoverMcpServers: async () => [],
      listSessionMcpServers: async () => [],
    });
    setRpcBridge(bridge);
    // No sessions seeded — sessions list is empty.

    const lib = useMcpLibrary();
    const ok = await lib.upsertConfig('add', {
      name: 'my-server',
      config: { type: 'http', url: 'https://example.com/mcp/' },
    });

    expect(ok).toBe(true);
    expect(calls.some((c) => c.name === 'reloadSessionMcpServers')).toBe(false);
  });
});
