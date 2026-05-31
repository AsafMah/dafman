import { describe, expect, test, afterAll } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  _setStagingDirForTest,
  isHostInlinableBlobMime,
  stageBlobToFile,
} from '../app/chat/attachmentStaging';

afterAll(() => {
  _setStagingDirForTest(null);
});

describe('isHostInlinableBlobMime', () => {
  test('accepts the host-inlinable image + office/pdf mimes', () => {
    for (const mime of [
      'image/png',
      'image/jpeg',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ]) {
      expect(isHostInlinableBlobMime(mime)).toBe(true);
    }
  });

  test('rejects text/code/markdown/octet-stream (the host drops these blobs)', () => {
    for (const mime of [
      'application/octet-stream',
      'text/plain',
      'text/markdown',
      'text/x-typescript',
      'application/typescript',
      'text/javascript',
    ]) {
      expect(isHostInlinableBlobMime(mime)).toBe(false);
    }
  });

  test('normalizes parameters and casing like the host', () => {
    expect(isHostInlinableBlobMime('IMAGE/PNG; charset=binary')).toBe(true);
    expect(isHostInlinableBlobMime('  text/markdown ; charset=utf-8')).toBe(false);
  });
});

describe('stageBlobToFile', () => {
  test('writes the decoded bytes to a real file and returns a type:file attachment', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dafman-stage-unit-'));
    _setStagingDirForTest(dir);

    try {
      const body = 'def main():\n    return 42\n';
      const staged = await stageBlobToFile({
        data: Buffer.from(body, 'utf8').toString('base64'),
        mimeType: 'application/octet-stream',
        displayName: 'main.py',
      });

      expect(staged.type).toBe('file');
      expect(staged.displayName).toBe('main.py');
      expect(staged.path).toStartWith(dir);
      expect(staged.path).toEndWith('main.py');
      expect(readFileSync(staged.path, 'utf8')).toBe(body);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('sanitizes unsafe display names to a single filename segment', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dafman-stage-unit-'));
    _setStagingDirForTest(dir);

    try {
      const staged = await stageBlobToFile({
        data: Buffer.from('x', 'utf8').toString('base64'),
        mimeType: 'application/octet-stream',
        displayName: '../../etc/evil.txt',
      });

      expect(staged.path).toEndWith('evil.txt');
      expect(staged.path).not.toContain('..');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
