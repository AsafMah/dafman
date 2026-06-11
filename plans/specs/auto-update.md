# In-App Auto-Update via Electrobun Delta Patches

**Status:** Implemented (client only)
**Date:** 2026-06-10

---

## Summary

Wire Electrobun's built-in `Updater` API into dafman so users receive and apply
updates without leaving the app. The implementation covers the full update
client: background check at boot, status push to the renderer, a Settings UI,
and one-click download-and-apply. Release hosting (publishing built artifacts to
a `baseUrl`) is a separate operational concern documented in the
[Release/Publish Process](#releasepublish-process) section.

---

## Motivation

dafman ships as a packaged Electrobun bundle. There is no OS-level auto-update
mechanism (no MSI/MSIX, no Sparkle on macOS). Without this feature, users must
manually download and install each new version. Electrobun 1.18.x ships a
complete update pipeline — delta-patch download, full-bundle fallback, and a
restart helper — that requires only a static file host to operate.

---

## Current State

### Before this implementation

| File                          | State                                                                     |
| ----------------------------- | ------------------------------------------------------------------------- |
| `electrobun.config.ts:27`     | No `release` key; `baseUrl` not set                                       |
| `src-bun/index.ts:12`         | `Updater` imported but used only for `getLocalInfo()` + channel detection |
| `src/shared/wireTypes.ts:543` | No update-related commands in `CommandMap`                                |
| `src-bun/rpc.ts:186`          | No `updateEvent` in webview messages                                      |
| `src/ipc/listenerRegistry.ts` | No `updateEvent` channel                                                  |

### Electrobun 1.18.x Updater surface (node_modules/electrobun/dist-win-x64/api/bun/core/Updater.ts)

| Method                       | Description                                                                                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Updater.checkForUpdate()`   | Fetches `<baseUrl>/<platform>-update.json`; returns `{ version, hash, updateAvailable, updateReady, error }`                                              |
| `Updater.downloadUpdate()`   | Walks delta-patch chain (`bspatch.exe`) from current hash to latest; falls back to full bundle download. Sets `updateInfo.updateReady = true` on success. |
| `Updater.applyUpdate()`      | Extracts tar into app data dir, writes an update `.bat` on Windows, calls `quit()` to restart. No-op if `updateReady` is false.                           |
| `Updater.onStatusChange(cb)` | Replaces the single global status callback; `cb` receives `UpdateStatusEntry` on every internal status transition (30+ distinct statuses).                |
| `Updater.getLocalInfo()`     | Reads `../Resources/version.json` (baked at build time); fields: `version, hash, channel, baseUrl, name, identifier`.                                     |
| `Updater.updateInfo()`       | Returns the last result from `checkForUpdate()`, or `undefined` before first check.                                                                       |

**Important constraints:**

- `channel === 'dev'` → `checkForUpdate()` immediately returns `{ updateAvailable: false }` (Updater.ts:184–195). Dev builds never auto-update.
- `version.json` embeds `baseUrl` at build time from `electrobun.config.ts:release.baseUrl`. There is no runtime override; changing channels or baseUrl requires a new build.
- `applyUpdate()` only acts when `updateInfo.updateReady === true`. Calling it before `downloadUpdate()` is a safe no-op.
- On Windows, the update is applied by a scheduled-task `.bat` that runs after the app exits (`Updater.ts:973–1050`). The launcher binary must not be in use.
- `Updater.onStatusChange` accepts a **single** callback (replaces the previous one); dafman's `onStatusChange` wrapper is therefore called once at startup.

---

## Design

### Architecture

```
┌─ src-bun/app/updater/updateService.ts ──────────────────────────────┐
│  checkForUpdate()       → Updater.checkForUpdate()                  │
│  downloadAndApplyUpdate()→ Updater.downloadUpdate() + applyUpdate() │
│  getUpdateStatus()      → Updater.updateInfo()                      │
│  onStatusChange(pushFn) → Updater.onStatusChange(granular→coarse)  │
│  scheduleBootCheck(fn)  → 30 s deferred check on first boot         │
└────────────────────────────────┬────────────────────────────────────┘
                                 │ push UpdateEventPayload
                                 ▼
┌─ src-bun/index.ts ──────────────────────────────────────────────────┐
│  3 new RPC handlers: checkForUpdate, downloadAndApplyUpdate,        │
│  getUpdateStatus                                                    │
│  Wires onStatusChange + scheduleBootCheck after bindEmitChannels()  │
└────────────────────────────────┬────────────────────────────────────┘
                                 │ send.updateEvent(payload)
                                 ▼
┌─ src/ipc/ ──────────────────────────────────────────────────────────┐
│  listenerRegistry: updateEvent fan-out channel                      │
│  invoke.ts: onUpdateEvent deferred subscriber                       │
│  electrobunBridge.ts: updateEvent → dispatchUpdateEvent             │
│  wsBridge.ts: dispatchMessage map + onUpdateEvent                   │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
           ┌─────────────────────┴──────────────────────┐
           ▼                                            ▼
┌─ updateStore.ts ────────────┐           ┌─ App.vue ──────────────┐
│  Pinia store tracking       │           │  onUpdateEvent toast   │
│  status, updateAvailable,   │           │  when update-available │
│  updateReady, latestVersion │           └────────────────────────┘
└─────────────┬───────────────┘
              ▼
┌─ UpdateSettingsSection.vue ──────────────────────────────────────┐
│  Shows version + channel                                         │
│  "Check for updates" button (calls checkForUpdate RPC)           │
│  "Download & Apply" button (calls downloadAndApplyUpdate RPC)    │
│  "Restart to apply" button (post-download state)                 │
└──────────────────────────────────────────────────────────────────┘
```

### Key files (post-implementation)

| File                                                | Role                                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `electrobun.config.ts:57–68`                        | `release.baseUrl` + `generatePatch: true` placeholder                                     |
| `src/shared/wireTypes.ts`                           | `UpdateStatusType`, `UpdateCheckResult`, `UpdateEventPayload`, 3 new `CommandMap` entries |
| `src-bun/rpc.ts`                                    | `updateEvent: UpdateEventPayload` in `DafmanRPC.webview.messages`                         |
| `src-bun/app/updater/updateService.ts`              | Update service wrapping `Updater`                                                         |
| `src-bun/index.ts`                                  | RPC handlers + status subscription + boot check                                           |
| `src/ipc/listenerRegistry.ts`                       | `updateEvent` fan-out channel                                                             |
| `src/ipc/invoke.ts`                                 | `onUpdateEvent` deferred subscriber                                                       |
| `src/ipc/electrobunBridge.ts`                       | `updateEvent` message handler                                                             |
| `src/ipc/wsBridge.ts`                               | `updateEvent` dispatch entry                                                              |
| `src/ipc/types.ts`                                  | Re-exports for update types                                                               |
| `src/stores/app/updateStore.ts`                     | Pinia store                                                                               |
| `src/components/settings/UpdateSettingsSection.vue` | Settings UI                                                                               |
| `src/components/settings/SettingsPanel.vue`         | Updated to include `UpdateSettingsSection`                                                |
| `src/App.vue`                                       | Boot subscription + update-available toast                                                |

### Status coarsening

Electrobun's `UpdateStatusType` has 30+ granular states. `updateService.ts`
maps them to a 7-value coarse set used by the renderer:

| Renderer status    | Electrobun states                                                                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checking`         | `checking`, `check-complete`                                                                                                                                                |
| `no-update`        | `no-update`                                                                                                                                                                 |
| `update-available` | `update-available`, `local-tar-*`, `patch-*` (discovery phase)                                                                                                              |
| `downloading`      | `download-*`, `fetching-patch`, `downloading-patch`, `applying-patch`, `patch-applied`, `extracting-version`, `patch-chain-complete`, `decompressing`, `checking-local-tar` |
| `applying`         | `applying`, `extracting`, `replacing-app`, `launching-new-version`                                                                                                          |
| `complete`         | `complete`                                                                                                                                                                  |
| `error`            | `error`, `patch-failed`                                                                                                                                                     |

### Boot-time check

`scheduleBootCheck()` fires once, 30 seconds after `bindEmitChannels()` in
`src-bun/index.ts`. This delay ensures the webview is live and the `send`
channel is bound before any event is pushed. If an update is found, a single
`updateEvent { status: 'update-available' }` is pushed; `App.vue` translates
this to a toast directing the user to Settings.

The background check does not auto-download or auto-apply. Downloads are always
user-initiated via the Settings section.

### Dev-channel guard

`Updater.checkForUpdate()` natively short-circuits on `channel === 'dev'`,
returning `{ updateAvailable: false }`. The UI also shows a hint that
auto-update is disabled on the dev channel.

---

## Open Questions

| Question                                                                                              | Recommended default                                                                                                          |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Should the boot check run automatically on all channels, or only canary/stable?                       | Auto-check on all packaged channels (dev is already excluded by Electrobun).                                                 |
| Should `downloadAndApplyUpdate` be one atomic operation or two separate buttons (Download / Restart)? | One button for simplicity; the three-state UI (idle → "Download & Apply" → "Restart to apply") already separates the phases. |
| Should updates auto-download without user action?                                                     | No — too disruptive. User-initiated only.                                                                                    |
| Should the check interval be periodic (every N hours) rather than once at boot?                       | Once at boot is sufficient for now; add periodic if release cadence increases.                                               |
| Should there be a channel-switch UI in Settings?                                                      | Out of scope — channel is baked into the build.                                                                              |
| Should failed update downloads be retried?                                                            | Electrobun handles internal retries implicitly via the full-bundle fallback. No extra retry needed.                          |

---

## Release/Publish Process

This is the process the **maintainer** must run to make a new version available
for auto-update. The client code is already in place; this section documents the
hosting requirements.

### 1. Set `release.baseUrl`

In `electrobun.config.ts`, set `release.baseUrl` to the public URL of your
artifact host (S3 bucket, GitHub Releases raw path, etc.):

```typescript
release: {
  baseUrl: 'https://releases.example.com/dafman',
  generatePatch: true,
},
```

This URL is baked into `Resources/version.json` at build time and is what
`Updater.checkForUpdate()` will fetch from.

### 2. Build

```bash
bun run build:canary   # or: bun run build  (for stable)
```

Output: `build/` directory containing:

- `dafman-Setup-canary.exe` (self-extracting installer)
- `dafman-canary-win-x64-<hash>.tar.zst` (the app bundle)

### 3. Generate required manifest and patch files

After each build, the following files must be uploaded to `<baseUrl>/`:

| File                              | Content                                                          |
| --------------------------------- | ---------------------------------------------------------------- |
| `canary-win-x64-update.json`      | `{ "version": "...", "hash": "<sha256 of .tar.zst>" }`           |
| `canary-win-x64-<prevHash>.patch` | bsdiff delta from the previous release's `.tar.zst` to this one  |
| `canary-win-x64-<hash>.tar.zst`   | Full bundle (only required if delta chain fails / first release) |

The `{channel}-{os}-{arch}` prefix is produced by Electrobun's
`getPlatformPrefix(channel, os, arch)` helper (`Updater.ts:198–202`): the order
is **channel first**, then os, then arch. For the `stable` channel on Windows
x64, the prefix is `stable-win-x64` and the manifest is
`stable-win-x64-update.json`.

When `generatePatch: true` is set, the `electrobun build` CLI automatically
generates the `.patch` file by diffing against the previous release (if it can
find the previous `.tar.zst`). The maintainer must keep old `.tar.zst` files
accessible for this to work.

### 4. Upload

Upload all three files to `<baseUrl>/`. The URL structure is flat
(no subdirectories); Electrobun requests:

```
GET <baseUrl>/<platform>-update.json
GET <baseUrl>/<platform>-<hash>.patch   (delta path)
```

### 5. Verify

After uploading, run:

```bash
curl https://releases.example.com/dafman/canary-win-x64-update.json
# should return: {"version":"<ver>","hash":"<hash>"}
```

---

## Implementation Phases

### Phase 1 — Client (this PR) ✅

- `updateService.ts` wrapping Electrobun `Updater`
- RPC commands: `checkForUpdate`, `downloadAndApplyUpdate`, `getUpdateStatus`
- Push channel: `updateEvent` bun→renderer
- `updateStore.ts` Pinia store
- `UpdateSettingsSection.vue` in Settings
- Boot-time background check (30 s deferred)
- Update-available toast in `App.vue`

### Phase 2 — Release hosting (future)

- CI workflow (`electrobun build` + upload artifacts to `baseUrl`)
- GitHub Actions or equivalent: build matrix (win/mac/linux × x64/arm64),
  upload `.tar.zst` + `update.json` + `.patch` files, sign releases
- Set `electrobun.config.ts:release.baseUrl` to the production host URL
- Smoke test: install canary, push a new version, verify in-app update applies

### Phase 3 — Polish (future)

- Periodic check (e.g., every 6 hours) in addition to the boot check
- Changelog/release notes in the update toast (requires structured data in `update.json`)
- Per-channel `baseUrl` override in settings (for testing against staging)
- Progress bar for delta download in `UpdateSettingsSection.vue`

---

## Security / Threat Model

**Electrobun 1.18.1 does not cryptographically sign update artifacts.**
The `hash` field in `update.json` is a build change-detector (derived from the
`.tar.zst` content) used to identify which delta patch to fetch. It is _not_ a
signed digest — there is no public key, no signature file, and no verification
step in `Updater.ts`.

Integrity therefore relies on three controls:

1. **HTTPS-only `baseUrl` (enforced in code)** — `updateService.checkForUpdate()`
   now refuses to proceed if the baked-in `baseUrl` does not start with
   `https://`. Unsigned artifacts over plaintext HTTP are unacceptable.
   See `src-bun/updateService.ts:checkForUpdate`.

2. **Locked-down, access-controlled release bucket** — the host serving
   `{prefix}-update.json` and `{prefix}-*.patch` must allow public reads but
   restrict writes to CI/CD service accounts only. Compromising the bucket
   breaks the entire update chain regardless of transport security.

3. **bspatch binary-exact patch application** — a delta patch applies against
   the exact installed binary (verified by bspatch's internal diffing). A patch
   crafted for a different binary version will fail to apply, providing a weak
   form of version pinning (but not tamper-resistance against a bucket
   compromise).

**Follow-up:** real signature verification (Ed25519 or similar) is gated on an
Electrobun release that supports artifact signing. Until then, the HTTPS +
locked bucket controls are the security boundary. Track this at Phase 2.

## References

- `node_modules/electrobun/dist-win-x64/api/bun/core/Updater.ts` — full Updater implementation
- `node_modules/electrobun/dist-win-x64/api/bun/ElectrobunConfig.ts:473–486` — `release` config shape
- `electrobun.config.ts:57–68` — `release.baseUrl` placeholder
- `src-bun/app/updater/updateService.ts` — update service
- `src-bun/index.ts:549–552` (post-edit) — RPC handler wiring
- `src/stores/app/updateStore.ts` — renderer state
- `src/components/settings/UpdateSettingsSection.vue` — Settings UI
