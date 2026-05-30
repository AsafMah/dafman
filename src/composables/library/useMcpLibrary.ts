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
  const loaded = ref(false);
  const error = ref<string | null>(null);

  const knownNames = computed(() => new Set(configured.value.map((e) => e.name)));
  const newlyDiscovered = computed(() =>
    discovered.value.filter((d) => !knownNames.value.has(d.name)),
  );

  async function loadAll(): Promise<void> {
    error.value = null;
    loaded.value = false;

    try {
      const sessionsStore = useSessionsStore();
      // Pass the active session's workingDirectory (or any open
      // session's, falling back to none) so the SDK's discovery picks
      // up workspace-level `.mcp.json` files. Without this, servers
      // configured per-workspace (e.g. the github MCP a session has
      // already auto-connected to) would NOT show up in the Library
      // — the SDK's mcp.discover defaults to user-config only.
      const activeId = useLayoutStore().activeSessionId;
      const active = sessionsStore.getSession(activeId);
      const wd =
        active?.workingDirectory ||
        sessionsStore.sessions.find((s) => s.workingDirectory)?.workingDirectory ||
        '';
      // Also query the active session's live MCP list — it includes
      // servers that the SDK auto-discovered AND connected to, which
      // mcp.discover (server-scoped) may miss for plugin-supplied
      // configs that only register against a live session.
      const sessionMcpsPromise = activeId
        ? invokeCommand('listSessionMcpServers', { sessionId: activeId }).catch(
            () => [] as Array<{ name: string }>,
          )
        : Promise.resolve([] as Array<{ name: string }>);
      const [configs, disc, sessionMcps] = await Promise.all([
        invokeCommand('listMcpConfigs', {}),
        invokeCommand('discoverMcpServers', wd ? { workingDirectory: wd } : {}),
        sessionMcpsPromise,
      ]);

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
      loaded.value = true;
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
  ): Promise<boolean> {
    try {
      if (mode === 'edit') {
        await invokeCommand('updateMcpConfig', payload);
      } else {
        await invokeCommand('addMcpConfig', payload);
      }

      await loadAll();

      return true;
    } catch (err) {
      useToastStore().error('Save failed', toErrorMessage(err));

      return false;
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
    const sessionsStore = useSessionsStore();
    const session = sessionsStore.sessions[0];

    if (!session) return { state: 'no-session' };

    try {
      const result = await invokeCommand('loginToMcpServer', {
        sessionId: session.id,
        serverName: name,
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
  };
}
