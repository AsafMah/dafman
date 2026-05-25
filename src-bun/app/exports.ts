// Conversation export — bun-side writer.
//
// Writes the renderer-produced markdown/JSON string under
// `<userData>/exports/`. Renderer is responsible for building the
// document; bun just handles disk + sanitisation so we don't expose a
// generic write-anywhere RPC.
//
// Filename is sanitised again here (renderer also sanitises) so a
// compromised renderer can't escape the exports/ directory via
// `..\..\Windows\System32` shenanigans.

import { mkdir, writeFile } from 'node:fs/promises';
import { join, basename, normalize } from 'node:path';
import { AppError } from './errors';
import { log } from './logging';
import { toErrorMessage } from './errorMessage';

export interface SaveExportOptions {
  /// `Utils.paths.userData` from the caller.
  outputRoot: string;
  /// Sanitised filename (renderer-side first pass). We strip path
  /// separators here as a defence in depth.
  fileName: string;
  contents: string;
}

export interface SaveExportResult {
  /// Absolute path to the written file.
  path: string;
  /// Byte size of the written content.
  bytes: number;
}

export async function saveExportFile(opts: SaveExportOptions): Promise<SaveExportResult> {
  const dir = join(opts.outputRoot, 'exports');
  try {
    await mkdir(dir, { recursive: true });
  } catch (err) {
    throw AppError.io(`failed to create exports dir: ${toErrorMessage(err)}`);
  }
  // Defence in depth: strip any path components from the filename so
  // the renderer can't escape `exports/` with a `..` traversal.
  const safe = basename(normalize(opts.fileName)).slice(0, 200);
  if (!safe || safe === '.' || safe === '..') {
    throw AppError.io('invalid filename');
  }
  const path = join(dir, safe);
  const bytes = Buffer.byteLength(opts.contents);
  try {
    await writeFile(path, opts.contents);
  } catch (err) {
    throw AppError.io(`failed to write export file: ${toErrorMessage(err)}`);
  }
  log.info('conversation export saved', { path, bytes });
  return { path, bytes };
}
