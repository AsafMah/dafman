// Adapter for the GitHub Copilot JSON-RPC SDK.
//
// Migration history:
// 1. Started on `copilot-sdk-supercharged` (3rd-party wrapper) — replaced
//    because it lagged the bundled SDK and lacked mode-lifecycle callbacks.
// 2. Switched to deep imports inside `@github/copilot/copilot-sdk/`. Worked
//    but reached through `node_modules/` (AGENTS.md rule 17).
// 3. (current) Use `@github/copilot-sdk@1.0.0-beta.7` — the standalone
//    GitHub-published SDK package. Type/runtime surface matches the
//    bundled SDK at beta.7 (earlier beta.4 was behind on
//    SessionContext.workingDirectory / getEvents — verify any future
//    pin against `node_modules/@github/copilot-sdk/dist/*.d.ts` before
//    downgrading).
//
// Notes for any future re-evaluation:
// - `UserInputRequest`/`Response` are exported from `dist/types.js` but
//   not from `dist/index.js` (consistent with the bundled SDK), so pull
//   them from the sub-path.
// - `SYSTEM_PROMPT_SECTIONS` was renamed to `SYSTEM_MESSAGE_SECTIONS` in
//   beta.7. We don't currently consume it; if we add a system-prompt
//   customization callsite, use the new name.
//
// Keep all SDK imports behind this module so any future export-path or
// package change is localized here.

export {
  CopilotClient,
  RuntimeConnection,
  approveAll,
  convertMcpCallToolResult,
  createSessionFsAdapter,
  defineTool,
} from '@github/copilot-sdk';

export type {
  AutoModeSwitchHandler,
  AutoModeSwitchRequest,
  AutoModeSwitchResponse,
  CommandContext,
  CommandDefinition,
  CommandHandler,
  CopilotClientOptions,
  CustomAgentConfig,
  ElicitationContext,
  ElicitationHandler,
  ElicitationResult,
  ExitPlanModeHandler,
  ExitPlanModeRequest,
  ExitPlanModeResult,
  ForegroundSessionInfo,
  MessageOptions,
  ModelInfo,
  PermissionHandler,
  PermissionRequest,
  PermissionRequestResult,
  ResumeSessionConfig,
  SessionConfig,
  SessionEvent,
  SessionEventPayload,
  SessionMetadata,
  SessionUiApi,
  Tool,
  ToolInvocation,
  ToolResultObject,
} from '@github/copilot-sdk';

export { CopilotSession } from '@github/copilot-sdk';

/// UserInputRequest/Response live in `dist/types.js` but the package's
/// `exports` map only allows `.` and `./extension` (no sub-path
/// access). Derive them from `SessionConfig.onUserInputRequest` —
/// which IS exported — so we don't need to reach past the entry.
import type { SessionConfig } from '@github/copilot-sdk';

export type UserInputRequest = Parameters<NonNullable<SessionConfig['onUserInputRequest']>>[0];

export type UserInputResponse = Awaited<
  ReturnType<NonNullable<SessionConfig['onUserInputRequest']>>
>;

/// `ReasoningEffort` is also unexported from the SDK's index but it's
/// just the `SessionConfig['reasoningEffort']` literal union. Derive
/// it the same way so sessions.ts doesn't need to hand-mirror the
/// SDK's `"low" | "medium" | "high" | "xhigh"` (which would silently
/// drift if the SDK adds a level).
export type ReasoningEffort = NonNullable<SessionConfig['reasoningEffort']>;
