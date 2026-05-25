// Diagnostics bundle export.
//
// Bundles the user's current logs + a redacted copy of settings.json
// into a single ZIP under <userData>/diagnostics-YYYY-MM-DD-HHMM.zip.
// The bundle is the artefact a user attaches to a bug report.
//
// Redaction posture:
//   * Log files: already redacted at write time by the structured
//     logger; we ship them as-is. (Older lines from before redaction
//     landed may contain richer content — the bundle README warns
//     the recipient to skim before sharing.)
//   * Settings: workspaces.recent paths can leak directory structure;
//     we keep them. Tokens / accounts go through the OS keyring (M4)
//     so they're not in settings.json anyway. Layout JSON is opaque
//     and harmless.
//   * We do NOT include the live in-memory event buffer (could contain
//     prompts). Out of scope for v1; future toggle.
//
// Format: standard ZIP via Bun's `Bun.spawn` to the platform `tar`
// binary would be cross-platform-painful; instead we use the
// `archiver`-equivalent in plain TS: write each file into a
// concatenated stream with `node:zlib`. Keeping it dead simple:
// produce a UNIX tar (Bun ships tar in stdlib) — no, simplest path
// is to copy files into a fresh directory and rely on the user
// zipping it. Or use Bun.zip when available.
//
// Pragmatic v1: copy the files into a timestamped subfolder and
// return the path. The user can right-click → Compress / Send To
// → Zip in their OS. We'll add programmatic ZIP in a follow-up if
// the manual step proves annoying.

import { copyFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getLogDir, log, recentLogs } from './logging';
import { AppError } from '../shared/errors';
import { toErrorMessage } from '../shared/errorMessage';

export interface DiagnosticsExportResult {
  /// Absolute path to the export directory.
  path: string;
  /// Filenames included (relative to `path`).
  files: string[];
  /// Total size in bytes.
  totalBytes: number;
}

interface ExportOptions {
  /// Output root (typically `<userData>`). The export creates a
  /// timestamped sub-folder.
  outputRoot: string;
  /// Settings JSON snapshot to embed. Caller passes the live shape so
  /// we never read the file twice (and the user gets exactly what
  /// they see).
  settings: unknown;
}

const BUNDLE_README = `# Dafman diagnostics bundle

This folder contains the most recent logs and a snapshot of your
settings for triage purposes.

Files:
  - logs/dafman-YYYY-MM-DD.log      — JSON-lines per-day logs
  - logs/recent.json                 — last 1000 in-memory records
  - settings.json                    — snapshot of your settings
  - README.md                        — this file

Logs are pre-redacted: token values, prompts, attachment data, and
encrypted reasoning blobs are replaced with shape descriptors
({ len, prefix }) before they ever reach disk. Skim a sample line
before sharing if you've ever logged sensitive workspace paths or
custom field names — redaction is rule-based, not all-knowing.

To attach this folder to a GitHub issue, right-click → Compress / Send
To → Zip (or run \`tar -czf dafman-diagnostics.tar.gz <folder>\`),
then upload.
`;

export async function exportDiagnostics(opts: ExportOptions): Promise<DiagnosticsExportResult> {
  const stamp = timestamp();
  const dir = join(opts.outputRoot, `dafman-diagnostics-${stamp}`);
  const logSubdir = join(dir, 'logs');

  try {
    await mkdir(logSubdir, { recursive: true });
  } catch (err) {
    throw AppError.io(`failed to create diagnostics dir: ${toErrorMessage(err)}`);
  }

  const files: string[] = [];
  let totalBytes = 0;

  // Copy every daily log file in the configured log dir.
  const sourceLogs = getLogDir();

  if (sourceLogs) {
    try {
      const entries = await readdir(sourceLogs);

      for (const name of entries) {
        if (!name.startsWith('dafman-') || !name.endsWith('.log')) continue;

        const src = join(sourceLogs, name);
        const dst = join(logSubdir, name);

        try {
          await copyFile(src, dst);
          const s = await stat(dst);

          totalBytes += s.size;
          files.push(`logs/${name}`);
        } catch (err) {
          log.warn('diagnostics: skipped log file', {
            name,
            error: toErrorMessage(err),
          });
        }
      }
    } catch (err) {
      log.warn('diagnostics: failed to list log dir', {
        path: sourceLogs,
        error: toErrorMessage(err),
      });
    }
  }

  // Dump the in-memory ring buffer so the bundle captures pre-init
  // records and anything from this run that hasn't flushed.
  try {
    const recent = recentLogs();
    const recentPath = join(logSubdir, 'recent.json');
    const recentJson = JSON.stringify(recent, null, 2);

    await writeFile(recentPath, recentJson);
    totalBytes += Buffer.byteLength(recentJson);
    files.push('logs/recent.json');
  } catch (err) {
    log.warn('diagnostics: failed to write recent.json', {
      error: toErrorMessage(err),
    });
  }

  // Settings snapshot.
  try {
    const settingsPath = join(dir, 'settings.json');
    const settingsJson = JSON.stringify(opts.settings, null, 2);

    await writeFile(settingsPath, settingsJson);
    totalBytes += Buffer.byteLength(settingsJson);
    files.push('settings.json');
  } catch (err) {
    log.warn('diagnostics: failed to write settings snapshot', {
      error: toErrorMessage(err),
    });
  }

  // README.
  try {
    const readmePath = join(dir, 'README.md');

    await writeFile(readmePath, BUNDLE_README);
    totalBytes += Buffer.byteLength(BUNDLE_README);
    files.push('README.md');
  } catch (err) {
    log.warn('diagnostics: failed to write README', {
      error: toErrorMessage(err),
    });
  }

  log.info('diagnostics export ready', {
    path: dir,
    files: files.length,
    totalBytes,
  });

  return { path: dir, files, totalBytes };
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));

  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`
  );
}
