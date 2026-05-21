// Conversation export.
//
// Builds a self-contained Markdown or JSON document from a session's
// `ChatItem[]`. Used by the "Export conversation" menu item in the
// ChatTab actions; the bun side writes the resulting string to
// `<userData>/exports/` via the `saveExportFile` RPC, then opens the
// file's containing folder.
//
// Tone of the output is "good-enough for sharing with a teammate or
// pasting into a GitHub issue", not "byte-for-byte reproducible SDK
// log". Tool args/results are quoted in fenced code blocks; reasoning
// is included but folded under a `<details>` block so the assistant's
// final message reads as the headline.

import type { ChatItem } from "./chatEvents";

export type ExportFormat = "markdown" | "json";

export interface ExportInput {
  /// Display title for the file header; falls back to the short session
  /// id when the user hasn't named the session.
  title: string;
  /// Absolute path the session ran against (cwd). Optional.
  workingDirectory?: string | null;
  /// Active model id at export time. Optional.
  model?: string | null;
  items: ChatItem[];
  /// ISO-8601 timestamp at export time.
  exportedAt: string;
}

/// Output filename (without an extension) sanitised from the title.
export function exportFilenameStem(title: string, format: ExportFormat): string {
  const safe = title
    .trim()
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "session";
  const ext = format === "markdown" ? "md" : "json";
  // Timestamp suffix so re-exports don't clobber.
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `${safe}-${ts}.${ext}`;
}

export function formatConversation(input: ExportInput, format: ExportFormat): string {
  if (format === "json") return formatJson(input);
  return formatMarkdown(input);
}

function formatJson(input: ExportInput): string {
  return JSON.stringify(
    {
      title: input.title,
      workingDirectory: input.workingDirectory ?? null,
      model: input.model ?? null,
      exportedAt: input.exportedAt,
      items: input.items,
    },
    null,
    2,
  );
}

function formatMarkdown(input: ExportInput): string {
  const lines: string[] = [];
  lines.push(`# ${input.title}`);
  lines.push("");
  const meta: string[] = [];
  if (input.model) meta.push(`**Model:** \`${input.model}\``);
  if (input.workingDirectory) meta.push(`**Workspace:** \`${input.workingDirectory}\``);
  meta.push(`**Exported:** ${input.exportedAt}`);
  meta.push(`**Messages:** ${countRenderable(input.items)}`);
  lines.push(meta.join("  \n"));
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const item of input.items) {
    const rendered = renderItem(item);
    if (!rendered) continue;
    lines.push(rendered);
    lines.push("");
  }
  return lines.join("\n");
}

function countRenderable(items: ChatItem[]): number {
  let n = 0;
  for (const item of items) {
    if (item.kind === "user" || item.kind === "assistant") n++;
  }
  return n;
}

function renderItem(item: ChatItem): string | null {
  switch (item.kind) {
    case "user":
      return renderUser(item);
    case "assistant":
      return renderAssistant(item);
    case "reasoning":
      return renderReasoning(item);
    case "tool":
      return renderTool(item);
    case "system":
      return renderSystem(item);
    case "pendingRequest":
      // Pending requests are transient; don't include them in exports.
      return null;
    case "forkNotice":
      return `> 🔀 ${item.direction === "into" ? "Forked into" : "Forked from"} **${item.referenceName}**`;
    default:
      return null;
  }
}

function renderUser(item: ChatItem & { kind: "user" }): string {
  const parts: string[] = ["## 👤 You", ""];
  parts.push(item.text);
  if (item.attachments && item.attachments.length > 0) {
    parts.push("");
    parts.push("_Attachments:_");
    for (const a of item.attachments) {
      const label = attachmentLabel(a);
      parts.push(`- ${label}`);
    }
  }
  return parts.join("\n");
}

function attachmentLabel(
  a: import("../ipc/types").SendMessageAttachment,
): string {
  if (a.type === "file" || a.type === "directory") {
    return `\`${a.displayName ?? a.path}\` (${a.type})`;
  }
  if (a.type === "blob") {
    return `\`${a.displayName ?? "attachment"}\` (${a.mimeType})`;
  }
  return `\`${a.displayName ?? a.filePath}\` (selection)`;
}

function renderAssistant(item: ChatItem & { kind: "assistant" }): string {
  // Skip empty assistant cards (created by message_start before any
  // deltas, then never filled because the turn went straight to a tool
  // call).
  if (!item.text.trim()) return "";
  return `## 🤖 Assistant\n\n${item.text}`;
}

function renderReasoning(item: ChatItem & { kind: "reasoning" }): string {
  // Reasoning folded inside a <details> block — collapsed by default
  // when previewed in GitHub / VS Code. Plays nicely with markdown-it.
  if (item.opaque && !item.text) {
    return [
      "<details>",
      "<summary>💭 Reasoning (encrypted)</summary>",
      "",
      "_This model used encrypted reasoning. The thinking happened, but the SDK doesn't expose it as readable text._",
      "",
      "</details>",
    ].join("\n");
  }
  if (!item.text.trim()) return "";
  return [
    "<details>",
    "<summary>💭 Reasoning</summary>",
    "",
    item.text,
    "",
    "</details>",
  ].join("\n");
}

function renderTool(item: ChatItem & { kind: "tool" }): string {
  const lines: string[] = [];
  const status = item.status === "success"
    ? "✓"
    : item.status === "error"
      ? "✗"
      : "…";
  const name = item.mcpToolName
    ? `${item.mcpServerName}/${item.mcpToolName}`
    : item.toolName;
  lines.push(`### 🔧 Tool · ${name} (${status})`);
  if (item.args && Object.keys(item.args).length > 0) {
    lines.push("");
    lines.push("**Args:**");
    lines.push("");
    lines.push("```json");
    lines.push(safeJsonStringify(item.args));
    lines.push("```");
  }
  if (item.progressMessage) {
    lines.push("");
    lines.push(`_${item.progressMessage}_`);
  }
  if (item.partialOutput) {
    lines.push("");
    lines.push("**Output:**");
    lines.push("");
    lines.push("```");
    lines.push(item.partialOutput);
    lines.push("```");
  }
  if (item.resultContent) {
    lines.push("");
    lines.push("**Result:**");
    lines.push("");
    lines.push("```");
    lines.push(item.resultContent);
    lines.push("```");
  }
  if (item.errorMessage) {
    lines.push("");
    const code = item.errorCode ? ` (${item.errorCode})` : "";
    lines.push(`**Error${code}:** ${item.errorMessage}`);
  }
  return lines.join("\n");
}

function renderSystem(item: ChatItem & { kind: "system" }): string {
  const icon = item.severity === "error" ? "🛑" : item.severity === "warn" ? "⚠️" : "ℹ️";
  return `> ${icon} ${item.text}`;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
