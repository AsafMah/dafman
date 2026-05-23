// Shared open-attachment helper.
//
// Used by both the composer's `AttachmentNode` (live pill click) and
// `UserMessageBody.vue` (sent message pill click) so the open behavior
// stays consistent: file / directory -> OS file explorer reveal,
// blob -> object-URL viewer window. Best-effort: errors are swallowed
// because this is an inspect convenience, not a critical path.

import { invokeCommand } from "../ipc/invoke";
import type { SendMessageAttachment } from "../ipc/types";
import { cleanTerminalCommandOutput } from "./ansi";

export async function openAttachment(a: SendMessageAttachment): Promise<void> {
  if (a.type === "commandResult") {
    const text = [
      "# Command result",
      "",
      `- Command: \`${a.result.command}\``,
      `- CWD: \`${a.result.cwd}\``,
      `- Shell: \`${a.result.shell}\``,
      `- Status: ${a.result.status}`,
      ...(typeof a.result.exitCode === "number" ? [`- Exit code: ${a.result.exitCode}`] : []),
      "",
      "## stdout",
      "```text",
      cleanTerminalCommandOutput(a.result.stdout) || "(empty)",
      "```",
      "",
      "## stderr",
      "```text",
      cleanTerminalCommandOutput(a.result.stderr) || "(empty)",
      "```",
    ].join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  if (a.type === "file" || a.type === "directory") {
    try {
      await invokeCommand("revealPath", { path: a.path });
    } catch {
      /* best-effort */
    }
    return;
  }
  if (a.type === "blob") {
    try {
      const bin = atob(a.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: a.mimeType });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      /* best-effort */
    }
  }
}
