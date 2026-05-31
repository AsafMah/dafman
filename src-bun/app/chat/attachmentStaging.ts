// Attachment staging — convert non-inlinable blob attachments into
// real on-disk files so the host CLI can actually deliver their
// content to the model (#110).
//
// Investigation (node_modules/@github/copilot/app.js, `Jio`/`fae`):
// the bundled host CLI only turns a `blob` attachment into model
// content when its mimeType is a recognized image (`sct`) OR a native
// office/PDF document (`Ios` ∪ `aKt`). Every other blob — a dropped
// `.ts`/`.py`/`.md` source file (whose webview `File.type` is empty,
// so it ships as `application/octet-stream`), or a `text/markdown`
// command-result pill — falls through both branches of `Jio` and is
// SILENTLY DROPPED. The model then "can't find the file".
//
// `type:'file'` path attachments take a different route: the host
// reads them from disk and embeds the content in a `<tagged_files>`
// XML block (`Kio`/`BXs`), which works for paths *outside* the session
// cwd. So the fix is: for any blob the host can't inline, write the
// decoded bytes to a real temp file and send it as a `type:'file'`.

import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';

/// Images the host inlines as an `image_url` content part (`sct` in
/// app.js). The host checks `sct.has(a.mimeType)` against the RAW
/// mimeType — no normalization — so we match exactly the same way.
const HOST_INLINABLE_IMAGE_MIMES = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/tiff',
  'image/x-icon',
  'image/heic',
  'image/avif',
]);

/// Native documents the host inlines as a `file` content part
/// (`Ios` ∪ `aKt` in app.js). The host's `fae`→`wIn`→`mUe`/`hUe`
/// branch normalizes the mimeType via `pR` (strip `;`-params,
/// lower-case) before the set check, so we normalize too.
const HOST_INLINABLE_DOC_MIMES = new Set<string>([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
  'application/pdf',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/rtf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

/// True when the host CLI can inline a `blob` of this mimeType as model
/// content. Mirrors the host's asymmetry exactly: the image branch
/// (`sct.has(a.mimeType)`) matches the raw mimeType, while the document
/// branch (`mUe`/`hUe`) normalizes first. Matching the host precisely
/// matters — over-accepting (e.g. treating `image/png; charset=...` as
/// inlinable when the host's raw `sct` check would miss it) would skip
/// staging and silently lose the attachment, re-introducing #110.
export function isHostInlinableBlobMime(mimeType: string): boolean {
  if (HOST_INLINABLE_IMAGE_MIMES.has(mimeType)) return true;

  const normalized = (mimeType.split(';')[0] ?? '').trim().toLowerCase();

  return HOST_INLINABLE_DOC_MIMES.has(normalized);
}

export interface StagedFileAttachment {
  type: 'file';
  path: string;
  displayName?: string;
}

interface StageableBlob {
  data: string;
  mimeType: string;
  displayName?: string;
}

/// Stale staged-file directories are swept after this long. Files are
/// kept (not deleted per-send) because the host reads them
/// asynchronously while assembling the prompt; a TTL sweep bounds disk
/// use without racing that read.
const STAGE_TTL_MS = 6 * 60 * 60 * 1000;

let stagingDirOverride: string | null = null;

/// Test seam — point staging at a scratch dir instead of the OS temp
/// dir so unit tests don't pollute the global temp space.
export function _setStagingDirForTest(dir: string | null): void {
  stagingDirOverride = dir;
}

function stagingRoot(): string {
  return stagingDirOverride ?? join(tmpdir(), 'dafman-attachments');
}

/// Reduce a display name to a safe single-segment filename, preserving
/// the extension (the host/model use it for syntax context).
function safeFileName(displayName: string | undefined): string {
  const base = basename((displayName ?? '').trim()).replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_');

  if (base.length === 0 || base === '.' || base === '..') return 'attachment.txt';

  return base;
}

/// Best-effort removal of staged directories older than the TTL.
async function sweepStale(root: string): Promise<void> {
  let entries: string[];

  try {
    entries = await readdir(root);
  } catch {
    return;
  }

  const now = Date.now();

  await Promise.all(
    entries.map(async (entry) => {
      const target = join(root, entry);

      try {
        const info = await stat(target);

        if (now - info.mtimeMs > STAGE_TTL_MS) {
          await rm(target, { recursive: true, force: true });
        }
      } catch {
        /* ignore — best-effort cleanup */
      }
    }),
  );
}

/// Write a blob attachment's decoded bytes to a real file and return a
/// `type:'file'` attachment pointing at it. Each blob gets its own
/// uuid subdirectory so the original filename is preserved verbatim
/// (no disambiguating prefix the model would have to read around).
export async function stageBlobToFile(blob: StageableBlob): Promise<StagedFileAttachment> {
  const root = stagingRoot();

  await sweepStale(root);

  const dir = join(root, randomUUID());

  await mkdir(dir, { recursive: true });

  const path = join(dir, safeFileName(blob.displayName));

  await writeFile(path, Buffer.from(blob.data, 'base64'));

  return {
    type: 'file',
    path,
    ...(blob.displayName ? { displayName: blob.displayName } : {}),
  };
}
