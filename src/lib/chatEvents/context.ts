import type { ChatAmbient, ChatItem, ChatToast, IdCounter, SystemSeverity } from "../chatEvents";
import type { SessionEventPayload } from "../../ipc/types";

export interface ReducerContext {
  items: ChatItem[];
  ambient: ChatAmbient;
  toasts: ChatToast[];
  counter: IdCounter;
  isLive: boolean;

  setIdle(): void;
  setError(): void;

  upsertAssistant(messageId: string): ChatItem;
  upsertReasoning(reasoningId: string): ChatItem;
  upsertTool(toolCallId: string, fallbackName?: string): ChatItem;
  pushSystem(text: string, severity: SystemSeverity): void;
}

export type Handler = (
  ctx: ReducerContext,
  data: unknown,
  payload: SessionEventPayload,
) => void;
