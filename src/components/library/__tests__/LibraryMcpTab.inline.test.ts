/// Tests for the inline create/edit form in Library → MCP tab.
///
/// Validates:
///   1. Clicking "New server" reveals the inline form region (.mcp-inline-form).
///   2. Submitting the form calls addMcpConfig with the provided payload.
///   3. The form collapses on successful save.
///   4. Cancel hides the form without calling addMcpConfig.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { defineComponent } from 'vue';
import { setActivePinia, createPinia } from 'pinia';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/vue';
import LibraryMcpTab from '@/components/library/LibraryMcpTab.vue';
import { setRpcBridge, type RpcBridge } from '@/ipc/invoke';
import type { CommandName, CommandMap } from '@/ipc/types';

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

/// A McpServerForm stub that emits submit/cancel on demand so we can
/// drive the inline-form flow without spinning up PrimeVue inputs.
const McpFormStub = defineComponent({
  name: 'McpServerForm',
  emits: ['submit', 'cancel'],
  template: `<div class="mcp-form-stub">
    <button
      data-testid="stub-save"
      @click="$emit('submit', { name: 'test-server', config: { type: 'local', command: 'cmd' } })"
    >Fake Save</button>
    <button data-testid="stub-cancel" @click="$emit('cancel')">Cancel</button>
  </div>`,
});

function stubEmptyLibrary() {
  bridge.setNext('listMcpConfigs', {});
  bridge.setNext('discoverMcpServers', []);
}

describe('LibraryMcpTab — inline form', () => {
  test('clicking New server shows the inline form', async () => {
    stubEmptyLibrary();

    const utils = render(LibraryMcpTab, {
      global: { stubs: { McpServerForm: McpFormStub } },
    });

    // Initially no form.
    expect(utils.container.querySelector('.mcp-inline-form')).toBeNull();

    const newBtn = utils.getByRole('button', { name: 'New server' });

    await fireEvent.click(newBtn);

    await waitFor(() => {
      expect(utils.container.querySelector('.mcp-inline-form')).not.toBeNull();
    });
  });

  test('submitting the form calls addMcpConfig and collapses the form', async () => {
    stubEmptyLibrary();
    // addMcpConfig returns undefined (void in the RPC schema).
    bridge.setNext('addMcpConfig', undefined as never);

    const utils = render(LibraryMcpTab, {
      global: { stubs: { McpServerForm: McpFormStub } },
    });

    // Open the form.
    await fireEvent.click(utils.getByRole('button', { name: 'New server' }));

    await waitFor(() => {
      expect(utils.container.querySelector('.mcp-inline-form')).not.toBeNull();
    });

    // Trigger submit via the stub.
    await fireEvent.click(utils.getByTestId('stub-save'));

    await waitFor(() => {
      expect(bridge.getCalls('addMcpConfig').length).toBeGreaterThanOrEqual(1);
    });

    expect(bridge.getCalls('addMcpConfig')[0].args).toMatchObject({
      name: 'test-server',
      config: { type: 'local', command: 'cmd' },
    });

    // Form collapses on success.
    await waitFor(() => {
      expect(utils.container.querySelector('.mcp-inline-form')).toBeNull();
    });
  });

  test('Cancel hides the form without calling addMcpConfig', async () => {
    stubEmptyLibrary();

    const utils = render(LibraryMcpTab, {
      global: { stubs: { McpServerForm: McpFormStub } },
    });

    await fireEvent.click(utils.getByRole('button', { name: 'New server' }));

    await waitFor(() => {
      expect(utils.container.querySelector('.mcp-inline-form')).not.toBeNull();
    });

    await fireEvent.click(utils.getByTestId('stub-cancel'));

    await waitFor(() => {
      expect(utils.container.querySelector('.mcp-inline-form')).toBeNull();
    });

    expect(bridge.getCalls('addMcpConfig')).toHaveLength(0);
  });
});
