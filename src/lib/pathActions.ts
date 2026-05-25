/// Shared helper for revealing a path in the OS file manager with
/// error-toast fallback.  Deduplicates 5+ identical try/catch blocks.

import { invokeCommand } from '../ipc/invoke';
import { useToastStore } from '../stores/app/toastStore';
import { toErrorMessage } from './errorMessage';

/**
 * Open a file or directory in the OS file manager (Explorer / Finder / xdg-open).
 * On failure, shows a toast with the error message.
 *
 * @param path     Absolute path to reveal.
 * @param toastMsg Optional summary for the error toast (default: "Couldn't reveal path").
 */
export async function revealPath(
  path: string,
  toastMsg = "Couldn't reveal path",
): Promise<void> {
  try {
    await invokeCommand('revealPath', { path });
  } catch (err) {
    useToastStore().error(toastMsg, toErrorMessage(err));
  }
}
