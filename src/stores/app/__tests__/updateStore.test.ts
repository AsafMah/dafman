// updateStore — unit tests for the Fix-3 hardening in checkForUpdate().
//
// Exercises the three branches that matter:
//   1. result.error set → status = 'error', message surfaced (never 'no-update')
//   2. result.error empty AND !updateAvailable → status = 'no-update'
//   3. result.updateAvailable → status stays 'checking' (push event drives it)
//
// The IPC bridge is replaced with a minimal stub that controls what
// invokeCommand('checkForUpdate', {}) returns.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createPinia, setActivePinia } from 'pinia';
import { setRpcBridge } from '@/ipc/invoke';
import type { RpcBridge } from '@/ipc/invoke';
import type { CommandMap, CommandName, UpdateCheckResult } from '@/ipc/types';
import { useUpdateStore } from '@/stores/app/updateStore';

type InvokeResult<N extends CommandName> = CommandMap[N]['result'];

function makeStubBridge(checkResult: UpdateCheckResult): RpcBridge {
  return {
    request<N extends CommandName>(name: N): Promise<InvokeResult<N>> {
      if (name === 'checkForUpdate') {
        return Promise.resolve(checkResult as InvokeResult<N>);
      }
      if (name === 'getUpdateStatus') {
        return Promise.resolve(null as InvokeResult<N>);
      }
      return Promise.resolve(undefined as InvokeResult<N>);
    },
    onSessionEvent: () => () => undefined,
    onPendingRequest: () => () => undefined,
    onUpdateEvent: () => () => undefined,
  };
}

describe('updateStore.checkForUpdate', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    // Reset the bridge so the module-level singleton doesn't leak between tests.
    setRpcBridge(null);
  });

  test('error in result → status becomes error, message surfaced (Fix 3)', async () => {
    const errMsg = 'refusing insecure update baseUrl: http://bad.example.com';
    setRpcBridge(
      makeStubBridge({
        version: '',
        hash: '',
        updateAvailable: false,
        updateReady: false,
        error: errMsg,
      }),
    );

    const store = useUpdateStore();
    await store.checkForUpdate();

    expect(store.status).toBe('error');
    // The error message must be surfaced — never the "up to date" text.
    expect(store.statusMessage).toBe(errMsg);
    expect(store.errorMessage).toBe(errMsg);
    expect(store.statusMessage).not.toContain('latest version');
  });

  test('no error + updateAvailable=false → status becomes no-update', async () => {
    setRpcBridge(
      makeStubBridge({
        version: '1.0.0',
        hash: 'abc123',
        updateAvailable: false,
        updateReady: false,
        error: '',
      }),
    );

    const store = useUpdateStore();
    await store.checkForUpdate();

    expect(store.status).toBe('no-update');
    expect(store.statusMessage).toContain('latest version');
    expect(store.errorMessage).toBe('');
  });

  test('updateAvailable=true → updateAvailable flag set, no error', async () => {
    setRpcBridge(
      makeStubBridge({
        version: '1.2.0',
        hash: 'def456',
        updateAvailable: true,
        updateReady: false,
        error: '',
      }),
    );

    const store = useUpdateStore();
    await store.checkForUpdate();

    expect(store.updateAvailable).toBe(true);
    expect(store.latestVersion).toBe('1.2.0');
    expect(store.status).not.toBe('error');
    expect(store.status).not.toBe('no-update');
  });

  test('error takes precedence even when updateAvailable is true (defensive)', async () => {
    // Should not happen in practice, but guard against it.
    const errMsg = 'network timeout';
    setRpcBridge(
      makeStubBridge({
        version: '',
        hash: '',
        updateAvailable: true,
        updateReady: false,
        error: errMsg,
      }),
    );

    const store = useUpdateStore();
    await store.checkForUpdate();

    expect(store.status).toBe('error');
    expect(store.statusMessage).toBe(errMsg);
  });
});
