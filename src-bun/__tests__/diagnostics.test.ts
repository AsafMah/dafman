// Diagnostics bundle export — integration test.
//
// Exercises the full export path: write a synthetic log + settings,
// then call `exportDiagnostics` and assert the resulting directory
// contains the expected files.
//
// `os.tmpdir` for the output root so we don't pollute the user-data
// directory of the host. Cleanup is best-effort.

import { describe, expect, test, beforeEach } from 'bun:test';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { initLogger, log, _resetLogger } from '../app/logging';
import { exportDiagnostics } from '../app/diagnostics';

describe('exportDiagnostics', () => {
  beforeEach(() => {
    _resetLogger();
  });

  test('produces a directory with logs + recent.json + settings + README', async () => {
    const logDir = await mkdtemp(join(tmpdir(), 'dafman-test-logs-'));
    const outRoot = await mkdtemp(join(tmpdir(), 'dafman-test-out-'));
    await initLogger({ logDir });
    // Write a couple of real log records so the per-day file exists.
    log.info('hello', { sessionId: 'sess-1' });
    log.warn('warned', { reason: 'test' });
    // Give the append a moment to flush (logger is fire-and-forget).
    await new Promise((r) => setTimeout(r, 50));
    // Also write a synthetic stale log file so the "copy every dafman-*.log"
    // branch is exercised.
    const stalePath = join(logDir, 'dafman-2000-01-01.log');
    await writeFile(stalePath, '{"ts":"old","level":"info","message":"old"}\n');

    const result = await exportDiagnostics({
      outputRoot: outRoot,
      settings: { version: 8, appearance: { theme: 'system' } },
    });

    expect(result.path).toContain('dafman-diagnostics-');
    expect(result.files).toContain('README.md');
    expect(result.files).toContain('settings.json');
    expect(result.files).toContain('logs/recent.json');
    expect(result.files).toContain('logs/dafman-2000-01-01.log');
    expect(result.totalBytes).toBeGreaterThan(0);

    // Verify the README mentions the redaction posture.
    const readme = await readFile(join(result.path, 'README.md'), 'utf8');
    expect(readme).toContain('redacted');
    expect(readme).toContain('attachment data');

    // settings.json should be the JSON we passed in.
    const settings = JSON.parse(await readFile(join(result.path, 'settings.json'), 'utf8'));
    expect(settings.version).toBe(8);
    expect(settings.appearance.theme).toBe('system');

    // recent.json should at least contain our two records.
    const recent = JSON.parse(await readFile(join(result.path, 'logs', 'recent.json'), 'utf8'));
    expect(Array.isArray(recent)).toBe(true);
    expect(recent.length).toBeGreaterThanOrEqual(2);
  });

  test('handles a missing log dir gracefully (no logs/, but settings + README still ship)', async () => {
    const outRoot = await mkdtemp(join(tmpdir(), 'dafman-test-out-'));
    // Don't init the logger — log dir stays null.
    const result = await exportDiagnostics({
      outputRoot: outRoot,
      settings: { version: 8 },
    });
    expect(result.files).toContain('settings.json');
    expect(result.files).toContain('README.md');
    // recent.json still writes (it's the in-process ring, not the file).
    expect(result.files).toContain('logs/recent.json');
    // No dafman-*.log files should be present (the source dir was never set).
    const logDir = join(result.path, 'logs');
    const entries = await readdir(logDir);
    expect(entries.filter((n) => n.startsWith('dafman-') && n.endsWith('.log'))).toEqual([]);
  });
});
