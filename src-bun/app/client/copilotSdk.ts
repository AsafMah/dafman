// Adapter for the JSON-RPC Copilot SDK bundled inside `@github/copilot`.
//
// Dafman previously imported `copilot-sdk-supercharged`, but that wrapper
// lags the bundled SDK and does not expose mode-lifecycle callbacks such as
// `onExitPlanMode` / `onAutoModeSwitch`. The bundled external SDK has the
// same client shape plus those callbacks. Keep all imports behind this module
// so any future package/export-path change is localized here.

export {
  CopilotClient,
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
  UserInputRequest,
  UserInputResponse,
} from '../../../node_modules/@github/copilot/copilot-sdk/index.js';
