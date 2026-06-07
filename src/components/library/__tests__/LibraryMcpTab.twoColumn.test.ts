/// Tests for the two-column toggle design on Library → MCP Configured rows
/// (issue #28 — Library as source of truth, Phase 2: per-session column).
///
/// Validates:
///   1. Both "Default" and "This session" toggle labels render per configured row.
///   2. "This session" toggle is disabled when no session is focused (OQ6).
///   3. Toggling "This session" calls setSessionMcpEnabled for the focused
///      session only — NOT enableMcpServers/disableMcpServers (global path).
///   4. sessionEnabled rule: status 'disabled' → OFF; 'connected' → ON.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { setActivePinia, createPinia } from 'pinia';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/vue';
import LibraryMcpTab from '@/components/library/LibraryMcpTab.vue';
import { setRpcBridge, type RpcBridge } from '@/ipc/invoke';
import type { CommandName, CommandMap } from '@/ipc/types';
import { useSessionsStore, type SessionRecord } from '@/stores/chat/sessionsStore';
import { useLayoutStore } from '@/stores/shell/layoutStore';

// Extended bridge that also records every request for assertion.
interface TrackingBridge extends RpcBridge {
  setNext<N extends CommandName>(name: N, value: CommandMap[N]['result']): void;
  getCalls(name: string): Array<{ args: unknown }>;
}

function makeBridge(): TrackingBridge {
  const nextResponses = new Map<string, unknown>();
  const calls: Array<{ name: string; args: unknown }> = [];

  return {
    setNext(name, value) {
      nextResponses.set(name as string, value);
    },
    getCalls(name: string) {
      return calls.filter((c) => c.name === name).map((c) => ({ args: c.args }));
    },
    async request(name, args) {
      calls.push({ name: name as string, args });

      if (!nextResponses.has(name as string)) {
        throw new Error(`No response stubbed for ${name as string}`);
      }

      return nextResponses.get(name as string) as never;
    },
    onSessionEvent: () => () => {},
    onPendingRequest: () => () => {},
    onLogEvent: () => () => {},
    onAuditEvent: () => () => {},
  };
}

let bridge: TrackingBridge;

beforeEach(() => {
  setActivePinia(createPinia());
  bridge = makeBridge();
  setRpcBridge(bridge);
});

afterEach(() => {
  setRpcBridge(null);
  cleanup();
});

const stubs = { McpServerForm: { template: '<div />' } };

/// Minimal stub set needed for a render without a focused session.
function stubNoSession() {
  bridge.setNext('listMcpConfigs', {
    myserver: { command: 'my-server', args: [] },
  });
  bridge.setNext('discoverMcpServers', [{ name: 'myserver', enabled: true, source: 'config' }]);
  // No listSessionMcpServers stub needed — loadAll skips the call when
  // getLibrarySession() returns null.
}

/// Minimal stub set for a focused session with a specific server status.
function stubWithSession(sessionId: string, serverStatus: string) {
  bridge.setNext('listMcpConfigs', {
    myserver: { command: 'my-server', args: [] },
  });
  bridge.setNext('discoverMcpServers', [{ name: 'myserver', enabled: true, source: 'config' }]);
  bridge.setNext('listSessionMcpServers', [{ name: 'myserver', status: serverStatus }]);

  useSessionsStore().sessions.push({
    id: sessionId,
    workingDirectory: '/workspace',
  } as unknown as SessionRecord);
  useLayoutStore().lastFocusedSessionId = sessionId;
}

describe('LibraryMcpTab — two-column toggles (#28)', () => {
  test('renders Default and This session labels on a configured row', async () => {
    stubNoSession();

    const utils = render(LibraryMcpTab, { global: { stubs } });

    await waitFor(() => expect(utils.getByText('myserver')).toBeDefined());

    expect(utils.getByText('Default')).toBeDefined();
    expect(utils.getByText('This session')).toBeDefined();
  });

  test('This session toggle is disabled when no session is focused', async () => {
    stubNoSession();

    const utils = render(LibraryMcpTab, { global: { stubs } });

    await waitFor(() => expect(utils.getByText('myserver')).toBeDefined());

    const sessionToggle = utils.getByRole('switch', {
      name: 'Enable MCP server myserver for this session',
    });

    expect(sessionToggle.hasAttribute('disabled')).toBe(true);
  });

  test('Default toggle remains enabled when no session is focused', async () => {
    stubNoSession();

    const utils = render(LibraryMcpTab, { global: { stubs } });

    await waitFor(() => expect(utils.getByText('myserver')).toBeDefined());

    const defaultToggle = utils.getByRole('switch', {
      name: 'Enable MCP server myserver',
    });

    expect(defaultToggle.hasAttribute('disabled')).toBe(false);
  });

  test('Toggling This session calls setSessionMcpEnabled for focused session only', async () => {
    // Server is 'connected' (enabled), clicking turns it disabled.
    stubWithSession('sess-42', 'connected');
    // Stub the RPC that setSessionEnabled calls, plus the subsequent loadAll.
    bridge.setNext('setSessionMcpEnabled', true);

    const utils = render(LibraryMcpTab, { global: { stubs } });

    await waitFor(() => expect(utils.getByText('myserver')).toBeDefined());

    const sessionToggle = utils.getByRole('switch', {
      name: 'Enable MCP server myserver for this session',
    });

    await fireEvent.click(sessionToggle);

    await waitFor(() => {
      const mcpCalls = bridge.getCalls('setSessionMcpEnabled');
      expect(mcpCalls.length).toBeGreaterThanOrEqual(1);
    });

    const mcpCalls = bridge.getCalls('setSessionMcpEnabled');
    expect(mcpCalls[0].args).toEqual({
      sessionId: 'sess-42',
      serverName: 'myserver',
      enabled: false,
    });

    // Global enable/disable RPCs must NOT have been called.
    expect(bridge.getCalls('enableMcpServers')).toHaveLength(0);
    expect(bridge.getCalls('disableMcpServers')).toHaveLength(0);
  });

  test('sessionEnabled rule: status disabled → This session toggle OFF', async () => {
    stubWithSession('sess-1', 'disabled');

    const utils = render(LibraryMcpTab, { global: { stubs } });

    await waitFor(() => expect(utils.getByText('myserver')).toBeDefined());

    const sessionToggle = utils.getByRole('switch', {
      name: 'Enable MCP server myserver for this session',
    });

    expect(sessionToggle.getAttribute('aria-checked')).toBe('false');
  });

  test('sessionEnabled rule: status connected → This session toggle ON', async () => {
    stubWithSession('sess-1', 'connected');

    const utils = render(LibraryMcpTab, { global: { stubs } });

    await waitFor(() => expect(utils.getByText('myserver')).toBeDefined());

    const sessionToggle = utils.getByRole('switch', {
      name: 'Enable MCP server myserver for this session',
    });

    expect(sessionToggle.getAttribute('aria-checked')).toBe('true');
  });

  test('sessionEnabled rule: no session status → inherits global enabled state', async () => {
    // Server is in configured list but NOT in sessionMcps → status undefined.
    bridge.setNext('listMcpConfigs', {
      myserver: { command: 'my-server', args: [] },
    });
    bridge.setNext('discoverMcpServers', [{ name: 'myserver', enabled: false, source: 'config' }]);
    // listSessionMcpServers returns an entry for a DIFFERENT server — so
    // myserver has no session-level data and falls back to isEnabled().
    bridge.setNext('listSessionMcpServers', [{ name: 'other-server', status: 'connected' }]);
    useSessionsStore().sessions.push({
      id: 'sess-1',
      workingDirectory: '/workspace',
    } as unknown as SessionRecord);
    useLayoutStore().lastFocusedSessionId = 'sess-1';

    const utils = render(LibraryMcpTab, { global: { stubs } });

    await waitFor(() => expect(utils.getByText('myserver')).toBeDefined());

    const sessionToggle = utils.getByRole('switch', {
      name: 'Enable MCP server myserver for this session',
    });

    // isEnabled returns false because discovered says enabled: false
    expect(sessionToggle.getAttribute('aria-checked')).toBe('false');
  });
});
