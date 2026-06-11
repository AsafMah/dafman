// Auto-update service — thin wrapper over Electrobun's `Updater` API.
//
// Responsibilities:
//   - checkForUpdate(): calls Updater.checkForUpdate() and returns the result
//   - downloadAndApplyUpdate(): calls downloadUpdate() then applyUpdate()
//   - onStatusChange(cb): subscribe to Updater status-change events
//   - scheduleBootCheck(pushFn): schedules a background check 30 s after boot
//
// `Updater.getLocalInfo()` reads from `../Resources/version.json` which is
// baked in at build time. On `channel === 'dev'` Electrobun short-circuits
// checkForUpdate() and returns `{ updateAvailable: false }` — so this service
// is always safe to call in dev.

import { Updater } from 'electrobun/bun';
import type {
  UpdateCheckResult,
  UpdateEventPayload,
  UpdateStatusType,
} from '../src/shared/wireTypes';
import { log } from './app/observability/logging';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Maps Electrobun's granular status strings to the coarser set used by the
/// renderer. Unknown strings fall back to 'idle'.
function coarseStatus(raw: string): UpdateStatusType {
  if (raw === 'checking' || raw === 'check-complete') return 'checking';
  if (raw === 'no-update') return 'no-update';
  if (
    raw === 'update-available' ||
    raw === 'local-tar-found' ||
    raw === 'local-tar-missing' ||
    raw === 'patch-found' ||
    raw === 'patch-not-found'
  )
    return 'update-available';
  if (
    raw === 'download-starting' ||
    raw === 'downloading' ||
    raw === 'fetching-patch' ||
    raw === 'downloading-patch' ||
    raw === 'applying-patch' ||
    raw === 'patch-applied' ||
    raw === 'extracting-version' ||
    raw === 'patch-chain-complete' ||
    raw === 'downloading-full-bundle' ||
    raw === 'download-progress' ||
    raw === 'decompressing' ||
    raw === 'download-complete' ||
    raw === 'checking-local-tar'
  )
    return 'downloading';
  if (
    raw === 'applying' ||
    raw === 'extracting' ||
    raw === 'replacing-app' ||
    raw === 'launching-new-version'
  )
    return 'applying';
  if (raw === 'complete') return 'complete';
  if (raw === 'error' || raw === 'patch-failed') return 'error';
  return 'idle';
}

/// Returns true if `url` is safe to use as an update baseUrl.
/// Update artifacts are unsigned, so HTTPS is the minimum requirement.
/// Exported so the guard is independently unit-testable.
export function isSecureBaseUrl(url: string): boolean {
  return url.toLowerCase().startsWith('https://');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type UpdateEventPushFn = (payload: UpdateEventPayload) => void;

/// Check for an available update. Returns the raw Electrobun result.
///
/// Guard: if the baked-in `baseUrl` is not HTTPS, no network request is made
/// and an error result is returned immediately. Unsigned artifacts over
/// plaintext HTTP are unacceptable.
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  // Enforce HTTPS — baseUrl is baked in at build time; reject anything else.
  const localInfo = await Updater.getLocalInfo();
  const baseUrl: string = localInfo.baseUrl ?? '';
  if (!isSecureBaseUrl(baseUrl)) {
    const msg = `refusing insecure update baseUrl: ${baseUrl || '(empty)'}`;
    log.warn('updateService.checkForUpdate: ' + msg);
    return { version: '', hash: '', updateAvailable: false, updateReady: false, error: msg };
  }

  try {
    const result = await Updater.checkForUpdate();
    return {
      version: result.version ?? '',
      hash: result.hash ?? '',
      updateAvailable: result.updateAvailable ?? false,
      updateReady: result.updateReady ?? false,
      error: result.error ?? '',
    };
  } catch (err) {
    log.warn('updateService.checkForUpdate threw', { error: String(err) });
    return {
      version: '',
      hash: '',
      updateAvailable: false,
      updateReady: false,
      error: String(err),
    };
  }
}

/// Download the update via delta patches (or full bundle), then apply it.
/// Calling applyUpdate() quits the app and launches the new version.
/// Returns false (and logs) if the download did not result in `updateReady`,
/// or if the updater set an error. Does NOT return true on a silent no-op.
export async function downloadAndApplyUpdate(): Promise<boolean> {
  try {
    await Updater.downloadUpdate();
    // Verify the download actually succeeded before calling applyUpdate.
    const info = Updater.updateInfo();
    if (info?.error) {
      log.warn('updateService.downloadAndApplyUpdate: updater error', { error: info.error });
      return false;
    }
    if (!info?.updateReady) {
      log.warn('updateService.downloadAndApplyUpdate: updateReady is false after download');
      return false;
    }
    await Updater.applyUpdate();
    return true;
  } catch (err) {
    log.warn('updateService.downloadAndApplyUpdate threw', { error: String(err) });
    return false;
  }
}

/// Returns the last-fetched update info, or null if checkForUpdate() has
/// not been called yet in this session.
export function getUpdateStatus(): UpdateCheckResult | null {
  const info = Updater.updateInfo();
  if (!info) return null;
  return {
    version: info.version ?? '',
    hash: info.hash ?? '',
    updateAvailable: info.updateAvailable ?? false,
    updateReady: info.updateReady ?? false,
    error: info.error ?? '',
  };
}

/// Subscribe to Electrobun Updater status changes; translates each entry to
/// an `UpdateEventPayload` and calls `pushFn`. Returns a cleanup function.
export function onStatusChange(pushFn: UpdateEventPushFn): () => void {
  Updater.onStatusChange((entry) => {
    const payload: UpdateEventPayload = {
      status: coarseStatus(entry.status),
      message: entry.message,
      timestamp: entry.timestamp,
      progress: entry.details?.progress,
      errorMessage: entry.details?.errorMessage,
    };
    pushFn(payload);
  });
  // Electrobun's onStatusChange replaces the single global callback;
  // return a no-op unsubscribe (the caller never re-subscribes).
  return () => Updater.onStatusChange(null);
}

/// Schedule a background update check 30 s after boot so we don't delay
/// startup. Calls `pushFn` if an update is found.
export function scheduleBootCheck(pushFn: UpdateEventPushFn): void {
  setTimeout(() => {
    void checkForUpdate().then((result) => {
      if (result.updateAvailable) {
        pushFn({
          status: 'update-available',
          message: `Update available (version ${result.version || result.hash.slice(0, 8)})`,
          timestamp: Date.now(),
        });
      }
    });
  }, 30_000);
}
