/// Renderer-side decoding of bun-thrown AppErrorPayload.
///
/// Regression coverage for the 2026-05-22 hang where two parallel
/// `resumeSession` requests with one rejection caused the renderer's
/// `invokeCommand` to never settle. Root cause: Electrobun's bridge
/// (`node_modules/electrobun/.../shared/rpc.ts:398`) only serializes
/// thrown `Error` instances; plain-object throws (the original
/// `rpcGuard` shape) are re-thrown as unhandled rejections and the
/// request promise on the renderer is leaked.
///
/// Fix: bun-side `rpcGuard` throws `new Error("AppErrorPayload:{json}")`;
/// renderer-side `invokeCommand` decodes the message back into a typed
/// `AppError`. This test exercises BOTH halves of that contract.

import { describe, expect, test, beforeEach } from 'bun:test';
import { AppError, invokeCommand, setRpcBridge, type RpcBridge } from '@/ipc/invoke';

const APP_ERROR_PREFIX = 'AppErrorPayload:';

function makeBridge(handler: (name: string, args: unknown) => Promise<unknown>): RpcBridge {
  return {
    request: handler as RpcBridge['request'],
    onSessionEvent: () => () => {},
    onPendingRequest: () => () => {},
    onLogEvent: () => () => {},
    onAuditEvent: () => () => {},
  };
}

describe('invokeCommand AppErrorPayload decoding', () => {
  beforeEach(() => {
    setRpcBridge(null);
  });

  test('decodes an Error whose message is AppErrorPayload:{json} back into a typed AppError', async () => {
    setRpcBridge(
      makeBridge(async () => {
        throw new Error(
          `${APP_ERROR_PREFIX}${JSON.stringify({ kind: 'SessionNotFound', data: 'missing-id' })}`,
        );
      }),
    );

    try {
      await invokeCommand('resumeSession' as never, {} as never);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).payload).toEqual({
        kind: 'SessionNotFound',
        data: 'missing-id',
      });
    }
  });

  // One test per discriminated-union variant. Each one used to be
  // silently dropped (renderer await hung forever) before the
  // Error-wrapped-AppErrorPayload encoding shipped — these tests are
  // the regression net for that protocol gap.
  test.each([
    { kind: 'ClientNotStarted' } as const,
    { kind: 'SessionNotFound', data: 'sess-x' } as const,
    { kind: 'Settings', data: 'settings.json missing' } as const,
    { kind: 'Sdk', data: 'internal sdk boom' } as const,
    { kind: 'Io', data: 'EACCES /tmp' } as const,
  ])('decodes variant %p back into a typed AppError', async (payload) => {
    setRpcBridge(
      makeBridge(async () => {
        throw new Error(`${APP_ERROR_PREFIX}${JSON.stringify(payload)}`);
      }),
    );

    try {
      await invokeCommand('resumeSession' as never, {} as never);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).payload).toEqual(payload);
    }
  });

  test('passes through a raw AppErrorPayload throw (back-compat path)', async () => {
    setRpcBridge(
      makeBridge(async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw { kind: 'Sdk', data: 'raw payload' };
      }),
    );

    try {
      await invokeCommand('resumeSession' as never, {} as never);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).payload).toEqual({ kind: 'Sdk', data: 'raw payload' });
    }
  });

  test('non-AppError messages pass through as plain Error', async () => {
    setRpcBridge(
      makeBridge(async () => {
        throw new Error('totally unrelated failure');
      }),
    );

    try {
      await invokeCommand('resumeSession' as never, {} as never);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(AppError);
      expect((err as Error).message).toBe('totally unrelated failure');
    }
  });
});
