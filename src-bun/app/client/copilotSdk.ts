// Adapter for the JSON-RPC Copilot SDK bundled inside `@github/copilot`.
//
// Dafman previously imported `copilot-sdk-supercharged`, but that wrapper
// lags the bundled SDK and does not expose mode-lifecycle callbacks such as
// `onExitPlanMode` / `onAutoModeSwitch`. The bundled external SDK has the
// same client shape plus those callbacks. Keep all imports behind this module
// so any future package/export-path change is localized here.

export {
  CopilotClient,
  RuntimeConnection,
  approveAll,
  convertMcpCallToolResult,
  createSessionFsAdapter,
  defineTool,
  SYSTEM_PROMPT_SECTIONS,
} from '../../../node_modules/@github/copilot/copilot-sdk/index.js';

export type {
  AutoModeSwitchHandler,
  AutoModeSwitchRequest,
  AutoModeSwitchResponse,
  CommandContext,
  CommandDefinition,
  CommandHandler,
  CopilotClientOptions,
  CopilotSession,
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
} from '../../../node_modules/@github/copilot/copilot-sdk/index.js';

/// UserInputRequest/Response live in `types.js`; the SDK's index.d.ts
/// re-exports `UserInputHandler` but not the request/response types
/// directly (as of 2026-05). Pull them from the deeper path.
export type {
  UserInputRequest,
  UserInputResponse,
} from '../../../node_modules/@github/copilot/copilot-sdk/types.js';
