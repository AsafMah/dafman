import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireSingleInstanceLock } from '../app/shared/singleInstance';

describe('acquireSingleInstanceLock', () => {
  let dir: string;
  let lockPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dafman-lock-'));
    lockPath = join(dir, 'dafman.lock');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('acquires when no lock file exists and writes our pid', () => {
    const lock = acquireSingleInstanceLock(lockPath, { pid: 4242, token: 'tok-a' });

    expect(lock.acquired).toBe(true);
    expect(lock.existingPid).toBeUndefined();
    expect(existsSync(lockPath)).toBe(true);

    const written = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid: number; token: string };
    expect(written.pid).toBe(4242);
    expect(written.token).toBe('tok-a');
  });

  test('does not acquire when a live foreign instance holds the lock', () => {
    const first = acquireSingleInstanceLock(lockPath, {
      pid: 1001,
      token: 'owner',
      isProcessAlive: () => true,
    });
    expect(first.acquired).toBe(true);

    const second = acquireSingleInstanceLock(lockPath, {
      pid: 2002,
      token: 'intruder',
      isProcessAlive: (pid) => pid === 1001,
    });

    expect(second.acquired).toBe(false);
    expect(second.existingPid).toBe(1001);

    // The intruder must NOT have clobbered the owner's lock.
    const onDisk = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid: number };
    expect(onDisk.pid).toBe(1001);
  });

  test('takes over a stale lock left by a dead process', () => {
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: 9999, token: 'ghost', startedAt: '2020-01-01T00:00:00.000Z' }),
    );

    const lock = acquireSingleInstanceLock(lockPath, {
      pid: 3003,
      token: 'fresh',
      isProcessAlive: () => false,
    });

    expect(lock.acquired).toBe(true);
    const onDisk = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid: number; token: string };
    expect(onDisk.pid).toBe(3003);
    expect(onDisk.token).toBe('fresh');
  });

  test('takes over a corrupt / empty lock file', () => {
    writeFileSync(lockPath, 'not json at all');

    const lock = acquireSingleInstanceLock(lockPath, {
      pid: 5005,
      token: 'recovered',
      // Liveness should never even be consulted for an unparseable lock.
      isProcessAlive: () => true,
    });

    expect(lock.acquired).toBe(true);
    const onDisk = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid: number };
    expect(onDisk.pid).toBe(5005);
  });

  test('release removes the lock only when we still own it', () => {
    const lock = acquireSingleInstanceLock(lockPath, { pid: 6006, token: 'mine' });
    expect(existsSync(lockPath)).toBe(true);

    lock.release();
    expect(existsSync(lockPath)).toBe(false);

    // Idempotent — a second release is a no-op even though the file is gone.
    expect(() => lock.release()).not.toThrow();
  });

  test('release does not remove a lock owned by a different token', () => {
    const lock = acquireSingleInstanceLock(lockPath, { pid: 7007, token: 'original' });
    expect(lock.acquired).toBe(true);

    // Simulate another instance having since taken over the lock file.
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: 8008, token: 'usurper', startedAt: new Date().toISOString() }),
    );

    lock.release();

    // The usurper's lock must survive our release.
    expect(existsSync(lockPath)).toBe(true);
    const onDisk = JSON.parse(readFileSync(lockPath, 'utf8')) as { token: string };
    expect(onDisk.token).toBe('usurper');
  });

  test('creates the parent directory if missing', () => {
    const nested = join(dir, 'deep', 'nested', 'dafman.lock');
    const lock = acquireSingleInstanceLock(nested, { pid: 1234, token: 'tok' });

    expect(lock.acquired).toBe(true);
    expect(existsSync(nested)).toBe(true);
  });
});
