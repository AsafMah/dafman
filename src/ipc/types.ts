// Renderer barrel for the IPC wire contract.
//
// All payload types and CommandMap are defined in `src/shared/wireTypes.ts`
// (no electrobun import; safe for both Bun and Vue bundler). This file
// re-exports them at the stable `@/ipc/types` import path so renderer
// components and stores need no call-site changes.
//
// Renderer-only values (LAYOUT_SCHEMA_VERSION) live here because they are
// not part of the wire surface and Bun does not need them.
//
// Phase-2 types (SessionEventPayload, PendingRequestPayload, CommandResultEvent,
// TerminalEventPayload) remain declared here until they move to wireTypes.

// Local imports needed for Phase-2 type declarations in this file.
import type { CommandMap, CommandResultRecord, TerminalSummary } from '@/shared/wireTypes';

// ---------------------------------------------------------------------------
// Phase 1 shared — forwarded from wireTypes at the stable renderer import path
// ---------------------------------------------------------------------------

export type {
  AgentFileEntry,
  AgentFileScope,
  AgentFileSpec,
  AgentInfo,
  AppInfo,
  Appearance,
  AuditEntry,
  CommandMap,
  CommandResultRecord,
  CommandResultStatus,
  GroupMeta,
  InstructionScope,
  InstructionSource,
  JobRecord,
  KeyboardShortcutPrefs,
  Layout,
  LogLevel,
  LogRecord,
  ModelSummary,
  NotificationPrefs,
  PermissionApprovalRule,
  PermissionsPrefs,
  ReasoningVisibility,
  RespondToRequestParams,
  SendMessageAttachment,
  SessionHistoryCompactionResult,
  SessionMetadataSummary,
  SessionMode,
  Settings,
  ShortcutScope,
  TaskAgentInfo,
  TaskInfo,
  TaskShellInfo,
  TaskStatus,
  TerminalAddonPrefs,
  TerminalCreateParams,
  TerminalPrefs,
  TerminalSummary,
  ThemeChoice,
  ToolsPrefs,
  WorkspaceFileMatch,
  Workspaces,
} from '@/shared/wireTypes';

// ---------------------------------------------------------------------------
// Renderer-only constants
// ---------------------------------------------------------------------------

/// Bump when the dockview layout shape stored in `Layout.dockview` changes
/// in an incompatible way. The boot path compares the persisted
/// `schemaVersion` against this and triggers a one-time narrow migration
/// on a downgrade detection.
///
/// History:
///   v1 — left edge: custom ActivityBar with `exclusive: true`; right edge:
///        ad-hoc session-details panel
///   v2 — left + right edges: native dockview vertical tab strips seeded by
///        `seedDefaultLayout`; library moved to right edge
///   v3 — outer + inner dockview split; groups replace flat panel list
export const LAYOUT_SCHEMA_VERSION = 3;

// ---------------------------------------------------------------------------
// Phase-2 candidates — declared here until WebviewMessageMap moves to
// wireTypes. PermissionRequestData and friends are also Phase-2 because they
// are payloads for the webview `pendingRequest` message, not CommandMap args.
// ---------------------------------------------------------------------------

export interface PermissionRequestData {
  kind:
    | 'shell'
    | 'write'
    | 'mcp'
    | 'read'
    | 'url'
    | 'custom-tool'
    | 'memory'
    | 'hook'
    | 'extension-management'
    | 'extension-permission-access';
  toolCallId?: string;
  /// Best-effort summary computed bun-side (e.g. "shell: ls -la").
  summary: string;
  /// Full request payload for diagnostic display.
  raw: Record<string, unknown>;
}

export interface UserInputRequestData {
  question: string;
  choices?: string[];
  allowFreeform: boolean;
}

export interface ElicitationRequestData {
  message: string;
  mode: 'form' | 'url';
  elicitationSource?: string;
  url?: string;
  requestedSchema?: unknown;
}

export interface ExitPlanModeRequestData {
  summary: string;
  planContent: string;
  actions: string[];
  recommendedAction: string;
}

export interface AutoModeSwitchRequestData {
  errorCode?: string;
  retryAfterSeconds?: number;
}

export type PendingRequestPayload =
  | {
      sessionId: string;
      requestId: string;
      kind: 'permission';
      request: PermissionRequestData;
    }
  | {
      sessionId: string;
      requestId: string;
      kind: 'userInput';
      request: UserInputRequestData;
    }
  | {
      sessionId: string;
      requestId: string;
      kind: 'elicitation';
      request: ElicitationRequestData;
    }
  | {
      sessionId: string;
      requestId: string;
      kind: 'exitPlanMode';
      request: ExitPlanModeRequestData;
    }
  | {
      sessionId: string;
      requestId: string;
      kind: 'autoModeSwitch';
      request: AutoModeSwitchRequestData;
    };

export interface SessionEventPayload {
  sessionId: string;
  eventType: string;
  data: Record<string, unknown>;
  agentId?: string;
  eventId?: string;
  timestamp?: string;
  replay?: true;
}

export type CommandResultEvent =
  | {
      kind: 'started';
      sessionId: string;
      commandId: string;
      record: CommandResultRecord;
    }
  | {
      kind: 'stdout' | 'stderr';
      sessionId: string;
      commandId: string;
      data: string;
    }
  | {
      kind: 'truncated';
      sessionId: string;
      commandId: string;
      limitBytes: number;
    }
  | {
      kind: 'completed' | 'cancelled';
      sessionId: string;
      commandId: string;
      record: CommandResultRecord;
    };

export type TerminalEventPayload =
  | { terminalId: string; kind: 'output'; data: string }
  | { terminalId: string; kind: 'status'; summary: TerminalSummary }
  | { terminalId: string; kind: 'exit'; summary: TerminalSummary }
  | { terminalId: string; kind: 'error'; message: string };

/// Discriminated union mirroring `AppErrorPayload` in
/// `src-bun/app/shared/errors.ts`. RPC rejections are deserialized into this
/// shape by `invokeCommand`.
export type AppErrorPayload =
  | { kind: 'ClientNotStarted' }
  | { kind: 'SessionNotFound'; data: string }
  | { kind: 'Settings'; data: string }
  | { kind: 'Sdk'; data: string }
  | { kind: 'Io'; data: string };

export type CommandName = keyof CommandMap;
