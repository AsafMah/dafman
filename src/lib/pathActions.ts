/// Shared helpers for OS-level actions (reveal in file manager, open
/// URL in default browser, open log folder). Each wraps an IPC call
/// with a consistent error-toast fallback so components don't repeat
/// the same try/catch pattern.

import { invokeCommand } from '@/ipc/invoke';
import { useToastStore } from '@/stores/app/toastStore';
import { toErrorMessage } from '@/lib/errorMessage';

/**
 * Open a file or directory in the OS file manager (Explorer / Finder / xdg-open).
 * On failure, shows a toast with the error message.
 *
 * @param path     Absolute path to reveal.
 * @param toastMsg Optional summary for the error toast (default: "Couldn't reveal path").
 */
export async function revealPath(path: string, toastMsg = "Couldn't reveal path"): Promise<void> {
  try {
    await invokeCommand('revealPath', { path });
  } catch (err) {
    useToastStore().error(toastMsg, toErrorMessage(err));
  }
}

/**
 * Open a URL in the OS default browser. On failure, shows a toast.
 * Returns the IPC bool (true on success). Returns false (and no toast)
 * if `notify` is false — useful for the WebLinksAddon callback that
 * shouldn't toast on every link miss.
 *
 * @param url      Absolute URL to open.
 * @param options  `toastMsg`: error toast summary; `notify`: when false,
 *                 swallow failures silently (default true).
 */
export async function openUrl(
  url: string,
  { toastMsg = "Couldn't open URL", notify = true }: { toastMsg?: string; notify?: boolean } = {},
): Promise<boolean> {
  try {
    const ok = await invokeCommand('openUrl', { url });

    if (!ok && notify) {
      useToastStore().error(toastMsg, url);
    }

    return ok;
  } catch (err) {
    if (notify) useToastStore().error(toastMsg, toErrorMessage(err));

    return false;
  }
}

/**
 * Open the bun-side log folder in the OS file manager. On failure, shows a toast.
 */
export async function openLogFolder(toastMsg = "Couldn't open log folder"): Promise<boolean> {
  try {
    return await invokeCommand('openLogFolder', {});
  } catch (err) {
    useToastStore().error(toastMsg, toErrorMessage(err));

    return false;
  }
}
