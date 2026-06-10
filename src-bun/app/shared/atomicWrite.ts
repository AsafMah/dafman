// Atomic file write: write to a temp file in the same directory,
// then rename onto the target. On every OS we care about, rename
// within the same volume is atomic — readers either see the old
// file or the new one, never a partial write.
//
// The temp suffix includes a random component so concurrent callers
// don't step on each other. On crash the temp leaks; we ignore it.

import { rename, rm, writeFile } from 'node:fs/promises';

export async function atomicWrite(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp-${Math.random().toString(16).slice(2, 8)}`;

  await writeFile(tmp, content, 'utf-8');

  try {
    await rename(tmp, path);
  } catch (err) {
    try {
      await rm(tmp, { force: true });
    } catch {
      /* ignore cleanup failure */
    }

    throw err;
  }
}
