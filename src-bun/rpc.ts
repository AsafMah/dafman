// Bun-side IPC adapter.
//
// `CommandMap` and all payload-only types live in the shared module
// `src/shared/wireTypes.ts` so the Vue renderer can import the contract
// without touching this file (which imports `electrobun/bun`).
//
// This file's responsibility: adapt the renderer-friendly
// `{ args; result }` shape into Electrobun's `{ params; response }` shape
// via `ToRPCRequests<CommandMap>`, own the `DafmanRPC` schema wiring, and
// own the webview-message types that are Phase-2 migration candidates.

import type { RPCSchema } from 'electrobun/bun';
import type { AppErrorPayload } from './app/shared/errors';
import type {
  AuditEntry,
  CommandMap,
  CommandResultRecord,
  LogRecord,
  TerminalSummary,
  UpdateEventPayload,
} from '../src/shared/wireTypes';

// Re-export all shared payload types so existing `import … from '../../rpc'`
// call sites in src-bun/app/** continue to resolve without changes (Phase 3
// will migrate those imports to point at wireTypes directly).
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
  TranscriptMatch,
  TranscriptSearchResult,
  WorkspaceFileMatch,
  Workspaces,
  UpdateEventPayload,
} from '../src/shared/wireTypes';

// ---------------------------------------------------------------------------
// Bun-adapter mapped type
//
// Converts the renderer's `{ args; result }` per-command shape into
// Electrobun's `{ params; response }` shape. The payload types themselves
// are identical on both sides — only the key names differ.
// ---------------------------------------------------------------------------

type ToRPCRequests<M extends Record<string, { args: unknown; result: unknown }>> = {
  [K in keyof M]: { params: M[K]['args']; response: M[K]['result'] };
};

// ---------------------------------------------------------------------------
// Phase-2 candidate types (webview push messages, pending-request callbacks).
// Will move to wireTypes when the WebviewMessageMap shape is extracted.
// ---------------------------------------------------------------------------

export interface SessionEventPayload {
  sessionId: string;
  eventType: string;
  data: Record<string, unknown>;
  agentId?: string;
  eventId?: string;
  timestamp?: string;
  replay?: true;
}

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
  summary: string;
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
  | { sessionId: string; requestId: string; kind: 'permission'; request: PermissionRequestData }
  | { sessionId: string; requestId: string; kind: 'userInput'; request: UserInputRequestData }
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

export type TerminalEventPayload =
  | { terminalId: string; kind: 'output'; data: string }
  | { terminalId: string; kind: 'status'; summary: TerminalSummary }
  | { terminalId: string; kind: 'exit'; summary: TerminalSummary }
  | { terminalId: string; kind: 'error'; message: string };

export type CommandResultEvent =
  | { kind: 'started'; sessionId: string; commandId: string; record: CommandResultRecord }
  | { kind: 'stdout' | 'stderr'; sessionId: string; commandId: string; data: string }
  | { kind: 'truncated'; sessionId: string; commandId: string; limitBytes: number }
  | {
      kind: 'completed' | 'cancelled';
      sessionId: string;
      commandId: string;
      record: CommandResultRecord;
    };

// ---------------------------------------------------------------------------
// DafmanRPC — Electrobun schema.
//
// bun.requests is fully derived from CommandMap via ToRPCRequests, so adding
// a new command only requires one edit in src/shared/wireTypes.ts.
// ---------------------------------------------------------------------------

export type DafmanRPC = {
  bun: RPCSchema<{
    requests: ToRPCRequests<CommandMap>;
    messages: Record<string, never>;
  }>;
  webview: RPCSchema<{
    requests: Record<string, never>;
    messages: {
      sessionEvent: SessionEventPayload;
      pendingRequest: PendingRequestPayload;
      logEvent: LogRecord;
      auditEvent: AuditEntry;
      terminalEvent: TerminalEventPayload;
      commandResultEvent: CommandResultEvent;
      updateEvent: UpdateEventPayload;
    };
  }>;
};

/// Typed view of the bun→webview message channel. Derived from
/// `DafmanRPC['webview']['messages']` so channel names + payload types
/// can't drift from the schema.
export type WebviewSendChannels = {
  [K in keyof DafmanRPC['webview']['messages']]: (
    payload: DafmanRPC['webview']['messages'][K],
  ) => void;
};

export type { AppErrorPayload };
