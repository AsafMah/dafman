// Typed wrapper around `@tauri-apps/api/core`'s `invoke`.
//
// Components and stores MUST call `invokeCommand` instead of `invoke`
// directly (see `AGENTS.md` -> "No raw `invoke()` in components"). The
// `CommandMap` in `./types.ts` is the single source of truth for command
// names and argument shapes; if you add a new Tauri command, register it
// there first.

import { invoke } from "@tauri-apps/api/core";
import type {
  AppErrorPayload,
  CommandMap,
  CommandName,
} from "./types";

export type InvokeResult<N extends CommandName> = CommandMap[N]["result"];

export class AppError extends Error {
  readonly payload: AppErrorPayload;
  constructor(payload: AppErrorPayload) {
    super(formatAppError(payload));
    this.name = "AppError";
    this.payload = payload;
  }
}

function formatAppError(payload: AppErrorPayload): string {
  switch (payload.kind) {
    case "ClientNotStarted":
      return "Copilot client not started";
    case "SessionNotFound":
      return `Session ${payload.data} not found`;
    case "Sdk":
      return `SDK error: ${payload.data}`;
  }
}

function isAppErrorPayload(value: unknown): value is AppErrorPayload {
  if (!value || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  return (
    kind === "ClientNotStarted" || kind === "SessionNotFound" || kind === "Sdk"
  );
}

export async function invokeCommand<N extends CommandName>(
  name: N,
  args: CommandMap[N]["args"],
): Promise<InvokeResult<N>> {
  try {
    return (await invoke(name, args as Record<string, unknown>)) as InvokeResult<N>;
  } catch (raw) {
    if (isAppErrorPayload(raw)) {
      throw new AppError(raw);
    }
    if (raw instanceof Error) throw raw;
    throw new Error(String(raw));
  }
}
