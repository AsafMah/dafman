export const TOOL_OUTPUT_CAP_BYTES = 64 * 1024;

export function clampOutput(text: string): string {
  if (text.length <= TOOL_OUTPUT_CAP_BYTES) return text;

  let end = TOOL_OUTPUT_CAP_BYTES;
  // Don't cut in the middle of a surrogate pair (emoji / astral chars):
  // a lone high surrogate renders as mojibake (#108). If the last kept
  // code unit is a high surrogate, drop it into the truncated remainder.
  const lastUnit = text.charCodeAt(end - 1);

  if (lastUnit >= 0xd800 && lastUnit <= 0xdbff) end -= 1;

  const head = text.slice(0, end);

  return `${head}\n... [output truncated: ${text.length - end} more chars]`;
}

export function pickString(data: unknown, keys: readonly string[]): string {
  if (!data || typeof data !== 'object') return '';

  const obj = data as Record<string, unknown>;

  for (const key of keys) {
    const v = obj[key];

    if (typeof v === 'string') return v;
  }

  return '';
}

/// Unwrap the `<system_notification>...</system_notification>` envelope the
/// CLI runtime puts around `system.notification` event content
/// (`SystemNotificationData.content` —
/// node_modules/@github/copilot/copilot-sdk/generated/session-events.d.ts:3901).
/// The inner text is the message we want to surface; the tags themselves are
/// pure transport noise and must never reach the transcript as literal text.
/// Scoped to the exact tag name so unrelated user content is untouched; also
/// drops a dangling open tag that can arrive mid-stream before its close.
export function unwrapSystemNotification(content: string): string {
  return content.replace(/<\/?system_notification[^>]*>/gi, '').trim();
}

export function pickNumber(data: unknown, keys: readonly string[]): number | null {
  if (!data || typeof data !== 'object') return null;

  const obj = data as Record<string, unknown>;

  for (const key of keys) {
    const v = obj[key];

    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }

  return null;
}
