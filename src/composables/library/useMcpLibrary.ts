/// IPC + state for the MCP tab in the Library panel.
///
/// Covers the full CRUD + lifecycle surface: load configured + discovered
/// + session-live lists, enable/disable (both globally and per active
/// session), add/edit/remove configs, OAuth sign-in. The biggest call-
/// site by far (13 invokeCommand calls before extraction).

import { computed, ref } from 'vue';
import { invokeCommand } from '@/ipc/invoke';
import { useToastStore } from '@/stores/app/toastStore';
import { useSessionsStore } from '@/stores/chat/sessionsStore';
import { useLayoutStore } from '@/stores/shell/layoutStore';
import { toErrorMessage } from '@/lib/errorMessage';
import { openUrl } from '@/lib/pathActions';
import { PRODUCT_NAME } from '@/lib/product';
import { useDelayedLoadedFlag } from '@/composables/library/useDelayedLoadedFlag';

export type McpConfig = Record<string, unknown>;

export interface ConfiguredEntry {
  name: string;
  config: McpConfig;
  /// Local vs http transport. Falls back to "local" when the SDK
  /// config blob doesn't include a type discriminator (some shapes
  /// only set `command` for local and `url` for http).
  transport: 'local' | 'http';
}

export interface DiscoveredEntry {
  name: string;
  type?: string;
  source: string;
  enabled: boolean;
}

/// Classify a raw MCP config's transport. Exported so the form can
/// hint defaults without re-implementing the heuristic.
///
/// We deliberately do NOT try to detect OAuth from the static config
/// (an `oauthClientId`/`oauthGrantType` field): real HTTP MCP servers
/// — e.g. the GitHub remote MCP `{ type: 'http', url: … }` — negotiate
/// OAuth dynamically and carry neither field, so any static heuristic
/// permanently hides their Sign-in affordance. The Sign-in flow itself
/// is the source of truth (it warns when there's no session and
/// reports "already signed in" when the server needs no OAuth).
export function classifyTransport(config: McpConfig): 'local' | 'http' {
  const type = typeof config.type === 'string' ? config.type : null;

  if (type === 'http' || type === 'sse') return 'http';

  if (type === 'local' || type === 'stdio') return 'local';

  // No explicit type — infer from shape. `url` field implies http.
  if (typeof config.url === 'string') return 'http';

  return 'local';
}

export function useMcpLibrary() {
  const configured = ref<ConfiguredEntry[]>([]);
  const discovered = ref<DiscoveredEntry[]>([]);
  const { loaded, beginLoading } = useDelayedLoadedFlag();
  const error = ref<string | null>(null);
  /// Live connection status per server name, from the active session's
  /// `mcp.list()`. Drives the Sign-in affordance: an HTTP server only
  /// needs sign-in when its status is `needs-auth`. A server absent from
  /// this map has unknown status (e.g. no active session, or not loaded
  /// into the current session) — callers treat unknown as "might need
  /// auth" so the affordance isn't hidden when we simply lack data.
  const serverStatus = ref<Map<string, string>>(new Map());

  const knownNames = computed(() => new Set(configured.value.map((e) => e.name)));
  const newlyDiscovered = computed(() =>
    discovered.value.filter((d) => !knownNames.value.has(d.name)),
  );

  /// Whether an HTTP server should surface the Sign-in button.
  /// True for any server that is NOT actively connected. This covers
  /// `needs-auth` (explicit auth request), `failed`/`disabled` (connection
  /// couldn't start — often because no OAuth token exists yet), and
  /// `undefined` (no session-live data — don't hide the affordance when
  /// we simply lack information). Only `connected` is unambiguously
  /// working and doesn't need sign-in.
  function needsSignIn(name: string): boolean {
    const status = serverStatus.value.get(name);

    return status !== 'connected';
  }

  function getLibrarySession() {
    const sessionsStore = useSessionsStore();
    const layoutStore = useLayoutStore();

    return (
      sessionsStore.getSession(layoutStore.lastFocusedSessionId) ??
      sessionsStore.getSession(layoutStore.activeSessionId) ??
      sessionsStore.sessions.find((s) => s.workingDirectory) ??
      sessionsStore.sessions[0] ??
      null
    );
  }

  const librarySession = computed(() => getLibrarySession());
  const hasLibrarySession = computed(() => librarySession.value !== null);

  async function loadAll(): Promise<void> {
    const finishLoading = beginLoading();

    error.value = null;

    try {
      // Pass the last focused chat session's workingDirectory (or any
      // open session's, falling back to none) so SDK discovery picks up
      // workspace-level `.mcp.json` files even while the Library edge
      // panel owns focus and `activeSessionId` is null/stale.
      const librarySession = getLibrarySession();
      const wd = librarySession?.workingDirectory || '';
      // Also query the Library session's live MCP list — it includes
      // servers that the SDK auto-discovered AND connected to, which
      // mcp.discover (server-scoped) may miss for plugin-supplied
      // configs that only register against a live session. We also use
      // its per-server `status` to gate the Sign-in affordance.
      const sessionMcpsPromise = librarySession
        ? invokeCommand('listSessionMcpServers', { sessionId: librarySession.id }).catch(
            () => [] as Array<{ name: string; status: string }>,
          )
        : Promise.resolve([] as Array<{ name: string; status: string }>);
      const [configs, disc, sessionMcps] = await Promise.all([
        invokeCommand('listMcpConfigs', {}),
        invokeCommand('discoverMcpServers', wd ? { workingDirectory: wd } : {}),
        sessionMcpsPromise,
      ]);

      serverStatus.value = new Map(sessionMcps.map((s) => [s.name, s.status]));

      configured.value = Object.entries(configs).map(([name, config]) => ({
        name,
        config,
        transport: classifyTransport(config),
      }));

      const merged = new Map<string, DiscoveredEntry>();

      for (const d of disc) merged.set(d.name, { ...d });

      for (const s of sessionMcps) {
        if (merged.has(s.name)) continue;

        merged.set(s.name, {
          name: s.name,
          source: 'session',
          enabled: true,
        });
      }

      discovered.value = [...merged.values()];
    } catch (err) {
      error.value = toErrorMessage(err);
    } finally {
      finishLoading();
    }
  }

  /// After toggling at the config level (which only affects new
  /// sessions), also push the change to every currently-open session
  /// so the toggle takes effect immediately.
  async function syncToggleToActiveSessions(serverName: string, enabled: boolean): Promise<void> {
    const sessionsStore = useSessionsStore();

    for (const session of sessionsStore.sessions) {
      try {
        await invokeCommand('setSessionMcpEnabled', {
          sessionId: session.id,
          serverName,
          enabled,
        });
      } catch {
        // Session may not have this server connected — ignore.
      }
    }
  }

  /// After writing a new or updated MCP config globally, reload the MCP
  /// runtime on every open session so the session's live McpHost picks up
  /// the new server immediately. Without this, signing in immediately
  /// after adding an HTTP MCP server errors with "MCP server does not
  /// exist" because the session was created before the config entry
  /// existed (Symptom A fix). Errors are silently swallowed — a session
  /// may already be disconnecting or the SDK call may not be available.
  async function syncReloadToActiveSessions(): Promise<void> {
    const sessionsStore = useSessionsStore();

    for (const session of sessionsStore.sessions) {
      try {
        await invokeCommand('reloadSessionMcpServers', { sessionId: session.id });
      } catch {
        // Session may not be in a state to reload — ignore.
      }
    }
  }

  /// Toggle a server's global allowlist state + sync to active sessions.
  /// `currentlyEnabled` is the caller's view of state (today's enabled).
  /// Returns the new desired state on success, null on failure (toasted).
  async function setEnabled(name: string, enabled: boolean): Promise<boolean | null> {
    try {
      if (enabled) {
        await invokeCommand('enableMcpServers', { names: [name] });
      } else {
        await invokeCommand('disableMcpServers', { names: [name] });
      }

      await syncToggleToActiveSessions(name, enabled);
      await loadAll();

      return enabled;
    } catch (err) {
      useToastStore().error('Failed to toggle MCP server', toErrorMessage(err));

      return null;
    }
  }

  function isEnabled(name: string): boolean {
    const hit = discovered.value.find((d) => d.name === name);

    // When the discover list doesn't include the configured server
    // (e.g. broken plugin), assume enabled — matches the SDK default
    // which auto-enables anything not in the disabled set.
    return hit ? hit.enabled : true;
  }

  /// Per-session enabled state for the focused session, derived from
  /// `serverStatus` (the live MCP list from `listSessionMcpServers`).
  ///
  /// Rule (from sessionMcpService.ts:51-63 / session.rpc.mcp.disable):
  /// - status === 'disabled' → explicitly session-disabled → false
  /// - any other status value (connected, needs-auth, failed, …) → true
  /// - no entry in serverStatus (server not in this session's list) →
  ///   fall back to the global isEnabled (treat as inheriting the default)
  function sessionEnabled(name: string): boolean {
    const status = serverStatus.value.get(name);
    if (status === undefined) return isEnabled(name);
    return status !== 'disabled';
  }

  /// Toggle MCP enabled state for the FOCUSED session only.
  /// Does NOT sync to other sessions — that is `syncToggleToActiveSessions`,
  /// which is the global-toggle path. Refreshes serverStatus via loadAll.
  async function setSessionEnabled(name: string, enabled: boolean): Promise<void> {
    const session = librarySession.value;
    if (!session) return;

    try {
      await invokeCommand('setSessionMcpEnabled', {
        sessionId: session.id,
        serverName: name,
        enabled,
      });
      await loadAll();
    } catch (err) {
      useToastStore().error('Failed to set session MCP state', toErrorMessage(err));
    }
  }

  async function removeConfig(name: string): Promise<boolean> {
    try {
      await invokeCommand('removeMcpConfig', { name });
      configured.value = configured.value.filter((e) => e.name !== name);
      // Also drop it from the in-memory discovered list. A configured
      // server round-trips through `mcp.discover` (source "user") and may
      // be a live session server too, so without this it re-surfaces under
      // the Discovered section the instant it leaves `configured` — the
      // "Remove jumps to Discovered" bug (#10). A genuine workspace-file
      // server legitimately returns on the next `loadAll`.
      discovered.value = discovered.value.filter((d) => d.name !== name);

      return true;
    } catch (err) {
      useToastStore().error('Failed to remove', toErrorMessage(err));

      return false;
    }
  }

  async function upsertConfig(
    mode: 'add' | 'edit',
    payload: { name: string; config: McpConfig },
  ): Promise<{ ok: boolean; wasUpdate?: boolean }> {
    try {
      if (mode === 'edit') {
        await invokeCommand('updateMcpConfig', payload);
      } else {
        try {
          await invokeCommand('addMcpConfig', payload);
        } catch (addErr) {
          // The CLI throws when a server with this name already exists in the
          // global config (typical when re-adding after a prior session). Auto-
          // upgrade to an update so the user isn't dead-ended by the error.
          const msg = toErrorMessage(addErr).toLowerCase();

          if (msg.includes('already exist') || msg.includes('already configured')) {
            await invokeCommand('updateMcpConfig', payload);

            // Reload + refresh, then signal the caller it was an update.
            await syncReloadToActiveSessions();
            await loadAll();

            return { ok: true, wasUpdate: true };
          }

          throw addErr;
        }
      }

      // Reload the MCP runtime on every open session so the new/updated
      // server config is immediately visible to the live McpHost. Without
      // this reload, clicking Sign-in right after adding an HTTP MCP
      // server fails with "MCP server does not exist" (Symptom A fix).
      await syncReloadToActiveSessions();
      await loadAll();

      return { ok: true };
    } catch (err) {
      useToastStore().error('Save failed', toErrorMessage(err));

      return { ok: false };
    }
  }

  /// Kick off the OAuth flow for `name` against the first open session.
  /// Returns:
  ///   - { state: 'no-session' }       — caller should toast "create a session first"
  ///   - { state: 'started' }          — browser launched; CLI will reconnect
  ///   - { state: 'already-signed-in' }
  ///   - { state: 'failed' }           — composable already toasted
  async function signIn(
    name: string,
  ): Promise<{ state: 'no-session' | 'started' | 'already-signed-in' | 'failed' }> {
    // Prefer the same last-focused session whose workspace/config the
    // Library is showing, then fall back to any open session — the OAuth
    // flow runs through a live session but isn't otherwise session-specific.
    const session = getLibrarySession();

    if (!session) return { state: 'no-session' };

    try {
      // Pass our product name so the OAuth consent screen names the app
      // requesting access instead of the SDK's neutral fallback. The SDK
      // applies this to newly-registered dynamic clients only; existing
      // registrations keep the name they were created with.
      const result = await invokeCommand('loginToMcpServer', {
        sessionId: session.id,
        serverName: name,
        clientName: PRODUCT_NAME,
      });

      if (result.authorizationUrl) {
        await openUrl(result.authorizationUrl);

        return { state: 'started' };
      }

      return { state: 'already-signed-in' };
    } catch (err) {
      useToastStore().error('Sign-in failed', toErrorMessage(err));

      return { state: 'failed' };
    }
  }

  return {
    configured,
    discovered,
    loaded,
    error,
    knownNames,
    newlyDiscovered,
    loadAll,
    setEnabled,
    isEnabled,
    removeConfig,
    upsertConfig,
    signIn,
    needsSignIn,
    librarySession,
    hasLibrarySession,
    sessionEnabled,
    setSessionEnabled,
  };
}
