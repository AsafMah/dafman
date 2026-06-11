// Shared wire-contract types for the Electrobun IPC bridge.
//
// RULES: no imports from `electrobun/bun`, Vue, Pinia, or any Bun-only
// module. No `@/*` aliases (must resolve under both tsconfig.json and
// tsconfig.bun.json). Only `type` / `interface` / type-alias exports —
// zero runtime code.
//
// Both sides import from here:
//   Bun:      `../src/shared/wireTypes` (relative)
//   Renderer: `@/shared/wireTypes` or via the `@/ipc/types` barrel

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export type ThemeChoice = 'system' | 'light' | 'dark';
export type ReasoningVisibility = 'hidden' | 'compact' | 'expanded';

/// Agent run mode. "interactive" prompts for permission per action;
/// "plan" stays in read-only planning mode; "autopilot" runs unattended.
export type SessionMode = 'interactive' | 'plan' | 'autopilot';

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

/// Scope union for keyboard shortcuts. Canonical copy is
/// `src/lib/shortcuts/types.ts`; kept here so Bun-side settings coercion
/// can validate on write without importing the renderer path.
export type ShortcutScope =
  | 'global'
  | 'commandPalette'
  | 'composer'
  | 'composerTypeahead'
  | 'terminal'
  | 'filePicker'
  | 'messageEditor'
  | 'pendingRequest'
  | 'composerCommandTerminal'
  | 'dockviewTabRename'
  | 'accessibility';

/// User-persisted keyboard-shortcut preferences. Stores only deltas from
/// the built-in default keymap — custom bindings added by the user and
/// default bindings the user has disabled. Canonical copy also at
/// `src/lib/shortcuts/types.ts:KeyboardShortcutPrefs`.
export interface KeyboardShortcutPrefs {
  customBindings: Array<{ commandId: string; scope: ShortcutScope; keys: string }>;
  disabledDefaultBindingIds: string[];
}

// ---------------------------------------------------------------------------
// App identity
// ---------------------------------------------------------------------------

/// Build-time identity of the running app. Sourced from the bundled
/// `Resources/version.json` via Electrobun's `Updater.getLocalInfo()`.
/// `channel` is the release channel (`dev` / `canary` / `stable`).
export interface AppInfo {
  channel: string;
  version: string;
}

// ---------------------------------------------------------------------------
// Settings hierarchy
// ---------------------------------------------------------------------------

export interface ToolsPrefs {
  /// Tool names excluded by default for new sessions.
  defaultExcluded: string[];
  /// 22b: allowlist applied at session create. Empty = no restriction.
  defaultAllowed: string[];
}

export interface PermissionsPrefs {
  /// 22c: when true, new sessions start with approve-all on.
  defaultApproveAll: boolean;
}

export interface TerminalAddonPrefs {
  search: boolean;
  webLinks: boolean;
  clipboard: boolean;
  unicode11: boolean;
  webFonts: boolean;
  progress: boolean;
  ligatures: boolean;
  image: boolean;
  unicodeGraphemes: boolean;
  webgl: boolean;
  serialize: boolean;
}

export interface TerminalPrefs {
  defaultProfileId: string;
  fontFamily: string;
  fontSize: number;
  scrollback: number;
  theme: {
    background: string;
    foreground: string;
  };
  addons: TerminalAddonPrefs;
}

export interface NotificationPrefs {
  /// Fire an OS notification at turn end when the session isn't the active
  /// panel. Off by default — turn-end notifications are noisier than
  /// waiting-for-input.
  turnEnd: boolean;
  /// Fire an OS notification when the SDK is awaiting user input (permission /
  /// user_input / elicitation) and the session isn't the active panel.
  waitingForInput: boolean;
}

export interface GroupMeta {
  id: string;
  name: string;
  /// Hex color for the tab's color dot.
  color: string;
}

export interface Layout {
  /// Serialized outer dockview state. Renamed from v2's `dockview` field.
  outer?: unknown;
  groups?: GroupMeta[];
  activeGroupId?: string;
  innerBodies?: Record<string, unknown>;
  schemaVersion?: number;
  /// Legacy v2 field retained ONLY for hydration of pre-v3 layouts.
  dockview?: unknown;
}

export interface Workspaces {
  recent: string[];
  /// Default workspace for new sessions. Empty when home-dir resolution
  /// failed at startup.
  defaultWorkspace: string;
}

export interface Appearance {
  theme: ThemeChoice;
  reasoningVisibility: ReasoningVisibility;
  /// Default model id for newly-created sessions. Empty means SDK default.
  defaultModelId: string;
  /// Default reasoning effort. Null means use the model's default.
  defaultReasoningEffort: string | null;
  /// Whether the SDK streams `assistant.message_delta` events. `false`
  /// renders only the final `assistant.message` per turn. Takes effect on
  /// the NEXT session created.
  streaming: boolean;
  /// Lazy-load mermaid and render ```mermaid``` fences as diagrams.
  enableMermaid: boolean;
}

export interface Settings {
  version: number;
  appearance: Appearance;
  layout: Layout;
  workspaces: Workspaces;
  notifications: NotificationPrefs;
  tools: ToolsPrefs;
  permissions: PermissionsPrefs;
  terminal: TerminalPrefs;
  keyboardShortcuts: KeyboardShortcutPrefs;
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

export interface SessionHistoryCompactionResult {
  success: boolean;
  tokensFreed: number | null;
  messagesRemoved: number | null;
}

export interface ModelSummary {
  id: string;
  name: string;
  supportsReasoningEffort: boolean;
  supportedReasoningEfforts: string[];
  defaultReasoningEffort: string | null;
}

/// Summary of a CLI-side session. Dates are ISO 8601 strings — the SDK
/// hands us `Date` objects but the RPC bridge loses the type tag.
export interface SessionMetadataSummary {
  sessionId: string;
  startTime: string;
  modifiedTime: string;
  summary?: string;
  isRemote: boolean;
  cwd?: string;
  repository?: string;
  branch?: string;
}

// ---------------------------------------------------------------------------
// Transcript search (Phase 1 — open sessions)
// ---------------------------------------------------------------------------

/// One matching message within a session transcript. `eventIndex` is the
/// ordinal of the matched event within `session.getEvents()` — used as a
/// scroll anchor by `requestReveal`.
export interface TranscriptMatch {
  /// Ordinal index of the event within getEvents() result — used as a
  /// scroll anchor by the frontend (requestReveal extension).
  eventIndex: number;
  /// 'user' | 'assistant' | 'system' — derived from eventType prefix.
  role: 'user' | 'assistant' | 'system';
  /// Up to 300 chars of surrounding context with the match highlighted
  /// via <<match>> delimiters (simple to parse on the frontend).
  snippet: string;
  timestamp?: string;
}

/// Grouped search results for one session.
export interface TranscriptSearchResult {
  sessionId: string;
  sessionSummary: string | undefined;
  matches: TranscriptMatch[];
}

// ---------------------------------------------------------------------------
// Agents & tasks
// ---------------------------------------------------------------------------

/// Mirror of `@github/copilot/schemas/api.schema.json#AgentInfo`. `path` is
/// set for file-based agents; we derive "Project" vs "User" source label
/// by checking whether it's under the session's `.github/agents/` subtree.
export interface AgentInfo {
  name: string;
  displayName: string;
  description: string;
  path?: string;
}

export type TaskStatus = 'running' | 'idle' | 'completed' | 'failed' | 'cancelled';

interface BaseTaskInfo {
  id: string;
  type: 'agent' | 'shell';
  description: string;
  status: TaskStatus;
  startedAt?: string;
  completedAt?: string;
  activeTimeMs?: number;
  error?: string;
  executionMode?: 'sync' | 'background';
  canPromoteToBackground?: boolean;
}

export type TaskInfo = TaskAgentInfo | TaskShellInfo;

export interface TaskAgentInfo extends BaseTaskInfo {
  type: 'agent';
  agentType: string;
  toolCallId?: string;
  agentName?: string;
  agentDisplayName?: string;
  prompt?: string;
  result?: string;
  model?: string;
  latestResponse?: string;
  idleSince?: string;
}

export interface TaskShellInfo extends BaseTaskInfo {
  type: 'shell';
  command: string;
  attachmentMode?: 'pty' | 'detached';
  logPath?: string;
  pid?: number;
}

export interface JobRecord {
  id: string;
  sessionId: string;
  source: 'sdk-task' | 'fleet' | 'autopilot-session';
  kind: 'agent' | 'shell' | 'fleet' | 'autopilot';
  status: 'starting' | TaskStatus;
  title: string;
  description: string;
  startedAt?: string;
  completedAt?: string;
  activeTimeMs?: number;
  agentType?: string;
  agentName?: string;
  agentDisplayName?: string;
  model?: string;
  prompt?: string;
  latestResponse?: string;
  result?: string;
  error?: string;
  toolCallId?: string;
  command?: string;
  logPath?: string;
  pid?: number;
  executionMode?: 'sync' | 'background';
  canCancel: boolean;
  canRemove: boolean;
  canPromoteToBackground: boolean;
  canOpenSession: boolean;
}

// ---------------------------------------------------------------------------
// Agent files (Library tab)
// ---------------------------------------------------------------------------

/// 19b.2: scope discriminator for filesystem-backed agent CRUD.
export type AgentFileScope = 'user' | 'project';

/// 19b.2: discovered agent file. Distinct from `AgentInfo` which only
/// sees SDK-loaded agents.
export interface AgentFileEntry {
  scope: AgentFileScope;
  name: string;
  path: string;
  canonical: boolean;
  loadStatus: 'loaded' | 'rejected' | 'unknown';
  loadMessage?: string;
  loadWarnings?: string[];
}

/// 19b.2: renderer-supplied spec for `writeAgentFile`.
export interface AgentFileSpec {
  scope: AgentFileScope;
  name: string;
  displayName?: string;
  description: string;
  tools?: string[];
  skills?: string[];
  model?: string;
  userInvocable?: boolean;
  prompt: string;
}

// ---------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------

export type InstructionScope = 'global' | 'project';

export interface InstructionSource {
  name: string;
  scope: InstructionScope;
  path: string;
  relativePath: string;
  exists: boolean;
  content: string | null;
  sizeBytes: number | null;
}

// ---------------------------------------------------------------------------
// Terminal
// ---------------------------------------------------------------------------

export interface TerminalCreateParams {
  cwd?: string;
  shell?: string;
  args?: string[];
  cols?: number;
  rows?: number;
  title?: string;
  sessionId?: string;
}

export interface TerminalSummary {
  id: string;
  title: string;
  cwd: string;
  shell: string;
  args: string[];
  status: 'running' | 'exiting' | 'exited' | 'failed';
  createdAt: string;
  cols: number;
  rows: number;
  sessionId?: string;
  integrationNonce?: string;
  exitCode?: number | null;
  signal?: string | null;
}

// ---------------------------------------------------------------------------
// Session commands (terminal-integrated tool use)
// ---------------------------------------------------------------------------

export type CommandResultStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout';

export interface CommandResultRecord {
  id: string;
  sessionId: string;
  command: string;
  cwd: string;
  shell: string;
  status: CommandResultStatus;
  stdout: string;
  stderr: string;
  truncated: boolean;
  createdAt: string;
  completedAt?: string;
  exitCode?: number | null;
  durationMs?: number;
  displayName?: string;
}

// ---------------------------------------------------------------------------
// Message composer attachments
// ---------------------------------------------------------------------------

/// Subset of `MessageOptions.attachments` from the Copilot JSON-RPC SDK.
/// Passed through `session.send({ attachments })` at send time.
export type SendMessageAttachment =
  | { type: 'file'; path: string; displayName?: string }
  | { type: 'directory'; path: string; displayName?: string }
  | {
      type: 'selection';
      filePath: string;
      displayName: string;
      selection?: {
        start: { line: number; character: number };
        end: { line: number; character: number };
      };
      text?: string;
    }
  | { type: 'blob'; data: string; mimeType: string; displayName?: string }
  | { type: 'commandResult'; result: CommandResultRecord; displayName?: string };

/// One file result from `searchWorkspaceFiles`. `path` is relative to the
/// session's working directory (fuzzy mode) or preserves the path-nav
/// prefix (for `@/abs`, `@~/foo`, `@../path`). `absolutePath` is the
/// resolved fs path bun uses to build SDK attachments at send-time.
export interface WorkspaceFileMatch {
  path: string;
  absolutePath: string;
  name: string;
  kind: 'file' | 'directory';
}

// ---------------------------------------------------------------------------
// Pending-request responses
// ---------------------------------------------------------------------------

/// Approval scope for `approveForSession` decisions.
export type PermissionApprovalRule =
  | { kind: 'commands'; commandIdentifiers: string[] }
  | { kind: 'read' }
  | { kind: 'write' }
  | { kind: 'mcp'; serverName: string; toolName: string | null }
  | { kind: 'mcp-sampling'; serverName: string }
  | { kind: 'memory' }
  | { kind: 'custom-tool'; toolName: string };

/// Renderer → bun response for `respondToRequest`.
export type RespondToRequestParams =
  | {
      sessionId: string;
      requestId: string;
      response: {
        kind: 'permission';
        decision: 'approveOnce' | 'approveForSession' | 'reject';
        approval?: PermissionApprovalRule;
        domain?: string;
      };
    }
  | {
      sessionId: string;
      requestId: string;
      response: { kind: 'userInput'; answer: string; wasFreeform: boolean };
    }
  | {
      sessionId: string;
      requestId: string;
      response: {
        kind: 'elicitation';
        action: 'accept' | 'decline' | 'cancel';
        content?: Record<string, unknown>;
      };
    }
  | {
      sessionId: string;
      requestId: string;
      response: {
        kind: 'exitPlanMode';
        approved: boolean;
        selectedAction?: 'interactive' | 'autopilot' | 'exit_only' | 'autopilot_fleet';
        feedback?: string;
      };
    }
  | {
      sessionId: string;
      requestId: string;
      response: { kind: 'autoModeSwitch'; response: 'yes' | 'yes_always' | 'no' };
    };

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
  ts: string;
  level: LogLevel;
  message: string;
  [key: string]: unknown;
}

export type AuditEntry =
  | {
      ts: string;
      kind: 'permission';
      sessionId: string;
      requestId: string;
      permissionKind: string;
      decision: 'approveOnce' | 'approveForSession' | 'reject';
      summary?: string;
      approvalKind?: string;
      approvalDomain?: string;
    }
  | {
      ts: string;
      kind: 'url';
      url: string;
      allowed: boolean;
      reason: string;
    }
  | {
      ts: string;
      kind: 'command';
      sessionId: string;
      commandId: string;
      command: string;
      cwd: string;
      shell: string;
      status: 'started' | 'completed' | 'failed' | 'cancelled' | 'timeout';
      exitCode?: number | null;
      durationMs?: number;
      truncated?: boolean;
    }
  | {
      ts: string;
      kind: 'mcp';
      sessionId: string;
      serverName: string;
      toolName: string;
      toolCallId?: string;
      argKeys?: string[];
      argKeyCount?: number;
    }
  | {
      ts: string;
      kind: 'toolFailure';
      sessionId: string;
      toolName: string;
      error: string;
      argKeys?: string[];
      argKeyCount?: number;
    };

// ---------------------------------------------------------------------------
// Command map — single source of truth for the request surface.
// Adding a new RPC? Add it here, then implement on the bun side in
// `src-bun/index.ts`. The bun adapter derives `DafmanRPC['bun']['requests']`
// from this map via a local mapped type.
// ---------------------------------------------------------------------------

export type CommandMap = {
  createClient: { args: Record<string, never>; result: string };
  createSession: {
    args: {
      workingDirectory?: string;
      model?: string | null;
      reasoningEffort?: string | null;
    };
    result: string;
  };
  pickFolder: {
    args: { startingFolder?: string };
    result: string | null;
  };
  pickAttachment: {
    args: { kind: 'file' | 'directory'; startingFolder?: string };
    result: { path: string; kind: 'file' | 'directory' } | null;
  };
  browseDirectory: {
    args: { prefix: string };
    result: string[];
  };
  disconnectSession: { args: { sessionId: string }; result: string };
  sendMessage: {
    args: {
      sessionId: string;
      text: string;
      /// SDK delivery mode. `"enqueue"` queues behind any in-flight turn;
      /// `"immediate"` injects into the running turn (steer).
      mode?: 'enqueue' | 'immediate';
      /// Per-message agent mode override. When set, overrides the
      /// session-wide `mode` for this send only (one-shot); the
      /// session-level mode is not mutated.
      agentMode?: SessionMode;
      attachments?: SendMessageAttachment[];
    };
    result: string;
  };
  searchWorkspaceFiles: {
    args: {
      sessionId: string;
      query: string;
      limit?: number;
      includeHidden?: boolean;
      includeIgnored?: boolean;
    };
    result: WorkspaceFileMatch[];
  };
  abortSession: { args: { sessionId: string }; result: string };
  listModels: { args: Record<string, never>; result: ModelSummary[] };
  setSessionModel: {
    args: {
      sessionId: string;
      model: string;
      reasoningEffort: string | null;
    };
    result: string;
  };
  resumeSession: {
    args: {
      sessionId: string;
      model: string | null;
      reasoningEffort: string | null;
    };
    result: {
      sessionId: string;
      cwd: string | null;
      model: string | null;
      approveAll: boolean;
      mode: SessionMode;
    };
  };
  listSessions: { args: Record<string, never>; result: SessionMetadataSummary[] };
  deleteSession: { args: { sessionId: string }; result: string };
  getSessionMode: { args: { sessionId: string }; result: SessionMode };
  setSessionMode: {
    args: { sessionId: string; mode: SessionMode };
    result: SessionMode;
  };
  getSessionName: { args: { sessionId: string }; result: string | null };
  setSessionName: {
    args: { sessionId: string; name: string };
    result: string;
  };
  setSessionWorkingDirectory: {
    args: {
      sessionId: string;
      workingDirectory: string;
      baseWorkingDirectory?: string | null;
    };
    result: string;
  };
  compactSessionHistory: {
    args: { sessionId: string };
    result: SessionHistoryCompactionResult;
  };
  truncateSessionHistory: {
    args: { sessionId: string; eventId: string };
    result: { eventsRemoved: number };
  };
  forkSession: {
    args: { sessionId: string; toEventId?: string };
    result: { sessionId: string };
  };
  setSessionApproveAll: {
    args: { sessionId: string; enabled: boolean };
    result: boolean;
  };
  resetSessionApprovals: { args: { sessionId: string }; result: boolean };
  listSessionSkills: {
    args: { sessionId: string };
    result: Array<{
      name: string;
      description: string;
      source: string;
      enabled: boolean;
      userInvocable: boolean;
      path?: string;
    }>;
  };
  setSessionSkillEnabled: {
    args: { sessionId: string; name: string; enabled: boolean };
    result: boolean;
  };
  listAgents: {
    args: { sessionId: string };
    result: AgentInfo[];
  };
  getCurrentAgent: {
    args: { sessionId: string };
    result: AgentInfo | null;
  };
  selectAgent: {
    args: { sessionId: string; name: string };
    result: AgentInfo;
  };
  deselectAgent: {
    args: { sessionId: string };
    result: boolean;
  };
  reloadAgents: {
    args: { sessionId: string };
    result: AgentInfo[];
  };
  listTasks: {
    args: { sessionId: string };
    result: TaskInfo[];
  };
  cancelTask: {
    args: { sessionId: string; id: string };
    result: boolean;
  };
  removeTask: {
    args: { sessionId: string; id: string };
    result: boolean;
  };
  promoteTask: {
    args: { sessionId: string; id: string };
    result: boolean;
  };
  listJobs: {
    args: Record<string, never>;
    result: JobRecord[];
  };
  listAgentFiles: {
    args: { sessionId: string; reloadSdk?: boolean };
    result: AgentFileEntry[];
  };
  listAgentFilesGlobal: {
    args: Record<string, never>;
    result: AgentFileEntry[];
  };
  writeAgentFile: {
    args: {
      sessionId: string;
      spec: AgentFileSpec;
      allowOverwrite?: boolean;
      preservedTail?: string;
    };
    result: string;
  };
  readAgentFile: {
    args: { sessionId: string; scope: AgentFileScope; name: string };
    result: {
      spec: Partial<AgentFileSpec>;
      prompt: string;
      preservedTail: string;
      path: string;
    };
  };
  deleteAgentFile: {
    args: { sessionId: string; scope: AgentFileScope; name: string };
    result: boolean;
  };
  startFleet: {
    args: { sessionId: string; prompt?: string };
    result: boolean;
  };
  getSessionUsageMetrics: {
    args: { sessionId: string };
    result: Record<string, unknown>;
  };
  listBuiltinTools: {
    args: Record<string, never>;
    result: Array<{
      name: string;
      namespacedName?: string;
      description: string;
    }>;
  };
  listSessionMcpServers: {
    args: { sessionId: string };
    result: Array<{
      name: string;
      status: string;
      source?: string;
      error?: string;
    }>;
  };
  setSessionMcpEnabled: {
    args: { sessionId: string; serverName: string; enabled: boolean };
    result: boolean;
  };
  reloadSessionMcpServers: {
    args: { sessionId: string };
    result: boolean;
  };
  getAccountQuota: {
    args: Record<string, never>;
    result: Record<
      string,
      {
        isUnlimitedEntitlement: boolean;
        entitlementRequests: number;
        usedRequests: number;
        remainingPercentage: number;
        overage: number;
        resetDate?: string;
      }
    >;
  };
  readSessionPlan: {
    args: { sessionId: string };
    result: { exists: boolean; content: string | null; path: string | null };
  };
  writeSessionPlan: {
    args: { sessionId: string; content: string };
    result: boolean;
  };
  deleteSessionPlan: {
    args: { sessionId: string };
    result: boolean;
  };
  // ---------- Phase 19a: MCP registry ----------
  listMcpConfigs: {
    args: Record<string, never>;
    result: Record<string, Record<string, unknown>>;
  };
  addMcpConfig: {
    args: { name: string; config: Record<string, unknown> };
    result: boolean;
  };
  updateMcpConfig: {
    args: { name: string; config: Record<string, unknown> };
    result: boolean;
  };
  removeMcpConfig: {
    args: { name: string };
    result: boolean;
  };
  enableMcpServers: {
    args: { names: string[] };
    result: boolean;
  };
  disableMcpServers: {
    args: { names: string[] };
    result: boolean;
  };
  discoverMcpServers: {
    args: { workingDirectory?: string };
    result: Array<{
      name: string;
      type?: string;
      source: string;
      enabled: boolean;
    }>;
  };
  loginToMcpServer: {
    args: {
      sessionId: string;
      serverName: string;
      forceReauth?: boolean;
      clientName?: string;
    };
    result: { authorizationUrl: string | null };
  };
  // ---------- Phase 19b: Skills library ----------
  discoverSkills: {
    args: { workingDirectory?: string };
    result: Array<{
      name: string;
      description: string;
      source: string;
      userInvocable: boolean;
      enabled: boolean;
      path?: string;
      projectPath?: string;
    }>;
  };
  setGloballyDisabledSkills: {
    args: { disabledSkills: string[] };
    result: boolean;
  };
  listInstructionSources: {
    args: { workingDirectory?: string };
    result: InstructionSource[];
  };
  createTerminal: {
    args: TerminalCreateParams;
    result: TerminalSummary;
  };
  writeTerminal: {
    args: { terminalId: string; data: string };
    result: boolean;
  };
  resizeTerminal: {
    args: { terminalId: string; cols: number; rows: number };
    result: boolean;
  };
  killTerminal: {
    args: { terminalId: string };
    result: boolean;
  };
  listTerminals: {
    args: Record<string, never>;
    result: TerminalSummary[];
  };
  startSessionCommand: {
    args: { sessionId: string; command: string };
    result: CommandResultRecord;
  };
  cancelSessionCommand: {
    args: { sessionId: string; commandId: string };
    result: boolean;
  };
  listCommandResults: {
    args: { sessionId: string };
    result: CommandResultRecord[];
  };
  getSettings: { args: Record<string, never>; result: Settings };
  updateSettings: { args: { next: Settings }; result: Settings };
  getAppInfo: { args: Record<string, never>; result: AppInfo };
  getLogDir: { args: Record<string, never>; result: string };
  openLogFolder: { args: Record<string, never>; result: boolean };
  revealPath: { args: { path: string }; result: boolean };
  openUrl: { args: { url: string }; result: boolean };
  respondToRequest: { args: RespondToRequestParams; result: boolean };
  rendererLog: {
    args: {
      level: 'debug' | 'info' | 'warn' | 'error';
      message: string;
      extra?: Record<string, unknown>;
    };
    result: undefined;
  };
  getLogState: {
    args: { recentLimit?: number };
    result: {
      level: LogLevel;
      recent: LogRecord[];
    };
  };
  setLogLevel: { args: { level: LogLevel }; result: LogLevel };
  exportDiagnostics: {
    args: Record<string, never>;
    result: { path: string; files: string[]; totalBytes: number };
  };
  saveExportFile: {
    args: { fileName: string; contents: string };
    result: { path: string; bytes: number };
  };
  getAuditState: {
    args: { recentLimit?: number };
    result: { recent: AuditEntry[] };
  };
  searchSessionTranscripts: {
    args: {
      query: string;
      options?: { sessionIds?: string[]; limit?: number };
    };
    result: TranscriptSearchResult[];
  };
};
