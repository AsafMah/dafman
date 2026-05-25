import { describe, expect, test } from 'bun:test';
import { AppError, rpcGuard } from '../app/errors';

describe('AppError', () => {
  test('formats ClientNotStarted', () => {
    const e = AppError.clientNotStarted();
    expect(e.payload).toEqual({ kind: 'ClientNotStarted' });
    expect(e.message).toBe('client not started');
  });

  test('formats SessionNotFound', () => {
    const e = AppError.sessionNotFound('sess-1');
    expect(e.payload).toEqual({ kind: 'SessionNotFound', data: 'sess-1' });
    expect(e.message).toContain('sess-1');
  });

  test('settings + sdk variants', () => {
    expect(AppError.settings('io').payload).toEqual({
      kind: 'Settings',
      data: 'io',
    });
    expect(AppError.sdk('boom').payload).toEqual({ kind: 'Sdk', data: 'boom' });
  });
});

describe('rpcGuard', () => {
  test('returns value on success', async () => {
    const handler = rpcGuard(async (n: number) => n * 2);
    expect(await handler(21)).toBe(42);
  });

  test('rethrows AppError payload as a real Error (JSON-encoded message)', async () => {
    const handler = rpcGuard(async () => {
      throw AppError.sessionNotFound('missing');
    });
    try {
      await handler(undefined as never);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toBe(
        `AppErrorPayload:${JSON.stringify({ kind: 'SessionNotFound', data: 'missing' })}`,
      );
    }
  });

  test('coerces unknown errors into Sdk (JSON-encoded Error)', async () => {
    const handler = rpcGuard(async () => {
      throw new Error('kaboom');
    });
    try {
      await handler(undefined as never);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toBe(
        `AppErrorPayload:${JSON.stringify({ kind: 'Sdk', data: 'kaboom' })}`,
      );
    }
  });
});
