// saveExportFile — integration test.
//
// Pins the path-traversal defence + file write happy path.

import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { saveExportFile } from '../app/config/exports';

describe('saveExportFile', () => {
  test('writes the file under <root>/exports/ and returns its path + bytes', async () => {
    const outRoot = await mkdtemp(join(tmpdir(), 'dafman-test-export-'));
    const result = await saveExportFile({
      outputRoot: outRoot,
      fileName: 'session-2026.md',
      contents: '# Hello\n\nworld\n',
    });
    expect(result.path).toContain('exports');
    expect(result.path).toContain('session-2026.md');
    expect(result.bytes).toBeGreaterThan(0);
    const round = await readFile(result.path, 'utf8');
    expect(round).toBe('# Hello\n\nworld\n');
  });

  test('strips path-traversal attempts — the file lands inside exports/, not outside', async () => {
    const outRoot = await mkdtemp(join(tmpdir(), 'dafman-test-export-'));
    const result = await saveExportFile({
      outputRoot: outRoot,
      fileName: '../../../etc/passwd.md',
      contents: 'evil',
    });
    // `basename(normalize(...))` reduces the path to just `passwd.md`.
    expect(result.path).toContain(join(outRoot, 'exports'));
    expect(result.path).toContain('passwd.md');
    expect(result.path).not.toContain('..');
  });

  test('rejects a filename that resolves to empty / dot', async () => {
    const outRoot = await mkdtemp(join(tmpdir(), 'dafman-test-export-'));
    await expect(
      saveExportFile({ outputRoot: outRoot, fileName: './', contents: 'x' }),
    ).rejects.toThrow();
  });
});
