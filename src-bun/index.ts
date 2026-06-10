/// <reference types="@types/bun" />

// Dafman main process — Electrobun entry.
//
// Wires up the BrowserWindow, all RPC handlers (one per former Tauri
// command), and the session-event forwarder. This is the only Bun-side
// module allowed to import from `electrobun/bun` for window + RPC
// concerns; everything below `src-bun/app/` stays framework-agnostic so
// it can be `bun test`-ed in isolation.

import { join } from 'node:path';
import { BrowserView, BrowserWindow, Updater, Utils } from 'electrobun/bun';
import { ensureClient, shutdownClient, tryGetClient } from './app/client/client';
import { browseDirectorySync } from './app/filesystem/directoryBrowser';
import { rpcGuard } from './app/shared/errors';
import { acquireSingleInstanceLock } from './app/shared/singleInstance';
import { channelWindowTitle } from './app/shared/appIdentity';
import {
  getLogDir as currentLogDir,
  getLogLevel,
  initLogger,
  log,
  recentLogs,
  setLogLevel,
  subscribeLogs,
} from './app/observability/logging';
import { exportDiagnostics } from './app/observability/diagnostics';
import { saveExportFile } from './app/config/exports';
import { initAudit, recentAudit, recordUrl, subscribeAudit } from './app/observability/audit';
import { toModelSummary } from './app/library/models';
import { SessionRegistry } from './app/chat/sessions';
import { SessionMetadataStore } from './app/chat/sessionMetadataStore';
import { McpRegistry } from './app/library/mcpRegistry';
import { SkillsRegistry } from './app/library/skillsRegistry';
import { TerminalRegistry } from './app/terminal/terminalRegistry';
import { CommandResultRegistry } from './app/chat/commandResultRegistry';
import { listInstructionSources } from './app/library/instructions';
import { SettingsService, ensureDefaultWorkspace } from './app/config/settings';
import { SnippetService } from './app/config/snippetService';
import { installStderrFilter } from './app/observability/stderrFilter';
import type {
  CommandResultEvent,
  DafmanRPC,
  SessionEventPayload,
  TerminalEventPayload,
  WebviewSendChannels,
} from './rpc';
import { toErrorMessage } from './app/shared/errorMessage';

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

await initLogger({ logDir: Utils.paths.userLogs });

// Single-instance guard. Two instances on the same build channel share one
// WebView2 user-data folder + dafman's JSON state and crash the webview.
// Acquire BEFORE touching any shared state (audit, settings, sessions, the
// window). The lock lives under the channel-scoped userData dir, so different
// channels (dev/canary/stable) still coexist — see `bun run install:canary`.
const singleInstance = acquireSingleInstanceLock(join(Utils.paths.userData, 'dafman.lock'));

if (!singleInstance.acquired) {
  const pidNote =
    singleInstance.existingPid !== undefined ? ` (pid ${singleInstance.existingPid})` : '';

  // Loud, synchronous stderr so `bun run dev` doesn't look like a silent
  // no-op; log.warn alone may never flush before we exit.
  process.stderr.write(
    `\ndafman is already running for this channel${pidNote}. Exiting this instance.\n` +
      'To run a second instance alongside it, use a different channel: `bun run install:canary`.\n\n',
  );
  log.warn('duplicate instance blocked', {
    ...(singleInstance.existingPid !== undefined
      ? { existingPid: singleInstance.existingPid }
      : {}),
  });
  process.exit(0);
}

await initAudit({ dir: join(Utils.paths.userData, 'audit') });

// Install the stderr filter *after* the logger is up (so dropped lines
// are routed to the JSON log) but *before* the SDK starts the CLI
// subprocess and relays its stderr to ours. node-pty on Windows emits a
// harmless multi-line AttachConsole stack trace from inside the CLI;
// filtering it here keeps the terminal clean while preserving the
// trace in the log file for diagnostics.
installStderrFilter();

const settingsPath = join(Utils.paths.userData, 'settings.json');
const settings = SettingsService.loadOrDefault(settingsPath);

// One-time backfill: if the user has never set a default workspace,
// auto-resolve to `<homedir>/dafman` (created on demand) and persist.
// Async/fire-and-forget so we don't block startup; the renderer reads
// `settings.workspaces.defaultWorkspace` lazily via `getSettings`.
void (async () => {
  const current = settings.get().workspaces.defaultWorkspace;

  if (current && current.length > 0) return;

  const resolved = await ensureDefaultWorkspace();

  if (!resolved) return;

  const snap = settings.get();

  await settings
    .update({
      ...snap,
      workspaces: { ...snap.workspaces, defaultWorkspace: resolved },
    })
    .catch((err: unknown) => {
      log.warn('default workspace backfill failed', {
        error: toErrorMessage(err),
      });
    });
})();

// `emitEvent` is rebound once the BrowserWindow's webview RPC is up.
// Until then events are buffered so they survive the brief gap
// between the BrowserWindow creation and the renderer's first
// `sessionEvent` listener being attached.  The buffer also covers
// HMR / dev-server reconnects where `dom-ready` fires again and we
// need to ensure the channel still points at the live `send`.
const _preWebviewEventBuffer: SessionEventPayload[] = [];
let emitEvent: (payload: SessionEventPayload) => void = (payload) => {
  log.debug('buffering session event before webview ready', {
    sessionId: payload.sessionId,
    eventType: payload.eventType,
  });
  _preWebviewEventBuffer.push(payload);
};
let emitPending: (payload: import('./rpc').PendingRequestPayload) => void = (payload) => {
  log.warn('dropped pending request before webview ready', {
    sessionId: payload.sessionId,
    kind: payload.kind,
    requestId: payload.requestId,
  });
};
let emitTerminal: (payload: TerminalEventPayload) => void = (payload) => {
  log.debug('dropped terminal event before webview ready', {
    terminalId: payload.terminalId,
    kind: payload.kind,
  });
};
let emitCommandResult: (payload: CommandResultEvent) => void = (payload) => {
  log.debug('dropped command result event before webview ready', {
    sessionId: payload.sessionId,
    commandId: payload.commandId,
    kind: payload.kind,
  });
};
const sessionMetadataStore = SessionMetadataStore.loadOrDefault(
  join(Utils.paths.userData, 'session-metadata.json'),
);
const snippetService = SnippetService.loadOrDefault(join(Utils.paths.userData, 'snippets.json'));
const sessions = new SessionRegistry(
  (payload) => emitEvent(payload),
  (payload) => emitPending(payload),
  () => settings.get().appearance.streaming,
  () => settings.get().tools.defaultExcluded,
  () => settings.get().tools.defaultAllowed,
  sessionMetadataStore,
);
const mcp = new McpRegistry();
const skills = new SkillsRegistry();
const terminals = new TerminalRegistry((payload) => emitTerminal(payload));
const commandResults = new CommandResultRegistry(
  join(Utils.paths.userData, 'command-results.json'),
  (payload) => emitCommandResult(payload),
);

const rpc = BrowserView.defineRPC<DafmanRPC>({
  maxRequestTime: 120000,
  handlers: {
    requests: {
      createClient: rpcGuard(async () => {
        await ensureClient();

        return 'Copilot client created';
      }),
      createSession: rpcGuard(async ({ workingDirectory, model, reasoningEffort }) => {
        // Pre-fetch globally-configured MCP servers and pass them to the new
        // session. `enableConfigDiscovery` handles workspace-level .mcp.json
        // files but does NOT re-read servers added to the CLI global config
        // after the CLI started — passing them explicitly here ensures every
        // new session sees all user-configured servers immediately, so
        // `session.mcp.oauth.login` never throws "MCP server does not exist".
        const mcpServers = await mcp.listConfigs().catch(() => ({}));

        return sessions.create({
          ...(workingDirectory ? { workingDirectory } : {}),
          ...(model ? { model } : {}),
          ...(reasoningEffort ? { reasoningEffort } : {}),
          ...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
        });
      }),
      pickFolder: rpcGuard(async ({ startingFolder }) => {
        const paths = await Utils.openFileDialog({
          canChooseFiles: false,
          canChooseDirectory: true,
          allowsMultipleSelection: false,
          ...(startingFolder ? { startingFolder } : {}),
        });
        // `openFileDialog` returns `[""]` on cancel (the FFI
        // hands back an empty comma-separated string). Treat
        // any empty / whitespace-only entry as a cancel.
        const first = paths[0]?.trim();

        if (!first || first.length === 0) return null;

        // Force absolute (see pickAttachment above for why).
        const { resolve, isAbsolute } = await import('node:path');

        return isAbsolute(first) ? first : resolve(first);
      }),
      pickAttachment: rpcGuard(async ({ kind, startingFolder }) => {
        // Windows native dialogs are file-only OR folder-only,
        // never both. Honor the kind the renderer asked for.
        const paths = await Utils.openFileDialog({
          canChooseFiles: kind === 'file',
          canChooseDirectory: kind === 'directory',
          allowsMultipleSelection: false,
          ...(startingFolder ? { startingFolder } : {}),
        });
        const first = paths[0]?.trim();

        if (!first) return null;

        // CRITICAL: Electrobun's `openFileDialog` can return a
        // path relative to the *bun process cwd* (the exe's
        // `bin/` folder in prod), producing pills like
        // `../Resources/version.json`. Force an absolute path.
        // `node:path.resolve` is a no-op on already-absolute
        // input, so it's safe regardless.
        const { resolve, isAbsolute } = await import('node:path');
        const abs = isAbsolute(first) ? first : resolve(first);

        return { path: abs, kind };
      }),
      disconnectSession: rpcGuard(async ({ sessionId }) => sessions.disconnect(sessionId)),
      sendMessage: rpcGuard(async ({ sessionId, text, mode, agentMode, attachments }) =>
        sessions.send(sessionId, text, mode, attachments, agentMode),
      ),
      searchWorkspaceFiles: rpcGuard(
        async ({ sessionId, query, limit, includeHidden, includeIgnored }) =>
          sessions.searchWorkspaceFiles(sessionId, query, limit ?? 40, {
            includeHidden: includeHidden ?? false,
            includeIgnored: includeIgnored ?? false,
          }),
      ),
      abortSession: rpcGuard(async ({ sessionId }) => sessions.abort(sessionId)),
      listModels: rpcGuard(async () => {
        const client = tryGetClient();
        const models = await client.listModels();

        return models.map(toModelSummary);
      }),
      setSessionModel: rpcGuard(async ({ sessionId, model, reasoningEffort }) =>
        sessions.setModel(sessionId, model, reasoningEffort),
      ),
      resumeSession: rpcGuard(async ({ sessionId, model, reasoningEffort }) => {
        // Same rationale as createSession: pass global MCP servers so the
        // resumed session has the full list and oauth.login doesn't fail.
        const mcpServers = await mcp.listConfigs().catch(() => ({}));
        const actualId = await sessions.resume(sessionId, {
          ...(model ? { model } : {}),
          ...(reasoningEffort ? { reasoningEffort } : {}),
          ...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
        });
        // Authoritative cwd via SessionRegistry.getCwd — reads
        // entry first, then getSessionMetadata, then catalog.
        // Returns undefined (not process.cwd()) if nothing
        // has a real cwd, so the renderer doesn't silently
        // display the exe folder as the workspace.
        const cwd = (await sessions.getCwd(actualId)) ?? null;
        const currentModel = await sessions.getCurrentModel(actualId).catch(() => null);
        // Hand back the dafman-persisted per-session state that
        // `resume()` just re-applied, so the renderer's SessionRecord
        // shows the restored "Allow all" + run mode without a separate
        // round-trip. `getMode` reads the (now-restored) live SDK mode;
        // `getApproveAll` reads our in-memory mirror.
        const mode = await sessions.getMode(actualId).catch(() => 'interactive' as const);
        const approveAll = sessions.getApproveAll(actualId);

        return { sessionId: actualId, cwd, model: currentModel, approveAll, mode };
      }),
      listSessions: rpcGuard(async () => sessions.list()),
      deleteSession: rpcGuard(async ({ sessionId }) => sessions.deleteCliSession(sessionId)),
      getSessionMode: rpcGuard(async ({ sessionId }) => sessions.getMode(sessionId)),
      setSessionMode: rpcGuard(async ({ sessionId, mode }) => sessions.setMode(sessionId, mode)),
      getSessionName: rpcGuard(async ({ sessionId }) => sessions.getName(sessionId)),
      setSessionName: rpcGuard(async ({ sessionId, name }) => sessions.setName(sessionId, name)),
      setSessionWorkingDirectory: rpcGuard(
        async ({ sessionId, workingDirectory, baseWorkingDirectory }) =>
          sessions.setWorkingDirectory(sessionId, workingDirectory, baseWorkingDirectory),
      ),
      compactSessionHistory: rpcGuard(async ({ sessionId }) => sessions.compactHistory(sessionId)),
      truncateSessionHistory: rpcGuard(async ({ sessionId, eventId }) =>
        sessions.truncateHistory(sessionId, eventId),
      ),
      forkSession: rpcGuard(async ({ sessionId, toEventId }) =>
        sessions.fork(sessionId, toEventId),
      ),
      setSessionApproveAll: rpcGuard(async ({ sessionId, enabled }) =>
        sessions.setApproveAll(sessionId, enabled),
      ),
      resetSessionApprovals: rpcGuard(async ({ sessionId }) => sessions.resetApprovals(sessionId)),
      listSessionSkills: rpcGuard(async ({ sessionId }) => sessions.listSkills(sessionId)),
      setSessionSkillEnabled: rpcGuard(async ({ sessionId, name, enabled }) =>
        sessions.setSkillEnabled(sessionId, name, enabled),
      ),
      listAgents: rpcGuard(async ({ sessionId }) => sessions.listAgents(sessionId)),
      getCurrentAgent: rpcGuard(async ({ sessionId }) => sessions.getCurrentAgent(sessionId)),
      selectAgent: rpcGuard(async ({ sessionId, name }) => sessions.selectAgent(sessionId, name)),
      deselectAgent: rpcGuard(async ({ sessionId }) => sessions.deselectAgent(sessionId)),
      reloadAgents: rpcGuard(async ({ sessionId }) => sessions.reloadAgents(sessionId)),
      listTasks: rpcGuard(async ({ sessionId }) => sessions.listTasks(sessionId)),
      cancelTask: rpcGuard(async ({ sessionId, id }) => sessions.cancelTask(sessionId, id)),
      removeTask: rpcGuard(async ({ sessionId, id }) => sessions.removeTask(sessionId, id)),
      promoteTask: rpcGuard(async ({ sessionId, id }) => sessions.promoteTask(sessionId, id)),
      listJobs: rpcGuard(async () => sessions.listJobs()),
      listAgentFiles: rpcGuard(async ({ sessionId, reloadSdk }) =>
        sessions.listAgentFiles(sessionId, reloadSdk === undefined ? {} : { reloadSdk }),
      ),
      listAgentFilesGlobal: rpcGuard(async () => sessions.listAgentFilesGlobal()),
      writeAgentFile: rpcGuard(async ({ sessionId, spec, allowOverwrite, preservedTail }) =>
        sessions.writeAgentFile(sessionId, spec, { allowOverwrite, preservedTail }),
      ),
      readAgentFile: rpcGuard(async ({ sessionId, scope, name }) =>
        sessions.readAgentFile(sessionId, scope, name),
      ),
      deleteAgentFile: rpcGuard(async ({ sessionId, scope, name }) =>
        sessions.deleteAgentFile(sessionId, scope, name),
      ),
      startFleet: rpcGuard(async ({ sessionId, prompt }) => sessions.startFleet(sessionId, prompt)),
      getSessionUsageMetrics: rpcGuard(async ({ sessionId }) =>
        sessions.getUsageMetrics(sessionId),
      ),
      listBuiltinTools: rpcGuard(async () => sessions.listBuiltinTools()),
      listSessionMcpServers: rpcGuard(async ({ sessionId }) =>
        sessions.listSessionMcpServers(sessionId),
      ),
      setSessionMcpEnabled: rpcGuard(async ({ sessionId, serverName, enabled }) =>
        sessions.setSessionMcpEnabled(sessionId, serverName, enabled),
      ),
      reloadSessionMcpServers: rpcGuard(async ({ sessionId }) => {
        await sessions.reloadSessionMcpServers(sessionId);
        return true;
      }),
      getAccountQuota: rpcGuard(async () => sessions.getAccountQuota()),
      readSessionPlan: rpcGuard(async ({ sessionId }) => sessions.readPlan(sessionId)),
      writeSessionPlan: rpcGuard(async ({ sessionId, content }) =>
        sessions.writePlan(sessionId, content),
      ),
      deleteSessionPlan: rpcGuard(async ({ sessionId }) => sessions.deletePlan(sessionId)),
      listMcpConfigs: rpcGuard(async () => mcp.listConfigs()),
      addMcpConfig: rpcGuard(async ({ name, config }) => mcp.addConfig(name, config)),
      updateMcpConfig: rpcGuard(async ({ name, config }) => mcp.updateConfig(name, config)),
      removeMcpConfig: rpcGuard(async ({ name }) => mcp.removeConfig(name)),
      enableMcpServers: rpcGuard(async ({ names }) => mcp.enable(names)),
      disableMcpServers: rpcGuard(async ({ names }) => mcp.disable(names)),
      discoverMcpServers: rpcGuard(async ({ workingDirectory }) => mcp.discover(workingDirectory)),
      loginToMcpServer: rpcGuard(async ({ sessionId, serverName, forceReauth, clientName }) =>
        sessions.loginToMcpServer(sessionId, serverName, {
          ...(forceReauth !== undefined ? { forceReauth } : {}),
          ...(clientName !== undefined ? { clientName } : {}),
        }),
      ),
      discoverSkills: rpcGuard(async ({ workingDirectory }) => skills.discover(workingDirectory)),
      setGloballyDisabledSkills: rpcGuard(async ({ disabledSkills }) =>
        skills.setGloballyDisabled(disabledSkills),
      ),
      listInstructionSources: rpcGuard(async ({ workingDirectory }) =>
        listInstructionSources({ workingDirectory }),
      ),
      createTerminal: rpcGuard(async (params) => terminals.create(params)),
      writeTerminal: rpcGuard(async ({ terminalId, data }) => terminals.write(terminalId, data)),
      resizeTerminal: rpcGuard(async ({ terminalId, cols, rows }) =>
        terminals.resize(terminalId, cols, rows),
      ),
      killTerminal: rpcGuard(async ({ terminalId }) => terminals.kill(terminalId)),
      listTerminals: rpcGuard(async () => terminals.list()),
      startSessionCommand: rpcGuard(async ({ sessionId, command }) => {
        const cwd = (await sessions.getCwd(sessionId)) ?? process.cwd();

        return commandResults.start({ sessionId, command, cwd });
      }),
      cancelSessionCommand: rpcGuard(async ({ sessionId, commandId }) =>
        commandResults.cancel(sessionId, commandId),
      ),
      listCommandResults: rpcGuard(async ({ sessionId }) => commandResults.list(sessionId)),
      getSettings: rpcGuard(async () => settings.get()),
      updateSettings: rpcGuard(async ({ next }) => settings.update(next)),
      getAppInfo: rpcGuard(async () => {
        const info = await Updater.getLocalInfo();

        return { channel: info.channel, version: info.version };
      }),
      getLogDir: rpcGuard(async () => currentLogDir()),
      openLogFolder: rpcGuard(async () => {
        const dir = currentLogDir();

        if (!dir) return false;

        Utils.showItemInFolder(dir);

        return true;
      }),
      revealPath: rpcGuard(async ({ path }) => {
        const trimmed = path.trim();

        if (!trimmed) return false;

        try {
          const { stat } = await import('node:fs/promises');
          let isDir = false;

          try {
            const st = await stat(trimmed);

            isDir = st.isDirectory();
          } catch {
            // Path missing — let the OS show whatever default
            // it does for an absent path (usually a benign error
            // dialog). We log and continue rather than silently
            // no-op'ing.
          }

          if (process.platform === 'win32') {
            const { spawn } = await import('node:child_process');

            if (isDir) {
              // Folder → open it in Explorer.
              spawn('explorer.exe', [trimmed], { detached: true, stdio: 'ignore' }).unref();
            } else {
              // File → reveal in Explorer with the file
              // highlighted. Uses `explorer /select,"path"`
              // which opens the containing folder and selects
              // the file — the expected "reveal" behavior for
              // exports and diagnostics.
              spawn('explorer.exe', [`/select,${trimmed}`], {
                detached: true,
                stdio: 'ignore',
              }).unref();
            }

            return true;
          }

          // macOS / Linux: openExternal delegates to the OS
          // (open / xdg-open), which opens both files and folders
          // with their default handler — exactly the behaviour
          // we want.
          Utils.openExternal(trimmed);

          return true;
        } catch (err) {
          log.warn('revealPath failed', {
            path: trimmed,
            error: toErrorMessage(err),
          });

          return false;
        }
      }),
      openUrl: rpcGuard(async ({ url }) => {
        const trimmed = url.trim();

        // Strict scheme allowlist. The handler is reachable by the
        // renderer + any compromised renderer should not be able to
        // shell out to arbitrary URI handlers (file:, javascript:,
        // custom protocol handlers like ms-windows-store:, etc.).
        if (!/^https?:\/\//i.test(trimmed)) {
          log.warn('openUrl rejected non-http scheme', { url: trimmed });
          void recordUrl({ url: trimmed, allowed: false, reason: 'scheme-blocked' });

          return false;
        }

        try {
          const opened = Utils.openExternal(trimmed);

          void recordUrl({
            url: trimmed,
            allowed: opened,
            reason: opened ? 'ok' : 'openExternal-returned-false',
          });

          return opened;
        } catch (err) {
          log.warn('openUrl threw', {
            url: trimmed,
            error: toErrorMessage(err),
          });
          void recordUrl({
            url: trimmed,
            allowed: false,
            reason: `openExternal-threw: ${toErrorMessage(err)}`,
          });

          return false;
        }
      }),
      respondToRequest: rpcGuard(async (params) => sessions.respondToRequest(params)),
      browseDirectory: rpcGuard(async ({ prefix }) => browseDirectorySync(prefix)),
      rendererLog: rpcGuard(async ({ level, message, extra }) => {
        // Mirror the renderer's structured log into the bun-side
        // JSON log so a developer can `tail` it instead of needing
        // WebView2 devtools open. Prefix lets us distinguish from
        // bun-originated entries.
        const tagged = `[renderer] ${message}`;
        const data = extra ?? {};

        switch (level) {
          case 'debug':
            log.debug(tagged, data);
            break;
          case 'info':
            log.info(tagged, data);
            break;
          case 'warn':
            log.warn(tagged, data);
            break;
          case 'error':
            log.error(tagged, data);
            break;
        }

        return undefined;
      }),
      getLogState: rpcGuard(async ({ recentLimit }) => ({
        level: getLogLevel(),
        recent: recentLogs(recentLimit),
      })),
      setLogLevel: rpcGuard(async ({ level }) => setLogLevel(level)),
      exportDiagnostics: rpcGuard(async () => {
        return exportDiagnostics({
          outputRoot: Utils.paths.userData,
          settings: settings.get(),
        });
      }),
      saveExportFile: rpcGuard(async ({ fileName, contents }) => {
        return saveExportFile({
          outputRoot: Utils.paths.userData,
          fileName,
          contents,
        });
      }),
      getAuditState: rpcGuard(async ({ recentLimit }) => ({
        recent: recentAudit(recentLimit),
      })),
      searchSessionTranscripts: rpcGuard(async ({ query, options }) =>
        sessions.searchTranscripts(query, options),
      ),
      listSnippets: rpcGuard(async () => snippetService.list()),
      saveSnippet: rpcGuard(async ({ snippet }) => snippetService.save(snippet)),
      deleteSnippet: rpcGuard(async ({ id }) => snippetService.delete(id)),
    },
    messages: {},
  },
});

async function getMainViewUrl(): Promise<string> {
  const channel = await Updater.localInfo.channel();
  // Allow `DAFMAN_PLAYGROUND=1` (dev only) to land directly on the
  // playground without manual URL editing. Handy when iterating on the
  // composer / Lexical bits without a real Copilot session.
  const playground = channel === 'dev' && process.env.DAFMAN_PLAYGROUND === '1';
  // Allow `DAFMAN_AUTO_SESSION=1` (dev only) to land on the main app
  // with a session auto-created on mount. Useful for the typing
  // diagnostic, which needs a mounted MessageComposer to fire.
  const autosession = channel === 'dev' && process.env.DAFMAN_AUTO_SESSION === '1';
  const suffix = playground ? '?dev' : autosession ? '?autosession=1' : '';

  if (channel === 'dev') {
    try {
      await fetch(DEV_SERVER_URL, { method: 'HEAD' });
      log.info(`HMR enabled: using Vite dev server at ${DEV_SERVER_URL}`);

      return `${DEV_SERVER_URL}/${suffix}`;
    } catch {
      log.info('Vite dev server not running. Run `bun run dev:hmr` for HMR.');
    }
  }

  return `views://mainview/index.html${suffix}`;
}

const url = await getMainViewUrl();

// Suffix the OS window title with the release channel for any non-stable
// build (`dafman — canary`) so a dev/canary instance running side-by-side
// with a stable one is unmistakable. Stable keeps the bare title.
const { channel: appChannel } = await Updater.getLocalInfo();
const windowTitle = channelWindowTitle(appChannel);

const mainWindow = new BrowserWindow({
  title: windowTitle,
  url,
  rpc,
  frame: { width: 1200, height: 800, x: 100, y: 100 },
});
// ─── Webview navigation guard ─────────────────────────────────────────────────
//
// The renderer must never load external URLs inside the webview process; doing
// so would give remote content full access to the Electrobun RPC bridge.
//
// Two-layer defence:
//   1. `setNavigationRules` — native, synchronous: only same-origin navigations
//      are allowed in the webview. All others are blocked before they load.
//   2. `will-navigate` / `new-window-open` listeners — detect blocked attempts
//      and route http(s) URLs to the external OS browser (same logic as the
//      `openUrl` RPC handler), logging every interception for audit.
//
// NOTE: `setNavigationRules` passes an array of allowed URL prefixes to the
// Electrobun native side. The exact format is determined by the C++ WebView2
// implementation and needs a live-boot smoke test (the format is not documented
// in the TypeScript API). If navigations are blocked more aggressively than
// expected (e.g. HMR reloads blocked in dev), widen the rules array to include
// additional allowed prefixes.

// Derive the app origin so any same-origin path is still allowed.
// `url` is already resolved: "http://localhost:5173/…" (dev) or
// "views://mainview/index.html" (prod).
const appOrigin = (() => {
  try {
    return new URL(url).origin; // "http://localhost:5173" | "views://mainview"
  } catch {
    return url; // malformed — use as-is (should never happen)
  }
})();

// Layer 1: native block — restrict the webview to the app origin only.
mainWindow.webview.setNavigationRules([appOrigin]);

// Layer 2: event listeners — intercept attempts and route http(s) externally.

// Helper: open an external http(s) URL via the OS browser.
// Mirrors the `openUrl` RPC handler's logic (recordUrl omitted here since
// the webview nav interception is a different audit path).
function openExternalUrl(targetUrl: string, source: string): void {
  if (/^https?:\/\//i.test(targetUrl)) {
    log.info('webview navigation intercepted, opening externally', {
      url: targetUrl,
      source,
    });
    try {
      Utils.openExternal(targetUrl);
    } catch (err) {
      log.warn('openExternal threw during webview navigation intercept', {
        url: targetUrl,
        source,
        error: toErrorMessage(err),
      });
    }
  } else {
    log.warn('webview navigation blocked: non-http(s) scheme', {
      url: targetUrl,
      source,
    });
  }
}

// `will-navigate` / `new-window-open` payloads: the native side delivers
// `detail` as a JSON-encoded object (e.g. `{"url":"…","allowed":true}` for
// will-navigate, `{"url":"…","isCmdClick":…}` for new-window-open) — NOT a
// bare URL string. Extract the URL robustly from either shape.
function extractNavTarget(detail: unknown): { url: string; allowed?: boolean } | null {
  let value: unknown = detail;
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return null;
    if (s.startsWith('{')) {
      try {
        value = JSON.parse(s) as unknown;
      } catch {
        return { url: s }; // not JSON — the string itself is the URL
      }
    } else {
      return { url: s };
    }
  }
  if (value && typeof value === 'object' && 'url' in value) {
    const obj = value as { url: unknown; allowed?: unknown };
    if (typeof obj.url === 'string' && obj.url.trim()) {
      return {
        url: obj.url.trim(),
        allowed: typeof obj.allowed === 'boolean' ? obj.allowed : undefined,
      };
    }
  }
  return null;
}

// Route any non-same-origin navigation/window-open to the OS browser.
function handleNavAttempt(detail: unknown, source: string): void {
  const target = extractNavTarget(detail);
  if (!target) return;
  if (target.url.startsWith(appOrigin)) return; // same-origin — allow it
  // If the native side flagged it `allowed` (setNavigationRules did NOT block
  // it in-webview), warn — the in-webview load may proceed and the rule format
  // needs revisiting.
  if (target.allowed === true) {
    log.warn('webview: external navigation was NOT blocked natively', {
      url: target.url,
      source,
    });
  }
  openExternalUrl(target.url, source);
}

mainWindow.webview.on('will-navigate', (event: unknown) => {
  handleNavAttempt((event as { data?: { detail?: unknown } })?.data?.detail, 'will-navigate');
});

// `new-window-open` (target=_blank / window.open / cmd+click) — BrowserView.on()
// doesn't type this event, but it dispatches through the same emitter; cast to
// subscribe at runtime.
(mainWindow.webview.on as (name: string, handler: (event: unknown) => void) => void)(
  'new-window-open',
  (event: unknown) => {
    handleNavAttempt((event as { data?: { detail?: unknown } })?.data?.detail, 'new-window-open');
  },
);

// ─────────────────────────────────────────────────────────────────────────────

/// Initial-paint clipping workaround for the Electrobun BrowserWindow on
/// Windows: the WebView2 surface is created at the *outer* window size,
/// so the renderer reports a viewport ~16px wider/taller than the visible
/// client area until the OS sends its first WM_SIZE. Any manual resize
/// fixes it permanently. We force one by nudging the frame by 1px and
/// snapping it back.
///
/// We schedule the nudge multiple times because heavier renderer init
/// (e.g. Lexical mounting many editors) can delay the renderer's first
/// real layout past a single 100ms tick. Each nudge is a cheap pair of
/// `setFrame` calls; once one of them lands after the renderer has
/// painted, the clip is gone.
function nudgeWindow(): void {
  const { x, y, width, height } = mainWindow.getFrame();

  mainWindow.setFrame(x, y, width + 1, height + 1);
  setTimeout(() => {
    mainWindow.setFrame(x, y, width, height);
  }, 16);
}

mainWindow.webview.on('dom-ready', () => {
  // #172: rebind emit channels on every renderer navigation so HMR
  // reloads and dev-server reconnects see the live send, not a stale
  // closure from a prior page load. bindEmitChannels is safe to call
  // here because `send` is already resolved at this point.
  bindEmitChannels();
  for (const delay of [0, 150, 400, 900]) {
    setTimeout(nudgeWindow, delay);
  }
});

// Belt-and-suspenders fallback in case `dom-ready` is missed (HMR reloads,
// dev-server reconnects, etc.). Cheap no-ops if the renderer is already
// laid out.
for (const delay of [200, 600, 1500]) {
  setTimeout(nudgeWindow, delay);
}

// Electrobun doesn't surface `webview.rpc.send` typed to the webview
// message schema, so this is the one place we cast — to the schema-derived
// `WebviewSendChannels`. Every call below is then compiler-checked against
// `DafmanRPC['webview']['messages']`; a renamed channel fails to build.
const send = (mainWindow.webview.rpc as unknown as { send: WebviewSendChannels }).send;

// Bind emitEvent to the live send channel and drain any events that
// were buffered before the window was created (belt-and-suspenders;
// in practice the queue is empty on cold boot, but covers the HMR /
// reconnect path where dom-ready fires after a page reload).
function bindEmitChannels(): void {
  emitEvent = (payload) => send.sessionEvent(payload);
  emitPending = (payload) => send.pendingRequest(payload);
  emitTerminal = (payload) => send.terminalEvent(payload);
  emitCommandResult = (payload) => send.commandResultEvent(payload);
  // Drain any events that accumulated while the webview was loading.
  for (const buffered of _preWebviewEventBuffer.splice(0)) {
    try {
      send.sessionEvent(buffered);
    } catch (err) {
      log.warn('failed to drain pre-webview event buffer', {
        sessionId: buffered.sessionId,
        eventType: buffered.eventType,
        error: toErrorMessage(err),
      });
    }
  }
}

bindEmitChannels();

// Live log fan-out to the renderer. The in-app log viewer subscribes
// via the `logEvent` webview message and applies its own level filter
// so users can flip verbosity without losing history.
subscribeLogs((record) => send.logEvent(record));

// Live audit fan-out — same fire-and-forget pattern as logs.
subscribeAudit((entry) => send.auditEvent(entry));

log.info('dafman started', { version: '0.1.0' });

// S1: bounded shutdown on either SIGINT (Ctrl+C / docker stop) or
// SIGTERM (window-close in Electrobun on most platforms). Both invoke
// `sessions.shutdownAll()` which races each `session.disconnect()`
// against a 2s timeout per session, so a hung SDK can't deadlock app
// exit.
const handleShutdownSignal = async (signal: string): Promise<void> => {
  log.info('shutdown signal received', { signal });

  try {
    await sessions.shutdownAll();
  } catch (err) {
    log.warn('sessions.shutdownAll threw during signal handler', {
      signal,
      error: toErrorMessage(err),
    });
  }

  try {
    terminals.shutdownAll();
  } catch (err) {
    log.warn('terminals.shutdownAll threw during signal handler', {
      signal,
      error: toErrorMessage(err),
    });
  }

  try {
    commandResults.shutdownAll();
  } catch (err) {
    log.warn('commandResults.shutdownAll threw during signal handler', {
      signal,
      error: toErrorMessage(err),
    });
  }

  try {
    await shutdownClient();
  } catch (err) {
    log.warn('shutdownClient threw during signal handler', {
      signal,
      error: toErrorMessage(err),
    });
  }

  // Release the single-instance lock last, after all shared state is torn
  // down, so a relaunch can't start while we're still touching it.
  singleInstance.release();

  process.exit(0);
};

process.on('SIGINT', () => void handleShutdownSignal('SIGINT'));
process.on('SIGTERM', () => void handleShutdownSignal('SIGTERM'));
// Final safety net for exit paths that bypass the signal handler.
process.on('exit', () => singleInstance.release());
