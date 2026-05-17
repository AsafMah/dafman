// Bridges renderer console.* and uncaught errors to the bun-side JSON log
// so we can debug WebView2 issues by tailing `dafman-*.log` instead of
// requiring devtools to be open.

import { invokeCommand } from "./invoke";

export type RendererLogLevel = "debug" | "info" | "warn" | "error";

let installed = false;

function send(level: RendererLogLevel, message: string, extra?: Record<string, unknown>): void {
  // Fire-and-forget; we already mirror to console below for devtools users.
  invokeCommand("rendererLog", { level, message, extra }).catch(() => {});
}

export function rendererLog(
  level: RendererLogLevel,
  message: string,
  extra?: Record<string, unknown>,
): void {
  send(level, message, extra);
}

/// Installs a global error handler + console interceptor that mirrors
/// everything to the bun log. Idempotent.
export function installRendererLogBridge(): void {
  if (installed) return;
  installed = true;

  window.addEventListener("error", (event: ErrorEvent) => {
    send("error", `uncaught ${event.message}`, {
      source: event.filename,
      line: event.lineno,
      column: event.colno,
      stack: event.error instanceof Error ? event.error.stack : undefined,
    });
  });

  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const message =
      reason instanceof Error
        ? `unhandledrejection ${reason.message}`
        : `unhandledrejection ${String(reason)}`;
    send("error", message, {
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });

  // Mirror console.error so anything throwing inside Lexical/PrimeVue/etc.
  // shows up server-side. Keep the original behaviour so devtools users
  // still see the message in the WebView2 console.
  const originalError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      const message = args
        .map((a) =>
          a instanceof Error ? `${a.message}\n${a.stack ?? ""}` : typeof a === "string" ? a : safeStringify(a),
        )
        .join(" ");
      send("error", message);
    } catch {
      /* swallow — we never want logging to break the page */
    }
    originalError(...args);
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
