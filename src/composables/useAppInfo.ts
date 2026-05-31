import { ref } from 'vue';

import { invokeCommand } from '@/ipc/invoke';
import type { AppInfo } from '@/ipc/types';

// Build-time identity (release channel + version) fetched once via the
// `getAppInfo` RPC and shared across the renderer. The bun side sources
// it from the bundled `Resources/version.json`, so it never changes for
// the lifetime of the process — a module-level cache is correct.
//
// Lazy + best-effort: the fetch is kicked off the first time any caller
// mounts. If the bridge isn't ready or the RPC rejects (e.g. the smoke
// harness stub doesn't implement it), `appInfo` simply stays null and
// channel-dependent UI (the StatusBar pill) renders nothing.
const appInfo = ref<AppInfo | null>(null);
let fetchStarted = false;

function ensureFetched(): void {
  if (fetchStarted) return;

  fetchStarted = true;

  void invokeCommand('getAppInfo', {})
    .then((info) => {
      appInfo.value = info;
    })
    .catch(() => {
      // Best-effort, but allow a later mount to retry: a transient bridge
      // failure shouldn't permanently hide a dev/canary pill (which would
      // make a non-stable build look stable). Re-arm the one-shot guard.
      fetchStarted = false;
    });
}

export function useAppInfo(): { appInfo: typeof appInfo } {
  ensureFetched();

  return { appInfo };
}
