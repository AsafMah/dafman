// SessionConfigBuilder — builds the SDK `SessionConfig` shape shared
// by `SessionRegistry.create()` and `SessionRegistry.resume()`.
//
// Extracted from `SessionRegistry.baseSessionConfig` (Phase D.3.7,
// 2026-05-26). A pure factory function — takes a deps bundle with
// the registry's resolvers/queue/handlers and returns the SDK config
// object. Keeps the registry's lifecycle methods short and lets the
// permission-handler shape evolve in isolation.
//
// Includes the small `buildRegisteredCommands` helper (the `/library`
// slash-command stub) because it's only ever called from inside this
// factory and shares the same `() => sessionId` closure pattern.

import type {
  AutoModeSwitchRequest,
  AutoModeSwitchResponse,
  CommandDefinition,
  ElicitationContext,
  ElicitationResult,
  ExitPlanModeRequest,
  ExitPlanModeResult,
  PermissionRequest,
  PermissionRequestResult,
  Tool,
  UserInputRequest,
  UserInputResponse,
} from '../client/copilotSdk';
import { log } from '../observability/logging';
import { summarizePermission, toPlainObject } from './sessionHelpers';
import type {
  AutoModeSwitchRequestData,
  ElicitationRequestData,
  ExitPlanModeRequestData,
  PendingRequestPayload,
  PermissionRequestData,
  SessionEventPayload,
  SessionMode,
  UserInputRequestData,
} from '../../rpc';
import type { PendingRequestQueue } from './pendingRequests';

type Emit = (payload: SessionEventPayload) => void;
type EmitPending = (payload: PendingRequestPayload) => void;

export interface SessionConfigBuilderDeps {
  /// Built-in tools list. The registry passes this in pre-built —
  /// keeping the `buildBuiltInTools(registry)` call site there
  /// avoids a circular type dependency with `library/tools.ts`.
  tools: Tool[];
  /// Renderer-facing emitters.
  emit: Emit;
  emitPending: EmitPending;
  /// Per-session approve-all + mode maps owned by the registry.
  approveAllBySession: Map<string, boolean>;
  modeBySession: Map<string, SessionMode>;
  /// Pending callback queue (also owned by the registry).
  pending: PendingRequestQueue;
  /// Resolvers fetched fresh at each call so settings/perms changes
  /// surface without re-creating the session.
  streamingResolver: () => boolean;
  excludedToolsResolver: () => string[];
  allowedToolsResolver: () => string[];
}

/// Build the SDK SessionConfig shared by create() and resume(). The
/// returned object captures every dep by reference — handlers close
/// over the maps/queue/emit so a single resolved config remains
/// "live" for the lifetime of the SDK session.
export function buildBaseSessionConfig(deps: SessionConfigBuilderDeps, sessionId: () => string) {
  return {
    // Auto-discover workspace-level MCP server configs (.mcp.json,
    // .vscode/mcp.json) and skill directories. Defaults to false
    // in the SDK, which meant a user dropping an .mcp.json in
    // their repo saw nothing. Custom instruction files
    // (.github/copilot-instructions.md, AGENTS.md, etc.) are
    // loaded regardless. Explicit `mcpServers` / `skillDirectories`
    // would take precedence on collision — we don't supply any
    // yet, so discovery is the only source.
    enableConfigDiscovery: true,
    tools: deps.tools,
    commands: buildRegisteredCommands(deps.emit, sessionId),
    onPermissionRequest: (request: PermissionRequest): Promise<PermissionRequestResult> => {
      const sid = sessionId();

      // Per-session approveAll short-circuit. Returns the SDK's
      // minimal `approve-once` shape — no rule editor here.
      if (deps.approveAllBySession.get(sid) === true) {
        return Promise.resolve({ kind: 'approve-once' });
      }

      if (deps.modeBySession.get(sid) === 'autopilot') {
        log.info('permission unavailable in autopilot', {
          sessionId: sid,
          permissionKind: request.kind,
        });

        return Promise.resolve({ kind: 'user-not-available' });
      }

      return deps.pending.enqueue(
        sid,
        'permission',
        (requestId) => {
          const data: PermissionRequestData = {
            kind: request.kind,
            ...(request.toolCallId ? { toolCallId: request.toolCallId } : {}),
            summary: summarizePermission(request),
            raw: toPlainObject(request),
          };

          deps.emitPending({
            sessionId: sid,
            requestId,
            kind: 'permission',
            request: data,
          });
        },
        {
          permissionKind: request.kind,
          summary: summarizePermission(request),
        },
      ) as Promise<PermissionRequestResult>;
    },
    onUserInputRequest: (request: UserInputRequest): Promise<UserInputResponse> => {
      const sid = sessionId();

      if (deps.modeBySession.get(sid) === 'autopilot') {
        log.info('user input unavailable in autopilot', { sessionId: sid });

        return Promise.resolve({
          answer: 'User is unavailable in autopilot mode.',
          wasFreeform: true,
        });
      }

      return deps.pending.enqueue(sid, 'userInput', (requestId) => {
        const data: UserInputRequestData = {
          question: request.question,
          ...(request.choices ? { choices: request.choices } : {}),
          allowFreeform: request.allowFreeform ?? true,
        };

        deps.emitPending({
          sessionId: sid,
          requestId,
          kind: 'userInput',
          request: data,
        });
      }) as Promise<UserInputResponse>;
    },
    onElicitationRequest: (context: ElicitationContext): Promise<ElicitationResult> => {
      const sid = sessionId();

      if (deps.modeBySession.get(sid) === 'autopilot') {
        log.info('elicitation declined in autopilot', {
          sessionId: sid,
          mode: context.mode ?? 'form',
        });

        return Promise.resolve({ action: 'decline' });
      }

      return deps.pending.enqueue(sid, 'elicitation', (requestId) => {
        const data: ElicitationRequestData = {
          message: context.message,
          mode: context.mode ?? 'form',
          ...(context.elicitationSource ? { elicitationSource: context.elicitationSource } : {}),
          ...(context.url ? { url: context.url } : {}),
          ...(context.requestedSchema
            ? { requestedSchema: toPlainObject(context.requestedSchema) }
            : {}),
        };

        deps.emitPending({
          sessionId: sid,
          requestId,
          kind: 'elicitation',
          request: data,
        });
      }) as Promise<ElicitationResult>;
    },
    onExitPlanModeRequest: (request: ExitPlanModeRequest): Promise<ExitPlanModeResult> => {
      const sid = sessionId();

      return deps.pending.enqueue(sid, 'exitPlanMode', (requestId) => {
        const data: ExitPlanModeRequestData = {
          summary: request.summary,
          planContent: request.planContent ?? '',
          actions: request.actions,
          recommendedAction: request.recommendedAction,
        };

        deps.emitPending({
          sessionId: sid,
          requestId,
          kind: 'exitPlanMode',
          request: data,
        });
      }) as Promise<ExitPlanModeResult>;
    },
    onAutoModeSwitchRequest: (request: AutoModeSwitchRequest): Promise<AutoModeSwitchResponse> => {
      const sid = sessionId();

      return deps.pending.enqueue(sid, 'autoModeSwitch', (requestId) => {
        const data: AutoModeSwitchRequestData = {
          ...(request.errorCode ? { errorCode: request.errorCode } : {}),
          ...(typeof request.retryAfterSeconds === 'number'
            ? { retryAfterSeconds: request.retryAfterSeconds }
            : {}),
        };

        deps.emitPending({
          sessionId: sid,
          requestId,
          kind: 'autoModeSwitch',
          request: data,
        });
      }) as Promise<AutoModeSwitchResponse>;
    },
    streaming: deps.streamingResolver(),
    ...(() => {
      // 22b: SDK semantics — `availableTools` (allowlist) takes
      // precedence over `excludedTools`. When the allowlist is
      // non-empty, the exclude list is ignored by the SDK so we
      // omit it entirely to keep the wire shape honest. When the
      // allowlist is empty, NEVER pass `availableTools: []` (the
      // SDK would interpret that as "allow no tools").
      const allowed = deps.allowedToolsResolver();
      const excluded = deps.excludedToolsResolver();

      if (allowed.length > 0) return { availableTools: allowed };

      return excluded.length > 0 ? { excludedTools: excluded } : {};
    })(),
  };
}

/// Builds the slash-command list registered with the SDK. Today: just
/// `/library`, which echoes a system notification so the CLI TUI can
/// route the user back to dafman's Library sidebar.
function buildRegisteredCommands(emit: Emit, sessionId: () => string): CommandDefinition[] {
  return [
    {
      name: 'library',
      description:
        "Open Dafman's Library panel. In Dafman UI, use /library [mcp|skills|agents|instructions].",
      handler: (context) => {
        const tab = context.args.trim().split(/\s+/)[0] || 'mcp';

        emit({
          sessionId: sessionId(),
          eventType: 'system.notification',
          data: {
            content: `Library command received (${tab}). In Dafman, /library opens the Library sidebar; from the CLI TUI use the app's Library activity-bar item.`,
          },
        });
      },
    },
  ];
}
