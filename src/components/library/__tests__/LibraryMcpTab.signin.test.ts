/// Regression test for #8 — the MCP "Sign in" button must show for any
/// configured HTTP-transport server, not only ones whose static config
/// happens to carry an `oauthClientId`/`oauthGrantType` field.
///
/// Real HTTP MCP servers (e.g. the GitHub remote MCP, configured as
/// `{ type: 'http', url: … }`) negotiate OAuth dynamically and carry
/// neither field, so the old `entry.hasOauth` gate hid the button
/// permanently. The sign-in flow itself handles the no-session and
/// no-OAuth cases gracefully, so the button is safe to always show.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { setActivePinia, createPinia } from 'pinia';
import { cleanup, render, waitFor } from '@testing-library/vue';
import LibraryMcpTab from '@/components/library/LibraryMcpTab.vue';
import { setRpcBridge, type RpcBridge } from '@/ipc/invoke';
import type { CommandName, CommandMap } from '@/ipc/types';

interface FakeBridge extends RpcBridge {
  setNext<N extends CommandName>(name: N, value: CommandMap[N]['result']): void;
}

function makeBridge(): FakeBridge {
  const nextResponses = new Map<string, unknown>();
  return {
    setNext(name, value) {
      nextResponses.set(name, value);
    },
    async request(name, _args) {
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

let bridge: FakeBridge;

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

describe('LibraryMcpTab — Sign-in button (#8)', () => {
  test('shows Sign in for an http server with no static oauth fields', async () => {
    bridge.setNext('listMcpConfigs', {
      remote: { type: 'http', url: 'https://api.example.invalid/mcp/' },
    });
    bridge.setNext('discoverMcpServers', []);

    const utils = render(LibraryMcpTab, { global: { stubs } });

    await waitFor(() => expect(utils.getByText('remote')).toBeDefined());
    expect(utils.getByText('Sign in')).toBeDefined();
  });

  test('does not show Sign in for a local (stdio) server', async () => {
    bridge.setNext('listMcpConfigs', {
      stdioserver: { command: 'my-server', args: [] },
    });
    bridge.setNext('discoverMcpServers', []);

    const utils = render(LibraryMcpTab, { global: { stubs } });

    await waitFor(() => expect(utils.getByText('stdioserver')).toBeDefined());
    expect(utils.queryByText('Sign in')).toBeNull();
  });
});
