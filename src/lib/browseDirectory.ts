/// Thin IPC wrapper for `browseDirectory` with a swallowed error +
/// empty-array fallback. The caller is in a typeahead loop and treats
/// failures as "no match" (don't disrupt the user's typing).

import { invokeCommand } from '@/ipc/invoke';

export async function browseDirectorySafe(prefix: string): Promise<string[]> {
  try {
    return await invokeCommand('browseDirectory', { prefix });
  } catch {
    return [];
  }
}
